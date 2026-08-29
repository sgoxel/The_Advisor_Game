import { test, expect } from '@playwright/test';

async function openGuardedPage(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('./');
  await page.waitForFunction(() => Boolean(document.head?.__simsoftOptionalMapScriptGuardInstalled));
  return { pageErrors, consoleErrors };
}

test('issue #256: a present same-origin optional map bundle still executes and exposes its payload', async ({ page }) => {
  const errors = await openGuardedPage(page);

  const evidence = await page.evaluate(async () => {
    delete window.__SIMSOFT_IMPORTED_MAP_DATA__;
    return await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.async = true;
      script.src = './map/worker6-issue256-present-bundle.js';
      script.onload = () => resolve({
        loaded: true,
        payload: window.__SIMSOFT_IMPORTED_MAP_DATA__ || null,
        finalSrc: script.src
      });
      script.onerror = () => reject(new Error('Present optional map bundle failed to load'));
      document.head.appendChild(script);
    });
  });

  expect(evidence.loaded).toBe(true);
  expect(evidence.payload?.worker6Issue256).toBe('present-http');
  expect(evidence.payload?.seed).toBe('WORKER6-ISSUE-256-PRESENT');
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});

test('issue #256: a selected local File/Blob script path remains compatible', async ({ page }) => {
  const errors = await openGuardedPage(page);

  const evidence = await page.evaluate(async () => {
    delete window.__SIMSOFT_IMPORTED_MAP_DATA__;
    const source = 'window.__SIMSOFT_IMPORTED_MAP_DATA__ = { worker6Issue256: "local-file", seed: "WORKER6-ISSUE-256-FILE", tiles: [] };';
    const selectedFile = new File([source], 'worker6-selected-map.js', { type: 'text/javascript' });
    const objectUrl = URL.createObjectURL(selectedFile);

    try {
      const loaded = await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.async = true;
        script.src = objectUrl;
        script.onload = () => resolve(true);
        script.onerror = () => reject(new Error('Selected local File/Blob map bundle failed to load'));
        document.head.appendChild(script);
      });

      return {
        loaded,
        objectProtocol: new URL(objectUrl).protocol,
        payload: window.__SIMSOFT_IMPORTED_MAP_DATA__ || null
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  });

  expect(evidence.loaded).toBe(true);
  expect(evidence.objectProtocol).toBe('blob:');
  expect(evidence.payload?.worker6Issue256).toBe('local-file');
  expect(evidence.payload?.seed).toBe('WORKER6-ISSUE-256-FILE');
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});
