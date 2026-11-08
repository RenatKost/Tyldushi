// Web-first discovery. The registry holds ~138 thousand organizations, most of them without any web
// presence, so searching them one by one wastes the free search quota. Instead the bot searches the web
// for organizations that are visibly active ("благодійний фонд Одеса допомога ВПО"), recognises them in
// the registry by ЄДРПОУ code or by the exact quoted name, and puts them at the front of the queue
// together with the page where they were found.
import { query } from '../server/db.js';
import { coreName } from './names.js';
import { hostOf } from './enrich/crawl.js';
import { search } from './enrich/search.js';

const TOPICS = [
    'благодійний фонд {city} допомога',
    'волонтерський центр {city}',
    'громадська організація {city} допомога ветеранам',
    'допомога ВПО {city} благодійний фонд',
    'психологічна допомога військовим {city} безкоштовно',
    'гуманітарна допомога {city} фонд',
    'реабілітація військових {city} громадська організація',
    'допомога дітям {city} благодійний фонд',
    'притулок для тварин {city} громадська організація',
    'збір на ЗСУ {city} фонд',
    'допомога людям з інвалідністю {city} громадська організація',
    'допомога літнім людям {city} фонд',
];

// Odesa and its region first, then the rest of Ukraine.
const PLACES = [
    ['Одеса', 'Одеська область'], ['Одеська область', 'Одеська область'], ['Ізмаїл', 'Одеська область'],
    ['Чорноморськ', 'Одеська область'], ['Білгород-Дністровський', 'Одеська область'], ['Подільськ', 'Одеська область'],
    ['Київ', 'Київ'], ['Харків', 'Харківська область'], ['Дніпро', 'Дніпропетровська область'],
    ['Львів', 'Львівська область'], ['Миколаїв', 'Миколаївська область'], ['Запоріжжя', 'Запорізька область'],
    ['Херсон', 'Херсонська область'], ['Вінниця', 'Вінницька область'], ['Полтава', 'Полтавська область'],
    ['Чернігів', 'Чернігівська область'], ['Суми', 'Сумська область'], ['Житомир', 'Житомирська область'],
    ['Черкаси', 'Черкаська область'], ['Кропивницький', 'Кіровоградська область'], ['Хмельницький', 'Хмельницька область'],
    ['Рівне', 'Рівненська область'], ['Луцьк', 'Волинська область'], ['Тернопіль', 'Тернопільська область'],
    ['Івано-Франківськ', 'Івано-Франківська область'], ['Ужгород', 'Закарпатська область'], ['Чернівці', 'Чернівецька область'],
];

const REPEAT_AFTER_DAYS = 60;
const CODE_RE = /(?:ЄДРПОУ|ЕДРПОУ|ЕГРПОУ|код\s+(?:за\s+)?ЄДРПОУ|ідентифікаційний\s+код)\D{0,20}(\d{8})\b/gi;
// Quoted names: «Добре серце», "Добре серце", “Добре серце”.
const QUOTED_RE = /[«"“„]([^«»"“”„]{3,60})[»"”]/g;
const GENERIC_CORES = new Set(['НАДІЯ', 'ДОБРО', 'ДОПОМОГА', 'ЖИТТЯ', 'СВІТЛО', 'МРІЯ', 'ВІРА', 'ЛЮБОВ', 'ДОВІРА',
    'РАЗОМ', 'УКРАЇНА', 'ДІТИ', 'СЕРЦЕ', 'ДІМ', 'ВІДРОДЖЕННЯ', 'ПІДТРИМКА', 'ТУРБОТА', 'ДРУЗІ', 'СІМ\'Я', 'РОДИНА']);

export function allQueries() {
    const list = [];
    for (const [city, region] of PLACES) for (const t of TOPICS) list.push({ query: t.replace('{city}', city), region });
    return list;
}

/** ЄДРПОУ codes and quoted names mentioned in a search result. */
export function extractCandidates(result) {
    const text = `${result.title || ''}\n${result.content || ''}`;
    const codes = [...new Set([...text.matchAll(CODE_RE)].map(m => m[1]))];
    const names = new Set();
    for (const m of text.matchAll(QUOTED_RE)) {
        const core = m[1].replace(/\s+/g, ' ').trim();
        const upper = core.toUpperCase();
        // A single common word ("Надія") matches hundreds of registry names — not an identification.
        if (core.length < 4 || GENERIC_CORES.has(upper) || /^\d+$/.test(core)) continue;
        if (core.split(' ').length > 7) continue;
        names.add(core);
    }
    return { codes, names: [...names] };
}

async function matchCode(code) {
    const { rows } = await query(`SELECT id, status FROM organizations WHERE edrpou = $1`, [code]);
    return rows[0] || null;
}

/** An organization whose innermost quoted name equals the found name; ambiguous names are skipped. */
async function matchName(name, region) {
    const core = coreName(`«${name}»`).toUpperCase().replace(/[’`]/g, '\'');
    const { rows } = await query(
        `SELECT id, status, region FROM organizations
         WHERE replace(upper(name), '’', '''') LIKE $1 AND status <> 'hidden'
         LIMIT 6`,
        [`%«${core.replace(/[%_]/g, '')}»%`],
    );
    const local = rows.filter(r => r.region === region);
    if (local.length === 1) return local[0];
    if (rows.length === 1) return rows[0];
    return null;
}

async function nextQueries(limit) {
    const { rows } = await query(
        `SELECT query FROM discovery_queries WHERE last_run_at > now() - ($1 || ' days')::interval`,
        [String(REPEAT_AFTER_DAYS)],
    );
    const recent = new Set(rows.map(r => r.query));
    return allQueries().filter(q => !recent.has(q.query)).slice(0, limit);
}

/**
 * Runs up to `searches` discovery queries. Matched registry organizations (or ones rejected earlier
 * because the per-name search found nothing) go to the front of the enrichment queue.
 */
export async function discover({ searches = 6, log = console.log } = {}) {
    const stats = { queries: 0, results: 0, matched: 0, queued: 0, search_requests: 0 };
    for (const { query: q, region } of await nextQueries(searches)) {
        const results = await search(q, { maxResults: 10 });
        stats.queries++;
        stats.search_requests++;
        stats.results += results.length;
        let matched = 0;
        for (const r of results) {
            const { codes, names } = extractCandidates(r);
            const found = new Map();
            for (const code of codes) {
                const org = await matchCode(code);
                if (org) found.set(org.id, org);
            }
            if (!found.size) {
                for (const name of names.slice(0, 12)) {
                    const org = await matchName(name, region);
                    if (org) found.set(org.id, org);
                }
            }
            for (const org of found.values()) {
                matched++;
                if (!['registry', 'rejected_auto'].includes(org.status)) continue;
                const { rowCount } = await query(
                    `UPDATE organizations SET status = 'registry', discovered_at = now(),
                        discovery = $2, enrich_attempts = LEAST(enrich_attempts, 1), updated_at = now()
                     WHERE id = $1 AND status IN ('registry', 'rejected_auto') AND discovered_at IS NULL`,
                    [org.id, JSON.stringify({ query: q, url: r.url, host: hostOf(r.url), title: r.title, content: r.content.slice(0, 1500) })],
                );
                stats.queued += rowCount;
            }
        }
        stats.matched += matched;
        await query(
            `INSERT INTO discovery_queries (query, last_run_at, results, matched) VALUES ($1, now(), $2, $3)
             ON CONFLICT (query) DO UPDATE SET last_run_at = now(), results = $2, matched = $3`,
            [q, results.length, matched],
        );
        log(`  discover «${q}»: ${results.length} results, ${matched} matched`);
    }
    log(`[discover] ${JSON.stringify(stats)}`);
    return stats;
}
