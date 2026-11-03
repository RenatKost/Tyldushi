import express from 'express';
import { CATEGORIES } from '../lib/categories.js';
import { getPublicBySlug, listCities, listPublic } from '../lib/orgs.js';

const router = express.Router();

const wrap = fn => (req, res, next) => fn(req, res).catch(next);

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
