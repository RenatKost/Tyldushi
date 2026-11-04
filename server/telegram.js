import { Api, Bot, InlineKeyboard, webhookCallback } from 'grammy';
import { createMagicLink } from './auth.js';
import { query } from './db.js';
import { CATEGORIES } from './lib/categories.js';
import { displayName } from './lib/display.js';
import { CONTACT_KEYS, getById, setFeatured, setStatus, updateOrg } from './lib/orgs.js';
import { getRequest, REQUEST_DIRECTIONS, REQUEST_KINDS, REQUEST_ROLES, setRequestStatus } from './lib/site.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChats = String(process.env.TELEGRAM_ADMIN_CHAT_ID || '')
    .split(',').map(s => s.trim()).filter(Boolean);
const publicUrl = (process.env.PUBLIC_URL || 'https://tyldushi.com').replace(/\/$/, '');

export const telegramEnabled = Boolean(token);

const STATUS_LABELS = {
    registry: '📄 У реєстрі (не оброблено)',
    enriching: '⏳ Збір інформації',
    pending: '🕓 На перевірці',
    approved: '✅ Опубліковано',
    rejected: '❌ Відхилено',
    rejected_auto: '🤖 Відхилено автоматично',
    hidden: '🙈 Приховано',
};

const EDIT_FIELDS = {
    name: 'Назва',
    description: 'Опис',
    city: 'Місто',
    contacts: 'Контакти',
};

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');

function isAdmin(ctx) {
    const ids = [ctx.chat?.id, ctx.from?.id].filter(Boolean).map(String);
    return adminChats.length > 0 && ids.some(id => adminChats.includes(id));
}

export function renderCard(org) {
    const cats = (org.help_categories || [])
        .map(k => CATEGORIES.find(c => c.key === k)?.label).filter(Boolean);
    const contacts = Object.entries(org.contacts || {}).map(([k, v]) => `• ${k}: ${esc(v)}`);
    const cases = (org.cases || []).slice(0, 3).map(c =>
        `• <b>${esc(cut(c.title, 120))}</b>${c.happened_at ? ` (${c.happened_at})` : ''}\n  ${esc(cut(c.description, 220))}${c.source_url ? `\n  ${esc(c.source_url)}` : ''}`);
    const sources = (org.sources || []).slice(0, 5).map(s => `• ${esc(typeof s === 'string' ? s : s.url)}`);

    const lines = [
        `<b>${esc(displayName(org))}</b>`,
        `<i>${esc(org.name)}</i>`,
        `${org.org_type === 'charity_fund' ? 'Благодійний фонд' : 'Громадська організація'} · ${esc(org.city || 'місто невідоме')}${org.edrpou ? ` · ЄДРПОУ ${esc(org.edrpou)}` : ''}`,
        `Статус: ${STATUS_LABELS[org.status] || org.status}${org.is_featured ? ' · ⭐ ТОП' : ''}`,
        '',
        org.description ? esc(cut(org.description, 1200)) : '<i>Опис відсутній</i>',
    ];
    if (cats.length) lines.push('', `<b>Чим допомагають:</b> ${esc(cats.join(', '))}`);
    if (cases.length) lines.push('', '<b>Кейси:</b>', ...cases);
    if (contacts.length) lines.push('', '<b>Контакти:</b>', ...contacts);
    if (sources.length) lines.push('', '<b>Джерела:</b>', ...sources);
    if (org.ai_confidence != null) lines.push('', `Впевненість бота: ${Math.round(org.ai_confidence * 100)}%`);
    lines.push(org.logo_url ? `Логотип: ${esc(publicUrl + org.logo_url)}` : 'Логотип: не знайдено');

    let text = lines.join('\n');
    if (text.length > 4000) text = `${text.slice(0, 3990)}…`;
    return text;
}

function mainKeyboard(org) {
    const kb = new InlineKeyboard();
    if (org.status !== 'approved') kb.text('✅ Схвалити', `a:${org.id}`);
    if (org.status !== 'rejected') kb.text('❌ Відхилити', `r:${org.id}`);
    kb.row().text('✏️ Редагувати', `e:${org.id}`);
    kb.text(org.is_featured ? '☆ Прибрати з топу' : '⭐ В топ', `f:${org.id}`);
    if (org.status === 'approved') kb.row().url('🌐 Відкрити на сайті', `${publicUrl}/organizations/${org.slug}`);
    return kb;
}

function editKeyboard(org) {
    const kb = new InlineKeyboard();
    for (const [field, label] of Object.entries(EDIT_FIELDS)) kb.text(label, `ef:${org.id}:${field}`).row();
    kb.text('🏷 Категорії', `ec:${org.id}`).row();
    kb.url('🛠 Відкрити в адмінці', createMagicLink(publicUrl, `/fond#/org/${org.id}`)).row();
    kb.text('← Назад', `b:${org.id}`);
    return kb;
}

function categoriesKeyboard(org) {
    const kb = new InlineKeyboard();
    CATEGORIES.forEach((c, i) => {
        const on = (org.help_categories || []).includes(c.key);
        kb.text(`${on ? '✅' : '▫️'} ${c.label}`, `ct:${org.id}:${c.key}`);
        if (i % 2 === 1) kb.row();
    });
    kb.row().text('← Готово', `e:${org.id}`);
    return kb;
}

const sendOpts = kb => ({ parse_mode: 'HTML', reply_markup: kb, link_preview_options: { is_disabled: true } });

/* ---------- requests from the site's forms ---------- */

const REQUEST_STATUS_LABELS = { new: '🆕 Нова', in_progress: '🟡 В роботі', done: '✅ Завершено' };

function renderRequest(r) {
    const head = r.kind === 'help' ? '🆘 Нова заявка на допомогу' : r.kind === 'partner' ? '🤝 Волонтерство / партнерство' : '✉️ Нове звернення';
    const date = new Date(r.created_at).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' });
    const lines = [
        `<b>${head}</b>  #${r.id}`,
        '',
        `👤 <b>${esc(r.name)}</b>${r.role ? ` · ${esc(REQUEST_ROLES[r.role])}` : ''}`,
    ];
    if (r.phone) lines.push(`📞 <a href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}">${esc(r.phone)}</a>`);
    if (r.contact) lines.push(`💬 ${esc(r.contact)}`);
    if (r.direction) lines.push(`🧭 ${esc(REQUEST_DIRECTIONS[r.direction])}`);
    if (r.message) lines.push('', esc(cut(r.message, 2500)));
    lines.push('', `🕒 ${date} · ${REQUEST_STATUS_LABELS[r.status]}${r.handled_by ? ` · ${esc(r.handled_by)}` : ''}`);
    return lines.join('\n');
}

function requestKeyboard(r) {
    const kb = new InlineKeyboard();
    if (r.status !== 'in_progress') kb.text('🟡 В роботу', `rq:${r.id}:in_progress`);
    if (r.status !== 'done') kb.text('✅ Завершено', `rq:${r.id}:done`);
    if (r.status === 'done') kb.text('↩️ Повернути', `rq:${r.id}:new`);
    return kb;
}

/** Posts a new site request to the moderators' group. */
export async function sendHelpRequest(r, api = token ? new Api(token) : null) {
    if (!api || !adminChats.length) return false;
    let messageId = null;
    for (const chat of adminChats) {
        const msg = await api.sendMessage(chat, renderRequest(r), sendOpts(requestKeyboard(r)));
        messageId ??= msg.message_id;
    }
    await query('UPDATE help_requests SET tg_message_id = $2 WHERE id = $1', [r.id, messageId]);
    return true;
}


async function setState(chatId, state) {
    if (state) {
        await query(`INSERT INTO tg_state (chat_id, state) VALUES ($1, $2)
                     ON CONFLICT (chat_id) DO UPDATE SET state = $2, updated_at = now()`, [chatId, state]);
    } else {
        await query('DELETE FROM tg_state WHERE chat_id = $1', [chatId]);
    }
}

async function getState(chatId) {
    const { rows } = await query(
        `SELECT state FROM tg_state WHERE chat_id = $1 AND updated_at > now() - interval '30 minutes'`, [chatId]);
    return rows[0]?.state || null;
}

function parseContacts(text) {
    const out = {};
    for (const line of text.split('\n')) {
        const m = line.match(/^\s*([a-zA-Z]+)\s*[:=]\s*(.+)$/);
        if (m && CONTACT_KEYS.includes(m[1].toLowerCase())) out[m[1].toLowerCase()] = m[2].trim();
    }
    return out;
}

const who = ctx => esc([ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ') || ctx.from?.username || 'адмін');

// Edit state is stored per admin (Telegram user id), so two admins in one group do not collide.
function createBot() {
    const bot = new Bot(token);

    bot.command('start', async ctx => {
        if (!isAdmin(ctx)) {
            return ctx.reply(`Chat id цього чату: <code>${ctx.chat.id}</code>\nДодайте його в змінну TELEGRAM_ADMIN_CHAT_ID на Railway, щоб керувати організаціями.`, { parse_mode: 'HTML' });
        }
        return ctx.reply('Бот фонду «Тил Душі». Сюди приходять заявки з сайту tyldushi.com.');
    });

    bot.use(async (ctx, next) => {
        if (!isAdmin(ctx)) {
            if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Немає доступу' });
            return;
        }
        return next();
    });

    async function refresh(ctx, orgId, kb, note) {
        const org = await getById(orgId);
        if (!org) return ctx.answerCallbackQuery({ text: 'Організацію видалено' });
        const text = note ? `${renderCard(org)}\n\n${note}` : renderCard(org);
        await ctx.editMessageText(text.slice(0, 4096), sendOpts(kb ? kb(org) : mainKeyboard(org))).catch(err => {
            if (!String(err.description || err.message).includes('message is not modified')) throw err;
        });
        return org;
    }

    bot.callbackQuery(/^rq:(\d+):(new|in_progress|done)$/, async ctx => {
        const [id, status] = [Number(ctx.match[1]), ctx.match[2]];
        if (!(await getRequest(id))) return ctx.answerCallbackQuery({ text: 'Заявку видалено' });
        const r = await setRequestStatus(id, status, status === 'new' ? null : who(ctx).replace(/<[^>]+>/g, ''));
        await ctx.editMessageText(renderRequest(r), sendOpts(requestKeyboard(r))).catch(() => {});
        await ctx.answerCallbackQuery({ text: REQUEST_STATUS_LABELS[status] });
    });

    bot.callbackQuery(/^a:(\d+)$/, async ctx => {
        await setStatus([Number(ctx.match[1])], 'approved');
        await refresh(ctx, Number(ctx.match[1]), null, `✅ Схвалив(ла): ${who(ctx)}`);
        await ctx.answerCallbackQuery({ text: 'Опубліковано ✅' });
    });

    bot.callbackQuery(/^r:(\d+)$/, async ctx => {
        await setStatus([Number(ctx.match[1])], 'rejected');
        await refresh(ctx, Number(ctx.match[1]), null, `❌ Відхилив(ла): ${who(ctx)}`);
        await ctx.answerCallbackQuery({ text: 'Відхилено' });
    });

    bot.callbackQuery(/^f:(\d+)$/, async ctx => {
        const id = Number(ctx.match[1]);
        const org = await getById(id);
        await setFeatured(id, !org.is_featured);
        await refresh(ctx, id, null, org.is_featured ? `☆ Прибрав(ла) з топу: ${who(ctx)}` : `⭐ Додав(ла) в топ: ${who(ctx)}`);
        await ctx.answerCallbackQuery({ text: org.is_featured ? 'Прибрано з топу' : 'Додано в топ ⭐' });
    });

    bot.callbackQuery(/^e:(\d+)$/, async ctx => {
        await setState(ctx.from.id, null);
        await refresh(ctx, Number(ctx.match[1]), editKeyboard);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^b:(\d+)$/, async ctx => {
        await setState(ctx.from.id, null);
        await refresh(ctx, Number(ctx.match[1]));
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^ec:(\d+)$/, async ctx => {
        await refresh(ctx, Number(ctx.match[1]), categoriesKeyboard);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^ct:(\d+):(\w+)$/, async ctx => {
        const id = Number(ctx.match[1]);
        const org = await getById(id);
        const set = new Set(org.help_categories || []);
        set.has(ctx.match[2]) ? set.delete(ctx.match[2]) : set.add(ctx.match[2]);
        await updateOrg(id, { help_categories: [...set] });
        await refresh(ctx, id, categoriesKeyboard);
        await ctx.answerCallbackQuery();
    });

    bot.callbackQuery(/^ef:(\d+):(\w+)$/, async ctx => {
        const [id, field] = [Number(ctx.match[1]), ctx.match[2]];
        if (!EDIT_FIELDS[field]) return ctx.answerCallbackQuery();
        await setState(ctx.from.id, { orgId: id, field, chatId: ctx.chat.id, messageId: ctx.callbackQuery.message?.message_id });
        const hint = field === 'contacts'
            ? `надішліть контакти, кожен з нового рядка у форматі <code>ключ: значення</code>.\nКлючі: ${CONTACT_KEYS.join(', ')}`
            : `надішліть нове значення для поля «${EDIT_FIELDS[field]}».`;
        // In groups the bot only sees replies to its own messages, so the prompt forces a reply.
        await ctx.reply(`${who(ctx)}, ${hint}\nВідповідайте на це повідомлення. /cancel — скасувати`, {
            parse_mode: 'HTML',
            reply_markup: { force_reply: true, selective: true, input_field_placeholder: EDIT_FIELDS[field] },
        });
        await ctx.answerCallbackQuery();
    });

    bot.command('cancel', async ctx => {
        await setState(ctx.from.id, null);
        await ctx.reply('Скасовано');
    });

    bot.on('message:text', async ctx => {
        const state = await getState(ctx.from.id);
        if (!state) {
            if (ctx.chat.type === 'private') await ctx.reply('Заявки з сайту приходять у групу модераторів.');
            return;
        }
        const value = ctx.message.text;
        const patch = state.field === 'contacts' ? { contacts: parseContacts(value) } : { [state.field]: value };
        if (state.field === 'contacts' && !Object.keys(patch.contacts).length) {
            return ctx.reply('Не вдалося розпізнати жодного контакту. Приклад:\nphone: +380 67 000 00 00\nemail: info@example.org',
                { reply_markup: { force_reply: true, selective: true } });
        }
        await updateOrg(state.orgId, patch);
        await setState(ctx.from.id, null);
        const org = await getById(state.orgId);
        if (state.messageId) {
            await ctx.api.editMessageText(state.chatId || ctx.chat.id, state.messageId,
                `${renderCard(org)}\n\n✏️ Відредагував(ла): ${who(ctx)}`.slice(0, 4096), sendOpts(mainKeyboard(org)))
                .catch(() => {});
        }
        await ctx.reply(`Збережено: ${EDIT_FIELDS[state.field]} ✅`);
    });

    bot.catch(err => console.error('[telegram]', err.error || err));
    return bot;
}

/** Express handler for the webhook; null when the bot is not configured. */
export function telegramWebhook() {
    if (!telegramEnabled) return null;
    const bot = createBot();
    return webhookCallback(bot, 'express', { secretToken: process.env.TELEGRAM_WEBHOOK_SECRET || undefined });
}

/** Registers the webhook URL with Telegram on startup. */
export async function registerWebhook() {
    if (!telegramEnabled || !process.env.TELEGRAM_WEBHOOK_SECRET) return;
    const api = new Api(token);
    await api.setWebhook(`${publicUrl}/api/telegram/webhook`, {
        secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'],
    });
    await api.setMyCommands([
        { command: 'cancel', description: 'Скасувати редагування' },
    ]);
    console.log('[telegram] webhook registered');
}
