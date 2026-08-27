import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeLocale, translate } from '../js/i18n.js';

test('P02 shell localization supports English and Turkish with safe fallback', () => {
  assert.equal(normalizeLocale('tr-TR'), 'tr');
  assert.equal(normalizeLocale('de-DE'), 'en');
  assert.equal(translate('en', 'shell.menu'), 'Menu');
  assert.equal(translate('tr', 'shell.menu'), 'Menü');
  assert.equal(translate('tr', 'core.title'), 'Tavsiye ver. Kararı karakter verir.');
  assert.equal(translate('unknown', 'save.export'), 'Export JSON');
});

test('localization does not define authoritative campaign values', () => {
  for (const locale of ['en', 'tr']) {
    for (const key of ['campaign.id', 'campaign.seed', 'campaign.turn', 'campaign.character', 'campaign.rank', 'campaign.gold']) {
      const label = translate(locale, key);
      assert.ok(label.length > 0);
      assert.doesNotMatch(label, /ADVISOR-P01-DEMO|Peasant|\b\d{2,}\b/);
    }
  }
});
