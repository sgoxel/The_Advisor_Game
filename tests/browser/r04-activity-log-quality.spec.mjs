import { test, expect } from '@playwright/test';

test('activity log keeps raw diagnostics while suppressing duplicate/noisy structured cards', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.ActivityLog?.snapshot &&
    window.Game?.ActivityLogQuality?.installed &&
    window.Game?.UI?.addLog &&
    window.Game?.State?.log?.lines
  ), null, { timeout: 30_000 });

  const beforeRaw = await page.evaluate(() => window.Game.State.log.lines.length);

  await page.evaluate(() => {
    const UI = window.Game.UI;
    UI.addLog('Zoom changed to 2.60x.', 'camera diagnostic');
    UI.addLog('JS map bundle load failed.', 'optional map probe');
    UI.addLog('Runtime error captured.', 'minimap.js:185 Cannot read properties of undefined');
    UI.addLog('Global error event captured.', 'minimap.js:185 Cannot read properties of undefined');
    UI.addLog('Background texture uploaded from generated-texture.', '4096x4096');
    UI.addLog('Background texture uploaded from generated-texture.', '4096x4096');
  });

  const result = await page.evaluate((before) => ({
    rawAdded: window.Game.State.log.lines.length - before,
    events: window.Game.ActivityLog.snapshot().slice(-12)
  }), beforeRaw);

  // Every diagnostic still reaches the raw compatibility/export buffer.
  expect(result.rawAdded).toBe(6);

  const zoom = result.events.filter((entry) => entry.source === 'camera-zoom');
  const probes = result.events.filter((entry) => entry.source === 'optional-map-probe');
  expect(zoom.length).toBeGreaterThanOrEqual(1);
  expect(zoom.every((entry) => entry.diagnosticOnly === true)).toBe(true);
  expect(probes.length).toBeGreaterThanOrEqual(1);
  expect(probes.every((entry) => entry.diagnosticOnly === true)).toBe(true);

  const capturedErrors = result.events.filter((entry) => entry.details.includes('minimap.js:185'));
  expect(capturedErrors).toHaveLength(2);
  expect(capturedErrors.filter((entry) => !entry.diagnosticOnly)).toHaveLength(1);
  expect(capturedErrors.filter((entry) => entry.diagnosticOnly)).toHaveLength(1);

  const background = result.events.filter((entry) => entry.title.includes('Background texture uploaded'));
  expect(background).toHaveLength(2);
  expect(background.filter((entry) => !entry.diagnosticOnly)).toHaveLength(1);
  expect(background.filter((entry) => entry.diagnosticOnly)).toHaveLength(1);

  await page.click('#logBtn');
  await expect(page.locator('.activity-event-title', { hasText: 'Runtime error captured.' })).toHaveCount(1);
  await expect(page.locator('.activity-event-title', { hasText: 'Global error event captured.' })).toHaveCount(0);
  await expect(page.locator('.activity-event-title', { hasText: 'Zoom changed to 2.60x.' })).toHaveCount(0);
  await expect(page.locator('.activity-event-title', { hasText: 'JS map bundle load failed.' })).toHaveCount(0);
});
