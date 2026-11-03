import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const hasDatabase = Boolean(process.env.DATABASE_URL);

export const pool = hasDatabase
    ? new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        max: Number(process.env.PG_POOL_MAX || 10),
    })
    : null;

export function query(text, params) {
    if (!pool) throw new Error('DATABASE_URL is not configured');
    return pool.query(text, params);
}

export async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function migrate() {
    if (!pool) return;
    await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const dir = path.join(__dirname, 'migrations');
    const files = (await fs.readdir(dir)).filter(f => f.endsWith('.sql')).sort();
    const { rows } = await query('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map(r => r.name));

    for (const file of files) {
        if (applied.has(file)) continue;
        const sql = await fs.readFile(path.join(dir, file), 'utf8');
        await withTransaction(async client => {
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        });
        console.log(`[db] applied migration ${file}`);
    }
}
