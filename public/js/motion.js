/* Motion layer for the whole site (GSAP + ScrollTrigger + SplitText).
 * Exposes window.Motion so page scripts can animate modals, menus and dynamically added cards.
 * Everything degrades gracefully: without GSAP or with prefers-reduced-motion the page is static. */
(function () {
    const root = document.documentElement;
    const hasGsap = typeof window.gsap !== 'undefined';
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const noop = () => {};
    const fallback = {
        enabled: false,
        revealCards: noop,
        modalIn(modal) { modal.style.display = 'block'; },
        modalOut(modal, done) { modal.style.display = 'none'; done && done(); },
        menuIn: noop,
    };

    if (!hasGsap || reduce) {
        root.classList.remove('js-motion');
        window.Motion = fallback;
        return;
    }

    const { gsap } = window;
    const plugins = [window.ScrollTrigger, window.SplitText].filter(Boolean);
    gsap.registerPlugin(...plugins);
    const hasST = Boolean(window.ScrollTrigger);
    const isDesktop = window.matchMedia('(min-width: 769px) and (pointer: fine)').matches;

    gsap.defaults({ ease: 'power3.out', duration: 0.8 });

    /* ---------- Global: scroll progress + header state ---------- */
    function initChrome() {
        const bar = document.createElement('div');
        bar.className = 'scroll-progress';
        document.body.appendChild(bar);

        const header = document.querySelector('.header');
        if (!hasST) return;
        gsap.to(bar, {
            scaleX: 1,
            ease: 'none',
            scrollTrigger: { start: 0, end: 'max', scrub: 0.3 },
        });
        if (header) {
            ScrollTrigger.create({
                start: 40,
                end: 'max',
                onToggle: self => header.classList.toggle('is-scrolled', self.isActive),
            });
        }
    }

    /* ---------- Hero intro ---------- */
    function initHero() {
        const hero = document.querySelector('.hero');
        if (!hero) return;
        const heading = hero.querySelector('h1');
        const subtitle = hero.querySelector('.hero-subtitle');
        const buttons = hero.querySelectorAll('.hero-buttons .btn');
        const image = hero.querySelector('.hero-image');
        const glow = hero.querySelector('.logo-glow');
        const text = hero.querySelector('.hero-text');

        gsap.set([text, image].filter(Boolean), { autoAlpha: 1 });
        root.classList.remove('js-motion');

        const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });

        if (heading && window.SplitText) {
            const split = SplitText.create(heading, {
                type: 'lines,words',
                mask: 'lines',
                linesClass: 'split-line',
                wordsClass: 'split-word',
            });
            tl.from(split.words, { yPercent: 110, duration: 1.1, stagger: 0.06 });
        } else if (heading) {
            tl.from(heading, { y: 40, autoAlpha: 0 });
        }

        if (subtitle) tl.from(subtitle, { y: 24, autoAlpha: 0, duration: 0.9 }, '-=0.7');
        if (buttons.length) tl.from(buttons, { y: 24, autoAlpha: 0, scale: 0.94, stagger: 0.12, duration: 0.7 }, '-=0.6');
        if (image) tl.from(image, { scale: 0.6, rotate: -8, autoAlpha: 0, duration: 1.4, ease: 'elastic.out(1, 0.75)' }, 0.2);
        if (glow) tl.from(glow, { scale: 0.2, autoAlpha: 0, duration: 1.6 }, 0.3);

        // Decorative orbs drift with the mouse and scroll at different depths.
        const orbs = hero.querySelectorAll('.hero-orb');
        orbs.forEach((orb, i) => {
            gsap.to(orb, {
                x: `random(-40, 40)`,
                y: `random(-30, 30)`,
                duration: 6 + i * 2,
                ease: 'sine.inOut',
                repeat: -1,
                yoyo: true,
                repeatRefresh: true,
            });
            if (hasST) {
                gsap.to(orb, {
                    yPercent: 60 * Number(orb.dataset.depth || 0.5),
                    ease: 'none',
                    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
                });
            }
        });

        // Hero content parallax out on scroll.
        if (hasST && text && image) {
            gsap.to(text, {
                y: -60, autoAlpha: 0.2, ease: 'none',
                scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
            });
            gsap.to(image, {
                y: 80, ease: 'none',
                scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
            });
        }

        // Logo follows the pointer slightly (desktop only).
        const container = hero.querySelector('.hero-logo-container');
        if (isDesktop && container) {
            const xTo = gsap.quickTo(container, 'x', { duration: 0.8, ease: 'power3' });
            const yTo = gsap.quickTo(container, 'y', { duration: 0.8, ease: 'power3' });
            const rTo = gsap.quickTo(container, 'rotationY', { duration: 0.8, ease: 'power3' });
            gsap.set(container, { transformPerspective: 900 });
            hero.addEventListener('mousemove', e => {
                const rect = hero.getBoundingClientRect();
                const nx = (e.clientX - rect.left) / rect.width - 0.5;
                const ny = (e.clientY - rect.top) / rect.height - 0.5;
                xTo(nx * 30);
                yTo(ny * 24);
                rTo(nx * 12);
            });
            hero.addEventListener('mouseleave', () => { xTo(0); yTo(0); rTo(0); });
        }
    }

    /* ---------- Inner page hero (organizations) ---------- */
    function initPageHero() {
        const hero = document.querySelector('.orgs-hero');
        if (!hero) return;
        const tl = gsap.timeline({ defaults: { ease: 'power4.out' } });
        const title = hero.querySelector('.orgs-title');
        if (title && window.SplitText) {
            const split = SplitText.create(title, { type: 'lines,words', mask: 'lines', linesClass: 'split-line' });
            tl.from(split.words, { yPercent: 110, duration: 1, stagger: 0.04 });
        }
        tl.from(hero.querySelectorAll('.orgs-eyebrow, .orgs-lead, .orgs-stats'), { y: 30, autoAlpha: 0, stagger: 0.12, duration: 0.8 }, 0.1);
        tl.from('.orgs-filters, .orgs-chips', { y: 30, autoAlpha: 0, stagger: 0.1, duration: 0.8 }, 0.4);
        hero.querySelectorAll('.hero-orb').forEach((orb, i) => {
            gsap.to(orb, { x: 'random(-50, 50)', y: 'random(-30, 30)', duration: 7 + i * 2, ease: 'sine.inOut', repeat: -1, yoyo: true, repeatRefresh: true });
        });
    }

    /* ---------- Section titles ---------- */
    function initSectionTitles() {
        if (!hasST) return;
        document.querySelectorAll('.section-title').forEach(title => {
            gsap.set(title, { '--line-scale': 0 });
            const tl = gsap.timeline({
                scrollTrigger: { trigger: title, start: 'top 85%', once: true },
            });
            if (window.SplitText) {
                const split = SplitText.create(title, { type: 'words', mask: 'words' });
                tl.from(split.words, { yPercent: 100, duration: 0.9, stagger: 0.07 });
            } else {
                tl.from(title, { y: 30, autoAlpha: 0 });
            }
            tl.to(title, { '--line-scale': 1, duration: 0.8, ease: 'expo.out' }, '-=0.5');
        });
    }

    /* ---------- Cards ---------- */
    function revealCards(elements) {
        const list = gsap.utils.toArray(elements);
        if (!list.length) return;
        if (!hasST) {
            gsap.from(list, { y: 30, autoAlpha: 0, stagger: 0.06 });
            return;
        }
        gsap.set(list, { y: 50, autoAlpha: 0, scale: 0.97 });
        ScrollTrigger.batch(list, {
            start: 'top 92%',
            once: true,
            onEnter: batch => gsap.to(batch, {
                y: 0, autoAlpha: 1, scale: 1, duration: 0.9, stagger: 0.09, overwrite: true,
                clearProps: 'transform',
            }),
        });
    }

    function initTilt(elements) {
        if (!isDesktop) return;
        gsap.utils.toArray(elements).forEach(card => {
            if (card.dataset.tilt) return;
            card.dataset.tilt = '1';
            gsap.set(card, { transformPerspective: 800 });
            const rx = gsap.quickTo(card, 'rotationX', { duration: 0.5, ease: 'power3' });
            const ry = gsap.quickTo(card, 'rotationY', { duration: 0.5, ease: 'power3' });
            card.addEventListener('mousemove', e => {
                const r = card.getBoundingClientRect();
                ry(((e.clientX - r.left) / r.width - 0.5) * 8);
                rx(-((e.clientY - r.top) / r.height - 0.5) * 8);
            });
            card.addEventListener('mouseleave', () => { rx(0); ry(0); });
        });
    }

    /* ---------- Counters and progress bars ---------- */
    function initCounters() {
        if (!hasST) return;
        document.querySelectorAll('.stat-number').forEach(el => {
            const target = parseInt(el.textContent.replace(/[^\d]/g, ''), 10);
            if (!target) return;
            const obj = { value: 0 };
            el.textContent = '0';
            gsap.to(obj, {
                value: target,
                duration: 2.2,
                ease: 'power2.out',
                scrollTrigger: { trigger: el, start: 'top 85%', once: true },
                onUpdate: () => { el.textContent = Math.round(obj.value).toLocaleString('uk-UA'); },
            });
        });

        document.querySelectorAll('.progress').forEach(bar => {
            gsap.from(bar, {
                width: 0,
                duration: 1.8,
                ease: 'power2.inOut',
                scrollTrigger: { trigger: bar, start: 'top 90%', once: true },
            });
        });
    }

    /* ---------- Magnetic buttons ---------- */
    function initMagnetic() {
        if (!isDesktop) return;
        document.querySelectorAll('.hero-buttons .btn, .btn-primary, .btn-magnetic').forEach(btn => {
            btn.classList.add('is-magnetic');
            const xTo = gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3' });
            const yTo = gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3' });
            btn.addEventListener('mousemove', e => {
                const r = btn.getBoundingClientRect();
                xTo((e.clientX - r.left - r.width / 2) * 0.25);
                yTo((e.clientY - r.top - r.height / 2) * 0.35);
            });
            btn.addEventListener('mouseleave', () => { xTo(0); yTo(0); });
        });
    }

    /* ---------- Modals and mobile menu ---------- */
    function modalIn(modal) {
        modal.style.display = 'block';
        const content = modal.querySelector('.modal-content');
        gsap.fromTo(modal, { backgroundColor: 'rgba(0,0,0,0)' }, { backgroundColor: 'rgba(0,0,0,0.5)', duration: 0.3, ease: 'none' });
        if (content) {
            gsap.fromTo(content,
                { y: 60, scale: 0.92, autoAlpha: 0 },
                { y: 0, scale: 1, autoAlpha: 1, duration: 0.55, ease: 'back.out(1.4)' });
            const items = content.querySelectorAll('h2, h3, .form-group, .bank-details, .payment-btn, li');
            gsap.from(items, { y: 16, autoAlpha: 0, stagger: 0.025, duration: 0.4, delay: 0.15 });
        }
    }

    function modalOut(modal, done) {
        const content = modal.querySelector('.modal-content');
        gsap.timeline({
            onComplete: () => {
                modal.style.display = 'none';
                gsap.set([modal, content].filter(Boolean), { clearProps: 'all' });
                done && done();
            },
        })
            .to(content, { y: 40, scale: 0.95, autoAlpha: 0, duration: 0.25, ease: 'power2.in' })
            .to(modal, { backgroundColor: 'rgba(0,0,0,0)', duration: 0.2, ease: 'none' }, '<');
    }

    function menuIn(menu) {
        const links = menu.querySelectorAll('.nav-link');
        gsap.fromTo(links,
            { y: 30, autoAlpha: 0, scale: 0.95 },
            { y: 0, autoAlpha: 1, scale: 1, stagger: 0.06, duration: 0.5, delay: 0.15, ease: 'back.out(1.6)' });
        gsap.fromTo(menu.querySelectorAll('.nav-link i'),
            { scale: 0, rotate: -180 },
            { scale: 1, rotate: 0, stagger: 0.06, duration: 0.6, delay: 0.25, ease: 'back.out(2)' });
    }

    const CARD_SELECTOR = '.report-card, .fundraising-card, .project-card, .stat-item, .contact-item';

    function init() {
        initChrome();
        initHero();
        initPageHero();
        initSectionTitles();
        revealCards(CARD_SELECTOR);
        initTilt('.report-card, .project-card, .fundraising-card');
        initCounters();
        initMagnetic();
        // Fonts and images change layout: recalculate trigger positions once everything is loaded.
        window.addEventListener('load', () => hasST && ScrollTrigger.refresh());
    }

    window.Motion = {
        enabled: true,
        revealCards: elements => { revealCards(elements); initTilt(elements); },
        modalIn,
        modalOut,
        menuIn,
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
