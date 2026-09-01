import { test, expect } from '@playwright/test';

function collectRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror:${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console:${message.text()}`); });
  return failures;
}

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.VectorLayerDebug?.snapshot &&
    window.Game?.State?.world?.terrain?.length &&
    document.getElementById('vectorLayerDebugSection')
  ), null, { timeout: 30_000 });
}

function authoritativeSnapshot() {
  const world = window.Game.State.world;
  return JSON.stringify({
    seed: world.seed,
    rows: world.rows,
    cols: world.cols,
    player: world.player ? { row: world.player.row, col: world.player.col } : null,
    terrain: (world.terrain || []).map((row) => (row || []).map((tile) => ({ type: tile?.type, elevation: tile?.elevation }))),
    roads: world.originVillage?.roadTiles || [],
    buildings: world.originVillage?.buildings || [],
    npcIds: (world.npcs || []).map((npc) => npc.id)
  });
}

test('Vector Layer Debug enumerates the world contributor registry and toggles every contributor safely', async ({ page }) => {
  test.setTimeout(150_000);
  const failures = collectRuntimeFailures(page);
  await ready(page);
  const before = await page.evaluate(authoritativeSnapshot);
  await page.getByRole('button', { name: /settings/i }).click();

  const section = page.locator('#vectorLayerDebugSection');
  await expect(section.getByRole('heading', { name: 'Vector Layer Debug' })).toBeVisible();
  await expect(section.getByRole('table', { name: 'Vector layer debug controls' })).toBeVisible();

  const initial = await page.evaluate(() => window.Game.VectorLayerDebug.snapshot());
  expect(initial.length).toBeGreaterThanOrEqual(15);
  expect(new Set(initial.map((layer) => layer.id)).size).toBe(initial.length);
  expect(initial.every((layer) => layer.enabled === true && layer.defaultEnabled === true)).toBe(true);

  const required = [
    'renderer-background-terrain', 'renderer-grid', 'renderer-hover-marker', 'renderer-selection-marker',
    'renderer-route-preview', 'renderer-player', 'terrain-shape-overlay', 'starter-village-roads',
    'main-road-overlay', 'starter-village-exteriors', 'starter-village-interiors', 'world-objects',
    'npc-world-overlay', 'npc-activity-dialogue', 'development-labels'
  ];
  expect(required.every((id) => initial.some((entry) => entry.id === id))).toBe(true);

  for (const layer of initial) {
    const button = section.locator(`[data-vector-layer-id="${layer.id}"]`);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => window.Game.Renderer?.renderWorld?.(true));
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }

  await section.getByRole('button', { name: 'Reset defaults' }).click();
  const restored = await page.evaluate(() => window.Game.VectorLayerDebug.snapshot());
  expect(restored.every((layer) => layer.enabled === layer.defaultEnabled)).toBe(true);
  expect(await page.evaluate(authoritativeSnapshot)).toBe(before);
  expect(failures).toEqual([]);
});

test('All world presentation Off clears/hides registered viewport overlays at the 2.6x diagnostic zoom and reset restores them', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);
  const before = await page.evaluate(authoritativeSnapshot);

  await page.evaluate(() => {
    if (window.Game.State?.camera) window.Game.State.camera.zoom = 2.6;
    window.Game.Renderer?.renderWorld?.(true);
  });
  await page.getByRole('button', { name: /settings/i }).click();
  const section = page.locator('#vectorLayerDebugSection');

  await section.getByRole('button', { name: 'All world presentation Off' }).click();
  await page.waitForTimeout(250);
  const off = await page.evaluate(() => ({
    snapshot: window.Game.VectorLayerDebug.snapshot(),
    evidence: window.Game.VectorLayerDebug.visualEvidence(),
    zoom: Number(window.Game.State?.camera?.zoom)
  }));
  expect(off.zoom).toBeCloseTo(2.6, 4);
  expect(off.snapshot.every((entry) => entry.enabled === false)).toBe(true);
  expect(off.evidence.filter((entry) => entry.selector).every((entry) => entry.visible === false)).toBe(true);

  await section.getByRole('button', { name: 'Reset defaults' }).click();
  await page.waitForTimeout(250);
  const restored = await page.evaluate(() => ({
    snapshot: window.Game.VectorLayerDebug.snapshot(),
    evidence: window.Game.VectorLayerDebug.visualEvidence()
  }));
  expect(restored.snapshot.every((entry) => entry.enabled === entry.defaultEnabled)).toBe(true);
  expect(restored.evidence.some((entry) => entry.visible === true)).toBe(true);
  expect(await page.evaluate(authoritativeSnapshot)).toBe(before);
  expect(failures).toEqual([]);
});

test('Settings remains vertically reachable at reduced viewport height with keyboard scrolling', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.setViewportSize({ width: 760, height: 420 });
  await ready(page);
  await page.getByRole('button', { name: /settings/i }).click();

  const section = page.locator('#vectorLayerDebugSection');
  const reset = section.getByRole('button', { name: 'Reset defaults' });
  await reset.scrollIntoViewIfNeeded();
  await reset.focus();
  await page.keyboard.press('End');
  await expect(reset).toBeVisible();

  const scrollEvidence = await page.evaluate(() => {
    const modal = document.getElementById('settingsModal');
    const scroller = modal?.querySelector('.modal-card, .settings-content, .modal-content') || modal;
    const style = scroller ? getComputedStyle(scroller) : null;
    return { overflowY: style?.overflowY || '', clientHeight: scroller?.clientHeight || 0, scrollHeight: scroller?.scrollHeight || 0 };
  });
  expect(['auto', 'scroll']).toContain(scrollEvidence.overflowY);
  expect(scrollEvidence.scrollHeight).toBeGreaterThan(scrollEvidence.clientHeight);
  expect(failures).toEqual([]);
});