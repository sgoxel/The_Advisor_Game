import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { APP_FOUNDATION, initializeApp } from '../js/app.js';

const indexUrl = new URL('../index.html', import.meta.url);
const cssUrl = new URL('../css/app.css', import.meta.url);
const p02CssUrl = new URL('../css/p02-shell.css', import.meta.url);
const html = await readFile(indexUrl, 'utf8');
const css = await readFile(cssUrl, 'utf8');
const p02Css = await readFile(p02CssUrl, 'utf8');

test('static entrypoint uses repository-relative assets and module loading', () => {
  assert.match(html, /href="\.\/css\/app\.css"/);
  assert.match(html, /href="\.\/css\/p02-shell\.css"/);
  assert.match(html, /type="module" src="\.\/js\/app\.js"/);
  assert.doesNotMatch(html, /https?:\/\/(?!schema\.org)/i);
});

test('shell preserves the README fundamental autonomy rule', () => {
  assert.equal(
    APP_FOUNDATION.coreRule,
    'Player advises -> AI Character decides -> Simulation validates -> World reacts.'
  );
  assert.equal(APP_FOUNDATION.phase, 'P02');
  assert.match(html, /Player advises → AI Character decides → Simulation validates → World reacts\./);
});

test('shell is static-client only and does not require provider credentials', () => {
  assert.equal(APP_FOUNDATION.runtime, 'static-client');
  const combined = `${html}\n${css}\n${p02Css}`.toLowerCase();
  for (const forbidden of ['api key', 'apikey', 'credential', 'provider token', 'backend url']) {
    assert.ok(!combined.includes(forbidden), `shell must not request ${forbidden}`);
  }
});

test('responsive and accessible foundations are present', () => {
  assert.match(html, /name="viewport"/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /id="language-select"/);
  assert.match(html, /p02-shell-symbols\.svg#menu/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(p02Css, /@media \(max-width: 959px\)/);
  assert.match(p02Css, /min-height:\s*44px/);
  assert.match(`${css}\n${p02Css}`, /env\(safe-area-inset-/);
});

test('browser initializer is safe without a DOM and marks a supplied DOM ready', () => {
  assert.deepEqual(initializeApp(undefined), { ready: false, reason: 'document-unavailable' });

  const status = { textContent: '', dataset: {} };
  const fakeDocument = {
    documentElement: { dataset: {}, lang: 'en' },
    getElementById(id) {
      return id === 'app-status' ? status : null;
    }
  };

  assert.deepEqual(initializeApp(fakeDocument), { ready: true, phase: 'P02' });
  assert.equal(status.textContent, 'Ready');
  assert.equal(status.dataset.state, 'ready');
  assert.equal(fakeDocument.documentElement.dataset.appReady, 'true');
});
