import { test, expect } from '@playwright/test';

test('structured activity log is meaningful, bounded, localized and presentation-only', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.ActivityLog?.snapshot &&
    window.Game?.UI?.addLog &&
    window.Game?.State?.world?.terrain?.length
  ), null, { timeout: 30_000 });

  const before = await page.evaluate(() => {
    const world = window.Game.State.world;
    return JSON.stringify({
      seed: world.seed,
      rows: world.rows,
      cols: world.cols,
      player: world.player ? { row: world.player.row, col: world.player.col } : null,
      terrain: (world.terrain || []).map((row) => (row || []).map((tile) => ({ type: tile?.type, elevation: tile?.elevation }))),
      roads: world.originVillage?.roadTiles || [],
      buildings: world.originVillage?.buildings || []
    });
  });

  await page.evaluate(() => {
    const Game = window.Game;
    Game.UI.addLog('World generated successfully.', 'SEED SIMSOFT-001 is active.', {
      category: 'world', severity: 'success', source: 'test-world', outcome: 'ready', timeKind: 'game'
    });
    Game.UI.addLog('Settings opened');
    Game.UI.addLog('Runtime resource failed.', 'example.js:42', {
      category: 'system', severity: 'error', source: 'test-error', timeKind: 'session'
    });
  });

  const meaningful = await page.evaluate(() => window.Game.ActivityLog.snapshot());
  expect(meaningful.some((entry) => entry.category === 'world' && entry.severity === 'success' && entry.title.includes('World generated'))).toBe(true);
  expect(meaningful.some((entry) => entry.category === 'system' && entry.severity === 'error' && entry.details.includes('example.js:42'))).toBe(true);
  expect(meaningful.some((entry) => entry.title.toLowerCase().includes('settings opened'))).toBe(false);
  expect(meaningful.every((entry) => entry.timeKind === 'game' || entry.timeKind === 'session')).toBe(true);

  await page.evaluate(() => {
    for (let index = 0; index < 230; index += 1) {
      window.Game.ActivityLog.add({ category: 'system', severity: 'info', title: `Retention probe ${index}`, diagnosticOnly: true, timeKind: 'session' });
    }
  });
  const retained = await page.evaluate(() => window.Game.ActivityLog.snapshot());
  expect(retained.length).toBeLessThanOrEqual(200);

  // Add stable named events after the retention probe. Natural NPC activity may be emitted
  // concurrently, so assertions target these entries instead of assuming a fixed card count.
  await page.evaluate(() => {
    window.Game.ActivityLog.add({ category: 'world', severity: 'success', title: 'World state ready', outcome: 'ready', timeKind: 'game' });
    window.Game.ActivityLog.add({ category: 'system', severity: 'error', title: 'Actionable test error', details: 'file.js:7', timeKind: 'session' });
  });

  await page.click('#logBtn');
  await expect(page.locator('#activityLogTitle')).toHaveText('Activity Log');
  await expect(page.locator('#activityLogEntries .activity-event-title', { hasText: 'World state ready' })).toHaveCount(1);
  const errorEvent = page.locator('.activity-event', { has: page.locator('.activity-event-title', { hasText: 'Actionable test error' }) });
  await expect(errorEvent).toHaveCount(1);
  await expect(errorEvent.locator('.activity-event-severity')).toHaveText('Error');
  await expect(errorEvent.locator('details')).toHaveCount(1);

  await page.click('#closeLogBtn');
  await page.click('#settingsBtn');
  await page.click('#cancelSettingsBtn');
  const visibleSelfNoise = await page.evaluate(() => window.Game.ActivityLog.snapshot().filter((entry) =>
    !entry.diagnosticOnly && /^(log|settings) (opened|closed)$/i.test(entry.title)
  ).map((entry) => entry.title));
  expect(visibleSelfNoise).toEqual([]);

  await page.selectOption('#languageSelect', 'tr');
  await page.waitForFunction(() => document.getElementById('activityLogTitle')?.textContent === 'Etkinlik Günlüğü');
  await page.click('#logBtn');
  await expect(page.locator('#activityLogTitle')).toHaveText('Etkinlik Günlüğü');
  await expect(errorEvent.locator('.activity-event-severity')).toHaveText('Hata');

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    const overflow = await page.evaluate(() => {
      const card = document.querySelector('.activity-log-card');
      return card ? card.getBoundingClientRect().right > window.innerWidth + 1 || card.getBoundingClientRect().left < -1 : true;
    });
    expect(overflow).toBe(false);
  }

  const after = await page.evaluate(() => {
    const world = window.Game.State.world;
    return JSON.stringify({
      seed: world.seed,
      rows: world.rows,
      cols: world.cols,
      player: world.player ? { row: world.player.row, col: world.player.col } : null,
      terrain: (world.terrain || []).map((row) => (row || []).map((tile) => ({ type: tile?.type, elevation: tile?.elevation }))),
      roads: world.originVillage?.roadTiles || [],
      buildings: world.originVillage?.buildings || []
    });
  });
  expect(after).toBe(before);
});

test('activity log records Advisor submission and stable NPC summaries without frame spam', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.ActivityLog?.snapshot && window.Game?.NPCSpatial), null, { timeout: 30_000 });

  const baseline = await page.evaluate(() => window.Game.ActivityLog.snapshot().length);
  await page.fill('#advisorMessageInput', 'Please consider checking for useful work nearby.');
  await page.click('#advisorSendBtn');
  await page.waitForFunction((before) => {
    const entries = window.Game.ActivityLog.snapshot();
    return entries.length > before && entries.some((entry) => entry.category === 'advisor') && entries.some((entry) => entry.category === 'character');
  }, baseline, { timeout: 10_000 });

  await page.evaluate(() => window.Game.ActivityLog.npcSummary());
  const first = await page.evaluate(() => window.Game.ActivityLog.snapshot());
  expect(first.some((entry) => entry.category === 'advisor')).toBe(true);
  expect(first.some((entry) => entry.category === 'character')).toBe(true);
  expect(first.some((entry) => entry.category === 'npc')).toBe(true);

  const routineCountBeforeRepeat = first.filter((entry) => entry.source === 'npc-routine').length;
  const dialogueCountBeforeRepeat = first.filter((entry) => entry.source === 'npc-dialogue').length;
  await page.evaluate(() => {
    window.Game.ActivityLog.npcSummary();
    window.Game.ActivityLog.npcSummary();
    window.Game.ActivityLog.npcSummary();
  });
  const afterRepeat = await page.evaluate(() => window.Game.ActivityLog.snapshot());
  expect(afterRepeat.filter((entry) => entry.source === 'npc-routine').length).toBe(routineCountBeforeRepeat);
  expect(afterRepeat.filter((entry) => entry.source === 'npc-dialogue').length).toBe(dialogueCountBeforeRepeat);
});
