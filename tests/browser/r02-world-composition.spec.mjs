import { test, expect } from '@playwright/test';

const WORLD_COMPOSITION_SCAN_TIMEOUT_MS = 120_000;

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.RegionTerrain?.generateRegion && window.Game?.WorldComposition?.composeRegion));
}

async function installWorldCompositionNoiseMemo(page) {
  await page.evaluate(() => {
    const rng = window.Game?.RNG;
    if (!rng?.hashNoise || !rng?.normalizeSeed) throw new Error('Game.RNG deterministic noise contract is required.');
    if (window.__worldCompositionNoiseMemo) throw new Error('World composition noise memo is already installed.');

    const originalHashNoise = rng.hashNoise;
    const cache = new Map();
    const stats = { hits: 0, misses: 0 };
    rng.hashNoise = function memoizedHashNoise(seedInput, row, col, salt) {
      const key = JSON.stringify([rng.normalizeSeed(seedInput), row, col, String(salt)]);
      if (cache.has(key)) {
        stats.hits += 1;
        return cache.get(key);
      }
      const value = originalHashNoise.call(rng, seedInput, row, col, salt);
      cache.set(key, value);
      stats.misses += 1;
      return value;
    };
    window.__worldCompositionNoiseMemo = { originalHashNoise, cache, stats };
  });
}

async function restoreWorldCompositionNoiseMemo(page) {
  return page.evaluate(() => {
    const harness = window.__worldCompositionNoiseMemo;
    if (!harness) return { hits: 0, misses: 0, entries: 0 };
    if (window.Game?.RNG) window.Game.RNG.hashNoise = harness.originalHashNoise;
    const result = { ...harness.stats, entries: harness.cache.size };
    delete window.__worldCompositionNoiseMemo;
    return result;
  });
}

async function withWorldCompositionNoiseMemo(page, operation) {
  await installWorldCompositionNoiseMemo(page);
  try {
    const value = await operation();
    const stats = await restoreWorldCompositionNoiseMemo(page);
    expect(stats.hits).toBeGreaterThan(0);
    expect(stats.misses).toBeGreaterThan(0);
    return value;
  } catch (error) {
    if (!page.isClosed()) await restoreWorldCompositionNoiseMemo(page);
    throw error;
  }
}

test('world composition is deterministic and Simulation-owned across unbounded coordinates', async ({ page }) => {
  test.setTimeout(WORLD_COMPOSITION_SCAN_TIMEOUT_MS);
  await ready(page);
  const evidence = await withWorldCompositionNoiseMemo(page, () => page.evaluate(() => {
    const api = window.Game.WorldComposition;
    const seed = window.Game.State.world.seed;
    const points = [[0,0],[1,-1],[37,-42],[-250,401]];
    return points.map(([x,y]) => {
      const a = api.composeRegion(seed,x,y);
      const b = api.composeRegion(seed,x,y);
      return { a, b };
    });
  }));
  for (const {a,b} of evidence) {
    expect(a).toEqual(b);
    expect(a.authority).toBe('simulation');
    expect(a.regionX).toBeDefined();
    expect(a.baseFingerprint).toBeTruthy();
  }
  expect(evidence[0].a.settlement?.type).toBe('village');
});

test('representative region sample contains settlement and environment diversity', async ({ page }) => {
  test.setTimeout(WORLD_COMPOSITION_SCAN_TIMEOUT_MS);
  await ready(page);
  const sample = await withWorldCompositionNoiseMemo(page, () => page.evaluate(() => {
    const api = window.Game.WorldComposition;
    const seed = window.Game.State.world.seed;
    const regions = [];
    for (let y=-8;y<=8;y++) for (let x=-8;x<=8;x++) regions.push(api.composeRegion(seed,x,y));
    return regions;
  }));
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
  test.setTimeout(WORLD_COMPOSITION_SCAN_TIMEOUT_MS);
  await ready(page);
  const evidence = await withWorldCompositionNoiseMemo(page, () => page.evaluate(() => {
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
  }));
  expect(evidence.every(([e,w,s,n]) => e===w && s===n)).toBe(true);
});

test('same coordinates with different compatible SEED can vary base composition', async ({ page }) => {
  test.setTimeout(WORLD_COMPOSITION_SCAN_TIMEOUT_MS);
  await ready(page);
  const evidence = await withWorldCompositionNoiseMemo(page, () => page.evaluate(() => {
    const api = window.Game.WorldComposition;
    const a=[]; const b=[];
    for (let y=-4;y<=4;y++) for (let x=-4;x<=4;x++) {
      a.push(api.composeRegion('composition-seed-a',x,y));
      b.push(api.composeRegion('composition-seed-b',x,y));
    }
    return {a,b};
  }));
  expect(evidence.a.some((r,i) => JSON.stringify(r) !== JSON.stringify(evidence.b[i]))).toBe(true);
});