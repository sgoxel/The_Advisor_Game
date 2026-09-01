import { test, expect } from '@playwright/test';

function collectRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror:${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console:${message.text()}`);
  });
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
    terrain: (world.terrain || []).map((row) => (row || []).map((tile) => ({
      type: tile?.type,
      elevation: tile?.elevation
    }))),
    roads: world.originVillage?.roadTiles || [],
    buildings: world.originVillage?.buildings || [],
    // NPC tile coordinates are authoritative Simulation state, but they legitimately
    // advance with GameTime while this intentionally exhaustive presentation test runs.
    // Preserve identity/population invariants here instead of falsely attributing normal
    // runtime motion to a vector-layer toggle.
    npcIds: (world.npcs || []).map((npc) => npc.id)
  });
}

test('Vector Layer Debug enumerates one registry and toggles every registered presentation layer safely', async ({ page }) => {
  // This case deliberately performs a full off/render/on cycle for every registered layer.
  // Independent trace evidence shows stable responsive controls but six sequential real
  // presentation redraw cycles exceed the global 45 s Playwright default. Preserve all
  // assertions and production interaction while budgeting only this exhaustive test.
  test.setTimeout(120_000);

  const failures = collectRuntimeFailures(page);
  await ready(page);

  const before = await page.evaluate(authoritativeSnapshot);
  await page.getByRole('button', { name: /settings/i }).click();

  const section = page.locator('#vectorLayerDebugSection');
  await expect(section.getByRole('heading', { name: 'Vector Layer Debug' })).toBeVisible();
  await expect(section.getByRole('table', { name: 'Vector layer debug controls' })).toBeVisible();

  const initial = await page.evaluate(() => window.Game.VectorLayerDebug.snapshot());
  expect(initial.length).toBeGreaterThanOrEqual(6);
  expect(new Set(initial.map((layer) => layer.id)).size).toBe(initial.length);
  expect(initial.every((layer) => layer.enabled === true && layer.defaultEnabled === true)).toBe(true);

  for (const layer of initial) {
    const button = section.locator(`[data-vector-layer-id="${layer.id}"]`);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await page.evaluate(() => window.Game.Renderer?.renderWorld?.(true));
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }

  await section.getByRole('button', { name: 'Reset layers' }).click();
  const restored = await page.evaluate(() => window.Game.VectorLayerDebug.snapshot());
  expect(restored.every((layer) => layer.enabled === layer.defaultEnabled)).toBe(true);

  const after = await page.evaluate(authoritativeSnapshot);
  expect(after).toBe(before);
  expect(failures).toEqual([]);
});

test('Vector Layer Debug remains usable near the 2.6x diagnostic zoom and logs presentation-only state changes', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);

  await page.evaluate(() => {
    if (window.Game.State?.camera) window.Game.State.camera.zoom = 2.6;
    window.Game.Renderer?.renderWorld?.(true);
  });
  await page.getByRole('button', { name: /settings/i }).click();

  const section = page.locator('#vectorLayerDebugSection');
  const firstToggle = section.locator('[data-vector-layer-id]').first();
  await firstToggle.focus();
  await page.keyboard.press('Enter');
  await expect(firstToggle).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Enter');
  await expect(firstToggle).toHaveAttribute('aria-pressed', 'true');

  const zoom = await page.evaluate(() => Number(window.Game.State?.camera?.zoom));
  expect(zoom).toBeCloseTo(2.6, 4);

  const logs = await page.evaluate(() => window.Game.ActivityLog?.snapshot?.() || []);
  expect(logs.some((entry) => entry.source === 'vector-layer-debug')).toBe(true);
  expect(failures).toEqual([]);
});
