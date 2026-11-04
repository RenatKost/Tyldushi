// Keeps the activity index fresh without spending search requests: re-reads public Telegram
// channels of published organizations (t.me/s/...) and recomputes ratings.
import { query } from '../server/db.js';
import { refreshAllRatings, refreshRating } from '../server/lib/rating.js';
import { readTelegramChannel } from './enrich/crawl.js';
import { telegramActivity } from './enrich/index.js';

export async function refreshTelegramActivity({ limit = 100, log = console.log } = {}) {
    const { rows } = await query(
        `SELECT id, contacts->>'telegram' AS telegram FROM organizations
         WHERE status = 'approved' AND contacts->>'telegram' IS NOT NULL
           AND (tg_checked_at IS NULL OR tg_checked_at < now() - interval '30 days')
         ORDER BY tg_checked_at NULLS FIRST LIMIT $1`,
        [limit],
    );
    let active = 0;
    for (const row of rows) {
        const channel = await readTelegramChannel(row.telegram).catch(() => null);
        const { posts90, last } = telegramActivity(channel);
        if (posts90) active++;
        await query(
            `UPDATE organizations SET tg_posts_90d = $2, tg_checked_at = now(),
                last_activity_at = CASE WHEN $3::date IS NULL THEN last_activity_at ELSE greatest(last_activity_at, $3::date) END
             WHERE id = $1`,
            [row.id, posts90, last],
        );
        await refreshRating(row.id);
    }
    log(`[activity] telegram channels checked: ${rows.length}, active: ${active}`);
    return { checked: rows.length, active };
}

export async function refreshRatings() {
    return refreshAllRatings();
}
