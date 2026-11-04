import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanServiceList, detectServices } from '../server/lib/services.js';

test('a request is mapped to concrete services and audiences', () => {
    const r = detectServices('потрібен психолог для чоловіка-ветерана');
    assert.ok(r.services.includes('psych_individual'));
    assert.ok(r.audiences.includes('veterans'));
    assert.deepEqual(detectServices('допомога з протезом').services, ['prosthetics']);
    assert.ok(detectServices('оформити УБД').services.includes('ubd_status'));
    assert.ok(detectServices('де взяти ліки').services.includes('medicines'));
});

test('stems match only at the start of a word', () => {
    // «протест» must not look like «протез», and generic words give no services.
    assert.deepEqual(detectServices('мирний протест').services, []);
    assert.deepEqual(detectServices('допоможіть будь ласка').services, []);
});

test('bot services without a quote or with an unknown key are dropped', () => {
    const list = cleanServiceList([
        { key: 'prosthetics', quote: 'Безкоштовно виготовляємо протези для військових', source_url: 'https://a.org' },
        { key: 'prosthetics', quote: '', source_url: 'https://a.org' },
        { key: 'made_up', quote: 'щось', source_url: 'https://a.org' },
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0].key, 'prosthetics');
});
