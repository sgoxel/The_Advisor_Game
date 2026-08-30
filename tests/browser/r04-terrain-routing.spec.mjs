import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.TerrainRouting?.findPath && window.Game?.NPCTerrainRouting?.refreshRoutes));
}

function gridFixture() {
  const terrain = Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, col) => ({ type: 'grass', row, col })));
  for (let col = 1; col <= 7; col += 1) terrain[4][col] = { type: 'road', road: true, row: 4, col };
  terrain[3][4] = { type: 'lake', water: true, row: 3, col: 4 };
  terrain[2][4] = { type: 'mountain', row: 2, col: 4 };
  terrain[5][4] = { type: 'forest', tags: ['blocked'], row: 5, col: 4 };
  return terrain;
}

test('shared terrain routing avoids impossible terrain and deterministically prefers cheaper roads', async ({ page }) => {
  await ready(page);
  const terrain = gridFixture();
  const output = await page.evaluate((grid) => {
    const routeA = Game.TerrainRouting.findPath(grid, { row: 4, col: 1 }, { row: 4, col: 7 });
    const routeB = Game.TerrainRouting.findPath(JSON.parse(JSON.stringify(grid)), { row: 4, col: 1 }, { row: 4, col: 7 });
    return {
      routeA,
      routeB,
      costs: {
        road: Game.TerrainRouting.traversalCost(grid[4][2]),
        grass: Game.TerrainRouting.traversalCost(grid[1][1]),
        water: Game.TerrainRouting.traversalCost(grid[3][4]),
        mountain: Game.TerrainRouting.traversalCost(grid[2][4]),
        blockedForest: Game.TerrainRouting.traversalCost(grid[5][4])
      }
    };
  }, terrain);
  expect(output.routeA).toEqual(output.routeB);
  expect(output.routeA.every((point) => point.row === 4)).toBe(true);
  expect(output.costs.road).toBeLessThan(output.costs.grass);
  expect(output.costs.water).toBe(Infinity);
  expect(output.costs.mountain).toBe(Infinity);
  expect(output.costs.blockedForest).toBe(Infinity);
});

test('dynamic occupancy participates in route search without allowing occupied transit cells', async ({ page }) => {
  await ready(page);
  const terrain = gridFixture();
  const route = await page.evaluate((grid) => Game.TerrainRouting.findPath(
    grid,
    { row: 4, col: 1 },
    { row: 4, col: 7 },
    { occupied: new Set(['4,4']) }
  ), terrain);
  expect(route.some((point) => point.row === 4 && point.col === 4)).toBe(false);
  expect(route.length).toBeGreaterThan(0);
});

test('NPC exterior route bridge consumes authoritative terrain while preserving Simulation ownership', async ({ page }) => {
  await ready(page);
  const output = await page.evaluate(() => {
    Game.NPCSpatial?.ensureSpatialNpcs?.();
    const beforeIds = (Game.State.world.npcs || []).map((npc) => npc.id);
    const refreshed = Game.NPCTerrainRouting.refreshRoutes();
    const routing = Game.State.world.npcTerrainRouting;
    const sample = (Game.State.world.npcs || []).slice(0, 4).map((npc) => ({
      id: npc.id,
      authority: npc.authority,
      routes: npc.spatialRoutes
    }));
    return { refreshed, beforeIds, afterIds: (Game.State.world.npcs || []).map((npc) => npc.id), routing, sample };
  });
  expect(output.refreshed).toBe(true);
  expect(output.afterIds).toEqual(output.beforeIds);
  expect(output.routing).toMatchObject({ authority: 'simulation', routeSource: 'authoritative-terrain+occupancy', interiorEdgesPreserved: true });
  expect(output.routing.routedNpcCount).toBeGreaterThan(0);
  expect(output.sample.every((npc) => npc.authority === 'simulation')).toBe(true);
  expect(output.sample.every((npc) => npc.routes.homeToWork.length && npc.routes.workToSocial.length && npc.routes.socialToHome.length)).toBe(true);
});
