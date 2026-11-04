// "Пошук по запиту": a person describes the problem in their own words and gets matching organizations.
// The request is turned into help categories + keywords by a synonym dictionary; for requests the
// dictionary does not understand, Gemini (free tier, no web search) is asked once and the answer cached.
import { query } from '../db.js';
import { CATEGORY_KEYS } from './categories.js';
import { AUDIENCE_KEYS, detectServices, SERVICE_KEYS, SERVICES, serviceByKey } from './services.js';

// Word stems (lower case, Ukrainian and Russian) that point to a help category.
const CATEGORY_HINTS = {
    military: ['військов', 'зсу', 'фронт', 'бригад', 'солдат', 'бійц', 'боєць', 'захисник', 'дрон', 'тактичн', 'бронежилет', 'амуніц', 'военн', 'армі', 'мобілізов'],
    veterans: ['ветеран', 'після фронту', 'з фронту', 'убд', 'учасник бойових', 'демобіліз', 'повернувся з фронту', 'загибл', 'полонен', 'зниклий безвісти', 'зниклого', 'родин військов', 'дружина військов', 'чоловік військов'],
    psychological: ['психолог', 'психотерап', 'птср', 'стрес', 'травм', 'депрес', 'тривог', 'панічн', 'посттравм', 'підтримк емоц', 'ментальн', 'горе', 'втрат', 'психіатр', 'кошмар', 'безсонн'],
    rehabilitation: ['реабіліт', 'протез', 'ампутац', 'фізіотерап', 'відновлен після поран', 'поранен', 'контузі', 'ерготерап', 'масаж', 'лфк'],
    medical: ['лік', 'медичн', 'лікар', 'операц', 'хвороб', 'аптек', 'медикамент', 'обстежен', 'діагност', 'онкол', 'лекарств', 'больниц', 'лікарн', 'стоматолог'],
    disability: ['інвалід', 'інвалідн', 'візок', 'особливими потреб', 'обмеженими можлив', 'інклюзі', 'глух', 'незряч', 'сліп'],
    legal: ['юрист', 'юридичн', 'адвокат', 'правов', 'суд', 'документ', 'посвідчен', 'статус', 'пільг', 'виплат', 'пенсі', 'оформит', 'довідк', 'тцк', 'відстрочк', 'спадщин', 'компенсац'],
    idp: ['впо', 'переселен', 'евакуац', 'біженц', 'переміщен', 'виїхал', 'окупац', 'деокупов'],
    housing: ['житл', 'квартир', 'оренд', 'ремонт', 'зруйнован', 'укритт', 'дах над головою', 'прихисток', 'гуртожит', 'відбудов'],
    humanitarian: ['гуманітар', 'продукт', 'їж', 'харч', 'одяг', 'гігієн', 'набір', 'продуктов', 'теплі речі', 'генератор', 'дров'],
    children: ['дит', 'діт', 'школ', 'садок', 'підліт', 'сирот', 'багатодітн', 'малюк', 'немовл'],
    elderly: ['літн', 'пенсіонер', 'людям похилого', 'старш вік', 'бабус', 'дідус', 'самотн'],
    education: ['навчан', 'освіт', 'курс', 'перекваліф', 'професі', 'студент', 'тренінг', 'робот', 'працевлашт', 'вакансі'],
    community: ['спорт', 'клуб', 'дозвілл', 'культур', 'молод', 'спільнот', 'зустріч'],
    animals: ['твари', 'собак', 'кіт', 'кот', 'кіш', 'притулок', 'ветеринар', 'цуцен', 'кошен'],
    ecology: ['еколог', 'довкілл', 'дерев', 'сміття', 'природ'],
};

// Extra category links: veterans' own needs usually mean the veteran-oriented organizations too.
const IMPLIES = { rehabilitation: ['medical'], disability: ['rehabilitation'] };

const STOP = new Set(['потрібна', 'потрібен', 'потрібно', 'потрібні', 'допомога', 'допомогу', 'допомоги', 'шукаю', 'хочу', 'треба',
    'нужна', 'нужен', 'нужно', 'помощь', 'помочь', 'який', 'яка', 'яке', 'які', 'для', 'мене', 'мені', 'мого', 'моєї', 'моєму',
    'моя', 'мій', 'моє', 'наша', 'наш', 'наші', 'щоб', 'чтобы', 'або', 'или', 'також', 'можна', 'можете', 'будь', 'ласка', 'дуже',
    'після', 'того', 'цього', 'взяти', 'знайти', 'отримати', 'де', 'має', 'мають', 'була', 'були', 'було', 'есть', 'якщо', 'если', 'одеса', 'одесі', 'одессе', 'одесса', 'місті', 'безкоштовно', 'безкоштовна']);

// Stems that appear in almost every description and would match everything.
const GENERIC_STEMS = ['допом', 'підтрим', 'організ', 'фонд', 'благод', 'громад', 'волонт', 'люд', 'діяльн', 'україн',
    'проєкт', 'проект', 'потреб', 'соціальн', 'сприя', 'надан', 'помощ', 'послуг'];

const isGeneric = word => GENERIC_STEMS.some(stem => word.startsWith(stem) || stem.startsWith(word));

export function normalizeQuery(q) {
    return String(q || '').toLowerCase().replace(/[^\p{L}\p{N}'’ʼ\s-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** Dictionary-based interpretation. Returns { categories, keywords }. */
export function interpretByRules(q) {
    const text = ` ${normalizeQuery(q)} `;
    const categories = new Set();
    for (const [key, stems] of Object.entries(CATEGORY_HINTS)) {
        if (stems.some(stem => text.includes(stem))) categories.add(key);
    }
    for (const key of [...categories]) for (const extra of IMPLIES[key] || []) categories.add(extra);
    const keywords = [...new Set(text.split(/[\s-]+/)
        .filter(w => w.length >= 4 && !STOP.has(w) && !isGeneric(w))
        .map(w => (w.length > 6 ? w.slice(0, w.length - 2) : w)))]
        .slice(0, 8);
    const { services, audiences } = detectServices(text);
    return { categories: [...categories], keywords, services, audiences };
}

/* ---------- Gemini (optional) ---------- */

let ai = null;
let aiState = { calls: [], disabledUntil: 0 };

async function gemini() {
    if (!process.env.GEMINI_API_KEY) return null;
    if (!ai) {
        const { GoogleGenAI } = await import('@google/genai');
        ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }
    return ai;
}

async function interpretByAi(q) {
    const client = await gemini();
    if (!client || Date.now() < aiState.disabledUntil) return null;
    aiState.calls = aiState.calls.filter(t => t > Date.now() - 60000);
    if (aiState.calls.length >= 20) return null;
    aiState.calls.push(Date.now());
    const { Type } = await import('@google/genai');
    try {
        const res = await client.models.generateContent({
            model: process.env.GEMINI_MATCH_MODEL || 'gemini-flash-lite-latest',
            contents: `Людина шукає допомогу благодійної або громадської організації в Україні. Її запит: «${q}».
Визнач:
- services — 1–3 конкретні послуги, які їй потрібні (лише ключі зі списку нижче; не додавай «про всяк випадок»);
- audiences — для кого допомога (${AUDIENCE_KEYS.join(', ')});
- categories — ширші напрями (${CATEGORY_KEYS.join(', ')});
- keywords — до 5 коротких основ слів українською для пошуку в описах.
Послуги:
${SERVICES.map(s => `${s.key} — ${s.label}`).join('; ')}`,
            config: {
                responseMimeType: 'application/json',
                temperature: 0,
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        services: { type: Type.ARRAY, items: { type: Type.STRING, enum: SERVICE_KEYS } },
                        audiences: { type: Type.ARRAY, items: { type: Type.STRING, enum: AUDIENCE_KEYS } },
                        categories: { type: Type.ARRAY, items: { type: Type.STRING, enum: CATEGORY_KEYS } },
                        keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ['services', 'audiences', 'categories', 'keywords'],
                },
            },
        });
        const data = JSON.parse(res.text);
        return {
            services: (data.services || []).filter(k => SERVICE_KEYS.includes(k)).slice(0, 3),
            audiences: (data.audiences || []).filter(k => AUDIENCE_KEYS.includes(k)),
            categories: (data.categories || []).filter(k => CATEGORY_KEYS.includes(k)),
            keywords: (data.keywords || []).map(k => normalizeQuery(k)).filter(k => k.length >= 3 && !isGeneric(k)).slice(0, 5),
        };
    } catch (err) {
        // Quota or overload: stop asking for a while, the dictionary keeps working.
        if (err.status === 429 || err.status === 503) aiState.disabledUntil = Date.now() + 10 * 60 * 1000;
        return null;
    }
}

const AI_WAIT_MS = Number(process.env.MATCH_AI_WAIT_MS || 1500);

/** Combines the dictionary with a cached Gemini interpretation. */
export async function interpret(q) {
    const key = normalizeQuery(q);
    if (!key) return { categories: [], keywords: [], services: [], audiences: [], via: 'empty' };
    const rules = interpretByRules(key);

    const { rows } = await query(`SELECT result FROM query_cache WHERE query = $1 AND created_at > now() - interval '30 days'`, [key]);
    let ai = rows[0]?.result || null;
    if (!ai && key.split(' ').length >= 2) {
        // Gemini can take tens of seconds when overloaded. People get the dictionary result within ~1.5 s;
        // a late answer is still cached, so the same request is refined next time.
        const pending = interpretByAi(key).then(async result => {
            if (result) {
                await query(`INSERT INTO query_cache (query, result) VALUES ($1, $2)
                             ON CONFLICT (query) DO UPDATE SET result = $2, created_at = now()`, [key, JSON.stringify(result)]);
            }
            return result;
        }).catch(() => null);
        ai = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve(null), AI_WAIT_MS))]);
    }
    // The dictionary is precise when it recognises a service; Gemini fills the gaps for free wording.
    const services = rules.services.length ? [...new Set([...rules.services, ...(ai?.services || [])])].slice(0, 4) : (ai?.services || []);
    const categories = [...new Set([
        ...rules.categories, ...(ai?.categories || []),
        ...services.map(k => serviceByKey[k]?.category).filter(Boolean),
    ])];
    return {
        services,
        audiences: [...new Set([...rules.audiences, ...(ai?.audiences || [])])],
        categories,
        keywords: [...new Set([...rules.keywords, ...(ai?.keywords || []).filter(k => !isGeneric(k))])].slice(0, 10),
        via: ai ? 'ai' : 'rules',
    };
}

/**
 * Ranks published organizations against a request in two tiers:
 *  - items:   organizations that provide one of the requested services (with evidence);
 *  - related: organizations that only share a broader direction ("Можливо, також допоможуть").
 * `service` (a chip the person clicked) narrows the request to one exact service.
 */
export async function matchOrganizations(q, { city, service } = {}) {
    const meaning = await interpret(q);
    if (service && serviceByKey[service]) {
        meaning.services = [service];
        meaning.categories = [...new Set([serviceByKey[service].category, ...meaning.categories])];
    }
    const empty = { ...meaning, items: [], related: [], suggestions: [], total: 0 };
    if (!meaning.services.length && !meaning.categories.length && !meaning.keywords.length) return empty;

    // A request without a concrete service ("гуманітарна допомога") searches all services of its directions.
    const wanted = meaning.services.length
        ? meaning.services
        : SERVICES.filter(s => meaning.categories.includes(s.category)).map(s => s.key);

    const params = [wanted, meaning.audiences, meaning.categories, meaning.keywords.map(k => `%${k}%`)];
    let cityFilter = '';
    if (city) {
        params.push(city);
        cityFilter = `AND o.city = $${params.length}`;
    }
    const { rows } = await query(
        `WITH scored AS (
            SELECT o.id,
                   (SELECT count(*) FROM organization_services s
                     WHERE s.organization_id = o.id AND s.service = ANY($1::text[]))::int AS svc_hits,
                   (SELECT count(*) FROM organization_services s
                     WHERE s.organization_id = o.id AND s.service = ANY($1::text[]) AND s.audiences && $2::text[])::int AS aud_hits,
                   (SELECT json_agg(json_build_object('service', s.service, 'quote', s.quote, 'source_url', s.source_url))
                      FROM organization_services s
                     WHERE s.organization_id = o.id AND s.service = ANY($1::text[])) AS matched_services,
                   cardinality(ARRAY(SELECT unnest(o.help_categories) INTERSECT SELECT unnest($3::text[]))) AS cat_hits,
                   (SELECT count(*) FROM unnest($4::text[]) k
                     WHERE lower(o.name || ' ' || coalesce(o.description, '') || ' ' || coalesce(
                        (SELECT string_agg(c.title || ' ' || coalesce(c.description, ''), ' ')
                           FROM organization_cases c WHERE c.organization_id = o.id), '')) LIKE k)::int AS word_hits,
                   ARRAY(SELECT unnest(o.help_categories) INTERSECT SELECT unnest($3::text[])) AS matched
            FROM organizations o
            WHERE o.status = 'approved' ${cityFilter}
        )
        SELECT o.id, o.slug, o.edrpou, o.name, o.short_name, o.org_type, o.city, o.region, o.help_categories, o.logo_url,
               o.is_featured, o.contacts, o.activity_score, o.activity_level, o.verified_by_fund, o.review_count, o.review_avg,
               to_char(o.last_activity_at, 'YYYY-MM-DD') AS last_activity_at,
               left(coalesce(o.description, ''), 600) AS excerpt,
               o.description AS full_description,
               ARRAY(SELECT c.title || '. ' || coalesce(c.description, '') FROM organization_cases c
                     WHERE c.organization_id = o.id ORDER BY c.happened_at DESC NULLS LAST LIMIT 10) AS case_texts,
               (SELECT count(*)::int FROM organization_cases c WHERE c.organization_id = o.id) AS cases_count,
               s.matched, s.matched_services, s.svc_hits, s.cat_hits, s.word_hits,
               (s.svc_hits * 10 + s.aud_hits * 3 + s.word_hits * 2 + s.cat_hits + o.activity_score / 20.0) AS relevance
        FROM scored s JOIN organizations o ON o.id = s.id
        WHERE s.svc_hits > 0 OR s.cat_hits > 0 OR s.word_hits > 0
        ORDER BY relevance DESC, o.activity_score DESC, o.name
        LIMIT 80`,
        params,
    );

    const toCard = ({ full_description, case_texts, matched_services, svc_hits, cat_hits, word_hits, ...org }) => {
        const evidence = (matched_services || []).find(m => m.quote) || (matched_services || [])[0];
        const hint = evidence
            ? {
                source: 'service',
                label: serviceByKey[evidence.service]?.label,
                text: evidence.quote || null,
                url: evidence.source_url || null,
            }
            : helpHint(full_description, case_texts, meaning);
        return { ...org, services_matched: (matched_services || []).map(m => m.service), help_hint: hint };
    };

    const exact = rows.filter(r => r.svc_hits > 0).slice(0, 30).map(toCard);
    // Related: works in the main direction of the requested service (протез → реабілітація), or shares
    // a broader direction AND mentions something from the request, so the list is never random.
    const primary = new Set(meaning.services.map(k => serviceByKey[k]?.category).filter(Boolean));
    const related = rows
        .filter(r => r.svc_hits === 0 && r.cat_hits > 0
            && (r.word_hits > 0 || !meaning.keywords.length || (r.help_categories || []).some(c => primary.has(c))))
        .slice(0, 9)
        .map(toCard);

    return { ...meaning, items: exact, related, suggestions: await suggestServices(meaning, wanted, city), total: exact.length };
}

/**
 * Chips that help to say precisely what is needed: services of the requested directions that at
 * least one published organization actually provides.
 */
async function suggestServices(meaning, wanted, city) {
    const pool = SERVICES.filter(s => meaning.categories.includes(s.category) || wanted.includes(s.key)).map(s => s.key);
    if (!pool.length) return [];
    const params = [pool];
    let cityFilter = '';
    if (city) {
        params.push(city);
        cityFilter = `AND o.city = $2`;
    }
    const { rows } = await query(
        `SELECT s.service, count(DISTINCT s.organization_id)::int AS n
         FROM organization_services s JOIN organizations o ON o.id = s.organization_id
         WHERE o.status = 'approved' AND s.service = ANY($1::text[]) ${cityFilter}
         GROUP BY s.service ORDER BY n DESC`,
        params,
    );
    const selected = new Set(meaning.services);
    return rows
        .filter(r => !(selected.size === 1 && selected.has(r.service)))
        .slice(0, 8)
        .map(r => ({ key: r.service, label: serviceByKey[r.service].label, count: r.n, selected: selected.has(r.service) }));
}

/**
 * The sentence from an organization's own description or cases that best answers the request,
 * e.g. "Надають безкоштовні консультації психолога ветеранам та їхнім сім'ям." Extractive only:
 * nothing is invented, the text is the organization's.
 */
export function helpHint(description, caseTexts, meaning) {
    const stems = [
        ...meaning.keywords,
        ...meaning.categories.flatMap(k => CATEGORY_HINTS[k] || []).filter(s => !s.includes(' ')),
    ].map(s => s.toLowerCase());
    if (!stems.length) return null;

    const sentences = [];
    const SPLIT = new RegExp('(?<=[.!?…])\\s+|\\n+');
    for (const [source, text] of [['case', (caseTexts || []).join('\n')], ['about', description || '']]) {
        for (const raw of String(text).split(SPLIT)) {
            const sentence = raw.trim();
            if (sentence.length >= 25 && sentence.length <= 400) sentences.push({ source, sentence });
        }
    }
    let best = null;
    for (const item of sentences) {
        const lower = item.sentence.toLowerCase();
        const hits = new Set(stems.filter(stem => lower.includes(stem))).size;
        if (!hits) continue;
        // Registry boilerplate ("зареєстрована…", "ЄДРПОУ…") is never a good answer.
        const penalty = /зареєстрован|єдрпоу|ідентифікаційн|юридичн/i.test(lower) ? 2 : 0;
        const score = hits * 2 + (item.source === 'case' ? 1 : 0) - penalty;
        if (!best || score > best.score) best = { ...item, score };
    }
    if (!best || best.score <= 0) return null;
    const text = best.sentence.length > 220 ? `${best.sentence.slice(0, 217).replace(/\s+\S*$/, '')}…` : best.sentence;
    return { text, source: best.source };
}
