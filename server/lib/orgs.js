import { query, withTransaction } from '../db.js';
import { normalizeCategories } from './categories.js';
import { refreshRating } from './rating.js';
import { slugify } from './slug.js';

export const STATUSES = ['registry', 'enriching', 'pending', 'approved', 'rejected', 'rejected_auto', 'hidden'];
export const CONTACT_KEYS = ['phone', 'email', 'website', 'facebook', 'instagram', 'telegram', 'youtube', 'tiktok'];

const PUBLIC_ORDER = 'is_featured DESC, featured_rank ASC NULLS LAST, activity_score DESC, name ASC';
export const CASE_KINDS = ['aid', 'event', 'project', 'report', 'post'];

const LIST_COLUMNS = `id, slug, edrpou, name, short_name, org_type, city, region, help_categories,
    logo_url, is_featured, featured_rank, status, updated_at, contacts,
    activity_score, activity_level, to_char(last_activity_at, 'YYYY-MM-DD') AS last_activity_at,
    verified_by_fund, review_count, review_avg,
    (SELECT count(*)::int FROM organization_cases c WHERE c.organization_id = organizations.id) AS cases_count,
    left(coalesce(description, ''), 600) AS excerpt`;

function str(value, max = 5000) {
    if (value === undefined || value === null) return null;
    const s = String(value).trim();
    return s ? s.slice(0, max) : null;
}

function cleanContacts(contacts) {
    const out = {};
    if (!contacts || typeof contacts !== 'object') return out;
    for (const key of CONTACT_KEYS) {
        const v = str(contacts[key], 500);
        if (v) out[key] = v;
    }
    return out;
}

function cleanDate(value) {
    const s = str(value, 10);
    return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function cleanCases(cases) {
    if (!Array.isArray(cases)) return [];
    return cases
        .map(c => ({
            title: str(c?.title, 300),
            description: str(c?.description, 5000),
            image_url: str(c?.image_url, 1000),
            happened_at: cleanDate(c?.happened_at),
            source_url: str(c?.source_url, 1000),
            kind: CASE_KINDS.includes(c?.kind) ? c.kind : 'aid',
            source: c?.source === 'admin' ? 'admin' : 'bot',
        }))
        .filter(c => c.title)
        .slice(0, 30);
}

function buildPublicFilters({ city, region, q, category, type }, params) {
    const where = [`status = 'approved'`];
    if (region) {
        params.push(region);
        where.push(`region = $${params.length}`);
    }
    if (city) {
        params.push(city);
        where.push(`city = $${params.length}`);
    }
    if (category) {
        params.push(category);
        where.push(`$${params.length} = ANY(help_categories)`);
    }
    if (type === 'charity_fund' || type === 'public_org') {
        params.push(type);
        where.push(`org_type = $${params.length}`);
    }
    if (q) {
        params.push(`%${q}%`);
        where.push(`(name ILIKE $${params.length} OR short_name ILIKE $${params.length} OR edrpou = $${params.length + 1})`);
        params.push(q);
    }
    return where.join(' AND ');
}

export async function listPublic({ city, region, q, category, type, page = 1, limit = 24 }) {
    const params = [];
    const where = buildPublicFilters({ city, region, q, category, type }, params);
    const pageSize = Math.min(Math.max(Number(limit) || 24, 1), 60);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * pageSize;

    const [{ rows }, { rows: countRows }] = await Promise.all([
        query(`SELECT ${LIST_COLUMNS} FROM organizations WHERE ${where}
               ORDER BY ${PUBLIC_ORDER} LIMIT ${pageSize} OFFSET ${offset}`, params),
        query(`SELECT count(*)::int AS total FROM organizations WHERE ${where}`, params),
    ]);
    return { items: rows, total: countRows[0].total, page: Number(page) || 1, pageSize };
}

export async function listRegions() {
    const { rows } = await query(`SELECT region, count(*)::int AS count FROM organizations
        WHERE status = 'approved' AND region IS NOT NULL
        GROUP BY region ORDER BY (region = 'Одеська область') DESC, count DESC, region ASC`);
    return rows;
}

export async function listCities() {
    const { rows } = await query(`SELECT city, count(*)::int AS count FROM organizations
        WHERE status = 'approved' AND city IS NOT NULL
        GROUP BY city ORDER BY (city = 'Одеса') DESC, count DESC, city ASC`);
    return rows;
}

async function attachCases(org) {
    if (!org) return null;
    const { rows } = await query(
        `SELECT id, title, description, image_url, to_char(happened_at, 'YYYY-MM-DD') AS happened_at, kind, source,
                source_url, position
         FROM organization_cases WHERE organization_id = $1 ORDER BY position, id`,
        [org.id],
    );
    org.cases = rows;
    return org;
}

export async function getPublicBySlug(slug) {
    const { rows } = await query(
        `SELECT id, slug, edrpou, name, short_name, org_type, city, region, address,
                to_char(registered_at, 'YYYY-MM-DD') AS registered_at, description, help_categories,
                contacts, logo_url, is_featured, sources, updated_at,
                activity_score, activity_level, activity_details, to_char(last_activity_at, 'YYYY-MM-DD') AS last_activity_at,
                verified_by_fund, has_reports, tg_posts_90d, review_count, review_avg
         FROM organizations WHERE slug = $1 AND status = 'approved'`,
        [slug],
    );
    return attachCases(rows[0]);
}

export async function listApprovedSlugs() {
    const { rows } = await query(`SELECT slug, updated_at FROM organizations WHERE status = 'approved' ORDER BY id`);
    return rows;
}

export async function getById(id) {
    const { rows } = await query(
        `SELECT *, to_char(registered_at, 'YYYY-MM-DD') AS registered_at FROM organizations WHERE id = $1`,
        [id],
    );
    return attachCases(rows[0]);
}

export async function adminCounts() {
    const { rows } = await query(`SELECT status, count(*)::int AS count FROM organizations GROUP BY status`);
    const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
    for (const r of rows) counts[r.status] = r.count;
    const { rows: f } = await query(`SELECT count(*)::int AS count FROM organizations WHERE is_featured`);
    counts.featured = f[0].count;
    return counts;
}

export async function adminList({ status, q, city, type, featured, page = 1, limit = 50 }) {
    const params = [];
    const where = [];
    if (featured) {
        where.push('is_featured');
    } else if (status && STATUSES.includes(status)) {
        params.push(status);
        where.push(`status = $${params.length}`);
    }
    if (city) {
        params.push(city);
        where.push(`city = $${params.length}`);
    }
    if (type === 'charity_fund' || type === 'public_org') {
        params.push(type);
        where.push(`org_type = $${params.length}`);
    }
    if (q) {
        params.push(`%${q}%`);
        where.push(`(name ILIKE $${params.length} OR edrpou LIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pageSize = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * pageSize;
    const order = featured ? 'featured_rank ASC NULLS LAST, name' : 'updated_at DESC';

    const [{ rows }, { rows: c }] = await Promise.all([
        query(`SELECT ${LIST_COLUMNS}, enriched_at FROM organizations ${whereSql}
               ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`, params),
        query(`SELECT count(*)::int AS total FROM organizations ${whereSql}`, params),
    ]);
    return { items: rows, total: c[0].total, page: Number(page) || 1, pageSize };
}

export async function uniqueSlug(name, excludeId = null) {
    const base = slugify(name);
    let candidate = base;
    for (let i = 2; i < 500; i++) {
        const { rows } = await query(
            'SELECT 1 FROM organizations WHERE slug = $1 AND ($2::int IS NULL OR id <> $2)',
            [candidate, excludeId],
        );
        if (!rows.length) return candidate;
        candidate = `${base}-${i}`;
    }
    return `${base}-${Date.now()}`;
}

const EDITABLE = {
    name: v => str(v, 500),
    short_name: v => str(v, 200),
    org_type: v => (v === 'charity_fund' ? 'charity_fund' : 'public_org'),
    city: v => str(v, 120),
    region: v => str(v, 120),
    address: v => str(v, 500),
    edrpou: v => str(v, 12),
    description: v => str(v, 20000),
    help_categories: v => normalizeCategories(v),
    contacts: v => cleanContacts(v),
    logo_url: v => str(v, 1000),
    verified_by_fund: v => Boolean(v),
};

function pickEditable(data) {
    const out = {};
    for (const [key, clean] of Object.entries(EDITABLE)) {
        if (key in data) out[key] = clean(data[key]);
    }
    return out;
}

async function replaceCases(client, orgId, cases) {
    await client.query('DELETE FROM organization_cases WHERE organization_id = $1', [orgId]);
    const list = cleanCases(cases);
    for (const [i, c] of list.entries()) {
        await client.query(
            `INSERT INTO organization_cases (organization_id, title, description, image_url, happened_at, source_url, position, kind, source)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [orgId, c.title, c.description, c.image_url, c.happened_at, c.source_url, i, c.kind, c.source],
        );
    }
}

export async function createOrg(data) {
    const fields = pickEditable(data);
    if (!fields.name) throw Object.assign(new Error('Назва обов\'язкова'), { status: 400 });
    fields.slug = await uniqueSlug(fields.name);
    fields.status = STATUSES.includes(data.status) ? data.status : 'pending';

    const id = await withTransaction(async client => {
        const keys = Object.keys(fields);
        const { rows } = await client.query(
            `INSERT INTO organizations (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})
             RETURNING id`,
            keys.map(k => (k === 'contacts' ? JSON.stringify(fields[k]) : fields[k])),
        );
        if (data.cases) await replaceCases(client, rows[0].id, data.cases);
        return rows[0].id;
    });
    await refreshRating(id);
    return getById(id);
}

export async function updateOrg(id, data) {
    const fields = pickEditable(data);
    if ('name' in fields && !fields.name) throw Object.assign(new Error('Назва обов\'язкова'), { status: 400 });

    await withTransaction(async client => {
        const keys = Object.keys(fields);
        if (keys.length) {
            const sets = keys.map((k, i) => `${k} = $${i + 2}`);
            await client.query(
                `UPDATE organizations SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
                [id, ...keys.map(k => (k === 'contacts' ? JSON.stringify(fields[k]) : fields[k]))],
            );
        }
        if (Array.isArray(data.cases)) await replaceCases(client, id, data.cases);
    });
    await refreshRating(id);
    return getById(id);
}

export async function setStatus(ids, status) {
    if (!STATUSES.includes(status)) throw Object.assign(new Error('Невідомий статус'), { status: 400 });
    const { rowCount } = await query(
        `UPDATE organizations SET status = $2,
            is_featured = CASE WHEN $2 = 'approved' THEN is_featured ELSE FALSE END,
            updated_at = now()
         WHERE id = ANY($1::int[])`,
        [ids, status],
    );
    return rowCount;
}

export async function setFeatured(id, featured) {
    if (featured) {
        await query(
            `UPDATE organizations SET is_featured = TRUE, status = 'approved',
                featured_rank = coalesce(featured_rank,
                    (SELECT coalesce(max(featured_rank), 0) + 1 FROM organizations WHERE is_featured)),
                updated_at = now()
             WHERE id = $1`,
            [id],
        );
    } else {
        await query(`UPDATE organizations SET is_featured = FALSE, featured_rank = NULL, updated_at = now() WHERE id = $1`, [id]);
    }
}

export async function reorderFeatured(ids) {
    await withTransaction(async client => {
        for (const [i, id] of ids.entries()) {
            await client.query('UPDATE organizations SET featured_rank = $2 WHERE id = $1 AND is_featured', [id, i + 1]);
        }
    });
}

export async function deleteOrgs(ids) {
    const { rowCount } = await query('DELETE FROM organizations WHERE id = ANY($1::int[])', [ids]);
    return rowCount;
}
