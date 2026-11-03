// Imports charity funds and public organizations from the open ЄДР dump (data.gov.ua).
// The dump is a ~330 MB zip with one windows-1251 XML file of all legal entities, so it is
// downloaded to a temp file and scanned as a stream, record by record.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import unzipper from 'unzipper';
import { query } from '../server/db.js';
import { slugify } from '../server/lib/slug.js';
import { guessLocation } from './geo.js';
import { prettifyName } from './names.js';

export { prettifyName };

const DATASET_ID = '03cc1239-3988-4451-aa0d-aadb77448714';
const RESOURCE_NAME = 'UO.zip';

const OPF_TYPES = {
    'БЛАГОДІЙНА ОРГАНІЗАЦІЯ': 'charity_fund',
    'ГРОМАДСЬКА ОРГАНІЗАЦІЯ': 'public_org',
    'ГРОМАДСЬКА СПІЛКА': 'public_org',
};
const ACTIVE_STATE = 'зареєстровано';

// Names suggesting the organization actually helps people (used for queue priority only).
const HELP_WORDS = /ДОПОМОГ|ВОЛОНТЕР|БЛАГОДІЙН|МИЛОСЕРД|ВЕТЕРАН|ВІЙСЬКОВ|ЗАХИСНИК|ДІТ|СІМ|ПЕРЕСЕЛЕН|ВПО|БІЖЕНЦ|ТВАРИН|ЗДОРОВ|РЕАБІЛІТАЦ|ІНВАЛІД|ПІДТРИМК|НАДІЯ|ВІДРОДЖ|ГУМАНІТАР|СОЦІАЛЬН|ТУРБОТ|СЕРЦ|ПАЛІАТИВ|ОНКО|ЛІКУВАН|МЕДИЧН/;

const ENTITIES = { quot: '"', apos: '\'', amp: '&', lt: '<', gt: '>' };
const decode = s => s.replace(/&(quot|apos|amp|lt|gt|#\d+);/g, (_, e) =>
    (e[0] === '#' ? String.fromCharCode(Number(e.slice(1))) : ENTITIES[e]));

function tag(record, name) {
    const open = record.indexOf(`<${name}>`);
    if (open === -1) return null;
    const close = record.indexOf(`</${name}>`, open);
    if (close === -1) return null;
    const value = decode(record.slice(open + name.length + 2, close)).trim();
    return value || null;
}

function parseDate(ddmmyyyy) {
    const m = String(ddmmyyyy || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function headName(record) {
    const signers = record.match(/<SIGNER>([^<]*)<\/SIGNER>/g) || [];
    for (const s of signers) {
        const text = decode(s.replace(/<\/?SIGNER>/g, ''));
        if (/керівник/i.test(text)) return text.split(/\s+-\s+|;/)[0].trim();
    }
    return null;
}

function priorityOf(org) {
    let p = 0;
    if (org.org_type === 'charity_fund') p += 40;
    if (HELP_WORDS.test(org.raw_name)) p += 25;
    if (org.registered_at && org.registered_at >= `${new Date().getFullYear() - 4}-01-01`) p += 20;
    if (org.registry_purpose) p += 10;
    if (org.city) p += 10;
    return p;
}

function parseRecord(record) {
    const opf = tag(record, 'OPF');
    const orgType = opf && OPF_TYPES[opf];
    if (!orgType) return null;
    const edrpou = tag(record, 'EDRPOU');
    const rawName = tag(record, 'NAME');
    if (!edrpou || !rawName) return null;

    const fullName = rawName;
    const { city, region } = guessLocation(fullName);
    const org = {
        edrpou,
        raw_name: fullName,
        name: prettifyName(fullName),
        short_name: tag(record, 'SHORT_NAME') ? prettifyName(tag(record, 'SHORT_NAME')) : null,
        org_type: orgType,
        registry_state: tag(record, 'STAN'),
        registered_at: parseDate(tag(record, 'REGISTRATION')),
        registry_purpose: tag(record, 'PURPOSE'),
        head_name: headName(record),
        city,
        region,
    };
    org.priority = priorityOf(org);
    return org;
}

async function resolveDownloadUrl() {
    if (process.env.EDR_UO_URL) return process.env.EDR_UO_URL;
    const res = await fetch(`https://data.gov.ua/api/3/action/package_show?id=${DATASET_ID}`);
    if (!res.ok) throw new Error(`data.gov.ua API: HTTP ${res.status}`);
    const { result } = await res.json();
    const resource = result.resources.find(r => r.name === RESOURCE_NAME);
    if (!resource) throw new Error('UO.zip resource not found in the ЄДР dataset');
    return resource.url;
}

async function download(url, file) {
    const res = await fetch(url, { headers: { 'User-Agent': 'tyldushi-bot/1.0 (+https://tyldushi.com)' } });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
}

/** Streams <SUBJECT> records from the XML entry of the zip. */
async function* records(zipFile) {
    const dir = await unzipper.Open.file(zipFile);
    const entry = dir.files.find(f => /\.xml$/i.test(f.path));
    if (!entry) throw new Error('No XML file inside the archive');
    const decoder = new TextDecoder('windows-1251');
    let buffer = '';
    for await (const chunk of entry.stream()) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf('</SUBJECT>')) !== -1) {
            const start = buffer.lastIndexOf('<SUBJECT>', end);
            yield buffer.slice(start === -1 ? 0 : start, end);
            buffer = buffer.slice(end + 10);
        }
    }
}

async function upsertBatch(rawBatch) {
    // The same code can appear twice in one dump; a single INSERT may touch a row only once.
    const batch = [...new Map(rawBatch.map(o => [o.edrpou, o])).values()];
    if (!batch.length) return 0;
    const cols = ['slug', 'edrpou', 'name', 'short_name', 'org_type', 'city', 'region', 'head_name',
        'registered_at', 'registry_state', 'registry_purpose', 'priority'];
    const values = [];
    const rows = batch.map((o, i) => {
        values.push(`${slugify(o.name).slice(0, 60)}-${o.edrpou}`, o.edrpou, o.name, o.short_name, o.org_type,
            o.city, o.region, o.head_name, o.registered_at, o.registry_state, o.registry_purpose, o.priority);
        return `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(', ')})`;
    });
    // Registry fields are refreshed; anything an admin or the bot already edited is kept.
    const { rowCount } = await query(
        `INSERT INTO organizations (${cols.join(', ')}) VALUES ${rows.join(', ')}
         ON CONFLICT (edrpou) DO UPDATE SET
            registry_state = EXCLUDED.registry_state,
            registered_at = EXCLUDED.registered_at,
            registry_purpose = EXCLUDED.registry_purpose,
            head_name = EXCLUDED.head_name,
            priority = EXCLUDED.priority,
            name = CASE WHEN organizations.status = 'registry' THEN EXCLUDED.name ELSE organizations.name END,
            short_name = CASE WHEN organizations.status = 'registry' THEN EXCLUDED.short_name ELSE organizations.short_name END,
            city = coalesce(organizations.city, EXCLUDED.city),
            region = coalesce(organizations.region, EXCLUDED.region)`,
        values,
    );
    return rowCount;
}

/** Organizations that stopped activity disappear from the site automatically. */
async function deactivate(edrpous) {
    if (!edrpous.length) return 0;
    const { rowCount } = await query(
        `UPDATE organizations SET
            registry_state = 'припинено',
            status = CASE WHEN status IN ('approved', 'pending') THEN 'hidden' ELSE status END,
            is_featured = FALSE,
            updated_at = now()
         WHERE edrpou = ANY($1::text[]) AND coalesce(registry_state, '') <> 'припинено'`,
        [edrpous],
    );
    return rowCount;
}

export async function importRegistry({ limit = Infinity, log = console.log } = {}) {
    const zipFile = path.join(os.tmpdir(), `edr-uo-${Date.now()}.zip`);
    const stats = { scanned: 0, matched: 0, upserted: 0, deactivated: 0 };
    try {
        const url = await resolveDownloadUrl();
        log(`[registry] downloading ${url}`);
        await download(url, zipFile);
        log(`[registry] downloaded ${(fs.statSync(zipFile).size / 1e6).toFixed(0)} MB, scanning…`);

        let batch = [];
        let inactive = [];
        for await (const record of records(zipFile)) {
            stats.scanned++;
            if (!record.includes('ОРГАНІЗАЦІЯ</OPF>') && !record.includes('СПІЛКА</OPF>')) continue;
            const org = parseRecord(record);
            if (!org) continue;
            if (org.registry_state !== ACTIVE_STATE) {
                inactive.push(org.edrpou);
                if (inactive.length >= 1000) {
                    stats.deactivated += await deactivate(inactive);
                    inactive = [];
                }
                continue;
            }
            stats.matched++;
            batch.push(org);
            if (batch.length >= 500) {
                stats.upserted += await upsertBatch(batch);
                batch = [];
            }
            if (stats.matched >= limit) break;
            if (stats.scanned % 200000 === 0) log(`[registry] scanned ${stats.scanned}, matched ${stats.matched}`);
        }
        stats.upserted += await upsertBatch(batch);
        stats.deactivated += await deactivate(inactive);
        log(`[registry] done: ${JSON.stringify(stats)}`);
        return stats;
    } finally {
        fs.rmSync(zipFile, { force: true });
    }
}
