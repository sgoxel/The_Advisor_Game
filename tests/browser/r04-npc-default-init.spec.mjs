import { test, expect } from '@playwright/test';

const EXPECTED_OPTIONAL_MAP_404S = [
  '/map/ISOMETRIC_MAP_30032026.js',
  '/map/ISOMETRIC_MAP_30032026/ISOMETRIC_MAP_30032026.js',
  '/map/map.js'
];

function isExpectedOptionalMap404(message) {
  if (message.type() !== 'error') return false;
  const text = message.text();
  const locationUrl = message.location().url || '';
  if (!text.includes('Failed to load resource') || !text.includes('404')) return false;
  try {
    return EXPECTED_OPTIONAL_MAP_404S.includes(new URL(locationUrl).pathname);
  } catch {
    return false;
  }
}

test('normal startup resolves the full active NPC population without occupancy exhaustion', async ({ page }) => {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !isExpectedOptionalMap404(message)) {
      failures.push(`console.error: ${message.text()}`);
    }
  });

  await page.goto('./');
  await page.waitForFunction(() => {
    const world = window.Game?.State?.world;
    return Boolean(
      world?.originVillage?.population?.length &&
      world?.npcs?.length === world.originVillage.population.length &&
      window.Game?.NPCSpatial?.capture
    );
  });

  await page.waitForTimeout(750);

  const snapshot = await page.evaluate(() => {
    const world = window.Game.State.world;
    const npcs = window.Game.NPCSpatial.capture();
    return {
      populationCount: world.originVillage.population.length,
      npcCount: npcs.length,
      positions: npcs.map((npc) => ({ id: npc.id, row: npc.row, col: npc.col })),
      regionSize: window.Game.NPCSpatial.regionSize,
      spatialVersion: window.Game.NPCSpatial.version
    };
  });

  expect(snapshot.spatialVersion).toBe('admin-100x100-npc-spatial-v1');
  expect(snapshot.npcCount).toBe(snapshot.populationCount);
  expect(snapshot.npcCount).toBeGreaterThanOrEqual(20);
  expect(snapshot.positions.every(({ row, col }) => Number.isInteger(row) && Number.isInteger(col))).toBe(true);
  expect(snapshot.positions.every(({ row, col }) => row >= 0 && row < snapshot.regionSize && col >= 0 && col < snapshot.regionSize)).toBe(true);
  expect(new Set(snapshot.positions.map(({ row, col }) => `${row},${col}`)).size).toBe(snapshot.npcCount);
  expect(failures.filter((failure) => failure.includes('No collision-safe tile available'))).toEqual([]);
  expect(failures).toEqual([]);
});
