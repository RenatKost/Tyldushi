import express from 'express';
import multer from 'multer';
import { loginHandler, logoutHandler, isAuthenticated, isAdminConfigured, requireAdmin } from '../auth.js';
import { query } from '../db.js';
import { CATEGORIES } from '../lib/categories.js';
import {
    adminCounts, adminList, createOrg, deleteOrgs, getById, reorderFeatured,
    setFeatured, setStatus, STATUSES, updateOrg,
} from '../lib/orgs.js';
import {
    createEvent, deleteEvent, deleteRequest, getSettings, listEvents, listRequests, reorderEvents,
    requestCounts, saveSettings, setRequestStatus, updateEvent,
} from '../lib/site.js';
import { storageEnabled, uploadImage } from '../storage.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const wrap = fn => (req, res, next) => fn(req, res).catch(next);

function ids(body) {
    const list = Array.isArray(body?.ids) ? body.ids : [];
    return list.map(Number).filter(Number.isInteger).slice(0, 1000);
}

router.post('/login', express.json(), wrap(loginHandler));
router.post('/logout', logoutHandler);
router.get('/me', (req, res) => res.json({ authenticated: isAuthenticated(req), configured: isAdminConfigured() }));

router.use(requireAdmin);

router.get('/meta', wrap(async (req, res) => {
    const { rows: cities } = await query(
        `SELECT city, count(*)::int AS count FROM organizations WHERE city IS NOT NULL
         GROUP BY city ORDER BY count DESC LIMIT 300`,
    );
    const { rows: runs } = await query(
        `SELECT job, started_at, finished_at, ok, stats, error FROM job_runs ORDER BY id DESC LIMIT 10`,
    );
    const counts = { ...(await adminCounts()), requests_new: (await requestCounts()).new };
    res.json({ counts, categories: CATEGORIES, cities, statuses: STATUSES, storageEnabled, runs });
}));

router.get('/organizations', wrap(async (req, res) => {
    const { status, q, city, type, featured, page, limit } = req.query;
    res.json(await adminList({ status, q, city, type, featured: featured === '1', page, limit }));
}));

router.get('/organizations/:id', wrap(async (req, res) => {
    const org = await getById(Number(req.params.id));
    if (!org) return res.status(404).json({ error: 'Не знайдено' });
    res.json(org);
}));

router.post('/organizations', express.json({ limit: '1mb' }), wrap(async (req, res) => {
    res.status(201).json(await createOrg(req.body || {}));
}));

router.put('/organizations/:id', express.json({ limit: '1mb' }), wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await getById(id))) return res.status(404).json({ error: 'Не знайдено' });
    res.json(await updateOrg(id, req.body || {}));
}));

router.post('/organizations/bulk', express.json(), wrap(async (req, res) => {
    const list = ids(req.body);
    const { action } = req.body || {};
    if (!list.length) return res.status(400).json({ error: 'Не обрано жодної організації' });
    let changed;
    if (action === 'delete') changed = await deleteOrgs(list);
    else if (STATUSES.includes(action)) changed = await setStatus(list, action);
    else if (action === 'requeue') {
        ({ rowCount: changed } = await query(
            `UPDATE organizations SET status = 'registry', enrich_attempts = 0, enrich_error = NULL, updated_at = now()
             WHERE id = ANY($1::int[])`,
            [list],
        ));
    } else return res.status(400).json({ error: 'Невідома дія' });
    res.json({ changed });
}));

router.post('/organizations/:id/featured', express.json(), wrap(async (req, res) => {
    await setFeatured(Number(req.params.id), Boolean(req.body?.featured));
    res.json(await getById(Number(req.params.id)));
}));

router.post('/featured/order', express.json(), wrap(async (req, res) => {
    await reorderFeatured(ids(req.body));
    res.json({ ok: true });
}));

/* ---------- site requests ---------- */

router.get('/requests', wrap(async (req, res) => {
    const { status, page, limit } = req.query;
    res.json({ ...(await listRequests({ status, page, limit })), counts: await requestCounts() });
}));

router.post('/requests/:id/status', express.json(), wrap(async (req, res) => {
    const r = await setRequestStatus(Number(req.params.id), req.body?.status, 'адмінка');
    if (!r) return res.status(404).json({ error: 'Не знайдено' });
    res.json(r);
}));

router.delete('/requests/:id', wrap(async (req, res) => {
    await deleteRequest(Number(req.params.id));
    res.json({ ok: true });
}));

/* ---------- site content ---------- */

router.get('/site', wrap(async (req, res) => {
    res.json({ settings: await getSettings(), events: await listEvents() });
}));

router.put('/site/settings', express.json(), wrap(async (req, res) => {
    res.json(await saveSettings(req.body || {}));
}));

router.post('/site/events', express.json(), wrap(async (req, res) => {
    res.status(201).json(await createEvent(req.body || {}));
}));

router.put('/site/events/:id', express.json(), wrap(async (req, res) => {
    const e = await updateEvent(Number(req.params.id), req.body || {});
    if (!e) return res.status(404).json({ error: 'Не знайдено' });
    res.json(e);
}));

router.delete('/site/events/:id', wrap(async (req, res) => {
    await deleteEvent(Number(req.params.id));
    res.json({ ok: true });
}));

router.post('/site/events/order', express.json(), wrap(async (req, res) => {
    await reorderEvents(ids(req.body));
    res.json({ ok: true });
}));

router.post('/upload', upload.single('file'), wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не отримано' });
    const url = await uploadImage(req.file.buffer, req.file.mimetype, ['cases', 'events'].includes(req.body?.folder) ? req.body.folder : 'logos');
    res.json({ url });
}));

export default router;
