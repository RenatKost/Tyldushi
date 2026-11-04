// Region of every organization from the tax service's register of non-profit organizations
// (data.gov.ua). The open ЄДР dump has no addresses, but this register names the regional tax office
// (c_sti) of each organization. Which office belongs to which region is learned from the data itself:
// most organizations registered with the Odesa office have "Одес..." in their names, and so on.
import { query } from '../server/db.js';

const DATASET_ID = 'f41f0e6d-135a-4ad9-b961-5da30bfc7a19';

// Name fragments → region. Order matters only for readability; each name votes once per match.
const REGION_HINTS = [
    ['Одеська область', /ОДЕС|ІЗМАЇЛ|ЧОРНОМОРСЬК|БІЛГОРОД-ДНІСТР/],
    ['Харківська область', /ХАРК/],
    ['Львівська область', /ЛЬВ[ІО]В/],
    ['Дніпропетровська область', /ДНІПР|КРИВОРІЗ|КРИВОГО РОГУ|КАМ.ЯНСЬК/],
    ['Запорізька область', /ЗАПОРІ|МЕЛІТОП|БЕРДЯН/],
    ['Миколаївська область', /МИКОЛА[ЇЄ]/],
    ['Вінницька область', /ВІНН/],
    ['Херсонська область', /ХЕРСОН/],
    ['Полтавська область', /ПОЛТАВ|КРЕМЕНЧ/],
    ['Чернігівська область', /ЧЕРНІГ/],
    ['Черкаська область', /ЧЕРКАС/],
    ['Житомирська область', /ЖИТОМИР/],
    ['Сумська область', /СУМСЬК|М\. СУМИ/],
    ['Хмельницька область', /ХМЕЛЬН/],
    ['Чернівецька область', /ЧЕРНІВ|БУКОВИН/],
    ['Рівненська область', /РІВН/],
    ['Івано-Франківська область', /ФРАНКІВ|ПРИКАРПАТ/],
    ['Тернопільська область', /ТЕРНОП/],
    ['Волинська область', /ВОЛИН|ЛУЦЬК/],
    ['Закарпатська область', /ЗАКАРПАТ|УЖГОРОД|МУКАЧ/],
    ['Кіровоградська область', /КІРОВОГРАД|КРОПИВН/],
    ['Донецька область', /ДОНЕЦЬК|КРАМАТОР|МАРІУПОЛ|СЛОВ.ЯНСЬК|БАХМУТ/],
    ['Луганська область', /ЛУГАНСЬК|СЄВЄРОДОН|ЛИСИЧАН/],
    ['Київська область', /КИЇВСЬК\S* ОБЛАС|БРОВАР|БІЛОЦЕРК|БІЛОЇ ЦЕРКВИ|ІРПІН|БУЧАНСЬК/],
    ['м. Київ', /КИЄВА|М\. КИЇВ|КИЇВСЬК\S* МІСЬК/],
];

const CITY_REGION = {
    'Київ': 'м. Київ', 'Харків': 'Харківська область', 'Одеса': 'Одеська область', 'Дніпро': 'Дніпропетровська область',
    'Львів': 'Львівська область', 'Запоріжжя': 'Запорізька область', 'Кривий Ріг': 'Дніпропетровська область',
    'Миколаїв': 'Миколаївська область', 'Вінниця': 'Вінницька область', 'Херсон': 'Херсонська область',
    'Полтава': 'Полтавська область', 'Чернігів': 'Чернігівська область', 'Черкаси': 'Черкаська область',
    'Житомир': 'Житомирська область', 'Суми': 'Сумська область', 'Хмельницький': 'Хмельницька область',
    'Чернівці': 'Чернівецька область', 'Рівне': 'Рівненська область', 'Івано-Франківськ': 'Івано-Франківська область',
    'Тернопіль': 'Тернопільська область', 'Луцьк': 'Волинська область', 'Ужгород': 'Закарпатська область',
    'Кропивницький': 'Кіровоградська область', 'Біла Церква': 'Київська область', 'Кременчук': 'Полтавська область',
    'Маріуполь': 'Донецька область', 'Краматорськ': 'Донецька область', 'Слов\'янськ': 'Донецька область',
    'Бровари': 'Київська область', 'Ірпінь': 'Київська область', 'Буча': 'Київська область',
};

export function regionOfCity(city) {
    return CITY_REGION[city] || null;
}

/** Parses the register CSV ("tin";"full_name";...;"c_sti") into [{ edrpou, name, sti }]. */
export function parseRegister(csv) {
    const lines = csv.replace(/^﻿/, '').split(/\r?\n/);
    const header = lines.shift().split(';').map(h => h.replace(/"/g, '').trim());
    const iTin = header.indexOf('tin');
    const iName = header.indexOf('full_name');
    const iSti = header.indexOf('c_sti');
    const rows = [];
    for (const line of lines) {
        if (!line) continue;
        // Values are ;-separated; quoted names may contain ";" only very rarely, so a simple split is enough.
        const cells = line.match(/("([^"]|"")*"|[^;]*)(;|$)/g)?.map(c => c.replace(/;$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) || [];
        const edrpou = (cells[iTin] || '').replace(/\D/g, '');
        if (edrpou) rows.push({ edrpou, name: (cells[iName] || '').toUpperCase(), sti: cells[iSti] || '' });
    }
    return rows;
}

/** Learns which tax office (c_sti) serves which region from organization names. */
export function learnOfficeRegions(rows, { minVotes = 30, minShare = 0.4 } = {}) {
    const votes = new Map();
    for (const r of rows) {
        const hit = REGION_HINTS.find(([, re]) => re.test(r.name));
        if (!hit) continue;
        const byRegion = votes.get(r.sti) || new Map();
        byRegion.set(hit[0], (byRegion.get(hit[0]) || 0) + 1);
        votes.set(r.sti, byRegion);
    }
    const mapping = {};
    for (const [sti, byRegion] of votes) {
        const total = [...byRegion.values()].reduce((a, b) => a + b, 0);
        const [region, n] = [...byRegion.entries()].sort((a, b) => b[1] - a[1])[0];
        if (n >= minVotes && n / total >= minShare) mapping[sti] = region;
    }
    return mapping;
}

async function downloadRegister() {
    const res = await fetch(`https://data.gov.ua/api/3/action/package_show?id=${DATASET_ID}`);
    if (!res.ok) throw new Error(`data.gov.ua API: HTTP ${res.status}`);
    const { result } = await res.json();
    const resource = [...result.resources].reverse().find(r => /zip/i.test(r.format || r.url));
    if (!resource) throw new Error('Register archive not found');
    const zipRes = await fetch(resource.url);
    if (!zipRes.ok) throw new Error(`Download failed: HTTP ${zipRes.status}`);
    const unzipper = (await import('unzipper')).default;
    const dir = await unzipper.Open.buffer(Buffer.from(await zipRes.arrayBuffer()));
    const entry = dir.files.find(f => /\.csv$/i.test(f.path));
    if (!entry) throw new Error('No CSV inside the archive');
    const buf = await entry.buffer();
    // The file is UTF-8 with a BOM in recent exports, windows-1251 in older ones.
    const utf8 = buf.toString('utf8');
    return utf8.includes('�') ? new TextDecoder('windows-1251').decode(buf) : utf8;
}

export async function importRegions({ log = console.log } = {}) {
    const rows = parseRegister(await downloadRegister());
    const mapping = learnOfficeRegions(rows);
    log(`[regions] register rows: ${rows.length}, offices mapped: ${Object.keys(mapping).length}`);

    const byRegion = new Map();
    for (const r of rows) {
        const region = mapping[r.sti];
        if (!region) continue;
        if (!byRegion.has(region)) byRegion.set(region, []);
        byRegion.get(region).push(r.edrpou);
    }
    let updated = 0;
    for (const [region, codes] of byRegion) {
        for (let i = 0; i < codes.length; i += 5000) {
            const { rowCount } = await query(
                `UPDATE organizations SET region = $1 WHERE edrpou = ANY($2::text[]) AND region IS DISTINCT FROM $1
                   AND (city IS NULL OR region IS NULL)`,
                [region, codes.slice(i, i + 5000)],
            );
            updated += rowCount;
        }
    }
    // Organizations whose city is known from the name get its region too.
    for (const [city, region] of Object.entries(CITY_REGION)) {
        const { rowCount } = await query(
            `UPDATE organizations SET region = $2 WHERE city = $1 AND region IS NULL`, [city, region]);
        updated += rowCount;
    }
    const { rows: odesa } = await query(
        `SELECT count(*)::int AS n FROM organizations WHERE region = 'Одеська область'`);
    log(`[regions] updated: ${updated}, Odesa region total: ${odesa[0].n}`);
    return { offices: Object.keys(mapping).length, updated, odesa_region: odesa[0].n, mapping };
}
