// Enrichment pipeline for one organization: search → pick links → crawl → structure → save.
import { query } from '../../server/db.js';
import { updateOrg } from '../../server/lib/orgs.js';
import { normalizeCity } from '../geo.js';
import { extractPage, fetchHtml, hostOf, readTelegramChannel } from './crawl.js';
import { llmState, structureWithLlm, structureWithRules } from './llm.js';
import { storeFirstLogo } from './logo.js';
import { hostLooksLike, nameTokens, rankResults, searchName, verifySite } from './pick.js';
import { refreshRating } from '../../server/lib/rating.js';
import { search, SearchUnavailableError, usage as searchUsage } from './search.js';

const MAX_SUBPAGES = 4;
const MATERIALS_LIMIT = 30000;

function pageMaterial(page) {
    return `URL: ${page.url}\nЗАГОЛОВОК: ${page.title}\nОПИС: ${page.description}\nТЕКСТ:\n${page.text.slice(0, 3500)}`;
}

let emptySearch = false;
const lastSearchWasEmpty = () => emptySearch;

async function collect(org, log) {
    // One search per organization fits the free Tavily plan (~30 organizations a day);
    // a second, broader query runs only when the first finds nothing about the organization.
    const name = searchName(org);
    const place = org.city || (org.region ? org.region.replace(' область', '') : '');
    const kind = org.org_type === 'charity_fund' ? 'благодійний фонд' : 'громадська організація';
    const results = await search(`"${name}" ${kind} ${place} ${org.edrpou || ''}`.replace(/\s+/g, ' ').trim());
    emptySearch = results.length === 0;
    let ranked = rankResults(org, results);
    if (!ranked.websites.length && !Object.keys(ranked.socials).length) {
        results.push(...(await search(`"${name}" ${place} facebook instagram telegram`.replace(/\s+/g, ' ').trim())));
        ranked = rankResults(org, results);
        emptySearch = results.length === 0;
    }
    log(`  search: ${results.length} results, ${ranked.websites.length} site candidates, socials: ${Object.keys(ranked.socials).join(', ') || '—'}`);

    // Official website: first candidate whose homepage mentions the organization.
    let site = null;
    const pages = [];
    for (const candidate of ranked.websites.slice(0, 2)) {
        const fetched = await fetchHtml(candidate.url);
        if (!fetched) continue;
        const home = extractPage(fetched);
        if (verifySite(org, home, ranked.tokens) >= 0.6) {
            site = candidate.url;
            pages.push(home);
            break;
        }
    }
    // Sites behind bot protection cannot be crawled; accepted only when the domain itself matches the name.
    const top = ranked.websites[0];
    if (!site && top && top.score >= 2.5 && hostLooksLike(hostOf(top.url), ranked.tokens)) site = top.url;

    if (pages.length) {
        for (const sub of pages[0].subpages.slice(0, MAX_SUBPAGES)) {
            const fetched = await fetchHtml(sub.url);
            if (fetched) pages.push(extractPage(fetched));
        }
    }

    // Social profiles linked from the official site are more trustworthy than search hits.
    const socials = { ...ranked.socials };
    for (const page of pages) Object.assign(socials, page.socials);

    const telegram = socials.telegram ? await readTelegramChannel(socials.telegram) : null;

    const snippets = results
        .filter(r => ranked.tokens.length && ranked.tokens.some(t => `${r.title} ${r.content}`.toUpperCase().includes(t)))
        .slice(0, 10);

    return { site, pages, socials, telegram, snippets, confirmations: ranked.confirmations, tokens: ranked.tokens };
}

/**
 * Logo sources, most reliable first: the verified official site, then the avatar of a Telegram
 * channel that is either linked from that site or clearly carries the organization's name.
 */
async function findLogo(org, { pages, telegram, tokens }) {
    const candidates = pages.flatMap(p => p.logos || []);
    if (telegram?.photo) {
        const linkedFromSite = pages.some(p => p.socials.telegram && p.socials.telegram.includes(telegram.url.split('/').pop()));
        const titled = verifySite(org, { title: telegram.title, description: telegram.description, text: '' }, tokens) >= 0.6;
        if (linkedFromSite || titled) candidates.push(telegram.photo);
    }
    return candidates.length ? storeFirstLogo([...new Set(candidates)]) : null;
}

function buildMaterials({ pages, telegram, snippets }) {
    const parts = pages.map(pageMaterial);
    if (telegram) {
        parts.push(`TELEGRAM-КАНАЛ ${telegram.url}\nОПИС: ${telegram.description}\nОСТАННІ ДОПИСИ:\n${
            telegram.posts.map(p => `[${p.date || 'без дати'}] ${p.url}\n${p.text.slice(0, 700)}`).join('\n---\n')}`);
    }
    if (snippets.length) {
        parts.push(`РЕЗУЛЬТАТИ ПОШУКУ:\n${snippets.map(s => `${s.url}\n${s.title}\n${s.content}`).join('\n---\n')}`);
    }
    return parts.join('\n\n=====\n\n').slice(0, MATERIALS_LIMIT);
}

function knownUrls({ pages, telegram, snippets, socials }) {
    const set = new Set();
    pages.forEach(p => set.add(p.url));
    telegram?.posts.forEach(p => p.url && set.add(p.url));
    if (telegram) set.add(telegram.url);
    snippets.forEach(s => set.add(s.url));
    Object.values(socials).forEach(u => set.add(u));
    return set;
}

async function markRejected(org, reason) {
    await query(
        `UPDATE organizations SET status = 'rejected_auto', enrich_error = $2, enriched_at = now(),
            enrich_attempts = enrich_attempts + 1, updated_at = now() WHERE id = $1`,
        [org.id, reason],
    );
}

/** Enriches one organization row. Returns the resulting status. */
export async function enrichOne(org, log = console.log) {
    log(`→ #${org.id} ${org.name} (${org.edrpou})`);
    const found = await collect(org, log);

    if (!found.site && !Object.keys(found.socials).length) {
        await markRejected(org, 'Не знайдено сайту чи соцмереж організації');
        log('  ✗ nothing found');
        return 'rejected_auto';
    }

    const materials = buildMaterials(found);
    const llmProfile = await structureWithLlm(org, materials);
    const profile = llmProfile || structureWithRules(org, found);
    const usedLlm = Boolean(llmProfile);

    if (!profile.match_ok) {
        await markRejected(org, 'Знайдені матеріали не стосуються цієї організації');
        log('  ✗ materials do not match');
        return 'rejected_auto';
    }

    const urls = knownUrls(found);
    const cases = (profile.cases || []).slice(0, 5).map(c => ({
        title: c.title,
        description: c.description,
        happened_at: /^\d{4}-\d{2}-\d{2}$/.test(c.date || '') ? c.date : null,
        source_url: urls.has(c.source_url) ? c.source_url : null,
        kind: ['aid', 'event', 'project', 'report'].includes(c.kind) ? c.kind : 'aid',
    }));

    const sitePages = found.pages;
    const contacts = {
        phone: [...new Set(sitePages.flatMap(p => p.phones))].slice(0, 2).join(', ') || undefined,
        email: [...new Set(sitePages.flatMap(p => p.emails))].slice(0, 2).join(', ') || undefined,
        website: found.site || undefined,
        ...found.socials,
    };

    const sources = [...new Set([
        found.site, ...sitePages.map(p => p.url), ...Object.values(found.socials), ...found.confirmations.map(c => c.url),
    ].filter(Boolean))].slice(0, 12);

    const patch = {
        description: profile.description || org.description,
        help_categories: profile.help_categories?.length ? profile.help_categories : org.help_categories,
        contacts: { ...org.contacts, ...Object.fromEntries(Object.entries(contacts).filter(([, v]) => v)) },
        cases,
    };
    if (profile.short_name && !org.short_name) patch.short_name = profile.short_name;
    if (!org.city && profile.city) patch.city = normalizeCity(profile.city);
    if (!org.logo_url) {
        const logo = await findLogo(org, found);
        if (logo) patch.logo_url = logo;
    }

    await updateOrg(org.id, patch);

    // No manual moderation: anything with confirmed information is published right away.
    const confidence = Math.max(0, Math.min(1, Number(profile.confidence) || 0));
    const status = confidence < 0.3 || !profile.description ? 'rejected_auto' : 'approved';
    await query(
        `UPDATE organizations SET status = $2, sources = $3, ai_confidence = $4, enriched_at = now(), logo_checked_at = now(),
            enrich_error = $5, enrich_attempts = enrich_attempts + 1, updated_at = now(),
            tg_posts_90d = $6, last_activity_at = greatest(last_activity_at, $7::date), tg_checked_at = now(),
            has_reports = $8
         WHERE id = $1`,
        [org.id, status, JSON.stringify(sources), confidence,
            status === 'rejected_auto' ? 'Низька впевненість у знайдених даних' : (usedLlm ? null : 'Зібрано без AI'),
            telegramActivity(found.telegram).posts90, telegramActivity(found.telegram).last,
            found.pages.some(p => /звіт|zvit|report/i.test(p.url) || (p.subpages || []).some(x => /звіт|zvit|report/i.test(`${x.url} ${x.text}`)))],
    );
    await refreshRating(org.id);
    log(`  ✓ ${status} (confidence ${confidence.toFixed(2)}, ${cases.length} cases, ${usedLlm ? llmState.model : 'rules'})`);
    return status;
}

/** Posts in the last 90 days and the date of the latest post of a public Telegram channel. */
export function telegramActivity(telegram) {
    const dates = (telegram?.posts || []).map(p => p.date).filter(Boolean).sort();
    const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    return { posts90: dates.filter(d => d >= since).length, last: dates[dates.length - 1] || null };
}

/** Picks the next organizations from the queue and enriches them one by one. */
export async function enrichBatch({ limit, ids, searchBudget = Infinity, log = console.log }) {
    // Only one worker runs at a time (advisory lock), so rows left in "enriching" are from an
    // interrupted run and go back to the queue.
    await query(`UPDATE organizations SET status = 'registry' WHERE status = 'enriching'`);

    const { rows } = ids?.length
        ? await query(`UPDATE organizations SET status = 'enriching', updated_at = now()
                       WHERE id = ANY($1::int[]) RETURNING *`, [ids])
        : await query(
            `UPDATE organizations SET status = 'enriching', updated_at = now()
             WHERE id IN (
                SELECT id FROM organizations
                WHERE status = 'registry' AND enrich_attempts < 3
                -- The focus region (Odesa first) is processed before the rest of Ukraine.
                ORDER BY (city = $2) DESC NULLS LAST, (region = $3) DESC NULLS LAST,
                         priority DESC, registered_at DESC NULLS LAST
                LIMIT $1 FOR UPDATE SKIP LOCKED)
             RETURNING *`,
            [limit, process.env.FOCUS_CITY || 'Одеса', process.env.FOCUS_REGION || 'Одеська область'],
        );

    const stats = { processed: 0, approved: 0, rejected_auto: 0, errors: 0, requeued: 0 };
    const requeue = async list => {
        if (!list.length) return;
        await query(`UPDATE organizations SET status = 'registry' WHERE id = ANY($1::int[])`, [list.map(o => o.id)]);
        stats.requeued += list.length;
    };

    let emptyStreak = [];
    for (const [i, org] of rows.entries()) {
        // Each organization needs up to two searches; stop before the daily search budget runs out.
        if (searchUsage.tavily + 2 > searchBudget) {
            log(`  · daily search budget (${searchBudget}) reached, ${rows.length - i} organizations wait for tomorrow`);
            await requeue(rows.slice(i));
            stats.budget_reached = true;
            break;
        }
        try {
            const status = await enrichOne(org, log);
            stats.processed++;
            stats[status] = (stats[status] || 0) + 1;
            // Five organizations in a row without a single search result means search is broken, not
            // that the organizations do not exist: undo those rejections and stop.
            emptyStreak = lastSearchWasEmpty() ? [...emptyStreak, org] : [];
            if (emptyStreak.length >= 5) {
                log('  ! search returns nothing — stopping, organizations go back to the queue');
                await requeue(emptyStreak);
                stats.rejected_auto -= emptyStreak.length;
                await requeue(rows.slice(i + 1));
                stats.search_broken = true;
                break;
            }
        } catch (err) {
            if (err instanceof SearchUnavailableError) {
                log(`  ! search unavailable (${err.message}) — stopping, organizations go back to the queue`);
                await requeue(rows.slice(i));
                stats.search_error = err.message;
                break;
            }
            stats.errors++;
            log(`  ! error: ${err.message}`);
            await query(
                `UPDATE organizations SET status = 'registry', enrich_attempts = enrich_attempts + 1,
                    enrich_error = $2, updated_at = now() WHERE id = $1`,
                [org.id, String(err.message).slice(0, 500)],
            );
        }
    }
    stats.search_requests = searchUsage.tavily;
    stats.llm_calls = llmState.calls;
    stats.llm_model = llmState.model;
    stats.llm_quota_exhausted = llmState.quotaExhausted;
    return stats;
}

/**
 * Re-checks logos of already moderated organizations (e.g. after the logo rules changed):
 * visits the known website and Telegram channel only, without a new web search.
 */
export async function refreshLogos({ limit = 50, log = console.log } = {}) {
    const { rows } = await query(
        `SELECT * FROM organizations
         WHERE status IN ('pending', 'approved', 'hidden') AND logo_checked_at IS NULL
         ORDER BY is_featured DESC, status = 'approved' DESC, id LIMIT $1`,
        [limit],
    );
    let found = 0;
    for (const org of rows) {
        const tokens = nameTokens(org.name);
        const pages = [];
        const website = org.contacts?.website;
        if (website) {
            const fetched = await fetchHtml(/^https?:/i.test(website) ? website : `https://${website}`);
            const home = fetched && extractPage(fetched);
            if (home && verifySite(org, home, tokens) >= 0.6) pages.push(home);
        }
        const telegram = org.contacts?.telegram ? await readTelegramChannel(org.contacts.telegram) : null;
        const logo = org.logo_url || (await findLogo(org, { pages, telegram, tokens }));
        await query('UPDATE organizations SET logo_url = $2, logo_checked_at = now() WHERE id = $1', [org.id, logo]);
        if (logo) found++;
        log(`  logo #${org.id}: ${logo || '—'}`);
    }
    return { checked: rows.length, found };
}
