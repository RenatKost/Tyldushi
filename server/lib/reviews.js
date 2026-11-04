// Public comments about organizations. Published immediately; admins can hide or delete them.
import crypto from 'node:crypto';
import { query } from '../db.js';
import { refreshRating } from './rating.js';

const LINK_RE = /(https?:\/\/|www\.|\.(com|ua|net|org|ru|info|xyz|top|site|online)(\/|\s|$)|t\.me\/|@[a-z0-9_]{4,})/i;

export function hashIp(ip) {
    return crypto.createHash('sha256').update(`${process.env.SESSION_SECRET || 'tyl'}:${ip}`).digest('hex').slice(0, 32);
}

const bad = message => Object.assign(new Error(message), { status: 400 });

export function cleanReview(body) {
    const name = String(body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const text = String(body?.text || '').trim().replace(/\n{3,}/g, '\n\n').slice(0, 2000);
    const rating = body?.rating ? Number(body.rating) : null;
    if (name.length < 2) throw bad('Вкажіть ваше ім’я');
    if (text.length < 10) throw bad('Відгук має містити щонайменше 10 символів');
    if (LINK_RE.test(text) || LINK_RE.test(name)) throw bad('Посилання у відгуках не дозволені');
    if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw bad('Оцінка має бути від 1 до 5');
    if (!body?.consent) throw bad('Потрібна згода з правилами');
    return { name, text, rating };
}

export async function listReviews(orgId, { includeHidden = false } = {}) {
    const { rows } = await query(
        `SELECT id, author_name, text, rating, status, created_at FROM organization_reviews
         WHERE organization_id = $1 ${includeHidden ? '' : `AND status = 'visible'`}
         ORDER BY created_at DESC LIMIT 200`,
        [orgId],
    );
    return rows;
}

export async function addReview(orgId, data, ip) {
    const ipHash = hashIp(ip);
    const { rows: recent } = await query(
        `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS hour,
                count(*) FILTER (WHERE organization_id = $2 AND created_at > now() - interval '1 day')::int AS org_day
         FROM organization_reviews WHERE ip_hash = $1`,
        [ipHash, orgId],
    );
    if (recent[0].hour >= 3) throw Object.assign(new Error('Забагато відгуків. Спробуйте пізніше.'), { status: 429 });
    if (recent[0].org_day >= 1) throw Object.assign(new Error('Ви вже залишали відгук про цю організацію сьогодні.'), { status: 429 });

    const { rows } = await query(
        `INSERT INTO organization_reviews (organization_id, author_name, text, rating, ip_hash)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, author_name, text, rating, status, created_at`,
        [orgId, data.name, data.text, data.rating, ipHash],
    );
    await refreshRating(orgId);
    return rows[0];
}

export async function adminListReviews({ status, limit = 100 } = {}) {
    const params = [];
    let where = '';
    if (status === 'visible' || status === 'hidden') {
        params.push(status);
        where = 'WHERE r.status = $1';
    }
    const { rows } = await query(
        `SELECT r.id, r.author_name, r.text, r.rating, r.status, r.created_at, o.id AS org_id, o.name AS org_name, o.slug
         FROM organization_reviews r JOIN organizations o ON o.id = r.organization_id
         ${where} ORDER BY r.created_at DESC LIMIT ${Math.min(Number(limit) || 100, 500)}`,
        params,
    );
    return rows;
}

export async function setReviewStatus(id, status) {
    if (!['visible', 'hidden'].includes(status)) throw bad('Невідомий статус');
    const { rows } = await query(`UPDATE organization_reviews SET status = $2 WHERE id = $1 RETURNING organization_id`, [id, status]);
    if (rows[0]) await refreshRating(rows[0].organization_id);
    return Boolean(rows[0]);
}

export async function deleteReview(id) {
    const { rows } = await query(`DELETE FROM organization_reviews WHERE id = $1 RETURNING organization_id`, [id]);
    if (rows[0]) await refreshRating(rows[0].organization_id);
}
