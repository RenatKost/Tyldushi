// Chooses the official website and social profiles of an organization among search results.
import { coreName } from '../names.js';
import { hostOf, socialKind } from './crawl.js';

// Registries, aggregators and catalogs: useful as confirmation, never the organization's own site.
const AGGREGATORS = /(opendatabot|youcontrol|clarity-project|ring\.org|edr\.|vkursi|kompass|rusprofile|zakon\.rada|prozorro|dozorro|010\.ua|008\.ua|ua-region|ua\.all-biz|catalog|spravochnik|businessguide|minjust|data\.gov|wikipedia|wikidata|google\.|goo\.gl|maps\.|linkedin|twitter\.com|x\.com|pinterest|olx|prom\.ua|rozetka|zhitlo|biz\.ligazakon|nais\.gov|tax\.gov|e-data|smida|charity\.in\.ua|gromada|decentralization|irs\.gov|dovidnyk|infopro|ua\.kompanii|kompanii|firms\.|company\.|companies\.|clarity|youscore|checkfirm|sumy-index|yellowpages|golden-pages|zoon|2gis|vsetovary|uaprom|tender)/i;

// Big media and portals: articles may be good case sources but are not the official site.
const MEDIA = /(pravda\.com\.ua|ukrinform|unian|tsn\.ua|rbc\.ua|nv\.ua|suspilne|radiosvoboda|bbc\.|lb\.ua|hromadske|focus\.ua|censor|obozrevatel|segodnya|zn\.ua|gazeta\.ua|24tv|glavcom|ain\.ua|dou\.ua|youtube|facebook|instagram|t\.me|tiktok|gov\.ua)/i;

const GENERIC = new Set(['БЛАГОДІЙНА', 'БЛАГОДІЙНИЙ', 'ОРГАНІЗАЦІЯ', 'ГРОМАДСЬКА', 'ФОНД', 'МІЖНАРОДНИЙ', 'МІЖНАРОДНА',
    'ВСЕУКРАЇНСЬКА', 'ВСЕУКРАЇНСЬКИЙ', 'УКРАЇНСЬКА', 'УКРАЇНСЬКИЙ', 'СПІЛКА', 'ОБЛАСНА', 'МІСЬКА', 'РАЙОННА', 'ВІДДІЛЕННЯ',
    'ЦЕНТР', 'АСОЦІАЦІЯ', 'ОБ’ЄДНАННЯ', 'ОБ\'ЄДНАННЯ', 'КИЇВСЬКА', 'ЛЬВІВСЬКА', 'ХАРКІВСЬКА', 'ОДЕСЬКА', 'НАЦІОНАЛЬНА']);

const words = text => String(text).toUpperCase().split(/[^А-ЯІЇЄҐA-Z0-9’']+/).filter(w => w.length >= 3 && !GENERIC.has(w));

/** Words that identify the organization: the innermost quoted part of the name, otherwise rare words. */
export function nameTokens(name) {
    const core = words(coreName(name));
    return core.length ? core : words(name);
}

/** Search-friendly name: the innermost quoted part if present, otherwise the full name. */
export function searchName(org) {
    return coreName(org.name || org.short_name || '').replace(/[«»"]/g, '');
}

function tokenScore(text, tokens) {
    if (!tokens.length) return 0;
    const upper = text.toUpperCase();
    return tokens.filter(t => upper.includes(t)).length / tokens.length;
}

/** Ranks search results. Returns { websites: [...], socials: {...}, confirmations: [...] } */
export function rankResults(org, results) {
    const tokens = nameTokens(org.name);
    const seen = new Set();
    const sites = new Map();
    const socials = {};
    const confirmations = [];

    for (const r of results) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        const host = hostOf(r.url);
        const blob = `${r.title} ${r.content} ${r.url}`;
        const match = tokenScore(blob, tokens);
        const hasCode = org.edrpou && blob.includes(org.edrpou);

        if (AGGREGATORS.test(host)) {
            if (hasCode) confirmations.push(r);
            continue;
        }
        const kind = socialKind(r.url);
        if (kind) {
            if (match >= 0.5 && !socials[kind]) socials[kind] = r.url.replace(/\?.*$/, '');
            continue;
        }
        if (MEDIA.test(host)) continue;
        const score = match * 2 + (hasCode ? 3 : 0) + (/фонд|благодій|громадськ|волонтер|допомог/i.test(blob) ? 0.5 : 0);
        if (match < 0.5 && !hasCode) continue;
        const prev = sites.get(host);
        const origin = (() => { try { return new URL(r.url).origin; } catch { return null; } })();
        if (origin && (!prev || prev.score < score)) sites.set(host, { url: origin, score, snippet: r });
    }

    return {
        websites: [...sites.values()].sort((a, b) => b.score - a.score).slice(0, 3),
        socials,
        confirmations: confirmations.slice(0, 3),
        tokens,
    };
}

/** Confirms that a fetched homepage belongs to the organization. */
export function verifySite(org, page, tokens) {
    const text = `${page.title}\n${page.description}\n${page.text}`;
    if (org.edrpou && text.includes(org.edrpou)) return 1;
    return tokenScore(text.slice(0, 20000), tokens);
}
