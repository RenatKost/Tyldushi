// Activity index (0–100): how much public evidence there is that an organization actually works.
import { query } from '../db.js';

export const LEVELS = [
    { key: 'high', min: 70, label: 'Висока активність' },
    { key: 'active', min: 40, label: 'Активна' },
    { key: 'low', min: 15, label: 'Мало підтверджень' },
    { key: 'none', min: 0, label: 'Немає підтверджень активності' },
];

export const levelOf = score => LEVELS.find(l => score >= l.min);

const SOCIAL_KEYS = ['facebook', 'instagram', 'telegram', 'youtube', 'tiktok'];

function daysAgo(date, now) {
    return (now - new Date(`${String(date).slice(0, 10)}T00:00:00Z`).getTime()) / 864e5;
}

/**
 * Pure scoring function. Returns { score, level, details, lastActivity } where details lists every
 * signal with the points it earned, so the site can explain "why this rating".
 */
export function computeScore(org, cases = [], { now = Date.now() } = {}) {
    const details = [];
    const add = (key, label, points, max, ok = points > 0) => details.push({ key, label, points, max, ok });

    const dated = cases.filter(c => c.happened_at).map(c => ({ ...c, age: daysAgo(c.happened_at, now) }))
        .filter(c => c.age >= -1);
    const lastYear = dated.filter(c => c.age <= 365);
    const tgLast = org.last_activity_at ? daysAgo(org.last_activity_at, now) : Infinity;
    const lastActivityDays = Math.min(tgLast, ...dated.map(c => c.age));

    add('cases', `Підтверджені справи за рік: ${lastYear.length}`, Math.min(30, lastYear.length * 6), 30);
    add('recent', 'Активність за останні 30 днів', lastActivityDays <= 30 ? 10 : 0, 10);
    const posts = Number(org.tg_posts_90d) || 0;
    add('telegram', posts ? `Публікації в Telegram за 3 місяці: ${posts}` : 'Активний Telegram-канал',
        posts >= 10 ? 15 : posts >= 3 ? 10 : posts >= 1 ? 5 : 0, 15);
    const contacts = org.contacts || {};
    add('website', 'Власний сайт', contacts.website ? 10 : 0, 10);
    add('reports', 'Публічні звіти', org.has_reports ? 5 : 0, 5);
    add('socials', 'Сторінки в соцмережах', SOCIAL_KEYS.some(k => contacts[k]) ? 5 : 0, 5);
    add('contacts', 'Телефон або email', contacts.phone || contacts.email ? 5 : 0, 5);
    const reviews = Number(org.review_count) || 0;
    const avg = Number(org.review_avg) || 0;
    add('reviews', reviews ? `Відгуки: ${avg.toFixed(1)} ★ (${reviews})` : 'Позитивні відгуки',
        reviews >= 2 ? Math.round(Math.max(0, avg - 3) * 5) : 0, 10);
    add('verified', 'Перевірено фондом «Тил Душі»', org.verified_by_fund ? 10 : 0, 10);

    const score = Math.max(0, Math.min(100, details.reduce((sum, d) => sum + d.points, 0)));
    const lastDate = Number.isFinite(lastActivityDays)
        ? new Date(now - lastActivityDays * 864e5).toISOString().slice(0, 10)
        : null;
    return { score, level: levelOf(score).key, details, lastActivity: lastDate };
}

/** Recomputes and stores the activity index of one organization. */
export async function refreshRating(orgId) {
    const { rows } = await query(
        `SELECT o.*, to_char(o.last_activity_at, 'YYYY-MM-DD') AS last_activity_at,
                (SELECT count(*)::int FROM organization_reviews r WHERE r.organization_id = o.id AND r.status = 'visible' AND r.rating IS NOT NULL) AS review_count,
                (SELECT avg(rating)::real FROM organization_reviews r WHERE r.organization_id = o.id AND r.status = 'visible') AS review_avg
         FROM organizations o WHERE o.id = $1`,
        [orgId],
    );
    const org = rows[0];
    if (!org) return null;
    const { rows: cases } = await query(
        `SELECT to_char(happened_at, 'YYYY-MM-DD') AS happened_at FROM organization_cases WHERE organization_id = $1`,
        [orgId],
    );
    const result = computeScore(org, cases);
    await query(
        `UPDATE organizations SET activity_score = $2, activity_level = $3, activity_details = $4,
            review_count = $5, review_avg = $6,
            last_activity_at = CASE WHEN $7::date IS NULL THEN last_activity_at ELSE greatest(last_activity_at, $7::date) END
         WHERE id = $1`,
        [orgId, result.score, result.level, JSON.stringify(result.details), org.review_count, org.review_avg, result.lastActivity],
    );
    return result;
}

/** Recomputes every published organization (nightly; a few thousand rows at most). */
export async function refreshAllRatings() {
    const { rows } = await query(`SELECT id FROM organizations WHERE status IN ('approved', 'hidden')`);
    for (const { id } of rows) await refreshRating(id);
    return { rated: rows.length };
}
