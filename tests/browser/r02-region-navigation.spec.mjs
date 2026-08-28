import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.RegionNavigation?.activateNeighbor &&
    window.Game?.WorldDeltaPersistence?.recordTileDelta &&
    window.Game?.RegionTerrain?.generateRegion
  ));
}

test('cardinal region activation uses authoritative SEED coordinates without finite edge', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const nav = window.Game.RegionNavigation;
    const results = [];
    nav.activate(0, 0);
    for (const direction of ['north', 'east', 'south', 'west']) {
      const before = nav.capture().currentRegion;
      const after = nav.activateNeighbor(direction);
      results.push({ direction, before, after });
    }
    const far = nav.activate(1500, -2300);
    return { results, far };
  });
  expect(evidence.results[0].after.currentRegion).toMatchObject({ x: 0, y: -1 });
  expect(evidence.results[1].after.currentRegion).toMatchObject({ x: 1, y: -1 });
  expect(evidence.results[2].after.currentRegion).toMatchObject({ x: 1, y: 0 });
  expect(evidence.results[3].after.currentRegion).toMatchObject({ x: 0, y: 0 });
  expect(evidence.far.currentRegion).toMatchObject({ x: 1500, y: -2300 });
  expect(evidence.far.activeRegionWindow.regions).toHaveLength(9);
});

test('active map window is a seamless 3x3 deterministic region mosaic', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const nav = window.Game.RegionNavigation;
    const terrain = window.Game.RegionTerrain;
    const seed = window.Game.State.world.seed;
    const built = nav.buildWindow(seed, 4, -3);
    const size = terrain.regionSize;
    const samples = [
      [0, 0], [size - 1, size - 1], [size, size],
      [size * 2, size * 2], [size * 3 - 1, size * 3 - 1]
    ].map(([row, col]) => {
      const tile = built.terrain[row][col];
      return { row, col, worldX: tile.worldX, worldY: tile.worldY, type: tile.type };
    });
    return { rows: built.rows, cols: built.cols, size, samples };
  });
  expect(evidence.rows).toBe(evidence.size * 3);
  expect(evidence.cols).toBe(evidence.size * 3);
  const xs = evidence.samples.map((sample) => sample.worldX);
  const ys = evidence.samples.map((sample) => sample.worldY);
  expect(new Set(xs).size).toBeGreaterThan(2);
  expect(new Set(ys).size).toBeGreaterThan(2);
});

test('returning to a region restores deterministic base plus persistent deltas', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const nav = window.Game.RegionNavigation;
    const deltas = window.Game.WorldDeltaPersistence;
    const seed = window.Game.State.world.seed;
    deltas.clearAll();
    const base = window.Game.RegionTerrain.generateRegion(seed, 1, 0);
    const original = base.tiles[2][3];
    const replacement = original.type === 'road' ? 'grass' : 'road';
    deltas.recordTileDelta(1, 0, 2, 3, { type: replacement, road: replacement === 'road' });
    nav.activate(1, 0);
    const first = nav.buildWindow(seed, 1, 0);
    nav.activate(-5, 9);
    nav.activate(1, 0);
    const second = nav.buildWindow(seed, 1, 0);
    const size = window.Game.RegionTerrain.regionSize;
    const row = size + 2;
    const col = size + 3;
    return {
      expected: replacement,
      first: first.terrain[row][col].type,
      second: second.terrain[row][col].type,
      current: nav.capture()
    };
  });
  expect(evidence.first).toBe(evidence.expected);
  expect(evidence.second).toBe(evidence.expected);
  expect(evidence.current.currentRegion).toMatchObject({ x: 1, y: 0 });
});

test('activation updates map/camera context but exposes no player movement command', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const nav = window.Game.RegionNavigation;
    const result = nav.activate(-2, 3);
    const world = window.Game.State.world;
    const camera = window.Game.State.camera;
    const canvas = document.getElementById('gameCanvas');
    return {
      apiKeys: Object.keys(nav),
      result,
      rows: world.rows,
      cols: world.cols,
      camera: { row: camera.row, col: camera.col },
      canvas: canvas ? canvas.getBoundingClientRect().toJSON() : null
    };
  });
  expect(evidence.apiKeys).not.toContain('movePlayer');
  expect(evidence.apiKeys).not.toContain('moveProtagonist');
  expect(evidence.rows).toBeGreaterThan(24);
  expect(evidence.cols).toBeGreaterThan(24);
  expect(evidence.camera.row).toBeGreaterThan(0);
  expect(evidence.camera.col).toBeGreaterThan(0);
  expect(evidence.canvas?.width).toBeGreaterThan(100);
  expect(evidence.canvas?.height).toBeGreaterThan(100);
});