// Enrichment pipeline for one organization: search → pick links → crawl → structure → save.
import { query } from '../../server/db.js';
import { updateOrg } from '../../server/lib/orgs.js';
import { normalizeCity } from '../geo.js';
import { extractPage, fetchHtml, hostOf, readTelegramChannel } from './crawl.js';
import { llmState, structureWithLlm, structureWithRules } from './llm.js';
import { storeFirstLogo } from './logo.js';
import { hostLooksLike, nameTokens, rankResults, searchName, verifySite } from './pick.js';
import { search } from './search.js';

const MAX_SUBPAGES = 4;
const MATERIALS_LIMIT = 30000;

function pageMaterial(page) {
    return `URL: ${page.url}\nЗАГОЛОВОК: ${page.title}\nОПИС: ${page.description}\nТЕКСТ:\n${page.text.slice(0, 3500)}`;
}

async function collect(org, log) {
    const name = searchName(org);
    const queries = [
        `"${name}" ${org.edrpou || ''}`.trim(),
        `"${name}" ${org.city || ''} ${org.org_type === 'charity_fund' ? 'благодійний фонд' : 'громадська організація'}`.replace(/\s+/g, ' '),
        `"${name}" facebook OR instagram OR telegram`,
    ];
    const results = [];
    for (const q of queries) results.push(...(await search(q)));
    const ranked = rankResults(org, results);
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

    const confidence = Math.max(0, Math.min(1, Number(profile.confidence) || 0));
    const status = confidence < 0.3 || !profile.description ? 'rejected_auto' : 'pending';
    await query(
        `UPDATE organizations SET status = $2, sources = $3, ai_confidence = $4, enriched_at = now(), logo_checked_at = now(),
            enrich_error = $5, enrich_attempts = enrich_attempts + 1, updated_at = now()
         WHERE id = $1`,
        [org.id, status, JSON.stringify(sources), confidence,
            status === 'rejected_auto' ? 'Низька впевненість у знайдених даних' : (usedLlm ? null : 'Зібрано без AI')],
    );
    log(`  ✓ ${status} (confidence ${confidence.toFixed(2)}, ${cases.length} cases, ${usedLlm ? llmState.model : 'rules'})`);
    return status;
}

/** Picks the next organizations from the queue and enriches them one by one. */
export async function enrichBatch({ limit, ids, log = console.log, onPending }) {
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
                ORDER BY priority DESC, registered_at DESC NULLS LAST
                LIMIT $1 FOR UPDATE SKIP LOCKED)
             RETURNING *`,
            [limit],
        );

    const stats = { processed: 0, pending: 0, rejected_auto: 0, errors: 0 };
    for (const org of rows) {
        try {
            const status = await enrichOne(org, log);
            stats.processed++;
            stats[status] = (stats[status] || 0) + 1;
            if (status === 'pending' && onPending) {
                await onPending(org.id).catch(err => log(`  ! telegram: ${err.message}`));
            }
        } catch (err) {
            stats.errors++;
            log(`  ! error: ${err.message}`);
            await query(
                `UPDATE organizations SET status = 'registry', enrich_attempts = enrich_attempts + 1,
                    enrich_error = $2, updated_at = now() WHERE id = $1`,
                [org.id, String(err.message).slice(0, 500)],
            );
        }
    }
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
