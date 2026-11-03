// Turns collected page texts into a structured profile with Google Gemini (free tier).
// Falls back to rule-based extraction when no key is configured or the quota is exhausted.
import { GoogleGenAI, Type } from '@google/genai';
import { CATEGORIES, CATEGORY_KEYS, normalizeCategories } from '../../server/lib/categories.js';

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// Free-tier model names change over time, so a few aliases are tried in order.
const MODELS = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash']
    .filter(Boolean);
let modelIndex = 0;
let lastCall = 0;
const MIN_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS || 7000);

export const llmState = { calls: 0, quotaExhausted: false, model: null };
export const llmEnabled = Boolean(ai);

const SCHEMA = {
    type: Type.OBJECT,
    properties: {
        match_ok: { type: Type.BOOLEAN, description: 'true if the materials are really about this exact organization' },
        is_active: { type: Type.BOOLEAN, description: 'true if there are signs of activity in the last 2 years' },
        confidence: { type: Type.NUMBER, description: '0..1 how confident you are in the whole profile' },
        short_name: { type: Type.STRING, description: 'Short public name in Ukrainian, e.g. «Повернись живим»' },
        city: { type: Type.STRING, description: 'City where the organization works, in Ukrainian nominative case, or empty' },
        description: { type: Type.STRING, description: '2-4 paragraphs in Ukrainian: who they are, what they do, for whom' },
        help_categories: { type: Type.ARRAY, items: { type: Type.STRING, enum: CATEGORY_KEYS } },
        cases: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    date: { type: Type.STRING, description: 'YYYY-MM-DD or empty' },
                    source_url: { type: Type.STRING, description: 'one of the URLs given in the materials' },
                },
                required: ['title', 'description', 'source_url'],
            },
        },
    },
    required: ['match_ok', 'is_active', 'confidence', 'description', 'help_categories', 'cases'],
};

function buildPrompt(org, materials) {
    const categories = CATEGORIES.map(c => `${c.key} — ${c.label}`).join('\n');
    return `Ти допомагаєш вести каталог благодійних фондів і громадських організацій України.

Організація з державного реєстру:
- Назва: ${org.name}
- ЄДРПОУ: ${org.edrpou || 'невідомо'}
- Тип: ${org.org_type === 'charity_fund' ? 'благодійна організація' : 'громадська організація'}
- Місто (може бути невідоме): ${org.city || 'невідоме'}
${org.registry_purpose ? `- Мета діяльності з реєстру: ${org.registry_purpose}\n` : ''}
Нижче — тексти сторінок і результатів пошуку, які знайшов бот. Склади профіль організації українською.

Правила:
- Використовуй ЛИШЕ факти з наданих матеріалів. Нічого не вигадуй: краще порожнє поле, ніж здогадка.
- match_ok = false, якщо матеріали про іншу організацію з подібною назвою.
- Опис — нейтральний, без реклами, 2–4 абзаци: хто вони, що роблять, кому допомагають, як давно.
- Кейси — до 5 конкретних справ (збори, проєкти, передана допомога) з датою, якщо вона є. source_url має бути одним із URL у матеріалах.
- help_categories — лише ключі з цього списку:
${categories}

МАТЕРІАЛИ:
${materials}`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function structureWithLlm(org, materials) {
    if (!ai || llmState.quotaExhausted) return null;
    const wait = lastCall + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);

    // Overloaded (503) models are retried, then the next model is tried for this call only.
    let index = modelIndex;
    let retries = 0;
    while (index < MODELS.length) {
        const model = MODELS[index];
        lastCall = Date.now();
        try {
            const res = await ai.models.generateContent({
                model,
                contents: buildPrompt(org, materials),
                config: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2 },
            });
            llmState.calls++;
            llmState.model = model;
            const data = JSON.parse(res.text);
            data.help_categories = normalizeCategories(data.help_categories);
            return data;
        } catch (err) {
            const status = err.status || err.code || 0;
            const message = String(err.message || err);
            if (status === 404 || /not found|is not supported/i.test(message)) {
                console.warn(`[llm] model ${model} unavailable, trying next`);
                if (index === modelIndex) modelIndex++;
                index++;
                retries = 0;
                continue;
            }
            if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(message)) {
                console.warn('[llm] free quota exhausted, switching to rule-based mode for this run');
                llmState.quotaExhausted = true;
                return null;
            }
            if (status === 503 || status === 500 || /UNAVAILABLE|overloaded|high demand|INTERNAL/i.test(message)) {
                if (retries < 2) {
                    retries++;
                    await sleep(10000 * retries);
                    continue;
                }
                console.warn(`[llm] ${model} overloaded, trying next model`);
                index++;
                retries = 0;
                continue;
            }
            console.warn(`[llm] ${message.slice(0, 300)}`);
            return null;
        }
    }
    return null;
}

/* ---------- rule-based fallback ---------- */

const CATEGORY_KEYWORDS = {
    military: /військов|зсу|фронт|бригад|захисник|дрон|тактичн|бронежилет|позиці/i,
    idp: /переселен|впо|евакуац|біженц|вимушено переміщ/i,
    humanitarian: /гуманітарн|продуктов|набор|речі|одяг|гігієн/i,
    medical: /медичн|ліки|лікарн|лікуван|медикамент|здоров|операці/i,
    children: /діт|дитяч|сім['’]?|школ|сирот|батьк/i,
    veterans: /ветеран|учасник.{0,10}бойов|убд|родин загибл/i,
    psychological: /психолог|ментальн|травм|підтримк.{0,10}емоц/i,
    rehabilitation: /реабіліт|протез|відновлен.{0,10}здоров/i,
    elderly: /літні|пенсіонер|старш.{0,10}вік/i,
    disability: /інвалідн|особлив.{0,10}потреб|доступніст/i,
    animals: /тварин|притулок|собак|котів|котик|зоо/i,
    education: /освіт|навчан|курс|студент|бібліотек/i,
    legal: /юридичн|правов|адвокат|консультац.{0,10}прав/i,
    housing: /житл|відбудов|ремонт.{0,10}будин|укритт/i,
    community: /громад|культур|молод|спорт|мистецт|фестивал/i,
    ecology: /еколог|довкілл|дерев|сміття|природ/i,
};

export function guessCategories(text) {
    return Object.entries(CATEGORY_KEYWORDS).filter(([, re]) => re.test(text)).map(([k]) => k).slice(0, 5);
}

function firstParagraph(text, min = 120, max = 900) {
    const paragraphs = String(text || '').split('\n').map(p => p.trim()).filter(p => p.length >= min);
    return paragraphs[0] ? paragraphs[0].slice(0, max) : '';
}

/** Builds a draft profile without AI from the collected pages and channel posts. */
export function structureWithRules(org, { pages, telegram }) {
    const about = pages.find(p => /про[\s-]?нас|about|діяльн/i.test(p.url)) || pages[0];
    const description = (about && (firstParagraph(about.text) || about.description))
        || telegram?.description || org.registry_purpose || '';
    const allText = [description, ...pages.map(p => p.text.slice(0, 5000)), telegram?.description, ...(telegram?.posts || []).map(p => p.text)].join('\n');

    const cases = (telegram?.posts || []).slice(0, 4).map(p => {
        const [first, ...rest] = p.text.split('\n').filter(Boolean);
        return {
            title: first.slice(0, 140),
            description: rest.join(' ').slice(0, 500) || first.slice(140, 600),
            date: p.date || '',
            source_url: p.url || telegram.url,
        };
    });

    return {
        match_ok: true,
        is_active: Boolean(telegram?.posts?.length) || pages.length > 0,
        confidence: pages.length ? 0.5 : 0.35,
        short_name: '',
        city: '',
        description,
        help_categories: guessCategories(allText),
        cases,
    };
}
