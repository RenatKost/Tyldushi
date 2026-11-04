import express from 'express';
import { CATEGORIES } from '../lib/categories.js';
import { getPublicBySlug, listCities, listPublic } from '../lib/orgs.js';
import { cleanRequest, createRequest, getSettings, listEvents } from '../lib/site.js';
import { sendHelpRequest } from '../telegram.js';

const router = express.Router();

const wrap = fn => (req, res, next) => fn(req, res).catch(next);

router.get('/site', wrap(async (req, res) => {
    const [settings, events] = await Promise.all([getSettings(), listEvents({ publishedOnly: true })]);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ ...settings, events });
}));

// At most 5 submissions per IP per hour; keeps the Telegram group free of spam.
const submissions = new Map();
function rateLimited(ip) {
    const now = Date.now();
    const recent = (submissions.get(ip) || []).filter(t => t > now - 60 * 60 * 1000);
    if (recent.length >= 5) return true;
    recent.push(now);
    submissions.set(ip, recent);
    if (submissions.size > 5000) submissions.clear();
    return false;
}

router.post('/requests', express.json({ limit: '20kb' }), wrap(async (req, res) => {
    // Honeypot: real people never see or fill the "website" field.
    if (req.body?.website) return res.json({ ok: true });
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'Забагато звернень. Будь ласка, зателефонуйте нам.' });
    const data = cleanRequest(req.body);
    const saved = await createRequest(data, req.ip);
    sendHelpRequest(saved).catch(err => console.error('[telegram] request notify failed', err.message));
    res.status(201).json({ ok: true, id: saved.id });
}));

router.get('/categories', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(CATEGORIES);
});

router.get('/cities', wrap(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=120');
    res.json(await listCities());
}));

router.get('/organizations', wrap(async (req, res) => {
    const { city, q, category, type, page, limit } = req.query;
    res.set('Cache-Control', 'public, max-age=60');
    res.json(await listPublic({
        city: typeof city === 'string' ? city : undefined,
        q: typeof q === 'string' ? q.trim().slice(0, 100) : undefined,
        category: typeof category === 'string' ? category : undefined,
        type: typeof type === 'string' ? type : undefined,
        page,
        limit,
    }));
}));

router.get('/organizations/:slug', wrap(async (req, res) => {
    const org = await getPublicBySlug(req.params.slug);
    if (!org) return res.status(404).json({ error: 'Організацію не знайдено' });
    res.set('Cache-Control', 'public, max-age=60');
    res.json(org);
}));

export default router;
