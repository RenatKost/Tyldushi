/* Admin panel: single-page app with hash routing. */
(function () {
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const STATUS_LABELS = {
        registry: 'Реєстр', enriching: 'Збір даних', pending: 'На перевірці', approved: 'Опубліковано',
        rejected: 'Відхилено', rejected_auto: 'Відсіяно ботом', hidden: 'Приховано',
    };
    const CONTACT_FIELDS = [
        ['phone', 'Телефон'], ['email', 'Email'], ['website', 'Сайт'], ['facebook', 'Facebook'],
        ['instagram', 'Instagram'], ['telegram', 'Telegram'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'],
    ];

    let meta = { categories: [], counts: {}, cities: [], storageEnabled: false, runs: [] };
    const view = $('#view');

    /* ---------- API ---------- */
    async function api(path, { method = 'GET', body, form } = {}) {
        const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
        if (form) opts.body = form;
        else if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res = await fetch(`/api/fond${path}`, opts);
        const data = await res.json().catch(() => ({}));
        if (res.status === 401 && path !== '/login') {
            showLogin();
            throw new Error('Потрібен вхід');
        }
        if (!res.ok) throw new Error(data.error || `Помилка ${res.status}`);
        return data;
    }

    let toastTimer;
    function toast(message, isError = false) {
        const el = $('#toast');
        el.textContent = message;
        el.classList.toggle('is-error', isError);
        el.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
    }

    const run = fn => async (...args) => {
        try {
            await fn(...args);
        } catch (err) {
            toast(err.message, true);
        }
    };

    /* ---------- auth ---------- */
    function showLogin(hint = '') {
        $('#app').hidden = true;
        $('#login').hidden = false;
        $('#loginHint').textContent = hint;
    }

    $('#loginForm').addEventListener('submit', run(async e => {
        e.preventDefault();
        $('#loginError').textContent = '';
        const form = new FormData(e.target);
        try {
            await api('/login', { method: 'POST', body: { login: form.get('login'), password: form.get('password') } });
        } catch (err) {
            $('#loginError').textContent = err.message;
            return;
        }
        await start();
    }));

    $('#logout').addEventListener('click', run(async () => {
        await api('/logout', { method: 'POST' });
        showLogin();
    }));

    /* ---------- meta / sidebar ---------- */
    async function refreshMeta() {
        meta = await api('/meta');
        for (const [key, value] of Object.entries(meta.counts)) {
            const el = $(`[data-count="${key}"]`);
            if (el) el.textContent = value || '';
        }
    }

    function setActiveNav(route) {
        $$('#sidebarNav a').forEach(a => a.classList.toggle('is-active', a.dataset.route === route));
    }

    const badge = status => `<span class="badge badge--${esc(status)}">${esc(STATUS_LABELS[status] || status)}</span>`;
    const typeShort = t => (t === 'charity_fund' ? 'БФ' : 'ГО');

    /* ---------- list view ---------- */
    const listState = { q: '', city: '', type: '', page: 1 };

    async function renderList(status) {
        setActiveNav(status);
        const title = status === 'all' ? 'Усі організації' : STATUS_LABELS[status];
        view.innerHTML = `
            <div class="page-head">
                <div><h1>${esc(title)}</h1><p id="listTotal"></p></div>
                <a class="btn btn--primary" href="#/new"><i class="fas fa-plus"></i>Додати</a>
            </div>
            <div class="toolbar">
                <input type="search" id="fQ" placeholder="Пошук за назвою або ЄДРПОУ" value="${esc(listState.q)}">
                <input list="cityList" id="fCity" placeholder="Місто" value="${esc(listState.city)}">
                <datalist id="cityList">${meta.cities.map(c => `<option value="${esc(c.city)}">`).join('')}</datalist>
                <select id="fType">
                    <option value="">БФ і ГО</option>
                    <option value="charity_fund" ${listState.type === 'charity_fund' ? 'selected' : ''}>Тільки фонди</option>
                    <option value="public_org" ${listState.type === 'public_org' ? 'selected' : ''}>Тільки ГО</option>
                </select>
            </div>
            <div class="bulk" id="bulk" hidden>
                <span id="bulkCount"></span>
                <button class="btn btn--sm" data-bulk="approved"><i class="fas fa-check"></i>Опублікувати</button>
                <button class="btn btn--sm" data-bulk="hidden"><i class="fas fa-eye-slash"></i>Приховати</button>
                <button class="btn btn--sm" data-bulk="rejected"><i class="fas fa-ban"></i>Відхилити</button>
                <button class="btn btn--sm" data-bulk="requeue"><i class="fas fa-rotate"></i>Повторити збір ботом</button>
                <button class="btn btn--sm btn--danger" data-bulk="delete"><i class="fas fa-trash"></i>Видалити</button>
            </div>
            <div class="table-wrap"><table>
                <thead><tr>
                    <th><input type="checkbox" id="checkAll" aria-label="Обрати всі"></th>
                    <th>Організація</th><th class="hide-sm">Місто</th><th>Статус</th>
                    <th title="Показувати на сайті">На сайті</th><th title="Топ">Топ</th><th></th>
                </tr></thead>
                <tbody id="rows"><tr><td colspan="7" class="empty">Завантаження…</td></tr></tbody>
            </table></div>
            <div class="pager" id="pager"></div>`;

        let timer;
        $('#fQ').addEventListener('input', e => {
            clearTimeout(timer);
            timer = setTimeout(() => { listState.q = e.target.value.trim(); listState.page = 1; loadRows(status); }, 300);
        });
        $('#fCity').addEventListener('change', e => { listState.city = e.target.value.trim(); listState.page = 1; loadRows(status); });
        $('#fType').addEventListener('change', e => { listState.type = e.target.value; listState.page = 1; loadRows(status); });
        $('#checkAll').addEventListener('change', e => {
            $$('#rows input[data-id]').forEach(cb => { cb.checked = e.target.checked; });
            updateBulk();
        });
        $('#bulk').addEventListener('click', run(async e => {
            const btn = e.target.closest('[data-bulk]');
            if (!btn) return;
            const ids = selectedIds();
            const action = btn.dataset.bulk;
            if (action === 'delete' && !confirm(`Видалити ${ids.length} організацій назавжди?`)) return;
            const { changed } = await api('/organizations/bulk', { method: 'POST', body: { ids, action } });
            toast(`Оновлено: ${changed}`);
            await refreshMeta();
            await loadRows(status);
        }));

        await loadRows(status);
    }

    function selectedIds() {
        return $$('#rows input[data-id]:checked').map(cb => Number(cb.dataset.id));
    }

    function updateBulk() {
        const n = selectedIds().length;
        $('#bulk').hidden = n === 0;
        $('#bulkCount').textContent = `Обрано: ${n}`;
    }

    async function loadRows(status) {
        const p = new URLSearchParams({ page: listState.page, limit: 50 });
        if (status !== 'all') p.set('status', status);
        for (const key of ['q', 'city', 'type']) if (listState[key]) p.set(key, listState[key]);
        const data = await api(`/organizations?${p}`);

        $('#listTotal').textContent = `Всього: ${data.total}`;
        const rows = $('#rows');
        rows.innerHTML = data.items.length ? data.items.map(o => `
            <tr data-row="${o.id}">
                <td><input type="checkbox" data-id="${o.id}" aria-label="Обрати"></td>
                <td>
                    <div class="org-name" data-open="${o.id}">${esc(o.name)}</div>
                    <div class="org-sub">${typeShort(o.org_type)}${o.edrpou ? ` · ${esc(o.edrpou)}` : ''}${(o.help_categories || []).length ? ` · ${o.help_categories.length} напр.` : ''}</div>
                </td>
                <td class="hide-sm">${esc(o.city || '—')}</td>
                <td>${badge(o.status)}</td>
                <td><label class="switch"><input type="checkbox" data-visible="${o.id}" ${o.status === 'approved' ? 'checked' : ''}><span></span></label></td>
                <td><button class="star ${o.is_featured ? 'is-on' : ''}" data-star="${o.id}" title="Топ"><i class="fas fa-star"></i></button></td>
                <td><a class="btn btn--sm btn--icon" href="#/org/${o.id}" title="Редагувати"><i class="fas fa-pen"></i></a></td>
            </tr>`).join('') : '<tr><td colspan="7" class="empty">Нічого немає</td></tr>';

        rows.onchange = run(async e => {
            if (e.target.dataset.id) return updateBulk();
            const id = e.target.dataset.visible;
            if (!id) return;
            const status = e.target.checked ? 'approved' : 'hidden';
            await api('/organizations/bulk', { method: 'POST', body: { ids: [Number(id)], action: status } });
            const row = rows.querySelector(`[data-row="${id}"] td:nth-child(4)`);
            row.innerHTML = badge(status);
            toast(status === 'approved' ? 'Опубліковано' : 'Приховано');
            refreshMeta();
        });
        rows.onclick = run(async e => {
            const open = e.target.closest('[data-open]');
            if (open) { location.hash = `#/org/${open.dataset.open}`; return; }
            const star = e.target.closest('[data-star]');
            if (!star) return;
            const featured = !star.classList.contains('is-on');
            await api(`/organizations/${star.dataset.star}/featured`, { method: 'POST', body: { featured } });
            star.classList.toggle('is-on', featured);
            if (featured) {
                rows.querySelector(`[data-row="${star.dataset.star}"] td:nth-child(4)`).innerHTML = badge('approved');
                rows.querySelector(`[data-visible="${star.dataset.star}"]`).checked = true;
            }
            toast(featured ? 'Додано в топ' : 'Прибрано з топу');
            refreshMeta();
        });

        const pages = Math.ceil(data.total / data.pageSize);
        $('#pager').innerHTML = pages > 1 ? `
            <button class="btn btn--sm" data-page="-1" ${listState.page <= 1 ? 'disabled' : ''}>← Назад</button>
            <span>${listState.page} / ${pages}</span>
            <button class="btn btn--sm" data-page="1" ${listState.page >= pages ? 'disabled' : ''}>Далі →</button>` : '';
        $('#pager').onclick = run(async e => {
            const btn = e.target.closest('[data-page]');
            if (!btn) return;
            listState.page += Number(btn.dataset.page);
            await loadRows(status);
            window.scrollTo(0, 0);
        });
        $('#checkAll').checked = false;
        updateBulk();
    }

    /* ---------- featured ---------- */
    async function renderFeatured() {
        setActiveNav('featured');
        const data = await api('/organizations?featured=1&limit=200');
        view.innerHTML = `
            <div class="page-head">
                <div><h1>Топ організацій</h1><p>Перетягніть, щоб змінити порядок. Перші в списку показуються першими в каталозі.</p></div>
                <button class="btn btn--gold" id="saveOrder"><i class="fas fa-floppy-disk"></i>Зберегти порядок</button>
            </div>
            <div class="featured-list" id="featuredList">
                ${data.items.length ? data.items.map((o, i) => `
                    <div class="featured-item" data-id="${o.id}">
                        <span class="handle" title="Перетягнути"><i class="fas fa-grip-vertical"></i></span>
                        <span class="rank">${i + 1}</span>
                        <div class="grow"><div class="org-name" data-open="${o.id}">${esc(o.name)}</div><div class="org-sub">${esc(o.city || '')} · ${typeShort(o.org_type)}</div></div>
                        <button class="btn btn--sm" data-unstar="${o.id}"><i class="fas fa-star-half-stroke"></i>Прибрати</button>
                    </div>`).join('') : '<div class="empty">У топі поки нікого. Натисніть ⭐ у списку опублікованих.</div>'}
            </div>`;

        const list = $('#featuredList');
        const renumber = () => $$('.featured-item .rank', list).forEach((el, i) => { el.textContent = i + 1; });
        if (window.Sortable && data.items.length) {
            Sortable.create(list, { handle: '.handle', animation: 200, onEnd: renumber });
        }
        $('#saveOrder').addEventListener('click', run(async () => {
            const ids = $$('.featured-item', list).map(el => Number(el.dataset.id));
            await api('/featured/order', { method: 'POST', body: { ids } });
            toast('Порядок збережено');
        }));
        list.addEventListener('click', run(async e => {
            const open = e.target.closest('[data-open]');
            if (open) { location.hash = `#/org/${open.dataset.open}`; return; }
            const btn = e.target.closest('[data-unstar]');
            if (!btn) return;
            await api(`/organizations/${btn.dataset.unstar}/featured`, { method: 'POST', body: { featured: false } });
            btn.closest('.featured-item').remove();
            renumber();
            refreshMeta();
        }));
    }

    /* ---------- editor ---------- */
    function caseHtml(c = {}) {
        return `
            <div class="case">
                <span class="handle" title="Перетягнути"><i class="fas fa-grip-vertical"></i></span>
                <div>
                    <div class="grid2">
                        <label class="field">Заголовок<input data-c="title" value="${esc(c.title)}" required></label>
                        <label class="field">Дата<input type="date" data-c="happened_at" value="${esc(c.happened_at || '')}"></label>
                    </div>
                    <label class="field">Опис<textarea data-c="description">${esc(c.description)}</textarea></label>
                    <div class="grid2">
                        <label class="field">Посилання на джерело<input data-c="source_url" value="${esc(c.source_url)}" placeholder="https://"></label>
                        <div class="field">Фото
                            <div class="case-img">
                                ${c.image_url ? `<img src="${esc(c.image_url)}" alt="">` : ''}
                                <input data-c="image_url" value="${esc(c.image_url)}" placeholder="URL або завантажте">
                                ${meta.storageEnabled ? '<label class="btn btn--sm btn--icon" title="Завантажити"><i class="fas fa-upload"></i><input type="file" accept="image/*" data-case-upload hidden></label>' : ''}
                            </div>
                        </div>
                    </div>
                </div>
                <button class="btn btn--sm btn--icon btn--danger" type="button" data-remove-case title="Видалити кейс"><i class="fas fa-xmark"></i></button>
            </div>`;
    }

    async function upload(file, folder) {
        const form = new FormData();
        form.append('folder', folder);
        form.append('file', file);
        const { url } = await api('/upload', { method: 'POST', form });
        return url;
    }

    async function renderEditor(id) {
        setActiveNav(id ? '' : 'new');
        const org = id ? await api(`/organizations/${id}`) : {
            org_type: 'charity_fund', status: 'approved', help_categories: [], contacts: {}, cases: [], sources: [],
        };
        const contacts = org.contacts || {};

        view.innerHTML = `
            <form id="editor">
                <div class="page-head">
                    <div>
                        <h1>${id ? esc(org.name) : 'Нова організація'}</h1>
                        <p>${id ? `${badge(org.status)} ${org.is_featured ? '· ⭐ Топ' : ''} ${org.enriched_at ? `· зібрано ботом ${new Date(org.enriched_at).toLocaleDateString('uk-UA')}` : ''}` : ''}</p>
                    </div>
                    ${id && org.status === 'approved' ? `<a class="btn" href="/organizations/${esc(org.slug)}" target="_blank"><i class="fas fa-arrow-up-right-from-square"></i>На сайті</a>` : ''}
                </div>
                <div class="editor">
                    <div>
                        <div class="panel">
                            <h2><i class="fas fa-building-ngo"></i>Основне</h2>
                            <label class="field">Повна назва<input name="name" value="${esc(org.name)}" required></label>
                            <div class="grid2">
                                <label class="field">Коротка назва (для картки)<input name="short_name" value="${esc(org.short_name)}"></label>
                                <label class="field">Тип
                                    <select name="org_type">
                                        <option value="charity_fund" ${org.org_type === 'charity_fund' ? 'selected' : ''}>Благодійний фонд</option>
                                        <option value="public_org" ${org.org_type === 'public_org' ? 'selected' : ''}>Громадська організація</option>
                                    </select>
                                </label>
                                <label class="field">Місто<input name="city" value="${esc(org.city)}" list="cityList2"></label>
                                <label class="field">Область<input name="region" value="${esc(org.region)}"></label>
                                <label class="field">ЄДРПОУ<input name="edrpou" value="${esc(org.edrpou)}" inputmode="numeric"></label>
                                <label class="field">Адреса<input name="address" value="${esc(org.address)}"></label>
                            </div>
                            <datalist id="cityList2">${meta.cities.map(c => `<option value="${esc(c.city)}">`).join('')}</datalist>
                            <label class="field">Опис — чим займається організація<textarea name="description" rows="8">${esc(org.description)}</textarea></label>
                        </div>

                        <div class="panel">
                            <h2><i class="fas fa-hand-holding-heart"></i>Чим допомагають</h2>
                            <div class="cats">
                                ${meta.categories.map(c => `<label><input type="checkbox" name="cat" value="${esc(c.key)}" ${(org.help_categories || []).includes(c.key) ? 'checked' : ''}> ${esc(c.label)}</label>`).join('')}
                            </div>
                        </div>

                        <div class="panel">
                            <h2><i class="fas fa-award"></i>Кейси</h2>
                            <div id="cases">${(org.cases || []).map(caseHtml).join('')}</div>
                            <button class="btn btn--sm" type="button" id="addCase" style="margin-top:.75rem"><i class="fas fa-plus"></i>Додати кейс</button>
                        </div>
                    </div>

                    <div>
                        <div class="panel">
                            <h2><i class="fas fa-eye"></i>Публікація</h2>
                            <label class="field">Статус
                                <select name="status">
                                    ${Object.entries(STATUS_LABELS).map(([k, v]) => `<option value="${k}" ${org.status === k ? 'selected' : ''}>${v}</option>`).join('')}
                                </select>
                            </label>
                            <label class="field" style="flex-direction:row;display:flex;gap:.5rem;align-items:center;margin-top:.85rem">
                                <input type="checkbox" name="featured" ${org.is_featured ? 'checked' : ''}> ⭐ Показувати в топі
                            </label>
                        </div>

                        <div class="panel">
                            <h2><i class="fas fa-image"></i>Логотип</h2>
                            <div class="logo-box">
                                <div class="preview" id="logoPreview">${org.logo_url ? `<img src="${esc(org.logo_url)}" alt="">` : '<i class="fas fa-image"></i>'}</div>
                                <div style="display:grid;gap:.5rem;flex:1">
                                    <input class="field" name="logo_url" value="${esc(org.logo_url)}" placeholder="URL зображення" style="padding:.5rem;border:1.5px solid var(--border);border-radius:9px">
                                    ${meta.storageEnabled ? '<label class="btn btn--sm"><i class="fas fa-upload"></i>Завантажити<input type="file" accept="image/*" id="logoUpload" hidden></label>' : '<small style="color:var(--muted)">Сховище файлів не підключене — вкажіть URL</small>'}
                                </div>
                            </div>
                        </div>

                        <div class="panel">
                            <h2><i class="fas fa-address-book"></i>Контакти</h2>
                            ${CONTACT_FIELDS.map(([k, label]) => `<label class="field">${label}<input name="c_${k}" value="${esc(contacts[k])}"></label>`).join('')}
                        </div>

                        ${(org.sources || []).length ? `
                        <div class="panel">
                            <h2><i class="fas fa-link"></i>Джерела бота</h2>
                            <ul class="sources">${org.sources.map(s => { const u = typeof s === 'string' ? s : s.url; return `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></li>`; }).join('')}</ul>
                        </div>` : ''}
                    </div>
                </div>

                <div class="sticky-actions">
                    <button class="btn btn--primary" type="submit"><i class="fas fa-floppy-disk"></i>Зберегти</button>
                    ${id ? `
                        <button class="btn" type="button" id="requeue" title="Бот заново збере інформацію з мережі"><i class="fas fa-rotate"></i>Повторити збір ботом</button>
                        <button class="btn btn--danger" type="button" id="deleteOrg"><i class="fas fa-trash"></i>Видалити</button>` : ''}
                    <a class="btn" href="javascript:history.back()">Скасувати</a>
                </div>
            </form>`;

        const form = $('#editor');
        const casesEl = $('#cases');
        if (window.Sortable) Sortable.create(casesEl, { handle: '.handle', animation: 200 });

        $('#addCase').addEventListener('click', () => {
            casesEl.insertAdjacentHTML('beforeend', caseHtml());
            casesEl.lastElementChild.querySelector('input').focus();
        });

        casesEl.addEventListener('click', e => {
            if (e.target.closest('[data-remove-case]') && confirm('Видалити кейс?')) e.target.closest('.case').remove();
        });

        casesEl.addEventListener('change', run(async e => {
            if (!e.target.matches('[data-case-upload]') || !e.target.files[0]) return;
            const url = await upload(e.target.files[0], 'cases');
            const box = e.target.closest('.case-img');
            box.querySelector('[data-c="image_url"]').value = url;
            const img = box.querySelector('img') || box.insertAdjacentElement('afterbegin', document.createElement('img'));
            img.src = url;
            toast('Фото завантажено');
        }));

        const logoInput = form.elements.logo_url;
        logoInput.addEventListener('change', () => {
            $('#logoPreview').innerHTML = logoInput.value ? `<img src="${esc(logoInput.value)}" alt="">` : '<i class="fas fa-image"></i>';
        });
        const logoUpload = $('#logoUpload');
        if (logoUpload) logoUpload.addEventListener('change', run(async () => {
            if (!logoUpload.files[0]) return;
            logoInput.value = await upload(logoUpload.files[0], 'logos');
            logoInput.dispatchEvent(new Event('change'));
            toast('Логотип завантажено');
        }));

        form.addEventListener('submit', run(async e => {
            e.preventDefault();
            const f = form.elements;
            const payload = {
                name: f.name.value,
                short_name: f.short_name.value,
                org_type: f.org_type.value,
                city: f.city.value,
                region: f.region.value,
                edrpou: f.edrpou.value,
                address: f.address.value,
                description: f.description.value,
                logo_url: f.logo_url.value,
                help_categories: $$('input[name="cat"]:checked', form).map(cb => cb.value),
                contacts: Object.fromEntries(CONTACT_FIELDS.map(([k]) => [k, f[`c_${k}`].value])),
                cases: $$('.case', casesEl).map(el => Object.fromEntries($$('[data-c]', el).map(i => [i.dataset.c, i.value]))),
                status: f.status.value,
            };
            let saved;
            if (id) {
                saved = await api(`/organizations/${id}`, { method: 'PUT', body: payload });
                if (saved.status !== payload.status) {
                    await api('/organizations/bulk', { method: 'POST', body: { ids: [id], action: payload.status } });
                }
            } else {
                saved = await api('/organizations', { method: 'POST', body: payload });
            }
            if (f.featured.checked !== Boolean(saved.is_featured)) {
                await api(`/organizations/${saved.id}/featured`, { method: 'POST', body: { featured: f.featured.checked } });
            }
            toast('Збережено ✓');
            await refreshMeta();
            if (!id) location.hash = `#/org/${saved.id}`;
            else renderEditor(id);
        }));

        if (id) {
            $('#deleteOrg').addEventListener('click', run(async () => {
                if (!confirm('Видалити організацію назавжди?')) return;
                await api('/organizations/bulk', { method: 'POST', body: { ids: [id], action: 'delete' } });
                toast('Видалено');
                await refreshMeta();
                location.hash = '#/list/pending';
            }));
            $('#requeue').addEventListener('click', run(async () => {
                await api('/organizations/bulk', { method: 'POST', body: { ids: [id], action: 'requeue' } });
                toast('Бот збере інформацію під час наступного запуску');
                renderEditor(id);
            }));
        }
    }

    /* ---------- runs ---------- */
    async function renderRuns() {
        setActiveNav('runs');
        await refreshMeta();
        view.innerHTML = `
            <div class="page-head"><div><h1>Журнал бота</h1><p>Останні запуски імпорту з реєстру та збору інформації.</p></div></div>
            <div class="table-wrap runs"><table>
                <thead><tr><th>Задача</th><th>Початок</th><th>Тривалість</th><th>Результат</th></tr></thead>
                <tbody>${meta.runs.length ? meta.runs.map(r => `
                    <tr>
                        <td>${esc(r.job)}</td>
                        <td>${new Date(r.started_at).toLocaleString('uk-UA')}</td>
                        <td>${r.finished_at ? `${Math.round((new Date(r.finished_at) - new Date(r.started_at)) / 1000)} с` : 'виконується…'}</td>
                        <td>${r.ok === false ? `<span class="fail">Помилка</span><pre>${esc(r.error)}</pre>` : r.ok ? '<span class="ok">OK</span>' : ''}
                            <pre>${esc(JSON.stringify(r.stats))}</pre></td>
                    </tr>`).join('') : '<tr><td colspan="4" class="empty">Бот ще не запускався</td></tr>'}</tbody>
            </table></div>`;
    }

    /* ---------- requests from the site ---------- */
    const REQ_STATUS = { new: 'Нова', in_progress: 'В роботі', done: 'Завершено' };
    const REQ_KIND = { help: 'Допомога', contact: 'Запитання', partner: 'Волонтерство / партнерство' };
    const REQ_ROLE = { veteran: 'Ветеран / ветеранка', family: 'Член родини', other: 'Інше' };
    const REQ_DIR = {
        psychology: 'Психологічна реабілітація', referral: 'Перенаправлення до послуг', documents: 'Документи',
        medical: 'Медичний супровід', grants: 'Гранти та власна справа', unsure: 'Потрібна консультація',
    };
    const reqState = { status: 'new' };

    async function renderRequests() {
        setActiveNav('requests');
        const data = await api(`/requests?limit=200${reqState.status ? `&status=${reqState.status}` : ''}`);
        const tabs = [['new', 'Нові'], ['in_progress', 'В роботі'], ['done', 'Завершені'], ['', 'Усі']];
        view.innerHTML = `
            <div class="page-head">
                <div><h1>Заявки з сайту</h1><p>Нові заявки також приходять у Telegram-групу модераторів.</p></div>
            </div>
            <div class="toolbar">
                ${tabs.map(([k, label]) => `<button class="btn btn--sm ${reqState.status === k ? 'btn--primary' : ''}" data-tab="${k}">${label}${k && data.counts[k] ? ` · ${data.counts[k]}` : ''}</button>`).join('')}
            </div>
            <div class="table-wrap"><table>
                <thead><tr><th>Звернення</th><th class="hide-sm">Отримано</th><th>Статус</th><th></th></tr></thead>
                <tbody id="reqRows">${data.items.length ? data.items.map(r => `
                    <tr data-id="${r.id}">
                        <td><div class="req">
                            <div class="req__head"><b>${esc(r.name)}</b><span class="badge">${esc(REQ_KIND[r.kind] || r.kind)}</span></div>
                            <div class="req__meta">
                                ${r.phone ? `<a href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}">${esc(r.phone)}</a>` : ''}
                                ${r.contact ? ` · ${esc(r.contact)}` : ''}
                                ${r.role ? ` · ${esc(REQ_ROLE[r.role] || r.role)}` : ''}
                                ${r.direction ? ` · ${esc(REQ_DIR[r.direction] || r.direction)}` : ''}
                            </div>
                            ${r.message ? `<div class="req__msg">${esc(r.message)}</div>` : ''}
                        </div></td>
                        <td class="hide-sm">${new Date(r.created_at).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td><span class="badge badge--${r.status}">${REQ_STATUS[r.status]}</span>${r.handled_by ? `<div class="req__meta">${esc(r.handled_by)}</div>` : ''}</td>
                        <td style="white-space:nowrap">
                            ${r.status !== 'in_progress' ? `<button class="btn btn--sm" data-set="in_progress" title="В роботу"><i class="fas fa-play"></i></button>` : ''}
                            ${r.status !== 'done' ? `<button class="btn btn--sm" data-set="done" title="Завершено"><i class="fas fa-check"></i></button>` : ''}
                            <button class="btn btn--sm btn--danger" data-del title="Видалити"><i class="fas fa-trash"></i></button>
                        </td>
                    </tr>`).join('') : '<tr><td colspan="4" class="empty">Заявок немає</td></tr>'}</tbody>
            </table></div>`;

        view.querySelector('.toolbar').onclick = run(async e => {
            const tab = e.target.closest('[data-tab]');
            if (!tab) return;
            reqState.status = tab.dataset.tab;
            await renderRequests();
        });
        $('#reqRows').onclick = run(async e => {
            const row = e.target.closest('tr[data-id]');
            if (!row) return;
            const id = row.dataset.id;
            const set = e.target.closest('[data-set]');
            if (set) {
                await api(`/requests/${id}/status`, { method: 'POST', body: { status: set.dataset.set } });
                toast('Статус оновлено');
            } else if (e.target.closest('[data-del]')) {
                if (!confirm('Видалити заявку?')) return;
                await api(`/requests/${id}`, { method: 'DELETE' });
                toast('Видалено');
            } else return;
            await refreshMeta();
            await renderRequests();
        });
    }

    /* ---------- events on the home page ---------- */
    function eventForm(e = {}) {
        return `
            <form class="panel" id="eventForm" data-id="${e.id || ''}">
                <h2><i class="fas fa-calendar-plus"></i>${e.id ? 'Редагувати подію' : 'Нова подія'}</h2>
                <div class="grid2">
                    <label class="field">Назва *<input name="title" value="${esc(e.title)}" required maxlength="200"></label>
                    <label class="field">Дата<input type="date" name="event_date" value="${esc(e.event_date || '')}"></label>
                </div>
                <label class="field">Опис (1–3 речення)<textarea name="text" rows="3" maxlength="3000">${esc(e.text)}</textarea></label>
                <div class="grid2">
                    <label class="field">Посилання на пост в Instagram<input name="link" value="${esc(e.link)}" placeholder="https://www.instagram.com/p/..."></label>
                    <div class="field">Фото
                        <div class="case-img">
                            ${e.image_url ? `<img src="${esc(e.image_url)}" alt="">` : ''}
                            <input name="image_url" value="${esc(e.image_url)}" placeholder="URL або завантажте">
                            ${meta.storageEnabled ? '<label class="btn btn--sm btn--icon" title="Завантажити"><i class="fas fa-upload"></i><input type="file" accept="image/*" id="eventUpload" hidden></label>' : ''}
                        </div>
                    </div>
                </div>
                <label class="field" style="display:flex;flex-direction:row;gap:.5rem;align-items:center;margin-top:.85rem">
                    <input type="checkbox" name="published" ${e.published === false ? '' : 'checked'}> Показувати на сайті
                </label>
                <div style="display:flex;gap:.5rem;margin-top:1rem">
                    <button class="btn btn--primary" type="submit"><i class="fas fa-floppy-disk"></i>Зберегти</button>
                    ${e.id ? '<button class="btn" type="button" data-cancel>Скасувати</button>' : ''}
                </div>
            </form>`;
    }

    async function renderEvents(editId = null) {
        setActiveNav('events');
        const { events } = await api('/site');
        const editing = editId ? events.find(e => e.id === editId) : null;
        view.innerHTML = `
            <div class="page-head">
                <div><h1>Події на сайті</h1><p>Блок «Наші події» на головній. Перетягніть, щоб змінити порядок. Якщо подій немає, блок не показується.</p></div>
            </div>
            ${eventForm(editing || {})}
            <div class="featured-list" id="eventList" style="margin-top:1rem">
                ${events.length ? events.map(e => `
                    <div class="featured-item event-item ${e.published ? '' : 'is-hidden'}" data-id="${e.id}">
                        <span class="handle" title="Перетягнути"><i class="fas fa-grip-vertical"></i></span>
                        ${e.image_url ? `<img src="${esc(e.image_url)}" alt="">` : '<span class="noimg"><i class="fas fa-image"></i></span>'}
                        <div class="grow"><div class="org-name">${esc(e.title)}</div>
                            <div class="org-sub">${e.event_date ? esc(new Date(`${e.event_date}T00:00:00`).toLocaleDateString('uk-UA')) : 'без дати'}${e.published ? '' : ' · приховано'}</div></div>
                        <div class="actions" style="display:flex;gap:.35rem">
                            <button class="btn btn--sm btn--icon" data-edit title="Редагувати"><i class="fas fa-pen"></i></button>
                            <button class="btn btn--sm btn--icon btn--danger" data-del title="Видалити"><i class="fas fa-trash"></i></button>
                        </div>
                    </div>`).join('') : '<div class="empty">Подій поки немає</div>'}
            </div>`;

        const form = $('#eventForm');
        const upload = $('#eventUpload');
        if (upload) upload.addEventListener('change', run(async () => {
            if (!upload.files[0]) return;
            const fd = new FormData();
            fd.append('folder', 'events');
            fd.append('file', upload.files[0]);
            const { url } = await api('/upload', { method: 'POST', form: fd });
            form.elements.image_url.value = url;
            toast('Фото завантажено');
        }));
        form.querySelector('[data-cancel]')?.addEventListener('click', () => renderEvents());
        form.addEventListener('submit', run(async e => {
            e.preventDefault();
            const f = form.elements;
            const body = {
                title: f.title.value, event_date: f.event_date.value, text: f.text.value,
                link: f.link.value, image_url: f.image_url.value, published: f.published.checked,
            };
            if (form.dataset.id) await api(`/site/events/${form.dataset.id}`, { method: 'PUT', body });
            else await api('/site/events', { method: 'POST', body });
            toast('Збережено ✓');
            await renderEvents();
        }));

        const list = $('#eventList');
        if (window.Sortable && events.length) {
            Sortable.create(list, {
                handle: '.handle', animation: 200,
                onEnd: run(async () => {
                    await api('/site/events/order', { method: 'POST', body: { ids: $$('.event-item', list).map(el => Number(el.dataset.id)) } });
                    toast('Порядок збережено');
                }),
            });
        }
        list.addEventListener('click', run(async e => {
            const item = e.target.closest('.event-item');
            if (!item) return;
            if (e.target.closest('[data-edit]')) return renderEvents(Number(item.dataset.id));
            if (e.target.closest('[data-del]')) {
                if (!confirm('Видалити подію?')) return;
                await api(`/site/events/${item.dataset.id}`, { method: 'DELETE' });
                toast('Видалено');
                await renderEvents();
            }
        }));
    }

    /* ---------- site settings ---------- */
    const BANK_FIELDS = [
        ['recipient', 'Отримувач'], ['edrpou', 'ЄДРПОУ'], ['iban', 'IBAN'], ['bank', 'Банк'], ['mfo', 'МФО'],
        ['purpose', 'Призначення платежу'], ['currencies', 'Валюти рахунку'], ['swift_note', 'Примітка (напр. SWIFT для валюти)'],
    ];

    async function renderSettings() {
        setActiveNav('settings');
        const { settings } = await api('/site');
        const bank = settings.bank_details || {};
        view.innerHTML = `
            <div class="page-head"><div><h1>Налаштування сайту</h1><p>Реквізити показуються у вікні «Підтримати фонд», години роботи — у блоці контактів.</p></div></div>
            <form id="settingsForm">
                <div class="panel">
                    <h2><i class="fas fa-building-columns"></i>Реквізити для благодійних внесків</h2>
                    <div class="settings-grid">
                        ${BANK_FIELDS.map(([k, label]) => `<label class="field">${label}<input name="b_${k}" value="${esc(bank[k])}"></label>`).join('')}
                    </div>
                </div>
                <div class="panel">
                    <h2><i class="fas fa-clock"></i>Години роботи</h2>
                    <label class="field">Наприклад: «Пн–Пт 10:00–18:00». Порожнє поле — блок не показується.
                        <input name="work_hours" value="${esc(settings.work_hours || '')}">
                    </label>
                </div>
                <div class="sticky-actions"><button class="btn btn--primary" type="submit"><i class="fas fa-floppy-disk"></i>Зберегти</button></div>
            </form>`;
        $('#settingsForm').addEventListener('submit', run(async e => {
            e.preventDefault();
            const f = e.target.elements;
            await api('/site/settings', {
                method: 'PUT',
                body: {
                    bank_details: Object.fromEntries(BANK_FIELDS.map(([k]) => [k, f[`b_${k}`].value])),
                    work_hours: f.work_hours.value,
                },
            });
            toast('Збережено ✓');
        }));
    }

    /* ---------- router ---------- */
    const router = run(async () => {
        const hash = location.hash || '#/requests';
        let m;
        if ((m = hash.match(/^#\/list\/(\w+)/))) {
            listState.page = 1;
            await renderList(m[1]);
        } else if ((m = hash.match(/^#\/org\/(\d+)/))) await renderEditor(Number(m[1]));
        else if (hash === '#/new') await renderEditor(null);
        else if (hash === '#/featured') await renderFeatured();
        else if (hash === '#/runs') await renderRuns();
        else if (hash === '#/requests') await renderRequests();
        else if (hash === '#/events') await renderEvents();
        else if (hash === '#/settings') await renderSettings();
        else location.hash = '#/requests';
    });

    async function start() {
        const me = await fetch('/api/fond/me').then(r => r.json()).catch(() => ({}));
        if (!me.authenticated) {
            showLogin(me.configured === false ? 'Адмін ще не налаштований: задайте ADMIN_LOGIN і ADMIN_PASSWORD на Railway.' : '');
            return;
        }
        $('#login').hidden = true;
        $('#app').hidden = false;
        await refreshMeta();
        await router();
    }

    window.addEventListener('hashchange', router);
    start().catch(err => showLogin(err.message));
})();
