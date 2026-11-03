// Polite page fetching and rule-based extraction (contacts, socials, texts, news).
import * as cheerio from 'cheerio';

const USER_AGENT = 'Mozilla/5.0 (compatible; TyldushiBot/1.0; +https://tyldushi.com/organizations)';
const MAX_BYTES = 1_500_000;

export const SOCIAL_HOSTS = {
    facebook: /(^|\.)(facebook\.com|fb\.com)$/,
    instagram: /(^|\.)instagram\.com$/,
    telegram: /^(t\.me|telegram\.me)$/,
    youtube: /(^|\.)(youtube\.com|youtu\.be)$/,
    tiktok: /(^|\.)tiktok\.com$/,
};

const robotsCache = new Map();
const lastHit = new Map();

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function hostOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
        return '';
    }
}

export function socialKind(url) {
    const host = hostOf(url);
    return Object.entries(SOCIAL_HOSTS).find(([, re]) => re.test(host))?.[0] || null;
}

async function allowedByRobots(url) {
    const u = new URL(url);
    if (!robotsCache.has(u.origin)) {
        let rules = [];
        try {
            const res = await fetch(`${u.origin}/robots.txt`, {
                headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000),
            });
            if (res.ok) {
                let applies = false;
                for (const raw of (await res.text()).split('\n')) {
                    const line = raw.split('#')[0].trim();
                    const [k, ...v] = line.split(':');
                    const key = (k || '').toLowerCase();
                    const value = v.join(':').trim();
                    if (key === 'user-agent') applies = value === '*' || /tyldushi/i.test(value);
                    else if (applies && key === 'disallow' && value) rules.push(value);
                }
            }
        } catch {
            rules = [];
        }
        robotsCache.set(u.origin, rules);
    }
    return !robotsCache.get(u.origin).some(prefix => u.pathname.startsWith(prefix));
}

/** Fetches an HTML page (respecting robots.txt and a per-host delay). Returns null on failure. */
export async function fetchHtml(url) {
    try {
        if (!/^https?:/i.test(url) || !(await allowedByRobots(url))) return null;
        const host = hostOf(url);
        const wait = (lastHit.get(host) || 0) + 1500 - Date.now();
        if (wait > 0) await sleep(wait);
        lastHit.set(host, Date.now());

        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'uk,en;q=0.5' },
            redirect: 'follow',
            signal: AbortSignal.timeout(15000),
        });
        if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return null;
        const reader = res.body.getReader();
        const chunks = [];
        let size = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            chunks.push(value);
            if (size > MAX_BYTES) {
                reader.cancel().catch(() => {});
                break;
            }
        }
        return { url: res.url || url, html: Buffer.concat(chunks).toString('utf8') };
    } catch {
        return null;
    }
}

// Ukrainian numbers only: area/operator codes start with 03..09; no longer digit runs (IBAN, ids).
const PHONE_RE = /(?<!\d)(?:\+?38[\s-]?)?\(?0[3-9]\d\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function normalizePhone(p) {
    const digits = p.replace(/\D/g, '');
    const local = digits.startsWith('380') ? digits.slice(2) : digits.startsWith('80') ? digits.slice(1) : digits;
    if (local.length !== 10 || !/^0([3-9]|800)/.test(local)) return null; // 0800 = free hotlines
    return `+38 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6, 8)} ${local.slice(8)}`;
}

const SUBPAGE_RE = /(про[\s-]?нас|about|контакт|contact|звіт|report|новин|news|проєкт|проект|project|діяльн|допомог|кейс|історі|наші[\s-]справи|результат|blog|блог)/i;

/** Extracts structured facts from an HTML page. */
export function extractPage({ url, html }) {
    const $ = cheerio.load(html);
    const base = new URL(url);
    const abs = href => {
        try {
            return new URL(href, base).href.split('#')[0];
        } catch {
            return null;
        }
    };

    const title = $('title').first().text().trim();
    const description = $('meta[name="description"]').attr('content')?.trim()
        || $('meta[property="og:description"]').attr('content')?.trim() || '';
    const ogImage = $('meta[property="og:image"]').attr('content');
    const logoImg = $('img').filter((_, el) => /logo|лого/i.test(`${$(el).attr('src')} ${$(el).attr('class')} ${$(el).attr('alt')} ${$(el).attr('id')}`)).first().attr('src');

    const links = [];
    const socials = {};
    const emails = new Set();
    const phones = new Set();

    $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (href.startsWith('mailto:')) emails.add(href.slice(7).split('?')[0].trim().toLowerCase());
        if (href.startsWith('tel:')) {
            const p = normalizePhone(href.slice(4));
            if (p) phones.add(p);
        }
        const link = abs(href);
        if (!link || !/^https?:/.test(link)) return;
        const kind = socialKind(link);
        if (kind) {
            const path = new URL(link).pathname;
            const isProfile = path.length > 1 && !/sharer|share\.php|intent|dialog|plugins|\/watch|\/\+|joinchat/i.test(link)
                && !(kind === 'telegram' && /bot\/?$/i.test(path));
            if (isProfile && !socials[kind]) socials[kind] = link.replace(/\?.*$/, '');
            return;
        }
        links.push({ url: link, text: $(el).text().replace(/\s+/g, ' ').trim().slice(0, 120), internal: hostOf(link) === hostOf(url) });
    });

    const clean = () => $('body').text().replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
    $('script, style, noscript, svg, iframe, form').remove();
    const fullText = clean();
    // Menus repeat on every page and drown the actual content.
    $('nav, header, [role="navigation"], .menu, .nav, .navbar, .breadcrumbs').remove();
    const text = clean();

    for (const m of fullText.match(EMAIL_RE) || []) {
        if (!/\.(png|jpe?g|gif|webp|svg)$/i.test(m) && !/example|sentry|wixpress|domain\.com/i.test(m)) emails.add(m.toLowerCase());
    }
    for (const m of fullText.match(PHONE_RE) || []) {
        const p = normalizePhone(m);
        if (p) phones.add(p);
    }

    const subpages = [...new Map(links
        .filter(l => l.internal && SUBPAGE_RE.test(`${l.text} ${l.url}`) && l.url !== url)
        .map(l => [l.url, l])).values()];

    return {
        url,
        title,
        description,
        logo: ogImage || logoImg ? abs(ogImage || logoImg) : null,
        text,
        links,
        subpages,
        socials,
        emails: [...emails].slice(0, 5),
        phones: [...phones].slice(0, 5),
    };
}

/** Reads the public preview of a Telegram channel: description and latest posts. */
export async function readTelegramChannel(channelUrl) {
    const m = channelUrl.match(/t(?:elegram)?\.me\/(?:s\/)?([A-Za-z0-9_]{4,})/);
    if (!m || /^(joinchat|addstickers|share|proxy)$/i.test(m[1])) return null;
    const page = await fetchHtml(`https://t.me/s/${m[1]}`);
    if (!page) return null;
    const $ = cheerio.load(page.html);
    const posts = $('.tgme_widget_message_wrap').map((_, el) => {
        const textEl = $(el).find('.tgme_widget_message_text').first();
        textEl.find('br').replaceWith('\n');
        return {
            text: textEl.text().trim(),
            date: $(el).find('.tgme_widget_message_date time').attr('datetime')?.slice(0, 10) || null,
            url: $(el).find('a.tgme_widget_message_date').attr('href') || null,
        };
    }).get().filter(p => p.text.length > 60).slice(-12).reverse();
    return {
        url: `https://t.me/${m[1]}`,
        title: $('.tgme_channel_info_header_title').text().trim(),
        description: $('.tgme_channel_info_description').text().trim(),
        posts,
    };
}
