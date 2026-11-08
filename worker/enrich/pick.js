// Chooses the official website and social profiles of an organization among search results.
import { slugify } from '../../server/lib/slug.js';
import { coreName } from '../names.js';
import { hostOf, isProfileUrl, socialKind } from './crawl.js';

// Registries, aggregators and catalogs: useful as confirmation, never the organization's own site.
const AGGREGATORS = /(opendatabot|youcontrol|clarity-project|ring\.org|edr\.|vkursi|kompass|rusprofile|zakon\.rada|prozorro|dozorro|010\.ua|008\.ua|ua-region|ua\.all-biz|catalog|spravochnik|businessguide|minjust|data\.gov|wikipedia|wikidata|google\.|goo\.gl|maps\.|linkedin|twitter\.com|x\.com|pinterest|olx|prom\.ua|rozetka|zhitlo|biz\.ligazakon|nais\.gov|tax\.gov|e-data|smida|charity\.in\.ua|gromada|decentralization|irs\.gov|dovidnyk|infopro|ua\.kompanii|kompanii|firms\.|company\.|companies\.|clarity|youscore|checkfirm|sumy-index|yellowpages|golden-pages|zoon|2gis|vsetovary|uaprom|tender|zvitnist|liqpay|monobank|privat24|privatbank|fondy|wayforpay|portmone|platon|dobro\.ua|gofundme|patreon|buymeacoffee|linktr\.ee|taplink|history\.org\.ua|reyestr|ukrstat|spending|nashigroshi|opencorporates|bizzy|ua\.biz|gov\.ua|court)/i;

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
            // The profile title itself must carry the name, not just a post that mentions it.
            if (isProfileUrl(r.url) && tokenScore(r.title || '', tokens) >= 0.6 && !socials[kind]) socials[kind] = r.url.replace(/\?.*$/, '');
            continue;
        }
        if (MEDIA.test(host)) continue;
        const domainMatch = hostLooksLike(host, tokens);
        const titleMatch = tokenScore(r.title || '', tokens);
        const score = titleMatch * 2 + (domainMatch ? 2 : 0) + (hasCode ? 1.5 : 0) + (r.discovered ? 0.5 : 0)
            + (/фонд|благодій|громадськ|волонтер|допомог/i.test(blob) ? 0.5 : 0);
        // A page that shows the organization's ЄДРПОУ code, or the page discovery found it on, is a candidate
        // even when the domain is a foreign spelling (caritas.od.ua for «Карітас»): verifySite checks it later.
        const strong = hasCode || (r.discovered && match >= 0.5);
        if (!strong && (match < 0.5 || (titleMatch < 0.6 && !domainMatch))) continue;
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

/** True when the domain looks like a transliteration of the organization's name. */
export function hostLooksLike(host, tokens) {
    const compact = String(host).replace(/[^a-z0-9]/g, '');
    return tokens.some(t => {
        const slug = slugify(t).replace(/-/g, '');
        return slug.length >= 4 && compact.includes(slug.slice(0, Math.min(slug.length, 6)));
    });
}

/**
 * Confirms that a fetched homepage belongs to the organization. Words from the name somewhere in
 * the text are not enough (news sites and catalogs mention many funds): the page must present
 * itself as the organization — name in the title, description, site name or main heading, its
 * own registry code, or a domain derived from the name.
 */
export function verifySite(org, page, tokens) {
    const identity = [page.title, page.description, page.siteName, ...(page.headings || [])].filter(Boolean).join('\n');
    if (org.edrpou && `${identity}\n${page.text || ''}`.includes(org.edrpou)) return 1;
    const idScore = tokenScore(identity, tokens);
    if (idScore >= 0.6) return idScore;
    if (page.url && hostLooksLike(hostOf(page.url), tokens) && tokenScore((page.text || '').slice(0, 5000), tokens) >= 0.6) return 0.7;
    return Math.min(0.3, idScore);
}
