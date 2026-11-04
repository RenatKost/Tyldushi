// Site behaviour: navigation, mobile menu, modals, request form, bank details, events.
// Animations live in js/motion.js (window.Motion).
const motion = () => window.Motion || { enabled: false, modalIn: m => { m.style.display = 'block'; }, modalOut: (m, done) => { m.style.display = 'none'; done && done(); }, menuIn() {}, revealCards() {} };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Navigation ---------- */
document.addEventListener('DOMContentLoaded', function() {
    const header = document.querySelector('.header');
    const navLinks = document.querySelectorAll('.nav-link');
    const navMenu = document.querySelector('.nav-menu');
    const toggle = document.querySelector('.mobile-menu-toggle');

    function closeMenu() {
        if (!navMenu || !navMenu.classList.contains('active')) return;
        navMenu.classList.remove('active');
        toggle && toggle.classList.remove('active');
        document.body.style.overflow = '';
    }

    if (toggle && navMenu) {
        toggle.addEventListener('click', function(e) {
            e.preventDefault();
            const isActive = navMenu.classList.toggle('active');
            this.classList.toggle('active', isActive);
            this.setAttribute('aria-expanded', String(isActive));
            document.body.style.overflow = isActive ? 'hidden' : '';
            if (isActive) motion().menuIn(navMenu);
        });
    }

    navLinks.forEach(link => link.addEventListener('click', closeMenu));

    // Highlight the section in view.
    const sections = [...document.querySelectorAll('main section[id]')];
    if (sections.length && 'IntersectionObserver' in window) {
        const io = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                navLinks.forEach(l => l.classList.toggle('active', l.getAttribute('href') === `#${entry.target.id}`));
            });
        }, { rootMargin: `-${header.offsetHeight + 40}px 0px -55% 0px` });
        sections.forEach(s => io.observe(s));
    }

    initRequestForm();
    initMap();
    loadSiteContent();
});

/* ---------- Modals ---------- */
// The "Отримати допомогу" buttons open the request form in its "help" mode.
function openModal(modalId) {
    if (modalId === 'receiveModal') return openRequest('help');
    showModal(modalId);
}

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    document.body.style.overflow = 'hidden';
    motion().modalIn(modal);
    const first = modal.querySelector('input:not([type=hidden]):not([tabindex="-1"]), button.btn');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 350);
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal || modal.style.display !== 'block') return;
    motion().modalOut(modal, () => {
        document.body.style.overflow = '';
    });
}

window.addEventListener('click', function(event) {
    if (event.target.classList.contains('modal')) closeModal(event.target.id);
});

window.addEventListener('keydown', function(event) {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.modal').forEach(modal => {
        if (modal.style.display === 'block') closeModal(modal.id);
    });
});

/* ---------- Request form (help / contact / partner) ---------- */
const REQUEST_TEXTS = {
    help: {
        title: 'Заявка на допомогу',
        note: 'Залиште контакти — фахівець фонду зв’яжеться з вами найближчим часом.',
        placeholder: 'Не обов’язково для заявки на допомогу',
    },
    contact: {
        title: 'Написати нам',
        note: 'Поставте запитання — ми відповімо телефоном або в месенджері.',
        placeholder: 'Ваше запитання',
    },
    partner: {
        title: 'Волонтерство та партнерство',
        note: 'Розкажіть, як ви хочете долучитися до роботи фонду.',
        placeholder: 'Чим ви можете допомогти або яку співпрацю пропонуєте',
    },
};

function openRequest(kind = 'help') {
    const form = document.getElementById('requestForm');
    if (!form) return;
    const texts = REQUEST_TEXTS[kind] || REQUEST_TEXTS.help;
    resetRequestForm();
    form.elements.kind.value = kind;
    document.getElementById('requestTitle').textContent = texts.title;
    document.getElementById('requestNote').textContent = texts.note;
    form.elements.message.placeholder = texts.placeholder;
    form.querySelectorAll('[data-only]').forEach(el => {
        el.hidden = !el.dataset.only.split(' ').includes(kind);
    });
    showModal('receiveModal');
}

function resetRequestForm() {
    const form = document.getElementById('requestForm');
    const success = form.parentElement.querySelector('.form-success');
    if (success) success.remove();
    form.hidden = false;
    form.querySelector('.form-error').textContent = '';
    form.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
}

function initRequestForm() {
    const form = document.getElementById('requestForm');
    if (!form) return;
    const error = form.querySelector('.form-error');

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        error.textContent = '';
        const data = Object.fromEntries(new FormData(form));
        data.consent = form.elements.consent.checked;

        const nameField = form.elements.name;
        const phoneField = form.elements.phone;
        nameField.classList.toggle('invalid', !data.name.trim());
        const needsContact = data.kind !== 'help';
        const hasContact = data.phone.trim() || (needsContact && (data.contact || '').trim());
        phoneField.classList.toggle('invalid', !hasContact);
        if (!data.name.trim() || !hasContact) {
            error.textContent = 'Вкажіть ім’я та телефон, щоб ми могли з вами зв’язатися.';
            return;
        }
        if (!data.consent) {
            error.textContent = 'Потрібна згода на обробку персональних даних.';
            return;
        }

        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        button.textContent = 'Надсилаємо…';
        try {
            const res = await fetch('/api/requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'Не вдалося надіслати. Спробуйте ще раз або зателефонуйте нам.');
            form.reset();
            form.hidden = true;
            form.insertAdjacentHTML('afterend', `
                <div class="form-success">
                    <span class="icon-ring"><i class="fas fa-check"></i></span>
                    <h3>Дякуємо, заявку отримано</h3>
                    <p>Ми зв’яжемося з вами найближчим часом. Якщо питання термінове — телефонуйте
                       <a href="tel:+380965051991">+380 96 505 19 91</a>.</p>
                </div>`);
        } catch (err) {
            error.textContent = err.message;
        } finally {
            button.disabled = false;
            button.textContent = 'Надіслати';
        }
    });
}

/* ---------- Bank details ---------- */
const BANK_ROWS = [
    ['recipient', 'Отримувач'],
    ['edrpou', 'ЄДРПОУ'],
    ['iban', 'IBAN'],
    ['bank', 'Банк'],
    ['mfo', 'МФО'],
    ['purpose', 'Призначення платежу'],
];

function formatIban(iban) {
    return String(iban).replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}

async function copyText(text, button) {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const area = document.createElement('textarea');
        area.value = text;
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
    }
    if (button) {
        const icon = button.innerHTML;
        button.classList.add('is-done');
        button.innerHTML = '<i class="fas fa-check"></i>' + (button.classList.contains('btn') ? ' Скопійовано' : '');
        setTimeout(() => {
            button.classList.remove('is-done');
            button.innerHTML = icon;
        }, 1800);
    }
}

function renderBank(bank) {
    const box = document.getElementById('bankDetails');
    if (!box || !bank || !bank.iban) return;
    const rows = BANK_ROWS.filter(([key]) => bank[key]);
    box.innerHTML = rows.map(([key, label]) => {
        const value = key === 'iban' ? formatIban(bank.iban) : bank[key];
        const copy = key === 'iban' ? bank.iban : value;
        return `
            <div class="bank-row">
                <div><dt>${label}</dt><dd class="${key === 'iban' || key === 'edrpou' ? 'mono' : ''}">${esc(value)}</dd></div>
                <button class="copy-btn" type="button" data-copy="${esc(copy)}" aria-label="Скопіювати: ${label}"><i class="fas fa-copy"></i></button>
            </div>`;
    }).join('') + (bank.currencies ? `<p class="modal-small">Рахунок приймає ${esc(bank.currencies)}.${bank.swift_note ? ` ${esc(bank.swift_note)}` : ''}</p>` : '');

    box.addEventListener('click', e => {
        const btn = e.target.closest('[data-copy]');
        if (btn) copyText(btn.dataset.copy, btn);
    });
    const all = document.getElementById('copyAll');
    if (all) {
        all.onclick = () => copyText(rows.map(([key, label]) => `${label}: ${key === 'iban' ? bank.iban : bank[key]}`).join('\n'), all);
    }
}

/* ---------- Content from the admin panel ---------- */
function formatDate(d) {
    if (!d) return '';
    const date = new Date(`${d}T00:00:00`);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function safeUrl(url) {
    try {
        const u = new URL(url, location.origin);
        return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
    } catch {
        return null;
    }
}

function renderEvents(events) {
    const section = document.getElementById('events');
    const grid = document.getElementById('eventsGrid');
    if (!section || !grid || !events || !events.length) return;
    grid.innerHTML = events.map(e => {
        const link = e.link && safeUrl(e.link);
        const img = e.image_url && (e.image_url.startsWith('/media/') ? e.image_url : safeUrl(e.image_url));
        const tag = link ? 'a' : 'article';
        const attrs = link ? ` href="${esc(link)}" target="_blank" rel="noopener"` : '';
        return `
            <${tag} class="event-card"${attrs}>
                <div class="event-card__img">
                    ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<img class="placeholder" src="/images/phoenix-sm.webp" alt="" loading="lazy">'}
                </div>
                <div class="event-card__body">
                    ${e.event_date ? `<time datetime="${esc(e.event_date)}">${esc(formatDate(e.event_date))}</time>` : ''}
                    <h3>${esc(e.title)}</h3>
                    ${e.text ? `<p>${esc(e.text)}</p>` : ''}
                </div>
            </${tag}>`;
    }).join('');
    section.hidden = false;
    document.querySelectorAll('.nav-events').forEach(el => { el.hidden = false; });
    motion().revealCards(grid.querySelectorAll('.event-card'));
    if (window.ScrollTrigger) ScrollTrigger.refresh();
}

async function loadSiteContent() {
    try {
        const res = await fetch('/api/site', { headers: { Accept: 'application/json' } });
        if (!res.ok) return;
        const site = await res.json();
        renderBank(site.bank_details);
        renderEvents(site.events);
        if (site.work_hours) {
            const li = document.querySelector('.work-hours');
            if (li) {
                li.querySelector('span').textContent = site.work_hours;
                li.hidden = false;
            }
        }
    } catch {
        // The page stays usable without dynamic content.
    }
}

/* ---------- Map (loaded on demand: Google Maps sets cookies) ---------- */
function initMap() {
    const box = document.getElementById('map');
    if (!box) return;
    const load = () => {
        if (box.querySelector('iframe')) return;
        box.insertAdjacentHTML('beforeend', `<iframe title="Карта: Одеса, Французький бульвар 9" loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
            src="https://www.google.com/maps?q=${encodeURIComponent('Французький бульвар, 9, Одеса')}&z=16&output=embed"></iframe>`);
        box.querySelector('.map-load')?.remove();
    };
    box.querySelector('.map-load')?.addEventListener('click', load);
}
