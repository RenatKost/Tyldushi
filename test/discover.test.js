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
