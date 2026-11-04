// Worker entry point (Railway cron service).
//
//   node worker/run.js              import (if due) → enrich → activity → ratings
//   node worker/run.js import [--limit 200]
//   node worker/run.js regions      tax register → region of every organization
//   node worker/run.js enrich [--limit 5] [--id 12,13]
//   node worker/run.js activity     re-read Telegram channels of published organizations
//   node worker/run.js ratings      recompute activity index
//   node worker/run.js logos [--limit 50]
import { migrate, pool, query } from '../server/db.js';
import { refreshRatings, refreshTelegramActivity } from './activity.js';
import { enrichBatch, refreshLogos } from './enrich/index.js';
import { searchConfigured } from './enrich/search.js';
import { prettifyName } from './names.js';
import { importRegions } from './nuo.js';
import { importRegistry } from './registry.js';

const LOCK_ID = 727274; // pg advisory lock: prevents overlapping cron runs
const IMPORT_EVERY_DAYS = Number(process.env.IMPORT_EVERY_DAYS || 7);
const DAILY_LIMIT = Number(process.env.ENRICH_DAILY_LIMIT || 30);

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

// Tavily's free plan gives 1000 searches a month: ~32 a day.
const SEARCH_BUDGET = Number(process.env.SEARCH_DAILY_BUDGET || 32);

async function searchBudgetLeft() {
    const { rows } = await query(
        `SELECT coalesce(sum((stats->>'search_requests')::int), 0)::int AS used FROM job_runs
         WHERE job = 'enrich' AND started_at >= date_trunc('day', now())`,
    );
    return Math.max(0, SEARCH_BUDGET - rows[0].used);
}

async function jobDue(job, days) {
    const { rows } = await query(
        `SELECT 1 FROM job_runs WHERE job = $1 AND ok AND started_at > now() - ($2 || ' days')::interval LIMIT 1`,
        [job, String(days)],
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
        console.log('[enrich] skipped: TAVILY_API_KEY is not set');
        return;
    }
    const ids = arg('id') ? arg('id').split(',').map(Number) : null;
    const limit = arg('limit') ? Number(arg('limit')) : await remainingToday();
    const searchBudget = await searchBudgetLeft();
    if (!ids && (!limit || searchBudget < 2)) {
        console.log(`[enrich] daily limit reached (organizations ${DAILY_LIMIT}, searches ${SEARCH_BUDGET})`);
        return;
    }
    return track('enrich', () => enrichBatch({ limit, ids, searchBudget }));
}

/** Re-formats names that an older parser left with broken quotes (cheap, runs every time). */
async function repairNames() {
    const { rows } = await query(
        `SELECT id, name FROM organizations WHERE status <> 'registry' AND name ~ '(\\s»|«\\s*$|")' LIMIT 500`,
    );
    for (const row of rows) {
        const fixed = prettifyName(row.name);
        if (fixed !== row.name) await query('UPDATE organizations SET name = $2 WHERE id = $1', [row.id, fixed]);
    }
    if (rows.length) console.log(`[names] repaired ${rows.length}`);
}

async function runLogos() {
    const limit = arg('limit') ? Number(arg('limit')) : 50;
    return track('logos', () => refreshLogos({ limit }));
}

async function main() {
    const command = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'all';
    await migrate();

    const { rows } = await query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
    if (!rows[0].ok) {
        console.log('[worker] another run is in progress, exiting');
        return;
    }

    const safe = (name, fn) => fn().catch(err => console.error(`[${name}] failed`, err.message));

    if (command === 'import') await runImport();
    else if (command === 'all' && (await importDue())) {
        // A failed registry download must not block enrichment of what is already imported.
        await safe('import', runImport);
        await safe('regions', () => track('regions', () => importRegions()));
    }
    if (command === 'regions') await track('regions', () => importRegions());
    else if (command === 'all' && (await jobDue('regions', 30))) await safe('regions', () => track('regions', () => importRegions()));
    if (command === 'all') await safe('names', repairNames);
    if (command === 'logos' || command === 'all') await safe('logos', runLogos);
    if (command === 'enrich' || command === 'all') await runEnrich();
    if (command === 'activity' || command === 'all') await safe('activity', () => track('activity', () => refreshTelegramActivity()));
    if (command === 'ratings' || command === 'all') await safe('ratings', () => track('ratings', refreshRatings));
}

main()
    .catch(err => {
        console.error('[worker] failed', err);
        process.exitCode = 1;
    })
    .finally(() => pool?.end());
