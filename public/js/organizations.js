/* Organizations catalog: free-text need search, filters, activity index, detail view, reviews. */
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
        region: document.querySelector('#orgFilters select[name="region"]'),
        types: document.querySelectorAll('.orgs-type button'),
        chips: document.getElementById('orgCategories'),
        grid: document.getElementById('orgGrid'),
        count: document.getElementById('orgCount'),
        empty: document.getElementById('orgEmpty'),
        more: document.getElementById('orgMore'),
        loader: document.getElementById('orgLoader'),
        needForm: document.getElementById('needForm'),
        needExamples: document.getElementById('needExamples'),
        needResult: document.getElementById('needResult'),
        needQuery: document.getElementById('needQuery'),
        needTags: document.getElementById('needTags'),
        needReset: document.getElementById('needReset'),
    };

    const state = { q: '', city: '', region: '', category: '', type: '', need: '', service: '', page: 1 };
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

    // Each help direction has its own accent so cards are easy to tell apart at a glance.
    const ACCENTS = {
        military: '#5b6b2f', idp: '#2f6fb3', humanitarian: '#d9822b', medical: '#c0392b', children: '#e05a8a',
        veterans: '#2e7d5b', psychological: '#7b4bb7', rehabilitation: '#159a9c', elderly: '#8d6e63', disability: '#1f8fd1',
        animals: '#c9952b', education: '#3f51b5', legal: '#546e7a', housing: '#b0603a', community: '#8e44ad', ecology: '#3c9a3c',
    };
    const DEFAULT_ACCENT = '#4a3c7c';

    const LEVELS = {
        high: { label: 'Висока активність', icon: 'fa-fire-flame-curved' },
        active: { label: 'Активна', icon: 'fa-circle-check' },
        low: { label: 'Мало підтверджень', icon: 'fa-circle-half-stroke' },
        none: { label: 'Немає підтверджень активності', icon: 'fa-circle-question' },
    };

    const CASE_KINDS = { aid: 'Допомога', event: 'Захід', project: 'Проєкт', report: 'Звіт', post: 'Публікація' };

    const LEGAL_PREFIX = /^(міжнародн\S*\s+|всеукраїнськ\S*\s+)?(благодійн\S*\s+(організаці\S*|фонд\S*)|громадськ\S*\s+(організаці\S*|спілк\S*|об.єднанн\S*)|бо|бф|го|мбф)\s+/i;

    /** "Благодійна організація «Благодійний фонд «Скаути Миколаєва»»" → "Скаути Миколаєва" */
    function displayName(org) {
        if (org.short_name) return org.short_name.replace(/^[«"]+|[»"]+$/g, '').trim();
        const name = String(org.name || '');
        const stripLegal = s => {
            let out = s.replace(/[«»"]/g, ' ').replace(/\s+/g, ' ').trim();
            for (let i = 0; i < 4 && LEGAL_PREFIX.test(`${out} `); i++) out = `${out} `.replace(LEGAL_PREFIX, '').trim();
            return out;
        };
        // The innermost quoted part is the organization's own name (works with unbalanced quotes too).
        const open = name.lastIndexOf('«');
        let core = stripLegal(open >= 0 ? name.slice(open + 1).split('»')[0] : name);
        if (!core) core = stripLegal(name) || name;
        return core.charAt(0).toUpperCase() + core.slice(1);
    }

    const REGISTRY_SENTENCE = /зареєстрован|ЄДРПОУ|ідентифікаційн|юридичн\S* особ|неприбутков|код\s+\d/i;

    /** Skips opening sentences that repeat the name or registry facts, so the excerpt starts with substance. */
    function cleanExcerpt(text, title) {
        let sentences = String(text || '').trim().split(/(?<=[.!?…])\s+/);
        const head = title.toLowerCase().slice(0, 12);
        while (sentences.length > 1 && (REGISTRY_SENTENCE.test(sentences[0]) || sentences[0].toLowerCase().includes(head))) {
            const m = sentences[0].match(/^([^.!?]{0,180}?)\s[—–-]\s(це\s+)?(.+)$/);
            if (m && !REGISTRY_SENTENCE.test(m[3]) && m[1].toLowerCase().includes(head)) {
                sentences[0] = m[3];
                break;
            }
            sentences = sentences.slice(1);
        }
        const t = sentences.join(' ');
        return t.charAt(0).toUpperCase() + t.slice(1);
    }

    function logoHtml(org, cls = 'org-logo') {
        const src = org.logo_url && (org.logo_url.startsWith('/media/') ? org.logo_url : safeUrl(org.logo_url));
        return src ? `<span class="${cls}"><img src="${esc(src)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></span>` : '';
    }

    function relativeDate(d) {
        if (!d) return '';
        const days = Math.round((Date.now() - new Date(`${d}T00:00:00`).getTime()) / 864e5);
        if (days < 1) return 'сьогодні';
        if (days < 7) return `${days} ${plural(days, 'день', 'дні', 'днів')} тому`;
        if (days < 31) {
            const w = Math.round(days / 7);
            return `${w} ${plural(w, 'тиждень', 'тижні', 'тижнів')} тому`;
        }
        if (days < 365) {
            const m = Math.round(days / 30);
            return `${m} ${plural(m, 'місяць', 'місяці', 'місяців')} тому`;
        }
        const y = Math.round(days / 365);
        return `${y} ${plural(y, 'рік', 'роки', 'років')} тому`;
    }

    function stars(value, max = 5) {
        const v = Math.round(Number(value) || 0);
        return Array.from({ length: max }, (_, i) => `<i class="fa${i < v ? 's' : 'r'} fa-star"></i>`).join('');
    }

    function activityHtml(org, compact = true) {
        const level = LEVELS[org.activity_level] || LEVELS.none;
        const score = Number(org.activity_score) || 0;
        return `
            <div class="org-activity org-activity--${esc(org.activity_level || 'none')}" title="Індекс активності ${score}/100">
                <span class="org-activity__badge"><i class="fas ${level.icon}"></i>${level.label}</span>
                <span class="org-activity__bar" aria-hidden="true"><span style="width:${Math.max(4, score)}%"></span></span>
                ${compact ? '' : `<span class="org-activity__score">${score}<small>/100</small></span>`}
            </div>`;
    }

    const CONTACT_ICONS = [
        ['website', 'fas fa-globe', 'Сайт'], ['telegram', 'fab fa-telegram', 'Telegram'], ['facebook', 'fab fa-facebook-f', 'Facebook'],
        ['instagram', 'fab fa-instagram', 'Instagram'], ['youtube', 'fab fa-youtube', 'YouTube'], ['phone', 'fas fa-phone', 'Телефон'],
    ];

    const typeLabel = t => (t === 'charity_fund' ? 'Благодійний фонд' : 'Громадська організація');
    const category = key => categories.find(c => c.key === key);
    const placeOf = org => org.city || org.region || '';

    async function getJSON(url) {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    /* ---------- URL state ---------- */
    const QUERY_KEYS = ['q', 'city', 'region', 'category', 'type', 'need', 'service'];

    function readQuery() {
        const p = new URLSearchParams(location.search);
        for (const key of QUERY_KEYS) state[key] = p.get(key) || '';
    }

    function writeQuery() {
        const p = new URLSearchParams();
        for (const key of QUERY_KEYS) if (state[key]) p.set(key, state[key]);
        const qs = p.toString();
        history.replaceState(history.state, '', `/organizations${qs ? `?${qs}` : ''}`);
    }

    function syncControls() {
        els.q.value = state.q;
        els.city.value = state.city;
        els.region.value = state.region;
        els.needForm.elements.need.value = state.need;
        els.types.forEach(b => b.classList.toggle('is-active', b.dataset.type === state.type));
        els.chips.querySelectorAll('.orgs-chip').forEach(c => c.classList.toggle('is-active', c.dataset.key === state.category));
    }

    /* ---------- list ---------- */
    function cardHtml(org) {
        const cats = (org.help_categories || []).map(k => category(k)).filter(Boolean);
        const primary = cats[0];
        const accent = ACCENTS[primary?.key] || DEFAULT_ACCENT;
        const title = displayName(org);
        const excerpt = cleanExcerpt(org.excerpt, title);
        const matched = new Set(org.matched || []);
        const ordered = matched.size ? [...cats.filter(c => matched.has(c.key)), ...cats.filter(c => !matched.has(c.key))] : cats;
        const tags = ordered.slice(0, 3).map((c, i) =>
            `<span class="org-tag${i === 0 ? ' is-primary' : ''}${matched.has(c.key) ? ' is-match' : ''}" style="--tag:${ACCENTS[c.key] || DEFAULT_ACCENT}"><i class="fas ${esc(c.icon)}"></i>${esc(c.label)}</span>`).join('');
        const more = cats.length > 3 ? `<span class="org-tag is-more">+${cats.length - 3}</span>` : '';
        const links = CONTACT_ICONS.filter(([k]) => org.contacts && org.contacts[k])
            .map(([, icon, label]) => `<span class="org-card__link" title="${label}"><i class="${icon}"></i></span>`).join('');
        const cases = org.cases_count ? `<span class="org-card__cases"><i class="fas fa-award"></i>${org.cases_count} ${plural(org.cases_count, 'справа', 'справи', 'справ')}</span>` : '';
        const why = matched.size
            ? `<p class="org-card__why"><i class="fas fa-check"></i>Підходить: ${[...matched].map(k => esc(category(k)?.label || k)).join(', ')}</p>` : '';
        // For a free-text request: the organization's own sentence that answers it best.
        const h = org.help_hint;
        const hint = !h ? '' : h.source === 'service'
            ? `<div class="org-card__hint"><span><i class="fas fa-circle-check"></i>Надають: ${esc(h.label || '')}</span>
                ${h.text ? `<p>«${esc(h.text)}»</p>` : ''}</div>`
            : `<div class="org-card__hint is-soft"><span><i class="fas fa-hand-holding-heart"></i>${h.source === 'case' ? 'Вже робили' : 'Чим можуть допомогти'}</span><p>${esc(h.text)}</p></div>`;

        return `
            <a class="org-card${org.is_featured ? ' is-featured' : ''}${org.logo_url ? ' has-logo' : ''}" href="/organizations/${encodeURIComponent(org.slug)}"
               data-slug="${esc(org.slug)}" data-flip-id="org-${org.id}" style="--accent:${accent}">
                <div class="org-card__head">
                    <div class="org-card__heading">
                        <span class="org-card__type">
                            ${org.is_featured ? '<i class="fas fa-star"></i>Рекомендуємо · ' : ''}${typeLabel(org.org_type)}
                            ${org.verified_by_fund ? '<span class="org-verified" title="Перевірено фондом «Тил Душі»"><i class="fas fa-shield-heart"></i></span>' : ''}
                        </span>
                        <h3 class="org-card__title">${esc(title)}</h3>
                        ${placeOf(org) ? `<span class="org-card__city"><i class="fas fa-location-dot"></i>${esc(placeOf(org))}</span>` : ''}
                    </div>
                    ${logoHtml(org, 'org-card__logo')}
                </div>
                ${activityHtml(org)}
                ${why}
                ${hint || (excerpt ? `<p class="org-card__excerpt">${esc(excerpt)}</p>` : '')}
                ${tags ? `<div class="org-tags">${tags}${more}</div>` : ''}
                <div class="org-card__foot">
                    <div class="org-card__links">${links}</div>
                    ${org.review_count ? `<span class="org-card__cases"><i class="fas fa-star"></i>${Number(org.review_avg || 0).toFixed(1)}</span>` : ''}
                    ${cases}
                    ${org.last_activity_at ? `<span class="org-card__cases" title="Остання активність"><i class="fas fa-bolt"></i>${esc(relativeDate(org.last_activity_at))}</span>` : ''}
                    <span class="org-card__go" aria-hidden="true"><i class="fas fa-arrow-right"></i></span>
                </div>
            </a>`;
    }

    function renderList(items, append) {
        const existing = [...els.grid.querySelectorAll('.org-card')];
        // Flip only when filtering an already rendered grid; the first render uses the scroll reveal.
        const flipState = hasFlip && !append && existing.length ? Flip.getState(existing) : null;
        const before = new Set(existing.map(c => c.dataset.flipId));

        if (append) els.grid.insertAdjacentHTML('beforeend', items.map(cardHtml).join(''));
        else els.grid.innerHTML = items.map(cardHtml).join('');

        const cards = [...els.grid.querySelectorAll('.org-card')];
        const fresh = cards.filter(c => !before.has(c.dataset.flipId));
        const kept = cards.filter(c => before.has(c.dataset.flipId));

        if (flipState) {
            // Cards stay in the normal flow (no absolute positioning), so the grid keeps its height.
            if (kept.length) Flip.from(flipState, { targets: kept, duration: 0.55, ease: 'power3.inOut', scale: false });
            if (fresh.length) gsap.fromTo(fresh, { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.04, clearProps: 'transform' });
        } else if (hasGsap && fresh.length) {
            window.Motion.revealCards(fresh);
        }
    }

    async function loadList({ append = false } = {}) {
        if (state.need) return loadNeed();
        const id = ++requestId;
        if (!append) state.page = 1;
        els.needResult.hidden = true;
        setEmptyText(false);
        const p = new URLSearchParams({ page: state.page, limit: 24 });
        for (const key of ['q', 'city', 'region', 'category', 'type']) if (state[key]) p.set(key, state[key]);

        els.loader.hidden = false;
        els.more.hidden = true;
        try {
            const data = await getJSON(`${API}/organizations?${p}`);
            if (id !== requestId) return;
            total = data.total;
            renderList(data.items, append);
            const shown = els.grid.querySelectorAll('.org-card').length;
            els.count.textContent = total
                ? `Знайдено ${total} ${plural(total, 'організацію', 'організації', 'організацій')} · спершу найактивніші`
                : '';
            els.empty.hidden = total > 0;
            els.more.hidden = shown >= total;
        } catch {
            if (id !== requestId) return;
            els.count.textContent = 'Не вдалося завантажити каталог. Спробуйте оновити сторінку.';
        } finally {
            if (id === requestId) els.loader.hidden = true;
        }
    }

    /* ---------- "Пошук по запиту" ---------- */
    const SEARCH_STEPS = [
        'Розбираємо ваш запит…',
        'Визначаємо, яка допомога потрібна…',
        'Перевіряємо організації та їхні справи…',
        'Підбираємо тих, хто справді може допомогти…',
    ];

    /** Shown instead of the catalog while a request is being matched, so nothing misleading is on screen. */
    function showSearching() {
        els.grid.innerHTML = `
            <div class="need-searching" role="status" aria-live="polite">
                <div class="need-searching__mark" aria-hidden="true">
                    <span class="need-searching__ring"></span>
                    <span class="need-searching__ring need-searching__ring--2"></span>
                    <img src="/images/phoenix-sm.webp" alt="">
                </div>
                <p class="need-searching__title">Шукаємо організації під ваш запит</p>
                <p class="need-searching__step">${SEARCH_STEPS[0]}</p>
                <div class="need-searching__dots" aria-hidden="true"><span></span><span></span><span></span></div>
            </div>`;
        const step = els.grid.querySelector('.need-searching__step');
        let i = 0;
        const timer = setInterval(() => {
            i = (i + 1) % SEARCH_STEPS.length;
            if (!step.isConnected) return clearInterval(timer);
            if (hasGsap) {
                gsap.to(step, { autoAlpha: 0, y: -6, duration: 0.2, onComplete: () => {
                    step.textContent = SEARCH_STEPS[i];
                    gsap.fromTo(step, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.25 });
                } });
            } else {
                step.textContent = SEARCH_STEPS[i];
            }
        }, 1100);
        if (hasGsap) gsap.fromTo(els.grid.firstElementChild, { autoAlpha: 0, scale: 0.96 }, { autoAlpha: 1, scale: 1, duration: 0.4 });
        return () => clearInterval(timer);
    }

    async function loadNeed() {
        const id = ++requestId;
        els.loader.hidden = true;
        els.more.hidden = true;
        els.empty.hidden = true;
        els.count.textContent = '';
        els.needResult.hidden = false;
        els.needQuery.textContent = state.need;
        els.needTags.innerHTML = '<span class="muted">Аналізуємо запит…</span>';
        const stopSearching = showSearching();
        const p = new URLSearchParams({ q: state.need });
        if (state.city) p.set('city', state.city);
        if (state.service) p.set('service', state.service);
        try {
            // A short minimum keeps the animation from flashing when the answer is instant.
            const [data] = await Promise.all([
                getJSON(`${API}/organizations/match?${p}`),
                new Promise(resolve => setTimeout(resolve, 900)),
            ]);
            stopSearching();
            if (id !== requestId) return;
            els.needTags.innerHTML = needTagsHtml(data);
            els.grid.innerHTML = '';
            renderList(data.items, false);
            renderRelated(data.related || []);
            els.count.textContent = data.items.length
                ? `Точно підходять ${data.items.length} ${plural(data.items.length, 'організація', 'організації', 'організацій')} — з підтвердженням із їхніх джерел`
                : '';
            setEmptyText(true);
            els.empty.hidden = data.items.length > 0 || (data.related || []).length > 0;
        } catch {
            stopSearching();
            if (id !== requestId) return;
            els.grid.innerHTML = '';
            els.count.textContent = 'Не вдалося виконати пошук. Спробуйте ще раз.';
        } finally {
            if (id === requestId) els.loader.hidden = true;
        }
    }

    const AUDIENCE_LABELS = {
        veterans: 'ветеранам', military: 'військовим', families: 'родинам', children: 'дітям',
        idp: 'переселенцям', elderly: 'літнім людям', disability: 'людям з інвалідністю',
    };

    /** What we understood from the request, plus chips to say precisely which service is needed. */
    function needTagsHtml(data) {
        const services = (data.suggestions || []).filter(s => s.selected);
        const understood = services.length
            ? services.map(s => `<span class="org-tag is-primary" style="--tag:#1f7a4e"><i class="fas fa-check"></i>${esc(s.label)}</span>`).join('')
            : data.categories.map(k => {
                const c = category(k);
                return c ? `<span class="org-tag is-primary" style="--tag:${ACCENTS[k] || DEFAULT_ACCENT}"><i class="fas ${esc(c.icon)}"></i>${esc(c.label)}</span>` : '';
            }).join('');
        const audience = (data.audiences || []).map(a => AUDIENCE_LABELS[a]).filter(Boolean);
        const options = (data.suggestions || []).filter(s => !s.selected);
        return `
            <div class="need-understood">
                <span>Шукаємо:</span>${understood || '<span class="muted">за словами з вашого запиту</span>'}
                ${audience.length ? `<span class="muted">· ${esc(audience.join(', '))}</span>` : ''}
            </div>
            ${options.length ? `
            <div class="need-refine">
                <span>Уточніть, що саме потрібно:</span>
                ${options.map(s => `<button type="button" class="need-chip" data-service="${esc(s.key)}">${esc(s.label)} <small>${s.count}</small></button>`).join('')}
                ${state.service ? '<button type="button" class="need-chip is-reset" data-service="">× усі варіанти</button>' : ''}
            </div>` : (state.service ? '<div class="need-refine"><button type="button" class="need-chip is-reset" data-service="">× усі варіанти</button></div>' : '')}`;
    }

    /** Organizations that only share a broader direction, clearly separated from exact matches. */
    function renderRelated(items) {
        if (!items.length) return;
        els.grid.insertAdjacentHTML('beforeend', `
            <div class="need-related-head">
                <h3>Можливо, також допоможуть</h3>
                <p>Працюють у схожому напрямі, але ми не знайшли в їхніх джерелах саме цієї послуги — уточніть телефоном.</p>
            </div>`);
        const before = els.grid.children.length;
        els.grid.insertAdjacentHTML('beforeend', items.map(cardHtml).join(''));
        const fresh = [...els.grid.children].slice(before);
        fresh.forEach(el => el.classList.add('is-related'));
        if (hasGsap) window.Motion.revealCards(fresh);
    }

    function setEmptyText(forNeed) {
        els.empty.querySelector('h3').textContent = forNeed ? 'Поки не знайшли організацій під цей запит' : 'Поки нічого не знайдено';
        els.empty.querySelector('p').innerHTML = forNeed
            ? 'Спробуйте описати ситуацію інакше або оберіть напрям нижче. Також можна зателефонувати нам: <a href="tel:+380965051991">+380 96 505 19 91</a> — підкажемо, куди звернутися.'
            : 'Спробуйте змінити місто чи категорію. Каталог постійно поповнюється.';
    }

    function runNeed(text) {
        state.need = String(text || '').trim().slice(0, 300);
        state.service = '';
        writeQuery();
        loadList();
        els.catalog.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderChips() {
        els.chips.innerHTML = [
            `<button type="button" class="orgs-chip" data-key=""><i class="fas fa-border-all"></i>Усі напрямки</button>`,
            ...categories.map(c => `<button type="button" class="orgs-chip" data-key="${esc(c.key)}"><i class="fas ${esc(c.icon)}"></i>${esc(c.label)}</button>`),
        ].join('');
    }

    async function loadMeta() {
        const [cats, cities, regions, stats] = await Promise.all([
            getJSON(`${API}/categories`).catch(() => []),
            getJSON(`${API}/cities`).catch(() => []),
            getJSON(`${API}/regions`).catch(() => []),
            getJSON(`${API}/catalog-stats`).catch(() => ({})),
        ]);
        categories = cats;
        renderChips();
        els.city.insertAdjacentHTML('beforeend', cities
            .map(c => `<option value="${esc(c.city)}">${esc(c.city)} (${c.count})</option>`).join(''));
        els.region.insertAdjacentHTML('beforeend', regions
            .map(r => `<option value="${esc(r.region)}">${esc(r.region)} (${r.count})</option>`).join(''));

        animateStat('total', stats.total || 0);
        animateStat('cities', stats.cities || cities.length);
        animateStat('active', stats.active || 0);
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

    function ratingPanel(org) {
        const details = Array.isArray(org.activity_details) ? org.activity_details : [];
        return `
            <div class="org-panel org-rating" data-anim>
                <h2><i class="fas fa-chart-simple"></i>Індекс активності</h2>
                ${activityHtml(org, false)}
                ${org.last_activity_at ? `<p class="org-rating__last"><i class="fas fa-bolt"></i>Остання підтверджена активність: ${esc(relativeDate(org.last_activity_at))}</p>` : ''}
                ${details.length ? `
                <details class="org-rating__why">
                    <summary>Чому такий рейтинг</summary>
                    <ul>${details.map(d => `
                        <li class="${d.ok ? 'is-ok' : ''}"><i class="fas ${d.ok ? 'fa-circle-check' : 'fa-circle'}"></i>
                            <span>${esc(d.label)}</span><b>${d.points}/${d.max}</b></li>`).join('')}
                    </ul>
                    <p class="org-rating__note">Індекс рахується автоматично з відкритих джерел: сайт, соцмережі, Telegram-канал, підтверджені справи з датами та відгуки людей.</p>
                </details>` : ''}
            </div>`;
    }

    function timelineHtml(org) {
        const items = (org.cases || []).slice().sort((a, b) => String(b.happened_at || '').localeCompare(String(a.happened_at || '')));
        if (!items.length) return '';
        return `
            <div class="org-panel" data-anim>
                <h2><i class="fas fa-timeline"></i>Активність і реалізовані справи</h2>
                <ol class="org-timeline">${items.map(c => {
                    const img = c.image_url && (c.image_url.startsWith('/media/') ? c.image_url : safeUrl(c.image_url));
                    const src = c.source_url && safeUrl(c.source_url);
                    return `
                    <li class="org-timeline__item">
                        <span class="org-timeline__dot" aria-hidden="true"></span>
                        <div class="org-case${img ? '' : ' no-image'}">
                            ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}
                            <div>
                                <div class="org-timeline__meta">
                                    <span class="org-kind">${esc(CASE_KINDS[c.kind] || 'Допомога')}</span>
                                    ${c.happened_at ? `<time datetime="${esc(c.happened_at)}">${esc(formatDate(c.happened_at))}</time>` : '<span class="muted">дата не вказана</span>'}
                                </div>
                                <h3>${esc(c.title)}</h3>
                                ${c.description ? `<p>${esc(c.description)}</p>` : ''}
                                ${src ? `<a href="${esc(src)}" target="_blank" rel="noopener nofollow">Джерело <i class="fas fa-arrow-up-right-from-square"></i></a>` : ''}
                            </div>
                        </div>
                    </li>`;
                }).join('')}</ol>
            </div>`;
    }

    function reviewsPanel(org) {
        return `
            <div class="org-panel org-reviews" data-anim id="reviews">
                <h2><i class="fas fa-comments"></i>Відгуки
                    ${org.review_count ? `<span class="org-reviews__avg">${stars(org.review_avg)} ${Number(org.review_avg).toFixed(1)} · ${org.review_count}</span>` : ''}
                </h2>
                <div class="org-reviews__list" id="reviewList"><p class="muted">Завантаження…</p></div>
                <form class="review-form" id="reviewForm" novalidate>
                    <h3>Залишити відгук</h3>
                    <p class="muted">Розкажіть, чи допомогла вам організація. Відгук з’явиться одразу.</p>
                    <label class="hp" aria-hidden="true">Сайт<input name="website" tabindex="-1" autocomplete="off"></label>
                    <div class="review-form__row">
                        <label class="form-group">Ваше ім’я *<input name="name" maxlength="60" required></label>
                        <fieldset class="review-stars" aria-label="Оцінка">
                            ${[5, 4, 3, 2, 1].map(n => `<input type="radio" name="rating" id="rs${n}" value="${n}"><label for="rs${n}" title="${n}"><i class="fas fa-star"></i></label>`).join('')}
                        </fieldset>
                    </div>
                    <label class="form-group">Відгук *<textarea name="text" rows="4" maxlength="2000" required placeholder="Що саме зробила організація, як швидко відповіли…"></textarea></label>
                    <label class="checkbox"><input type="checkbox" name="consent"> Відгук правдивий, без образ і реклами; посилання не допускаються</label>
                    <p class="form-error" role="alert"></p>
                    <button class="btn btn-gold" type="submit"><i class="fas fa-paper-plane"></i> Опублікувати</button>
                </form>
            </div>`;
    }

    function reviewItem(r) {
        const date = new Date(r.created_at).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
        return `
            <article class="review">
                <div class="review__head"><b>${esc(r.author_name)}</b>${r.rating ? `<span class="review__stars">${stars(r.rating)}</span>` : ''}<time>${esc(date)}</time></div>
                <p>${esc(r.text)}</p>
            </article>`;
    }

    async function loadReviews(slug) {
        const list = document.getElementById('reviewList');
        if (!list) return;
        try {
            const reviews = await getJSON(`${API}/organizations/${encodeURIComponent(slug)}/reviews`);
            list.innerHTML = reviews.length ? reviews.map(reviewItem).join('') : '<p class="muted">Поки немає відгуків. Будьте першими.</p>';
        } catch {
            list.innerHTML = '<p class="muted">Не вдалося завантажити відгуки.</p>';
        }
    }

    function bindReviewForm(slug) {
        const form = document.getElementById('reviewForm');
        if (!form) return;
        const error = form.querySelector('.form-error');
        form.addEventListener('submit', async e => {
            e.preventDefault();
            error.textContent = '';
            const f = form.elements;
            const body = {
                name: f.name.value, text: f.text.value, rating: form.querySelector('input[name="rating"]:checked')?.value || null,
                consent: f.consent.checked, website: f.website.value,
            };
            const button = form.querySelector('button[type="submit"]');
            button.disabled = true;
            try {
                const res = await fetch(`${API}/organizations/${encodeURIComponent(slug)}/reviews`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Не вдалося опублікувати відгук');
                form.reset();
                const list = document.getElementById('reviewList');
                if (list.querySelector('.muted')) list.innerHTML = '';
                list.insertAdjacentHTML('afterbegin', reviewItem(data));
                if (hasGsap) gsap.fromTo(list.firstElementChild, { autoAlpha: 0, y: -10 }, { autoAlpha: 1, y: 0, duration: 0.5 });
                error.textContent = '';
                form.querySelector('h3').textContent = 'Дякуємо за відгук!';
            } catch (err) {
                error.textContent = err.message;
            } finally {
                button.disabled = false;
            }
        });
    }

    function servicesPanel(org) {
        const list = org.services || [];
        if (!list.length) return '';
        return `
            <div class="org-panel" data-anim>
                <h2><i class="fas fa-list-check"></i>Послуги</h2>
                <ul class="org-services">${list.map(s => {
                    const src = s.source_url && safeUrl(s.source_url);
                    return `<li>
                        <i class="fas fa-circle-check"></i>
                        <div>
                            <b>${esc(s.label)}</b>
                            ${s.quote ? `<q>${esc(s.quote)}</q>` : ''}
                            ${src ? `<a href="${esc(src)}" target="_blank" rel="noopener nofollow">джерело <i class="fas fa-arrow-up-right-from-square"></i></a>` : ''}
                            ${s.source === 'admin' ? '<span class="muted">· підтверджено фондом</span>' : ''}
                        </div>
                    </li>`;
                }).join('')}</ul>
            </div>`;
    }

    function detailHtml(org) {
        const help = (org.help_categories || []).map(category).filter(Boolean)
            .map(c => `<div class="org-help-item"><i class="fas ${esc(c.icon)}"></i><span>${esc(c.label)}</span></div>`).join('');
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
                                ${logoHtml(org, 'org-detail__logo')}
                                <div>
                                    <span class="org-card__type">${org.is_featured ? '<i class="fas fa-star"></i>Рекомендуємо · ' : ''}${typeLabel(org.org_type)}</span>
                                    <h1>${esc(displayName(org))}</h1>
                                    <p class="org-detail__legal">${esc(org.name)}</p>
                                    ${placeOf(org) ? `<span class="org-card__city"><i class="fas fa-location-dot"></i>${esc(placeOf(org))}</span>` : ''}
                                    ${org.verified_by_fund ? '<span class="org-verified-badge"><i class="fas fa-shield-heart"></i>Перевірено фондом «Тил Душі»</span>' : ''}
                                </div>
                            </div>
                            <h2><i class="fas fa-circle-info"></i>Про організацію</h2>
                            <p class="org-description">${esc(org.description || 'Опис готується.')}</p>
                        </div>
                        ${servicesPanel(org)}
                        ${help ? `<div class="org-panel" data-anim><h2><i class="fas fa-hand-holding-heart"></i>Напрями роботи</h2><div class="org-help-grid">${help}</div></div>` : ''}
                        ${timelineHtml(org)}
                        ${reviewsPanel(org)}
                    </div>
                    <aside class="org-detail__aside">
                        ${ratingPanel(org)}
                        ${contacts ? `<div class="org-panel" data-anim><h2><i class="fas fa-address-book"></i>Контакти</h2><div class="org-contacts">${contacts}</div></div>` : ''}
                        <div class="org-panel" data-anim>
                            <h2><i class="fas fa-file-shield"></i>Дані з реєстру</h2>
                            <dl class="org-facts">
                                ${org.edrpou ? `<div><dt>ЄДРПОУ</dt><dd>${esc(org.edrpou)}</dd></div>` : ''}
                                ${org.region ? `<div><dt>Область</dt><dd>${esc(org.region)}</dd></div>` : ''}
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
            const primary = (org.help_categories || [])[0];
            els.detail.style.setProperty('--accent', ACCENTS[primary] || DEFAULT_ACCENT);
            document.title = `${displayName(org)}${org.city ? ` — ${org.city}` : ''} | Тил Душі`;
            loadReviews(slug);
            bindReviewForm(slug);
            if (hasGsap) {
                gsap.fromTo(els.detail.querySelectorAll('[data-anim]'), { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8, stagger: 0.1, ease: 'power3.out', clearProps: 'transform' });
                gsap.fromTo(els.detail.querySelectorAll('.org-help-item, .org-timeline__item, .org-contact'), { y: 16, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.04, delay: 0.3, clearProps: 'transform,opacity,visibility' });
                const bar = els.detail.querySelector('.org-rating .org-activity__bar span');
                if (bar) gsap.from(bar, { width: '0%', duration: 1.2, delay: 0.4, ease: 'power3.out' });
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
            state.need = '';
            state.service = '';
            writeQuery();
            loadList();
        }, 300);
    });

    els.city.addEventListener('change', () => {
        state.city = els.city.value;
        writeQuery();
        loadList();
    });

    els.region.addEventListener('change', () => {
        state.region = els.region.value;
        state.need = '';
        state.service = '';
        writeQuery();
        loadList();
    });

    els.types.forEach(btn => btn.addEventListener('click', () => {
        state.type = btn.dataset.type;
        state.need = '';
        state.service = '';
        syncControls();
        writeQuery();
        loadList();
    }));

    els.chips.addEventListener('click', e => {
        const chip = e.target.closest('.orgs-chip');
        if (!chip) return;
        state.category = chip.dataset.key;
        state.need = '';
        state.service = '';
        syncControls();
        writeQuery();
        loadList();
        if (hasGsap) gsap.fromTo(chip, { scale: 0.9 }, { scale: 1, duration: 0.4, ease: 'back.out(3)' });
    });

    els.needForm.addEventListener('submit', e => {
        e.preventDefault();
        const text = els.needForm.elements.need.value.trim();
        if (text.length < 3) return;
        runNeed(text);
    });

    els.needExamples.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        els.needForm.elements.need.value = btn.textContent;
        runNeed(btn.textContent);
    });

    els.needTags.addEventListener('click', e => {
        const chip = e.target.closest('[data-service]');
        if (!chip) return;
        state.service = chip.dataset.service;
        writeQuery();
        loadNeed();
    });

    els.needReset.addEventListener('click', () => {
        state.need = '';
        state.service = '';
        els.needForm.elements.need.value = '';
        writeQuery();
        loadList();
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
