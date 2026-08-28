import { test, expect } from '@playwright/test';

async function loadGame(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.Game?.RegionTerrain && window.Game?.WorldCoordinates);
}

test.describe('R02-T14 deterministic multi-region terrain', () => {
  test('same seed and coordinates are reproducible independent of visit order', async ({ page }) => {
    await loadGame(page);
    const result = await page.evaluate(() => {
      const T = window.Game.RegionTerrain;
      const first = T.generateRegion('REGION-ORDER', 3, -2);
      T.generateRegion('REGION-ORDER', -9, 4);
      T.generateRegion('REGION-ORDER', 0, 0);
      const second = T.generateRegion('REGION-ORDER', 3, -2);
      return {
        first: T.fingerprint(first),
        second: T.fingerprint(second),
        region: first.region,
        boundary: first.hasGameplayFiniteBoundary
      };
    });
    expect(result.first).toBe(result.second);
    expect(result.region.x).toBe(3);
    expect(result.region.y).toBe(-2);
    expect(result.boundary).toBe(false);
  });

  test('positive and negative neighboring regions use consecutive global coordinates with coherent fields', async ({ page }) => {
    await loadGame(page);
    const result = await page.evaluate(() => {
      const T = window.Game.RegionTerrain;
      const west = T.generateRegion('REGION-EDGE', -1, 0);
      const east = T.generateRegion('REGION-EDGE', 0, 0);
      const size = T.regionSize;
      const pairs = [];
      for (let row = 0; row < size; row++) {
        const a = west.tiles[row][size - 1];
        const b = east.tiles[row][0];
        pairs.push({
          consecutive: b.worldX === a.worldX + 1 && b.worldY === a.worldY,
          elevationDelta: Math.abs(a.elevation - b.elevation),
          moistureDelta: Math.abs(a.moisture - b.moisture)
        });
      }
      return {
        westOrigin: [west.originWorldX, west.originWorldY],
        eastOrigin: [east.originWorldX, east.originWorldY],
        allConsecutive: pairs.every((pair) => pair.consecutive),
        maxElevationDelta: Math.max(...pairs.map((pair) => pair.elevationDelta)),
        maxMoistureDelta: Math.max(...pairs.map((pair) => pair.moistureDelta))
      };
    });
    expect(result.westOrigin).toEqual([-24, 0]);
    expect(result.eastOrigin).toEqual([0, 0]);
    expect(result.allConsecutive).toBe(true);
    expect(result.maxElevationDelta).toBeLessThan(0.2);
    expect(result.maxMoistureDelta).toBeLessThan(0.2);
  });

  test('distant coordinates are diverse and presentation/cache state cannot alter generated truth', async ({ page }) => {
    await loadGame(page);
    const result = await page.evaluate(() => {
      const T = window.Game.RegionTerrain;
      const seed = 'REGION-DIVERSITY';
      const before = T.generateRegion(seed, 1200, -975);
      const fingerprints = [
        T.fingerprint(T.generateRegion(seed, 0, 0)),
        T.fingerprint(T.generateRegion(seed, 51, 74)),
        T.fingerprint(T.generateRegion(seed, -83, 29)),
        T.fingerprint(before)
      ];
      window.Game.State.world.camera = { x: 999999, y: -999999, zoom: 0.01 };
      window.Game.State.world.renderCache = { region: 'fake', x: 7, y: 7 };
      const after = T.generateRegion(seed, 1200, -975);
      return {
        unique: new Set(fingerprints).size,
        stable: T.fingerprint(before) === T.fingerprint(after),
        counts: before.counts,
        authority: before.authority,
        finite: T.hasGameplayFiniteBoundary
      };
    });
    expect(result.unique).toBeGreaterThanOrEqual(3);
    expect(result.stable).toBe(true);
    expect(result.authority).toBe('simulation');
    expect(result.finite).toBe(false);
    expect(Object.values(result.counts).reduce((sum, value) => sum + value, 0)).toBe(24 * 24);
  });

  test('region data exposes terrain, elevation, biome, water and road attributes', async ({ page }) => {
    await loadGame(page);
    const summary = await page.evaluate(() => {
      const region = window.Game.RegionTerrain.generateRegion('REGION-FEATURES', 2, 2);
      const flat = region.tiles.flat();
      return {
        validTypes: flat.every((tile) => ['grass','dirt','forest','lake','river','road','mountain'].includes(tile.type)),
        elevations: flat.every((tile) => Number.isFinite(tile.elevation) && tile.elevation >= 0 && tile.elevation <= 1),
        biomes: new Set(flat.map((tile) => tile.biome)).size,
        waterFlags: flat.filter((tile) => tile.type === 'lake' || tile.type === 'river').every((tile) => tile.water),
        roadFlags: flat.filter((tile) => tile.type === 'road').every((tile) => tile.road)
      };
    });
    expect(summary.validTypes).toBe(true);
    expect(summary.elevations).toBe(true);
    expect(summary.biomes).toBeGreaterThanOrEqual(1);
    expect(summary.waterFlags).toBe(true);
    expect(summary.roadFlags).toBe(true);
  });
});
