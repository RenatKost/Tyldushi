import assert from 'node:assert/strict';
import test from 'node:test';
import { allQueries, extractCandidates } from '../worker/discover.js';

test('discovery finds ЄДРПОУ codes and distinctive quoted names', () => {
    const c = extractCandidates({
        title: 'БФ «Добрий Самарянин» — Одеса',
        content: 'Благодійний фонд "Карітас Одеса УГКЦ", код ЄДРПОУ 33722076. Проєкт «Надія» для дітей.',
    });
    assert.deepEqual(c.codes, ['33722076']);
    assert.ok(c.names.includes('Добрий Самарянин'));
    assert.ok(c.names.includes('Карітас Одеса УГКЦ'));
    assert.ok(!c.names.includes('Надія'), 'a single common word is not an identification');
});

test('Odesa queries come first', () => {
    const q = allQueries();
    assert.match(q[0].query, /Одеса/);
    assert.equal(q[0].region, 'Одеська область');
});

test('a quoted name counts only when introduced as an organization', () => {
    const c = extractCandidates({
        title: 'Новини',
        content: 'Як повідомляє «Українська правда», ГО «Ветеранс хаб Одеса» відкрила простір. Фонд "Ваше місто" допоміг.',
    });
    assert.ok(!c.names.includes('Українська правда'));
    assert.ok(c.names.includes('Ветеранс хаб Одеса'));
    assert.ok(c.names.includes('Ваше місто'));
});
