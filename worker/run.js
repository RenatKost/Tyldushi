// Worker entry point (Railway cron service).
//
//   node worker/run.js              import (if due) → enrich → notify
//   node worker/run.js import [--limit 200]
//   node worker/run.js enrich [--limit 5] [--id 12,13]
//   node worker/run.js notify
//   node worker/run.js logos [--limit 50]
import { migrate, pool, query } from '../server/db.js';
import { sendModerationCard, telegramEnabled } from '../server/telegram.js';
import { enrichBatch, refreshLogos } from './enrich/index.js';
import { searchConfigured } from './enrich/search.js';
import { importRegistry } from './registry.js';

const LOCK_ID = 727274; // pg advisory lock: prevents overlapping cron runs
const IMPORT_EVERY_DAYS = Number(process.env.IMPORT_EVERY_DAYS || 7);
const DAILY_LIMIT = Number(process.env.ENRICH_DAILY_LIMIT || 40);

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
}

async function track(job, fn) {
    const { rows } = await query('INSERT INTO job_runs (job) VALUES ($1) RETURNING id', [job]);
    try {
        const stats = await fn();
        await query('UPDATE job_runs SET finished_at = now(), ok = TRUE, stats = $2 WHERE id = $1', [rows[0].id, stats || {}]);
        return stats;
    } catch (err) {
        await query('UPDATE job_runs SET finished_at = now(), ok = FALSE, error = $2 WHERE id = $1',
            [rows[0].id, String(err.stack || err).slice(0, 2000)]);
        throw err;
    }
}

async function importDue() {
    const { rows } = await query(
        `SELECT 1 FROM job_runs WHERE job = 'import' AND ok AND started_at > now() - ($1 || ' days')::interval LIMIT 1`,
        [String(IMPORT_EVERY_DAYS)],
    );
    return rows.length === 0;
}

async function remainingToday() {
    const { rows } = await query(
        `SELECT count(*)::int AS n FROM organizations WHERE enriched_at >= date_trunc('day', now())`,
    );
    return Math.max(0, DAILY_LIMIT - rows[0].n);
}

async function runImport() {
    const limit = arg('limit') ? Number(arg('limit')) : Infinity;
    return track('import', () => importRegistry({ limit }));
}

async function runEnrich() {
    if (!searchConfigured) {
        console.log('[enrich] skipped: neither SEARXNG_URL nor TAVILY_API_KEY is set');
        return;
    }
    const ids = arg('id') ? arg('id').split(',').map(Number) : null;
    const limit = arg('limit') ? Number(arg('limit')) : await remainingToday();
    if (!ids && !limit) {
        console.log(`[enrich] daily limit (${DAILY_LIMIT}) reached`);
        return;
    }
    // Each card goes to the moderators as soon as it is ready, not after the whole batch.
    const onPending = telegramEnabled ? id => sendModerationCard(id) : undefined;
    return track('enrich', () => enrichBatch({ limit, ids, onPending }));
}

async function runLogos() {
    const limit = arg('limit') ? Number(arg('limit')) : 50;
    return track('logos', () => refreshLogos({ limit }));
}

async function runNotify() {
    if (!telegramEnabled) {
        console.log('[notify] skipped: TELEGRAM_BOT_TOKEN is not set');
        return;
    }
    return track('notify', async () => {
        const { rows } = await query(
            `SELECT id FROM organizations WHERE status = 'pending' AND tg_sent_at IS NULL
             ORDER BY ai_confidence DESC NULLS LAST, enriched_at LIMIT $1`,
            [DAILY_LIMIT],
        );
        let sent = 0;
        for (const { id } of rows) {
            if (await sendModerationCard(id)) sent++;
            await new Promise(r => setTimeout(r, 1200)); // stay well under Telegram rate limits
        }
        return { sent };
    });
}

async function main() {
    const command = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'all';
    await migrate();

    const { rows } = await query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
    if (!rows[0].ok) {
        console.log('[worker] another run is in progress, exiting');
        return;
    }

    if (command === 'import') await runImport();
    else if (command === 'all' && (await importDue())) {
        // A failed registry download must not block enrichment of what is already imported.
        await runImport().catch(err => console.error('[import] failed', err.message));
    }
    if (command === 'logos' || command === 'all') await runLogos().catch(err => console.error('[logos] failed', err.message));
    if (command === 'enrich' || command === 'all') await runEnrich();
    if (command === 'notify' || command === 'all') await runNotify();
}

main()
    .catch(err => {
        console.error('[worker] failed', err);
        process.exitCode = 1;
    })
    .finally(() => pool?.end());
