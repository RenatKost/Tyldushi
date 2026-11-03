import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCategories } from '../server/lib/categories.js';
import { slugify } from '../server/lib/slug.js';
import { rankResults, nameTokens, searchName, verifySite } from '../worker/enrich/pick.js';
import { extractPage } from '../worker/enrich/crawl.js';
import { guessLocation } from '../worker/geo.js';
import { prettifyName } from '../worker/registry.js';

test('slugify transliterates Ukrainian', () => {
    assert.equal(slugify('Благодійний фонд «Голоси дітей»'), 'blahodiinyi-fond-holosy-ditei');
    assert.equal(slugify(''), 'org');
});

test('normalizeCategories keeps only known keys', () => {
    assert.deepEqual(normalizeCategories(['children', 'nope', 'children', 'animals']), ['children', 'animals']);
});

test('guessLocation reads city and region from registry names', () => {
    assert.deepEqual(guessLocation('ГРОМАДСЬКА ОРГАНІЗАЦІЯ "ВОЛОНТЕРИ М. КИЄВА"'), { city: 'Київ', region: null });
    assert.deepEqual(guessLocation('ХАРКІВСЬКА МІСЬКА ГРОМАДСЬКА ОРГАНІЗАЦІЯ'), { city: 'Харків', region: null });
    assert.deepEqual(guessLocation('ЛЬВІВСЬКА ОБЛАСНА ОРГАНІЗАЦІЯ'), { city: null, region: 'Львівська область' });
    assert.deepEqual(guessLocation('ФОНД КИЄВАН'), { city: null, region: null });
});

test('prettifyName fixes case, quotes and apostrophes', () => {
    assert.equal(prettifyName('БЛАГОДІЙНИЙ ФОНД "ЛЮДИ ДОБРА"'), 'Благодійний фонд «Люди добра»');
    assert.equal(prettifyName('ВСЕУКРАЇНСЬКЕ ОБ"ЄДНАННЯ ВЕТЕРАНІВ ЗСУ'), 'Всеукраїнське об’єднання ветеранів ЗСУ');
    assert.equal(prettifyName('Already Pretty'), 'Already Pretty');
    assert.equal(prettifyName('БЛАГОДІЙНА ОРГАНІЗАЦІЯ "БЛАГОДІЙНИЙ ФОНД "СКАУТИ МИКОЛАЄВА""'),
        'Благодійна організація «Благодійний фонд «Скаути Миколаєва»»');
    assert.equal(prettifyName('ГРОМАДСЬКА ОРГАНІЗАЦІЯ "ВОЛОНТЕРИ М. КИЄВА"'), 'Громадська організація «Волонтери м. Києва»');
});

test('search uses the innermost quoted part of the name', () => {
    const name = 'Благодійна організація «Благодійний фонд «Скаути Миколаєва»»';
    assert.equal(searchName({ name }), 'Скаути Миколаєва');
    assert.deepEqual(nameTokens(name), ['СКАУТИ', 'МИКОЛАЄВА']);
});

test('rankResults separates official site, socials and registries', () => {
    const org = { name: 'Благодійний фонд «Голоси дітей»', edrpou: '41117015' };
    const ranked = rankResults(org, [
        { url: 'https://voices.org.ua/about', title: 'Голоси дітей — благодійний фонд', content: '' },
        { url: 'https://opendatabot.ua/c/41117015', title: 'БФ ГОЛОСИ ДІТЕЙ 41117015', content: '' },
        { url: 'https://www.facebook.com/voices.of.children', title: 'Голоси дітей | Facebook', content: '' },
        { url: 'https://example.com/other', title: 'Зовсім інша організація', content: '' },
    ]);
    assert.deepEqual(ranked.websites.map(w => w.url), ['https://voices.org.ua']);
    assert.equal(ranked.socials.facebook, 'https://www.facebook.com/voices.of.children');
    assert.equal(ranked.confirmations.length, 1);
    assert.deepEqual(nameTokens(org.name), ['ГОЛОСИ', 'ДІТЕЙ']);
});

test('extractPage finds contacts, socials and verifies the site', () => {
    const html = `<html><head><title>Фонд «Голоси дітей»</title><meta name="description" content="Допомога дітям">
        <meta property="og:image" content="/logo.png"></head><body>
        <nav><a href="/about-us">Про фонд</a><a href="/news">Новини</a></nav>
        <p>Телефон: (044) 123-45-67, IBAN UA213223130000026007233566001</p>
        <a href="mailto:info@voices.org.ua">Пишіть</a>
        <a href="https://t.me/helpBot">бот</a><a href="https://t.me/voices_channel">канал</a>
        <a href="https://facebook.com/sharer.php?u=x">share</a><p>ЄДРПОУ 41117015</p></body></html>`;
    const page = extractPage({ url: 'https://voices.org.ua/', html });
    assert.deepEqual(page.phones, ['+38 044 123 45 67']);
    assert.deepEqual(page.emails, ['info@voices.org.ua']);
    assert.equal(page.socials.telegram, 'https://t.me/voices_channel');
    assert.equal(page.socials.facebook, undefined);
    assert.deepEqual(page.logos, ['https://voices.org.ua/logo.png']);
    assert.deepEqual(page.subpages.map(s => s.url), ['https://voices.org.ua/about-us', 'https://voices.org.ua/news']);
    assert.equal(verifySite({ name: 'x', edrpou: '41117015' }, page, []), 1);
});
