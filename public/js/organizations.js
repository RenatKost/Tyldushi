/* Organizations catalog: filters, list, detail view with client-side routing. */
(function () {
    const API = '/api';
    const hasGsap = typeof window.gsap !== 'undefined' && window.Motion && window.Motion.enabled;
    const hasFlip = hasGsap && typeof window.Flip !== 'undefined';
    if (hasFlip) gsap.registerPlugin(Flip);

    const els = {
        hero: document.querySelector('.orgs-hero'),
        catalog: document.getElementById('catalog'),
        detail: document.getElementById('orgDetail'),
        form: document.getElementById('orgFilters'),
        q: document.querySelector('#orgFilters input[name="q"]'),
        city: document.querySelector('#orgFilters select[name="city"]'),
        types: document.querySelectorAll('.orgs-type button'),
        chips: document.getElementById('orgCategories'),
        grid: document.getElementById('orgGrid'),
        count: document.getElementById('orgCount'),
        empty: document.getElementById('orgEmpty'),
        more: document.getElementById('orgMore'),
        loader: document.getElementById('orgLoader'),
    };

    const state = { q: '', city: '', category: '', type: '', page: 1 };
    let categories = [];
    let total = 0;
    let requestId = 0;
    let catalogScroll = 0;

    /* ---------- helpers ---------- */
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function safeUrl(url) {
        try {
            const u = new URL(url, location.origin);
            return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
        } catch {
            return null;
        }
    }

    function plural(n, one, few, many) {
        const m10 = n % 10, m100 = n % 100;
        if (m10 === 1 && m100 !== 11) return one;
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
        return many;
    }

    function initials(name) {
        const words = String(name).replace(/["«»“”]/g, '').split(/\s+/)
            .filter(w => w.length > 2 && !/^(благодійн|громадськ|організ|фонд|міжнародн)/i.test(w));
        return (words[0] || name || '?').charAt(0).toUpperCase();
    }

    function logoHtml(org) {
        const src = org.logo_url && (org.logo_url.startsWith('/media/') ? org.logo_url : safeUrl(org.logo_url));
        return src
            ? `<span class="org-logo" data-i="${esc(initials(org.name))}"><img src="${esc(src)}" alt="" loading="lazy" onerror="this.parentNode.textContent=this.parentNode.dataset.i"></span>`
            : `<span class="org-logo" aria-hidden="true">${esc(initials(org.name))}</span>`;
    }

    const typeLabel = t => (t === 'charity_fund' ? 'Благодійний фонд' : 'Громадська організація');
    const category = key => categories.find(c => c.key === key);

    async function getJSON(url) {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    /* ---------- URL state ---------- */
    function readQuery() {
        const p = new URLSearchParams(location.search);
        for (const key of ['q', 'city', 'category', 'type']) state[key] = p.get(key) || '';
    }

    function writeQuery() {
        const p = new URLSearchParams();
        for (const key of ['q', 'city', 'category', 'type']) if (state[key]) p.set(key, state[key]);
        const qs = p.toString();
        history.replaceState(history.state, '', `/organizations${qs ? `?${qs}` : ''}`);
    }

    function syncControls() {
        els.q.value = state.q;
        els.city.value = state.city;
        els.types.forEach(b => b.classList.toggle('is-active', b.dataset.type === state.type));
        els.chips.querySelectorAll('.orgs-chip').forEach(c => c.classList.toggle('is-active', c.dataset.key === state.category));
    }

    /* ---------- list ---------- */
    function cardHtml(org) {
        const tags = (org.help_categories || []).slice(0, 3).map(k => category(k)).filter(Boolean)
            .map(c => `<span class="org-tag">${esc(c.label)}</span>`).join('');
        return `
            <a class="org-card${org.is_featured ? ' is-featured' : ''}" href="/organizations/${encodeURIComponent(org.slug)}"
               data-slug="${esc(org.slug)}" data-flip-id="org-${org.id}">
                ${org.is_featured ? '<span class="org-card__badge"><i class="fas fa-star"></i> Топ</span>' : ''}
                <div class="org-card__head">
                    ${logoHtml(org)}
                    <div>
                        <h3 class="org-card__title">${esc(org.short_name || org.name)}</h3>
                        <div class="org-card__meta">
                            ${org.city ? `<span><i class="fas fa-location-dot"></i>${esc(org.city)}</span>` : ''}
                            <span><i class="fas fa-building-ngo"></i>${typeLabel(org.org_type)}</span>
                        </div>
                    </div>
                </div>
                ${org.excerpt ? `<p class="org-card__excerpt">${esc(org.excerpt)}</p>` : ''}
                ${tags ? `<div class="org-tags">${tags}</div>` : ''}
                <span class="org-card__more">Детальніше <i class="fas fa-arrow-right"></i></span>
            </a>`;
    }

    function renderList(items, append) {
        const flipState = hasFlip && !append ? Flip.getState(els.grid.querySelectorAll('.org-card')) : null;
        const before = new Set([...els.grid.querySelectorAll('.org-card')].map(c => c.dataset.flipId));

        if (append) els.grid.insertAdjacentHTML('beforeend', items.map(cardHtml).join(''));
        else els.grid.innerHTML = items.map(cardHtml).join('');

        const cards = [...els.grid.querySelectorAll('.org-card')];
        const fresh = cards.filter(c => !before.has(c.dataset.flipId));

        if (flipState) {
            Flip.from(flipState, {
                targets: cards,
                duration: 0.6,
                ease: 'power3.inOut',
                absolute: true,
                stagger: 0.02,
                onEnter: entering => gsap.fromTo(entering, { autoAlpha: 0, y: 30, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.6, stagger: 0.04 }),
                onLeave: leaving => gsap.to(leaving, { autoAlpha: 0, scale: 0.9, duration: 0.3 }),
            });
        } else if (hasGsap && fresh.length) {
            window.Motion.revealCards(fresh);
        }
    }

    async function loadList({ append = false } = {}) {
        const id = ++requestId;
        if (!append) state.page = 1;
        const p = new URLSearchParams({ page: state.page, limit: 24 });
        for (const key of ['q', 'city', 'category', 'type']) if (state[key]) p.set(key, state[key]);

        els.loader.hidden = false;
        els.more.hidden = true;
        try {
            const data = await getJSON(`${API}/organizations?${p}`);
            if (id !== requestId) return;
            total = data.total;
            renderList(data.items, append);
            const shown = els.grid.querySelectorAll('.org-card').length;
            els.count.textContent = total
                ? `Знайдено ${total} ${plural(total, 'організацію', 'організації', 'організацій')}`
                : '';
            els.empty.hidden = total > 0;
            els.more.hidden = shown >= total;
        } catch (err) {
            if (id !== requestId) return;
            els.count.textContent = 'Не вдалося завантажити каталог. Спробуйте оновити сторінку.';
        } finally {
            if (id === requestId) els.loader.hidden = true;
        }
    }

    function renderChips() {
        els.chips.innerHTML = [
            `<button type="button" class="orgs-chip" data-key=""><i class="fas fa-border-all"></i>Усі напрямки</button>`,
            ...categories.map(c => `<button type="button" class="orgs-chip" data-key="${esc(c.key)}"><i class="fas ${esc(c.icon)}"></i>${esc(c.label)}</button>`),
        ].join('');
    }

    async function loadMeta() {
        const [cats, cities] = await Promise.all([
            getJSON(`${API}/categories`).catch(() => []),
            getJSON(`${API}/cities`).catch(() => []),
        ]);
        categories = cats;
        renderChips();
        els.city.insertAdjacentHTML('beforeend', cities
            .map(c => `<option value="${esc(c.city)}">${esc(c.city)} (${c.count})</option>`).join(''));

        const totalOrgs = cities.reduce((sum, c) => sum + c.count, 0);
        animateStat('total', totalOrgs);
        animateStat('cities', cities.length);
    }

    function animateStat(name, value) {
        const el = document.querySelector(`[data-stat="${name}"]`);
        if (!el) return;
        if (!hasGsap) { el.textContent = value; return; }
        const obj = { v: 0 };
        gsap.to(obj, { v: value, duration: 1.6, ease: 'power2.out', onUpdate: () => { el.textContent = Math.round(obj.v).toLocaleString('uk-UA'); } });
    }

    /* ---------- detail ---------- */
    const CONTACTS = {
        phone: { icon: 'fa-phone', href: v => `tel:${v.replace(/[^\d+]/g, '')}` },
        email: { icon: 'fa-envelope', href: v => `mailto:${v}` },
        website: { icon: 'fa-globe', href: v => safeUrl(/^https?:/i.test(v) ? v : `https://${v}`) },
        facebook: { icon: 'fa-brands fa-facebook', href: v => safeUrl(/^https?:/i.test(v) ? v : `https://facebook.com/${v.replace(/^@/, '')}`) },
        instagram: { icon: 'fa-brands fa-instagram', href: v => safeUrl(/^https?:/i.test(v) ? v : `https://instagram.com/${v.replace(/^@/, '')}`) },
        telegram: { icon: 'fa-brands fa-telegram', href: v => safeUrl(/^https?:/i.test(v) ? v : `https://t.me/${v.replace(/^@/, '')}`) },
        youtube: { icon: 'fa-brands fa-youtube', href: v => safeUrl(/^https?:/i.test(v) ? v : `https://youtube.com/${v}`) },
        tiktok: { icon: 'fa-brands fa-tiktok', href: v => safeUrl(/^https?:/i.test(v) ? v : `https://tiktok.com/@${v.replace(/^@/, '')}`) },
    };

    function contactsHtml(contacts) {
        return Object.entries(contacts || {}).flatMap(([key, value]) => {
            const def = CONTACTS[key];
            if (!def) return [];
            return String(value).split(/[,;]\s*/).filter(Boolean).map(v => {
                const href = def.href(v.trim());
                const label = v.trim().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
                const icon = def.icon.includes('fa-brands') ? def.icon : `fas ${def.icon}`;
                return href
                    ? `<a class="org-contact" href="${esc(href)}" ${key === 'phone' || key === 'email' ? '' : 'target="_blank" rel="noopener nofollow"'}><i class="${icon}"></i><span>${esc(label)}</span></a>`
                    : '';
            });
        }).join('');
    }

    function formatDate(d) {
        if (!d) return '';
        const date = new Date(`${d}T00:00:00`);
        return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('uk-UA', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    function detailHtml(org) {
        const help = (org.help_categories || []).map(category).filter(Boolean)
            .map(c => `<div class="org-help-item"><i class="fas ${esc(c.icon)}"></i><span>${esc(c.label)}</span></div>`).join('');
        const cases = (org.cases || []).map(c => {
            const img = c.image_url && (c.image_url.startsWith('/media/') ? c.image_url : safeUrl(c.image_url));
            const src = c.source_url && safeUrl(c.source_url);
            return `
                <article class="org-case${img ? '' : ' no-image'}">
                    ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}
                    <div>
                        <h3>${esc(c.title)}</h3>
                        ${c.happened_at ? `<time datetime="${esc(c.happened_at)}">${esc(formatDate(c.happened_at))}</time>` : ''}
                        ${c.description ? `<p>${esc(c.description)}</p>` : ''}
                        ${src ? `<a href="${esc(src)}" target="_blank" rel="noopener nofollow">Джерело <i class="fas fa-arrow-up-right-from-square"></i></a>` : ''}
                    </div>
                </article>`;
        }).join('');
        const contacts = contactsHtml(org.contacts);
        const sources = (org.sources || []).map(s => safeUrl(typeof s === 'string' ? s : s.url)).filter(Boolean)
            .map(u => `<li><a href="${esc(u)}" target="_blank" rel="noopener nofollow">${esc(u.replace(/^https?:\/\/(www\.)?/, ''))}</a></li>`).join('');

        return `
            <div class="container">
                <button class="org-back" type="button" data-back><i class="fas fa-arrow-left"></i> До каталогу</button>
                <div class="org-detail__layout">
                    <div class="org-detail__main">
                        <div class="org-panel" data-anim>
                            <div class="org-detail__head">
                                ${logoHtml(org)}
                                <div>
                                    <h1>${esc(org.name)}</h1>
                                    <div class="org-card__meta">
                                        ${org.city ? `<span><i class="fas fa-location-dot"></i>${esc(org.city)}</span>` : ''}
                                        <span><i class="fas fa-building-ngo"></i>${typeLabel(org.org_type)}</span>
                                        ${org.is_featured ? '<span><i class="fas fa-star"></i>Рекомендуємо</span>' : ''}
                                    </div>
                                </div>
                            </div>
                            <h2><i class="fas fa-circle-info"></i>Про організацію</h2>
                            <p class="org-description">${esc(org.description || 'Опис готується.')}</p>
                        </div>
                        ${help ? `<div class="org-panel" data-anim><h2><i class="fas fa-hand-holding-heart"></i>Чим допомагають</h2><div class="org-help-grid">${help}</div></div>` : ''}
                        ${cases ? `<div class="org-panel" data-anim><h2><i class="fas fa-award"></i>Реалізовані кейси</h2><div class="org-cases">${cases}</div></div>` : ''}
                    </div>
                    <aside class="org-detail__aside">
                        ${contacts ? `<div class="org-panel" data-anim><h2><i class="fas fa-address-book"></i>Контакти</h2><div class="org-contacts">${contacts}</div></div>` : ''}
                        <div class="org-panel" data-anim>
                            <h2><i class="fas fa-file-shield"></i>Дані з реєстру</h2>
                            <dl class="org-facts">
                                ${org.edrpou ? `<div><dt>ЄДРПОУ</dt><dd>${esc(org.edrpou)}</dd></div>` : ''}
                                ${org.address ? `<div><dt>Адреса</dt><dd>${esc(org.address)}</dd></div>` : ''}
                                ${org.registered_at ? `<div><dt>Дата реєстрації</dt><dd>${esc(formatDate(org.registered_at))}</dd></div>` : ''}
                            </dl>
                        </div>
                        ${sources ? `<div class="org-panel" data-anim><h2><i class="fas fa-link"></i>Джерела</h2><ul class="org-sources">${sources}</ul></div>` : ''}
                    </aside>
                </div>
            </div>`;
    }

    function slugFromPath() {
        const m = location.pathname.match(/^\/organizations\/([^/]+)\/?$/);
        return m ? decodeURIComponent(m[1]) : null;
    }

    async function showDetail(slug) {
        catalogScroll = window.scrollY;
        els.detail.innerHTML = '<div class="orgs-loader"><span></span><span></span><span></span></div>';
        els.detail.hidden = false;
        els.hero.hidden = true;
        els.catalog.hidden = true;
        window.scrollTo(0, 0);
        try {
            const org = await getJSON(`${API}/organizations/${encodeURIComponent(slug)}`);
            if (!categories.length) categories = await getJSON(`${API}/categories`).catch(() => []);
            els.detail.innerHTML = detailHtml(org);
            document.title = `${org.name}${org.city ? ` — ${org.city}` : ''} | Тил Душі`;
            if (hasGsap) {
                gsap.from(els.detail.querySelectorAll('[data-anim]'), { y: 40, autoAlpha: 0, duration: 0.8, stagger: 0.1, ease: 'power3.out' });
                gsap.from(els.detail.querySelectorAll('.org-help-item, .org-case, .org-contact'), { y: 16, autoAlpha: 0, duration: 0.5, stagger: 0.04, delay: 0.3 });
            }
        } catch {
            els.detail.innerHTML = `<div class="container orgs-empty"><i class="fas fa-circle-exclamation"></i><h3>Організацію не знайдено</h3><p><a href="/organizations">Повернутися до каталогу</a></p></div>`;
        }
    }

    function showCatalog() {
        els.detail.hidden = true;
        els.detail.innerHTML = '';
        els.hero.hidden = false;
        els.catalog.hidden = false;
        document.title = 'Організації — благодійні фонди та громадські організації України | Тил Душі';
        window.scrollTo(0, catalogScroll);
        if (window.ScrollTrigger) ScrollTrigger.refresh();
    }

    async function route() {
        const slug = slugFromPath();
        if (slug) await showDetail(slug);
        else showCatalog();
    }

    /* ---------- events ---------- */
    let searchTimer;
    els.q.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.q = els.q.value.trim();
            writeQuery();
            loadList();
        }, 300);
    });

    els.city.addEventListener('change', () => {
        state.city = els.city.value;
        writeQuery();
        loadList();
    });

    els.types.forEach(btn => btn.addEventListener('click', () => {
        state.type = btn.dataset.type;
        syncControls();
        writeQuery();
        loadList();
    }));

    els.chips.addEventListener('click', e => {
        const chip = e.target.closest('.orgs-chip');
        if (!chip) return;
        state.category = chip.dataset.key;
        syncControls();
        writeQuery();
        loadList();
        if (hasGsap) gsap.fromTo(chip, { scale: 0.9 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' });
    });

    els.more.addEventListener('click', () => {
        state.page += 1;
        loadList({ append: true });
    });

    els.grid.addEventListener('click', e => {
        const card = e.target.closest('.org-card');
        if (!card || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        history.pushState({ detail: true }, '', card.getAttribute('href'));
        route();
    });

    els.detail.addEventListener('click', e => {
        if (!e.target.closest('[data-back]')) return;
        if (history.state && history.state.detail) history.back();
        else {
            history.pushState({}, '', '/organizations');
            route();
        }
    });

    window.addEventListener('popstate', route);

    /* ---------- start ---------- */
    readQuery();
    loadMeta().then(() => {
        syncControls();
        if (!slugFromPath()) loadList();
    });
    if (slugFromPath()) {
        route().then(() => loadList());
    }
})();
