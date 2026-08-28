import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.RegionTerrain?.generateRegion && window.Game?.WorldComposition?.composeRegion));
}

test('world composition is deterministic and Simulation-owned across unbounded coordinates', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.WorldComposition;
    const seed = window.Game.State.world.seed;
    const points = [[0,0],[1,-1],[37,-42],[-250,401]];
    return points.map(([x,y]) => {
      const a = api.composeRegion(seed,x,y);
      const b = api.composeRegion(seed,x,y);
      return { a, b };
    });
  });
  for (const {a,b} of evidence) {
    expect(a).toEqual(b);
    expect(a.authority).toBe('simulation');
    expect(a.regionX).toBeDefined();
    expect(a.baseFingerprint).toBeTruthy();
  }
  expect(evidence[0].a.settlement?.type).toBe('village');
});

test('representative region sample contains settlement and environment diversity', async ({ page }) => {
  await ready(page);
  const sample = await page.evaluate(() => {
    const api = window.Game.WorldComposition;
    const seed = window.Game.State.world.seed;
    const regions = [];
    for (let y=-8;y<=8;y++) for (let x=-8;x<=8;x++) regions.push(api.composeRegion(seed,x,y));
    return regions;
  });
  const types = new Set(sample.map(r => r.settlement?.type).filter(Boolean));
  expect(types.has('village')).toBe(true);
  expect(types.has('town')).toBe(true);
  expect(types.has('city')).toBe(true);
  expect(types.has('fortified-town') || types.has('castle')).toBe(true);
  const features = new Set(sample.flatMap(r => r.environmentFeatures));
  expect(features.size).toBeGreaterThanOrEqual(3);
  expect(sample.some(r => Object.values(r.connections.roads).some(Boolean))).toBe(true);
});

test('shared road edges agree between neighboring regions', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.WorldComposition;
    const seed = window.Game.State.world.seed;
    const pairs=[];
    for (let y=-3;y<=3;y++) for (let x=-3;x<=3;x++) {
      const c=api.composeRegion(seed,x,y);
      const e=api.composeRegion(seed,x+1,y);
      const s=api.composeRegion(seed,x,y+1);
      pairs.push([c.connections.roads.east,e.connections.roads.west,c.connections.roads.south,s.connections.roads.north]);
    }
    return pairs;
  });
  expect(evidence.every(([e,w,s,n]) => e===w && s===n)).toBe(true);
});

test('same coordinates with different compatible SEED can vary base composition', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.WorldComposition;
    const a=[]; const b=[];
    for (let y=-4;y<=4;y++) for (let x=-4;x<=4;x++) {
      a.push(api.composeRegion('composition-seed-a',x,y));
      b.push(api.composeRegion('composition-seed-b',x,y));
    }
    return {a,b};
  });
  expect(evidence.a.some((r,i) => JSON.stringify(r) !== JSON.stringify(evidence.b[i]))).toBe(true);
});