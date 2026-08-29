import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.SpatialWorld?.generateOriginVillage), null, { timeout: 20_000 });
}

function stable(value) {
  return JSON.stringify(value);
}

function network(village) {
  return {
    roadTiles: village.roadTiles,
    paths: village.paths.map((path) => ({
      fromBuildingId: path.fromBuildingId,
      toBuildingId: path.toBuildingId,
      points: path.points
    }))
  };
}

test('starter-village road/path network is deterministic for one SEED and changes with another SEED', async ({ page }) => {
  await ready(page);

  const evidence = await page.evaluate(() => {
    const api = window.Game.SpatialWorld;
    const first = api.generateOriginVillage('R04-SEEDED-ROADS-A').village;
    const repeated = api.generateOriginVillage('R04-SEEDED-ROADS-A').village;
    const other = api.generateOriginVillage('R04-SEEDED-ROADS-B').village;

    const project = (village) => ({
      roadTiles: village.roadTiles,
      paths: village.paths.map((path) => ({
        fromBuildingId: path.fromBuildingId,
        toBuildingId: path.toBuildingId,
        points: path.points
      }))
    });

    return {
      first: project(first),
      repeated: project(repeated),
      other: project(other)
    };
  });

  expect(stable(evidence.first)).toBe(stable(evidence.repeated));
  expect(stable(evidence.first)).not.toBe(stable(evidence.other));
  expect(stable(evidence.first.roadTiles)).not.toBe(stable(evidence.other.roadTiles));
  expect(stable(evidence.first.paths)).not.toBe(stable(evidence.other.paths));

  expect(evidence.first.roadTiles.length).toBeGreaterThan(150);
  expect(evidence.first.paths.length).toBeGreaterThan(0);
  expect(evidence.first.paths.every((path) => path.points.length > 0)).toBe(true);
});
