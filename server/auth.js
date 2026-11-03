import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const COOKIE = 'tyl_fond';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAGIC_TTL_MS = 15 * 60 * 1000;

const secret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
    console.warn('[auth] SESSION_SECRET is not set: sessions will reset on every restart');
}

function hmac(data) {
    return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function signToken(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${hmac(body)}`;
}

export function verifyToken(token) {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const expected = hmac(body);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!payload.exp || payload.exp < Date.now()) return null;
        return payload;
    } catch {
        return null;
    }
}

function readCookie(req, name) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) return decodeURIComponent(v.join('='));
    }
    return null;
}

function setSessionCookie(res, token, maxAgeMs) {
    const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);
    res.setHeader('Set-Cookie', [
        `${COOKIE}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
        secure ? 'Secure' : '',
    ].filter(Boolean).join('; '));
}

export function isAdminConfigured() {
    return Boolean(process.env.ADMIN_LOGIN && (process.env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD));
}

async function checkCredentials(login, password) {
    if (!isAdminConfigured() || typeof login !== 'string' || typeof password !== 'string') return false;
    const loginOk = login.length === process.env.ADMIN_LOGIN.length
        && crypto.timingSafeEqual(Buffer.from(login), Buffer.from(process.env.ADMIN_LOGIN));
    let passwordOk;
    if (process.env.ADMIN_PASSWORD_HASH) {
        passwordOk = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    } else {
        const a = crypto.createHash('sha256').update(password).digest();
        const b = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD).digest();
        passwordOk = crypto.timingSafeEqual(a, b);
    }
    return loginOk && passwordOk;
}

// Simple in-memory brute-force protection: 10 failed attempts per IP per 15 minutes.
const attempts = new Map();
function tooManyAttempts(ip) {
    const now = Date.now();
    const entry = attempts.get(ip);
    if (!entry || entry.reset < now) return false;
    return entry.count >= 10;
}
function recordFailure(ip) {
    const now = Date.now();
    const entry = attempts.get(ip);
    if (!entry || entry.reset < now) attempts.set(ip, { count: 1, reset: now + 15 * 60 * 1000 });
    else entry.count++;
}

export async function loginHandler(req, res) {
    const ip = req.ip;
    if (tooManyAttempts(ip)) return res.status(429).json({ error: 'Забагато спроб. Спробуйте пізніше.' });
    const { login, password } = req.body || {};
    if (!(await checkCredentials(login, password))) {
        recordFailure(ip);
        return res.status(401).json({ error: 'Невірний логін або пароль' });
    }
    attempts.delete(ip);
    setSessionCookie(res, signToken({ sub: 'admin', exp: Date.now() + SESSION_TTL_MS }), SESSION_TTL_MS);
    res.json({ ok: true });
}

export function logoutHandler(req, res) {
    setSessionCookie(res, '', 0);
    res.json({ ok: true });
}

export function isAuthenticated(req) {
    const payload = verifyToken(readCookie(req, COOKIE));
    return Boolean(payload && payload.sub === 'admin');
}

export function requireAdmin(req, res, next) {
    if (!isAuthenticated(req)) return res.status(401).json({ error: 'Потрібен вхід' });
    // Mutating requests must come from our own origin.
    if (req.method !== 'GET' && req.headers.origin) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        try {
            if (new URL(req.headers.origin).host !== host) return res.status(403).json({ error: 'Forbidden' });
        } catch {
            return res.status(403).json({ error: 'Forbidden' });
        }
    }
    next();
}

// One-time login links for the Telegram "Open in admin" button.
const usedNonces = new Map();

export function createMagicLink(baseUrl, redirectPath) {
    const token = signToken({
        sub: 'magic',
        nonce: crypto.randomBytes(12).toString('base64url'),
        redirect: redirectPath,
        exp: Date.now() + MAGIC_TTL_MS,
    });
    return `${baseUrl.replace(/\/$/, '')}/fond/magic?t=${encodeURIComponent(token)}`;
}

export function magicHandler(req, res) {
    const payload = verifyToken(req.query.t);
    if (!payload || payload.sub !== 'magic' || usedNonces.has(payload.nonce)) {
        return res.status(401).send('Посилання недійсне або вже використане. Увійдіть у /fond звичайним способом.');
    }
    usedNonces.set(payload.nonce, payload.exp);
    for (const [nonce, exp] of usedNonces) if (exp < Date.now()) usedNonces.delete(nonce);

    setSessionCookie(res, signToken({ sub: 'admin', exp: Date.now() + SESSION_TTL_MS }), SESSION_TTL_MS);
    const target = typeof payload.redirect === 'string' && payload.redirect.startsWith('/fond') ? payload.redirect : '/fond';
    res.redirect(302, target);
}
