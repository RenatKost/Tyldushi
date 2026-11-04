import assert from 'node:assert/strict';
import test from 'node:test';
import { interpretByRules } from '../server/lib/match.js';
import { computeScore, levelOf } from '../server/lib/rating.js';
import { learnOfficeRegions, parseRegister } from '../worker/nuo.js';
import { telegramActivity } from '../worker/enrich/index.js';

const NOW = Date.parse('2026-11-05T12:00:00Z');

test('an organization that exists only on paper gets no activity points', () => {
    const r = computeScore({ contacts: {} }, [], { now: NOW });
    assert.equal(r.score, 0);
    assert.equal(r.level, 'none');
    assert.equal(r.lastActivity, null);
});

test('an active organization with recent cases, Telegram and a site is rated high', () => {
    const org = {
        contacts: { website: 'https://x.org', telegram: 'https://t.me/x', phone: '+38 048 000 00 00' },
        tg_posts_90d: 12,
        has_reports: true,
        review_count: 3,
        review_avg: 5,
        verified_by_fund: true,
        last_activity_at: '2026-11-01',
    };
    const cases = [{ happened_at: '2026-10-20' }, { happened_at: '2026-06-01' }, { happened_at: '2024-01-01' }];
    const r = computeScore(org, cases, { now: NOW });
    // 2 cases in the last year (12) + recent (10) + telegram (15) + site (10) + reports (5)
    // + socials (5) + contacts (5) + reviews (10) + verified (10)
    assert.equal(r.score, 82);
    assert.equal(r.level, 'high');
    assert.equal(r.lastActivity, '2026-11-01');
    assert.equal(r.details.find(d => d.key === 'cases').points, 12);
});

test('levels follow the thresholds', () => {
    assert.equal(levelOf(70).key, 'high');
    assert.equal(levelOf(69).key, 'active');
    assert.equal(levelOf(40).key, 'active');
    assert.equal(levelOf(39).key, 'low');
    assert.equal(levelOf(14).key, 'none');
});

test('free-text requests map to help categories', () => {
    assert.deepEqual(interpretByRules('Потрібен психолог для чоловіка-ветерана').categories.sort(), ['psychological', 'veterans']);
    assert.ok(interpretByRules('допомога з протезом').categories.includes('rehabilitation'));
    assert.ok(interpretByRules('оформити УБД і пільги').categories.includes('legal'));
    assert.deepEqual(interpretByRules('притулок для собак').categories, ['animals']);
    assert.deepEqual(interpretByRules('').categories, []);
});

test('tax offices are mapped to regions by the names of their organizations', () => {
    const rows = [];
    for (let i = 0; i < 40; i++) rows.push({ edrpou: `1${i}`, name: `ГО "ОДЕСЬКИЙ КЛУБ ${i}"`, sti: '44069166' });
    for (let i = 0; i < 10; i++) rows.push({ edrpou: `2${i}`, name: `ГО "ДРУЗІ ${i}"`, sti: '44069166' });
    for (let i = 0; i < 5; i++) rows.push({ edrpou: `3${i}`, name: `ГО "ХАРКІВСЬКІ ${i}"`, sti: '99999999' });
    assert.deepEqual(learnOfficeRegions(rows), { 44069166: 'Одеська область' });
});

test('the tax register CSV is parsed with quoted names', () => {
    const csv = 'tin;full_name;d_reg_no_pr;c_sti\n"36545349";"ГРОМАДСЬКА ОРГАНIЗАЦIЯ ""ДРУЗІ""";2018-04-17;44069166\n';
    assert.deepEqual(parseRegister(csv), [{ edrpou: '36545349', name: 'ГРОМАДСЬКА ОРГАНIЗАЦIЯ "ДРУЗІ"', sti: '44069166' }]);
});

test('telegram activity counts posts of the last 90 days', () => {
    const today = new Date().toISOString().slice(0, 10);
    const old = new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10);
    assert.deepEqual(telegramActivity({ posts: [{ date: today }, { date: old }, { date: null }] }), { posts90: 1, last: today });
    assert.deepEqual(telegramActivity(null), { posts90: 0, last: null });
});
