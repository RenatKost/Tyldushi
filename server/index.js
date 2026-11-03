import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { magicHandler } from './auth.js';
import { hasDatabase, migrate } from './db.js';
import { displayName } from './lib/display.js';
import { getPublicBySlug, listApprovedSlugs } from './lib/orgs.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';
import { mediaHandler } from './storage.js';
import { registerWebhook, telegramWebhook } from './telegram.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://tyldushi.com').replace(/\/$/, '');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

function noIndex(req, res, next) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
}

app.get('/healthz', (req, res) => res.json({ ok: true }));

// API is unavailable until a database is attached; the static site keeps working.
app.use('/api', (req, res, next) => {
    if (!hasDatabase) return res.status(503).json({ error: 'База даних не підключена' });
    next();
});

const tgHandler = telegramWebhook();
if (tgHandler) app.post('/api/telegram/webhook', express.json(), tgHandler);

app.use('/api', publicRoutes);
app.use('/api/fond', noIndex, adminRoutes);
app.get('/media/*', mediaHandler);
app.get('/fond/magic', noIndex, magicHandler);

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Cloudflare caches static files for hours, so local CSS/JS links carry the deploy version.
const ASSET_VERSION = (process.env.RAILWAY_GIT_COMMIT_SHA || String(Date.now())).slice(0, 10);
const htmlCache = new Map();

async function loadHtml(file) {
    if (!htmlCache.has(file)) {
        const raw = await fs.readFile(path.join(PUBLIC_DIR, file), 'utf8');
        htmlCache.set(file, raw.replace(/(href|src)="(\/(?:css|js|fond)\/[^"?]+\.(?:css|js))"/g, `$1="$2?v=${ASSET_VERSION}"`));
    }
    return htmlCache.get(file);
}

function sendHtml(file, cacheControl) {
    return (req, res, next) => loadHtml(file)
        .then(html => res.set('Cache-Control', cacheControl).type('html').send(html))
        .catch(next);
}

async function renderOrganizationsPage(res, meta) {
    const html = (await loadHtml('organizations.html'))
        .replaceAll('{{TITLE}}', esc(meta.title))
        .replaceAll('{{DESCRIPTION}}', esc(meta.description))
        .replaceAll('{{CANONICAL}}', esc(meta.canonical));
    res.set('Cache-Control', 'public, max-age=60').type('html').send(html);
}

const LIST_META = {
    title: 'Організації — благодійні фонди та громадські організації України | Тил Душі',
    description: 'Каталог перевірених благодійних фондів і громадських організацій України за містами: чим допомагають, реалізовані кейси та контакти.',
    canonical: `${PUBLIC_URL}/organizations`,
};

app.get('/organizations.html', (req, res) => res.redirect(301, '/organizations'));
app.get('/organizations', (req, res, next) => renderOrganizationsPage(res, LIST_META).catch(next));

app.get('/organizations/:slug', async (req, res, next) => {
    try {
        const org = hasDatabase ? await getPublicBySlug(req.params.slug) : null;
        if (!org) return res.redirect(302, '/organizations');
        await renderOrganizationsPage(res, {
            title: `${displayName(org)}${org.city ? ` — ${org.city}` : ''} | Тил Душі`,
            description: (org.description || LIST_META.description).slice(0, 200),
            canonical: `${PUBLIC_URL}/organizations/${org.slug}`,
        });
    } catch (err) {
        next(err);
    }
});

// The admin panel lives at a non-obvious path and is never indexed or advertised in robots.txt.
app.get(['/fond', '/fond/'], noIndex, sendHtml('fond/index.html', 'no-store'));
app.use('/fond', noIndex);

app.get(['/', '/index.html'], sendHtml('index.html', 'no-cache'));

app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /api/\nSitemap: ${PUBLIC_URL}/sitemap.xml\n`);
});

app.get('/sitemap.xml', async (req, res, next) => {
    try {
        const orgs = hasDatabase ? await listApprovedSlugs() : [];
        const urls = [
            `<url><loc>${PUBLIC_URL}/</loc></url>`,
            `<url><loc>${PUBLIC_URL}/organizations</loc></url>`,
            ...orgs.map(o => `<url><loc>${PUBLIC_URL}/organizations/${o.slug}</loc><lastmod>${new Date(o.updated_at).toISOString().slice(0, 10)}</lastmod></url>`),
        ];
        res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
    } catch (err) {
        next(err);
    }
});

app.use(express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        else res.setHeader('Cache-Control', 'public, max-age=3600');
    },
}));

app.use((req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.use((err, req, res, next) => {
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    if (status >= 500) console.error(err);
    if (res.headersSent) return next(err);
    res.status(status).json({ error: status >= 500 ? 'Внутрішня помилка сервера' : err.message });
});

const port = Number(process.env.PORT || 8080);

try {
    await migrate();
} catch (err) {
    // Keep serving the static site even if the database is unreachable; the API will report errors.
    console.error('[db] migration failed', err);
}

app.listen(port, () => {
    console.log(`[server] listening on :${port}`);
    registerWebhook().catch(err => console.error('[telegram] webhook registration failed', err.message));
});
