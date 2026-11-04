import express from 'express';
import { query } from '../db.js';
import { CATEGORIES } from '../lib/categories.js';
import { getPublicBySlug, listCities, listPublic, listRegions } from '../lib/orgs.js';
import { LEVELS } from '../lib/rating.js';
import { matchOrganizations } from '../lib/match.js';
import { addReview, cleanReview, listReviews } from '../lib/reviews.js';
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
    const { city, region, q, category, type, page, limit } = req.query;
    res.set('Cache-Control', 'public, max-age=60');
    res.json(await listPublic({
        city: typeof city === 'string' ? city : undefined,
        region: typeof region === 'string' ? region : undefined,
        q: typeof q === 'string' ? q.trim().slice(0, 100) : undefined,
        category: typeof category === 'string' ? category : undefined,
        type: typeof type === 'string' ? type : undefined,
        page,
        limit,
    }));
}));

router.get('/regions', wrap(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=120');
    res.json(await listRegions());
}));

router.get('/catalog-stats', wrap(async (req, res) => {
    const { rows } = await query(`SELECT count(*)::int AS total,
            count(DISTINCT city)::int AS cities,
            count(*) FILTER (WHERE activity_level IN ('high', 'active'))::int AS active
        FROM organizations WHERE status = 'approved'`);
    res.set('Cache-Control', 'public, max-age=120');
    res.json(rows[0]);
}));

router.get('/levels', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(LEVELS);
});

// "Пошук по запиту": free-text description of the need → matching organizations.
router.get('/organizations/match', wrap(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 300) : '';
    const city = typeof req.query.city === 'string' ? req.query.city : undefined;
    const service = typeof req.query.service === 'string' ? req.query.service : undefined;
    res.set('Cache-Control', 'public, max-age=60');
    res.json(await matchOrganizations(q, { city, service }));
}));

router.get('/organizations/:slug/reviews', wrap(async (req, res) => {
    const org = await getPublicBySlug(req.params.slug);
    if (!org) return res.status(404).json({ error: 'Організацію не знайдено' });
    res.set('Cache-Control', 'no-cache');
    res.json(await listReviews(org.id));
}));

router.post('/organizations/:slug/reviews', express.json({ limit: '10kb' }), wrap(async (req, res) => {
    if (req.body?.website) return res.status(201).json({ ok: true }); // honeypot
    const org = await getPublicBySlug(req.params.slug);
    if (!org) return res.status(404).json({ error: 'Організацію не знайдено' });
    const review = await addReview(org.id, cleanReview(req.body), req.ip);
    res.status(201).json(review);
}));

router.get('/organizations/:slug', wrap(async (req, res) => {
    const org = await getPublicBySlug(req.params.slug);
    if (!org) return res.status(404).json({ error: 'Організацію не знайдено' });
    res.set('Cache-Control', 'public, max-age=60');
    res.json(org);
}));

export default router;
