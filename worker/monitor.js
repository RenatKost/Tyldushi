// Monitoring of published organizations. Free sources only:
//   daily  — public Telegram channels (t.me/s/<channel>);
//   weekly — YouTube channel RSS, the news section of the organization's site, Google News mentions.
// New items are stored in monitor_items; Gemini then turns the relevant ones into dated cases
// (the activity feed) and service evidence. Facebook/Instagram are not scraped: their rules forbid it.
import * as cheerio from 'cheerio';
import { query } from '../server/db.js';
import { displayName } from '../server/lib/display.js';
import { saveBotServices } from '../server/lib/orgs.js';
import { refreshRating } from '../server/lib/rating.js';
import { AUDIENCE_KEYS, cleanServiceList, SERVICE_KEYS, SERVICES } from '../server/lib/services.js';
import { extractPage, fetchHtml, readTelegramChannel } from './enrich/crawl.js';
import { telegramActivity } from './enrich/index.js';
import { generateJson, llmState, Type } from './enrich/llm.js';
import { nameTokens } from './enrich/pick.js';

const UA = 'Mozilla/5.0 (compatible; TyldushiBot/1.0; +https://tyldushi.com/organizations)';
const NEWS_RE = /(новин|news|блог|blog|поді|events?|звіт|report|актуальн|діяльн)/i;

async function saveItems(orgId, source, items) {
    let added = 0;
    for (const it of items) {
        if (!it.url) continue;
        const { rowCount } = await query(
            `INSERT INTO monitor_items (organization_id, source, url, title, text, published_at)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (organization_id, url) DO NOTHING`,
            [orgId, source, it.url.slice(0, 1000), (it.title || '').slice(0, 300), (it.text || '').slice(0, 3000),
                /^\d{4}-\d{2}-\d{2}$/.test(it.date || '') ? it.date : null],
        );
        added += rowCount;
    }
    return added;
}

/* ---------- Telegram (daily) ---------- */

export async function scanTelegram({ log = console.log } = {}) {
    const { rows } = await query(
        `SELECT id, contacts->>'telegram' AS telegram FROM organizations
         WHERE status = 'approved' AND contacts->>'telegram' IS NOT NULL
           AND (tg_checked_at IS NULL OR tg_checked_at < now() - interval '20 hours')
         ORDER BY tg_checked_at NULLS FIRST LIMIT 300`,
    );
    let added = 0;
    for (const org of rows) {
        const channel = await readTelegramChannel(org.telegram).catch(() => null);
        const { posts90, last } = telegramActivity(channel);
        await query(
            `UPDATE organizations SET tg_posts_90d = $2, tg_checked_at = now(),
                last_activity_at = CASE WHEN $3::date IS NULL THEN last_activity_at ELSE greatest(last_activity_at, $3::date) END
             WHERE id = $1`,
            [org.id, posts90, last],
        );
        if (channel?.posts?.length) {
            added += await saveItems(org.id, 'telegram', channel.posts.map(p => ({
                url: p.url, title: p.text.split('\n')[0], text: p.text, date: p.date,
            })));
        }
    }
    log(`[monitor] telegram: ${rows.length} channels, ${added} new posts`);
    return { channels: rows.length, new_posts: added };
}

/* ---------- Weekly: YouTube, site news, Google News ---------- */

async function youtubeChannelId(url) {
    const direct = String(url).match(/channel\/(UC[\w-]{22})/);
    if (direct) return direct[1];
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'uk' }, signal: AbortSignal.timeout(15000) });
        const html = await res.text();
        return html.match(/"(?:channelId|externalId)":"(UC[\w-]{22})"/)?.[1] || null;
    } catch {
        return null;
    }
}

async function youtubeItems(channelId) {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const $ = cheerio.load(await res.text(), { xmlMode: true });
    return $('entry').map((_, el) => ({
        url: $(el).find('link').attr('href'),
        title: $(el).find('title').first().text(),
        text: $(el).find('media\\:description').text(),
        date: $(el).find('published').text().slice(0, 10),
    })).get().slice(0, 10);
}

async function siteNewsItems(website) {
    const home = await fetchHtml(/^https?:/i.test(website) ? website : `https://${website}`);
    if (!home) return [];
    const page = extractPage(home);
    const newsPage = page.subpages.find(s => NEWS_RE.test(`${s.url} ${s.text}`));
    const source = newsPage ? await fetchHtml(newsPage.url) : home;
    if (!source) return [];
    const $ = cheerio.load(source.html);
    const seen = new Set();
    const items = [];
    $('article a[href], .news a[href], .post a[href], h2 a[href], h3 a[href]').each((_, el) => {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        let url;
        try {
            url = new URL($(el).attr('href'), source.url).href.split('#')[0];
        } catch {
            return;
        }
        if (text.length < 20 || seen.has(url) || new URL(url).host !== new URL(source.url).host) return;
        seen.add(url);
        const block = $(el).closest('article, .post, .news-item, li, .item');
        const date = (block.find('time').attr('datetime') || block.text().match(/(\d{4}-\d{2}-\d{2})/)?.[1] || '').slice(0, 10);
        items.push({ url, title: text, text: block.text().replace(/\s+/g, ' ').trim().slice(0, 800), date });
    });
    return items.slice(0, 10);
}

async function newsMentions(org) {
    const name = displayName(org);
    const place = org.city || (org.region ? org.region.replace(' область', '') : '');
    const q = `"${name}" ${place}`.trim();
    const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=uk&gl=UA&ceid=UA:uk`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const $ = cheerio.load(await res.text(), { xmlMode: true });
    const tokens = nameTokens(org.name);
    return $('item').map((_, el) => ({
        url: $(el).find('link').text(),
        title: $(el).find('title').text(),
        text: cheerio.load($(el).find('description').text()).text(),
        date: (() => {
            const d = new Date($(el).find('pubDate').text());
            return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
        })(),
    })).get()
        // The headline itself must name the organization; generic matches are noise.
        .filter(it => tokens.length && tokens.every(t => it.title.toUpperCase().includes(t)))
        .slice(0, 5);
}

export async function scanWeb({ limit = 40, log = console.log } = {}) {
    const { rows } = await query(
        `SELECT id, name, city, region, contacts, youtube_channel_id FROM organizations
         WHERE status = 'approved' AND (web_checked_at IS NULL OR web_checked_at < now() - interval '7 days')
         ORDER BY web_checked_at NULLS FIRST LIMIT $1`,
        [limit],
    );
    const stats = { organizations: rows.length, youtube: 0, site: 0, news: 0 };
    for (const org of rows) {
        const contacts = org.contacts || {};
        try {
            if (contacts.youtube) {
                const id = org.youtube_channel_id || (await youtubeChannelId(contacts.youtube));
                if (id) {
                    if (id !== org.youtube_channel_id) await query('UPDATE organizations SET youtube_channel_id = $2 WHERE id = $1', [org.id, id]);
                    stats.youtube += await saveItems(org.id, 'youtube', await youtubeItems(id));
                }
            }
            if (contacts.website) stats.site += await saveItems(org.id, 'site', await siteNewsItems(contacts.website));
            stats.news += await saveItems(org.id, 'news', await newsMentions(org));
        } catch (err) {
            log(`  ! web scan #${org.id}: ${err.message}`);
        }
        await query('UPDATE organizations SET web_checked_at = now() WHERE id = $1', [org.id]);
    }
    log(`[monitor] web: ${JSON.stringify(stats)}`);
    return stats;
}

/* ---------- Turning new items into cases and service evidence ---------- */

const ITEM_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        items: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    n: { type: Type.INTEGER, description: 'number of the material' },
                    relevant: { type: Type.BOOLEAN, description: 'true only if it reports what THIS organization did or does' },
                    kind: { type: Type.STRING, enum: ['aid', 'event', 'project', 'report', 'post'] },
                    title: { type: Type.STRING, description: 'short Ukrainian title of the deed, up to 90 characters' },
                    summary: { type: Type.STRING, description: '1–2 sentences in Ukrainian: what was done, for whom, how much' },
                    date: { type: Type.STRING, description: 'YYYY-MM-DD of the deed or publication, or empty' },
                    services: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                key: { type: Type.STRING, enum: SERVICE_KEYS },
                                quote: { type: Type.STRING },
                                audiences: { type: Type.ARRAY, items: { type: Type.STRING, enum: AUDIENCE_KEYS } },
                            },
                            required: ['key', 'quote'],
                        },
                    },
                },
                required: ['n', 'relevant'],
            },
        },
    },
    required: ['items'],
};

function itemsPrompt(org, items) {
    return `Організація: ${org.name} (${org.city || org.region || 'Україна'}).
Нижче — нові публікації з її Telegram-каналу, YouTube, сайту та новини, де її згадано.
Для кожного матеріалу визнач, чи він про те, що ЦЯ організація зробила або робить (передала допомогу, провела захід,
запустила проєкт, звітувала). Репости чужих зборів, привітання, мотиваційні пости й новини про інші організації — relevant = false.
Для релевантних: коротка назва, 1–2 речення суті (без вигадок, лише з тексту), дата і тип.
services — лише конкретні послуги, які організація САМА надає, з дослівною цитатою з матеріалу. Ключі:
${SERVICES.map(s => `${s.key} — ${s.label}`).join('; ')}

МАТЕРІАЛИ:
${items.map((it, i) => `#${i + 1} [${it.source}] ${it.published_at ? String(it.published_at).slice(0, 10) : 'без дати'} ${it.url}
${(it.title || '').slice(0, 200)}
${(it.text || '').slice(0, 900)}`).join('\n---\n')}`;
}

export async function processItems({ maxCalls = Number(process.env.MONITOR_LLM_DAILY || 40), log = console.log } = {}) {
    const { rows: orgs } = await query(
        `SELECT DISTINCT o.id, o.name, o.city, o.region FROM monitor_items m JOIN organizations o ON o.id = m.organization_id
         WHERE NOT m.processed AND o.status = 'approved' LIMIT $1`,
        [maxCalls],
    );
    const stats = { organizations: 0, items: 0, cases: 0, services: 0, calls_before: llmState.calls };
    for (const org of orgs) {
        if (llmState.quotaExhausted || llmState.calls - stats.calls_before >= maxCalls) break;
        const { rows: items } = await query(
            `SELECT id, source, url, title, text, to_char(published_at, 'YYYY-MM-DD') AS published_at FROM monitor_items
             WHERE organization_id = $1 AND NOT processed ORDER BY published_at DESC NULLS LAST LIMIT 15`,
            [org.id],
        );
        const result = await generateJson(itemsPrompt(org, items), ITEM_SCHEMA, { temperature: 0.1 });
        if (!result) break; // quota or outage: items stay unprocessed and are retried tomorrow
        stats.organizations++;
        for (const r of result.items || []) {
            const item = items[r.n - 1];
            if (!item) continue;
            await query('UPDATE monitor_items SET processed = TRUE, relevant = $2 WHERE id = $1', [item.id, Boolean(r.relevant)]);
            stats.items++;
            if (!r.relevant || !r.title) continue;
            const date = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : item.published_at;
            const { rowCount } = await query(
                `INSERT INTO organization_cases (organization_id, title, description, happened_at, source_url, position, kind, source)
                 VALUES ($1, $2, $3, $4, $5, 0, $6, 'monitor') ON CONFLICT DO NOTHING`,
                [org.id, r.title.slice(0, 300), (r.summary || '').slice(0, 2000), date, item.url,
                    ['aid', 'event', 'project', 'report', 'post'].includes(r.kind) ? r.kind : 'post'],
            );
            stats.cases += rowCount;
            const services = cleanServiceList((r.services || []).map(s => ({ ...s, source_url: item.url })));
            if (services.length) {
                await saveBotServices(org.id, services);
                stats.services += services.length;
            }
        }
        // Items the model skipped are marked processed too, so they are not sent again forever.
        await query('UPDATE monitor_items SET processed = TRUE WHERE id = ANY($1::int[]) AND NOT processed', [items.map(i => i.id)]);
        await refreshRating(org.id);
    }
    stats.llm_calls = llmState.calls - stats.calls_before;
    delete stats.calls_before;
    log(`[monitor] processed: ${JSON.stringify(stats)}`);
    return stats;
}

/* ---------- Services for organizations enriched before the service catalog existed ---------- */

export async function backfillServices({ limit = 10, log = console.log } = {}) {
    const { rows } = await query(
        `SELECT * FROM organizations
         WHERE status = 'approved' AND services_checked_at IS NULL
           AND (contacts->>'website' IS NOT NULL OR contacts->>'telegram' IS NOT NULL OR description IS NOT NULL)
         ORDER BY is_featured DESC, activity_score DESC LIMIT $1`,
        [limit],
    );
    let found = 0;
    for (const org of rows) {
        if (llmState.quotaExhausted) break;
        const contacts = org.contacts || {};
        const parts = [`ОПИС З КАТАЛОГУ:\n${org.description || ''}`];
        if (contacts.website) {
            const home = await fetchHtml(/^https?:/i.test(contacts.website) ? contacts.website : `https://${contacts.website}`);
            if (home) {
                const page = extractPage(home);
                parts.push(`URL: ${page.url}\n${page.title}\n${page.text.slice(0, 3000)}`);
                for (const sub of page.subpages.slice(0, 3)) {
                    const f = await fetchHtml(sub.url);
                    if (f) {
                        const p = extractPage(f);
                        parts.push(`URL: ${p.url}\n${p.title}\n${p.text.slice(0, 2500)}`);
                    }
                }
            }
        }
        if (contacts.telegram) {
            const tg = await readTelegramChannel(contacts.telegram).catch(() => null);
            if (tg) parts.push(`TELEGRAM ${tg.url}\n${tg.description}\n${tg.posts.map(p => `${p.url}\n${p.text.slice(0, 600)}`).join('\n---\n')}`);
        }
        const { structureWithLlm } = await import('./enrich/llm.js');
        const profile = await structureWithLlm(org, parts.join('\n\n=====\n\n').slice(0, 25000));
        if (!profile) break;
        await saveBotServices(org.id, (profile.services || []).filter(s => s.quote));
        found += (profile.services || []).filter(s => s.quote).length;
        await refreshRating(org.id);
        log(`  services #${org.id}: ${(profile.services || []).map(s => s.key).join(', ') || '—'}`);
    }
    return { organizations: rows.length, services: found };
}
