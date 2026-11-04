// Site content (settings, events) and requests from the site's forms.
import { query, withTransaction } from '../db.js';

const str = (v, max = 2000) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s ? s.slice(0, max) : null;
};

/* ---------- settings ---------- */

export const SETTING_KEYS = ['bank_details', 'work_hours'];

const BANK_FIELDS = ['recipient', 'edrpou', 'iban', 'bank', 'mfo', 'purpose', 'currencies', 'swift_note'];

export async function getSettings() {
    const { rows } = await query('SELECT key, value FROM site_settings');
    const out = { bank_details: null, work_hours: '' };
    for (const r of rows) out[r.key] = r.value;
    return out;
}

export async function saveSettings(data) {
    if (data.bank_details && typeof data.bank_details === 'object') {
        const bank = Object.fromEntries(BANK_FIELDS.map(k => [k, str(data.bank_details[k], 500) || '']));
        bank.iban = bank.iban.replace(/\s+/g, '').toUpperCase();
        await query(`INSERT INTO site_settings (key, value) VALUES ('bank_details', $1)
                     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`, [JSON.stringify(bank)]);
    }
    if ('work_hours' in data) {
        await query(`INSERT INTO site_settings (key, value) VALUES ('work_hours', $1)
                     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`, [JSON.stringify(str(data.work_hours, 500) || '')]);
    }
    return getSettings();
}

/* ---------- events ---------- */

const EVENT_COLUMNS = `id, title, text, to_char(event_date, 'YYYY-MM-DD') AS event_date, image_url, link, position, published`;

export async function listEvents({ publishedOnly = false } = {}) {
    const { rows } = await query(
        `SELECT ${EVENT_COLUMNS} FROM site_events ${publishedOnly ? 'WHERE published' : ''}
         ORDER BY position ASC, event_date DESC NULLS LAST, id DESC`,
    );
    return rows;
}

function cleanEvent(data) {
    const date = str(data.event_date, 10);
    return {
        title: str(data.title, 200),
        text: str(data.text, 3000),
        event_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
        image_url: str(data.image_url, 1000),
        link: str(data.link, 1000),
        published: data.published === undefined ? true : Boolean(data.published),
    };
}

export async function createEvent(data) {
    const e = cleanEvent(data);
    if (!e.title) throw Object.assign(new Error('Вкажіть назву події'), { status: 400 });
    const { rows } = await query(
        `INSERT INTO site_events (title, text, event_date, image_url, link, published, position)
         VALUES ($1, $2, $3, $4, $5, $6, (SELECT coalesce(min(position), 1) - 1 FROM site_events))
         RETURNING ${EVENT_COLUMNS}`,
        [e.title, e.text, e.event_date, e.image_url, e.link, e.published],
    );
    return rows[0];
}

export async function updateEvent(id, data) {
    const e = cleanEvent(data);
    if (!e.title) throw Object.assign(new Error('Вкажіть назву події'), { status: 400 });
    const { rows } = await query(
        `UPDATE site_events SET title = $2, text = $3, event_date = $4, image_url = $5, link = $6,
            published = $7, updated_at = now()
         WHERE id = $1 RETURNING ${EVENT_COLUMNS}`,
        [id, e.title, e.text, e.event_date, e.image_url, e.link, e.published],
    );
    return rows[0] || null;
}

export async function deleteEvent(id) {
    await query('DELETE FROM site_events WHERE id = $1', [id]);
}

export async function reorderEvents(ids) {
    await withTransaction(async client => {
        for (const [i, id] of ids.entries()) await client.query('UPDATE site_events SET position = $2 WHERE id = $1', [id, i]);
    });
}

/* ---------- requests ---------- */

export const REQUEST_KINDS = { help: 'Отримати допомогу', contact: 'Запитання', partner: 'Волонтерство / партнерство' };
export const REQUEST_ROLES = { veteran: 'Ветеран / ветеранка', family: 'Член родини', other: 'Інше' };
export const REQUEST_DIRECTIONS = {
    psychology: 'Психологічна реабілітація',
    referral: 'Перенаправлення до спеціалізованих послуг',
    documents: 'Консультації щодо документів',
    medical: 'Медичне перенаправлення та супровід',
    grants: 'Грантова підтримка та власна справа',
    unsure: 'Не знаю / потрібна консультація',
};
export const REQUEST_STATUSES = ['new', 'in_progress', 'done'];

/** Validates a public form submission; throws 400 with a user-facing message. */
export function cleanRequest(body) {
    const kind = REQUEST_KINDS[body?.kind] ? body.kind : 'help';
    const name = str(body?.name, 120);
    const phone = str(body?.phone, 40);
    const contact = str(body?.contact, 120);
    const message = str(body?.message, 3000);
    const bad = msg => Object.assign(new Error(msg), { status: 400 });

    if (!name) throw bad('Вкажіть, будь ласка, ім’я');
    if (!phone && !contact) throw bad('Залиште телефон або інший контакт, щоб ми могли відповісти');
    if (phone && phone.replace(/\D/g, '').length < 9) throw bad('Перевірте номер телефону');
    if (!body?.consent) throw bad('Потрібна згода на обробку персональних даних');
    if (kind !== 'help' && !message) throw bad('Напишіть кілька слів про ваше звернення');

    return {
        kind,
        name,
        phone,
        contact,
        role: REQUEST_ROLES[body?.role] ? body.role : null,
        direction: REQUEST_DIRECTIONS[body?.direction] ? body.direction : null,
        message,
    };
}

export async function createRequest(data, ip) {
    const { rows } = await query(
        `INSERT INTO help_requests (kind, name, phone, contact, role, direction, message, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [data.kind, data.name, data.phone, data.contact, data.role, data.direction, data.message, ip],
    );
    return rows[0];
}

export async function getRequest(id) {
    const { rows } = await query('SELECT * FROM help_requests WHERE id = $1', [id]);
    return rows[0] || null;
}

export async function listRequests({ status, page = 1, limit = 50 } = {}) {
    const params = [];
    let where = '';
    if (REQUEST_STATUSES.includes(status)) {
        params.push(status);
        where = 'WHERE status = $1';
    }
    const size = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
    const [{ rows }, { rows: c }] = await Promise.all([
        query(`SELECT id, kind, name, phone, contact, role, direction, message, status, handled_by, created_at
               FROM help_requests ${where} ORDER BY created_at DESC LIMIT ${size} OFFSET ${offset}`, params),
        query(`SELECT count(*)::int AS total FROM help_requests ${where}`, params),
    ]);
    return { items: rows, total: c[0].total };
}

export async function requestCounts() {
    const { rows } = await query(`SELECT status, count(*)::int AS n FROM help_requests GROUP BY status`);
    return Object.fromEntries(REQUEST_STATUSES.map(s => [s, rows.find(r => r.status === s)?.n || 0]));
}

export async function setRequestStatus(id, status, handledBy = null) {
    if (!REQUEST_STATUSES.includes(status)) throw Object.assign(new Error('Невідомий статус'), { status: 400 });
    const { rows } = await query(
        `UPDATE help_requests SET status = $2, handled_by = coalesce($3, handled_by), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, status, handledBy],
    );
    return rows[0] || null;
}

export async function deleteRequest(id) {
    await query('DELETE FROM help_requests WHERE id = $1', [id]);
}
