import { test, expect } from '@playwright/test';

function summarize(npcs, originBinding) {
  const rowOffset = Number(originBinding?.rowOffset || 0);
  const colOffset = Number(originBinding?.colOffset || 0);
  const positions = npcs.map((npc) => ({
    id: npc.id,
    row: Number(npc.row),
    col: Number(npc.col),
    localRow: Number(npc.localRow),
    localCol: Number(npc.localCol)
  }));
  const keys = positions.map((npc) => `${npc.localRow},${npc.localCol}`);
  const rows = positions.map((npc) => npc.localRow);
  const cols = positions.map((npc) => npc.localCol);
  return {
    count: positions.length,
    uniqueCount: new Set(keys).size,
    allInteger: positions.every((npc) => Number.isInteger(npc.localRow) && Number.isInteger(npc.localCol)),
    allInBounds: positions.every((npc) => npc.localRow >= 0 && npc.localRow < 100 && npc.localCol >= 0 && npc.localCol < 100),
    zeroZeroCount: positions.filter((npc) => npc.localRow === 0 && npc.localCol === 0).length,
    bindingConsistent: positions.every((npc) => (
      npc.row === npc.localRow + rowOffset && npc.col === npc.localCol + colOffset
    )),
    rowSpan: positions.length ? Math.max(...rows) - Math.min(...rows) : 0,
    colSpan: positions.length ? Math.max(...cols) - Math.min(...cols) : 0,
    signature: positions.map((npc) => `${npc.id}:${npc.localRow},${npc.localCol}`).join('|')
  };
}

test('untouched production startup keeps all NPCs collision-safe and spatially distributed across render frames', async ({ page }) => {
  await page.goto('./');

  // No NPCSpatial.updateAt(), no test-created village and no state mutation is allowed
  // before the observed assertions. This follows the same path as the public Pages build.
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.originVillage?.population?.length &&
    window.Game?.NPCRuntimeBridge?.installed &&
    Array.isArray(window.Game.State.world.npcs) &&
    window.Game.State.world.npcs.length === window.Game.State.world.originVillage.population.length
  ), null, { timeout: 25_000 });

  await page.waitForFunction(() => window.Game.NPCRuntimeBridge.validSpatialPopulation(), null, { timeout: 25_000 });

  const first = await page.evaluate(() => {
    const world = window.Game.State.world;
    return {
      populationCount: world.originVillage.population.length,
      bridgeInstalled: window.Game.NPCRuntimeBridge.installed,
      valid: window.Game.NPCRuntimeBridge.validSpatialPopulation(),
      originBinding: world.npcRuntime?.originBinding,
      npcs: world.npcs.map((npc) => ({ id: npc.id, row: npc.row, col: npc.col, localRow: npc.localRow, localCol: npc.localCol }))
    };
  });

  // Let the legacy and compatibility render wrappers run for many real frames. The
  // regression is specifically that a later wrapper used to overwrite the spatial result.
  await page.waitForTimeout(750);

  const second = await page.evaluate(() => {
    const world = window.Game.State.world;
    return {
      populationCount: world.originVillage.population.length,
      bridgeInstalled: window.Game.NPCRuntimeBridge.installed,
      valid: window.Game.NPCRuntimeBridge.validSpatialPopulation(),
      routineClockAuthority: world.npcRuntime?.routineClockAuthority,
      originBinding: world.npcRuntime?.originBinding,
      npcs: world.npcs.map((npc) => ({ id: npc.id, row: npc.row, col: npc.col, localRow: npc.localRow, localCol: npc.localCol }))
    };
  });

  const a = summarize(first.npcs, first.originBinding);
  const b = summarize(second.npcs, second.originBinding);

  expect(first.bridgeInstalled).toBe(true);
  expect(second.bridgeInstalled).toBe(true);
  expect(first.valid).toBe(true);
  expect(second.valid).toBe(true);
  expect(a.count).toBe(first.populationCount);
  expect(b.count).toBe(second.populationCount);
  expect(a.uniqueCount).toBe(a.count);
  expect(b.uniqueCount).toBe(b.count);
  expect(a.allInteger).toBe(true);
  expect(b.allInteger).toBe(true);
  expect(a.allInBounds).toBe(true);
  expect(b.allInBounds).toBe(true);
  expect(a.bindingConsistent).toBe(true);
  expect(b.bindingConsistent).toBe(true);
  expect(a.zeroZeroCount).toBe(0);
  expect(b.zeroZeroCount).toBe(0);
  expect(a.rowSpan).toBeGreaterThanOrEqual(10);
  expect(a.colSpan).toBeGreaterThanOrEqual(10);
  expect(b.rowSpan).toBeGreaterThanOrEqual(10);
  expect(b.colSpan).toBeGreaterThanOrEqual(10);
  expect(second.routineClockAuthority).toBe('Game.GameTime');
});
