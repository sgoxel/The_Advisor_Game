import { test, expect } from '@playwright/test';

const ECOLOGY_SCAN_MIN = -12;
const ECOLOGY_SCAN_MAX = 12;
const ECOLOGY_SCAN_BATCH_ROWS = 5;
const ECOLOGY_SCAN_BATCH_BUDGET_MS = 30_000;
const ECOLOGY_SCAN_TEST_TIMEOUT_MS = 120_000;

async function waitForEcology(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.Ecology?.composeRegion &&
    window.Game?.WorldComposition?.composeRegion &&
    window.Game?.State?.world?.seed
  ));
}

async function installEcologyCoverageNoiseMemo(page) {
  await page.evaluate(() => {
    const rng = window.Game?.RNG;
    if (!rng?.hashNoise || !rng?.normalizeSeed) throw new Error('Game.RNG deterministic noise contract is required.');
    if (window.__ecologyCoverageNoiseMemo) throw new Error('Ecology coverage noise memo is already installed.');

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

    window.__ecologyCoverageNoiseMemo = { originalHashNoise, cache, stats };
  });
}

async function restoreEcologyCoverageNoiseMemo(page) {
  return page.evaluate(() => {
    const harness = window.__ecologyCoverageNoiseMemo;
    if (!harness) return { hits: 0, misses: 0, entries: 0 };
    if (window.Game?.RNG) window.Game.RNG.hashNoise = harness.originalHashNoise;
    const result = { ...harness.stats, entries: harness.cache.size };
    delete window.__ecologyCoverageNoiseMemo;
    return result;
  });
}

test('same SEED and coordinates reproduce equivalent Simulation ecology state', async ({ page }) => {
  await waitForEcology(page);
  const evidence = await page.evaluate(() => {
    const ecology = window.Game.Ecology;
    const seed = window.Game.State.world.seed;
    const first = ecology.composeRegion(seed, 3, -4);
    const second = ecology.composeRegion(seed, 3, -4);
    const other = ecology.composeRegion(`${seed}-other`, 3, -4);
    return { first, second, other };
  });
  expect(evidence.first).toEqual(evidence.second);
  expect(evidence.first.authority).toBe('simulation');
  expect(evidence.first.regionX).toBe(3);
  expect(evidence.first.regionY).toBe(-4);
  expect(JSON.stringify(evidence.other)).not.toBe(JSON.stringify(evidence.first));
});

test('representative scanned regions expose domestic, wild and original fantasy ecology tied to habitat', async ({ page }) => {
  test.setTimeout(ECOLOGY_SCAN_TEST_TIMEOUT_MS);
  await waitForEcology(page);

  const categories = new Set();
  const species = new Set();
  const fantasyCategories = new Set();
  const habitats = new Set();
  let total = 0;
  let visitedRegions = 0;
  const batchDurationsMs = [];
  let noiseMemoStats = { hits: 0, misses: 0, entries: 0 };

  // The terrain generator repeatedly asks for identical deterministic lattice-noise points
  // while scanning adjacent regions. Memoizing only those exact hashNoise calls keeps every
  // real Ecology -> WorldComposition -> RegionTerrain path and output intact, while removing
  // redundant test-harness CPU work that otherwise leaves Playwright inside one sync task.
  await installEcologyCoverageNoiseMemo(page);
  try {
    for (let startY = ECOLOGY_SCAN_MIN; startY <= ECOLOGY_SCAN_MAX; startY += ECOLOGY_SCAN_BATCH_ROWS) {
      const endY = Math.min(ECOLOGY_SCAN_MAX, startY + ECOLOGY_SCAN_BATCH_ROWS - 1);
      const batch = await page.evaluate(({ minX, maxX, startY: batchStartY, endY: batchEndY }) => {
        const ecology = window.Game.Ecology;
        const seed = window.Game.State.world.seed;
        const batchCategories = new Set();
        const batchSpecies = new Set();
        const batchFantasyCategories = new Set();
        const batchHabitats = new Set();
        let batchTotal = 0;
        let batchVisitedRegions = 0;
        const startedAt = performance.now();

        for (let y = batchStartY; y <= batchEndY; y += 1) {
          for (let x = minX; x <= maxX; x += 1) {
            const state = ecology.composeRegion(seed, x, y);
            batchVisitedRegions += 1;
            for (const creature of state.creatures) {
              batchTotal += 1;
              batchCategories.add(creature.category);
              batchSpecies.add(creature.species);
              batchHabitats.add(creature.habitat);
              if (!['domestic', 'wild'].includes(creature.category)) batchFantasyCategories.add(creature.category);
            }
          }
        }

        return {
          categories: [...batchCategories],
          species: [...batchSpecies],
          fantasyCategories: [...batchFantasyCategories],
          habitats: [...batchHabitats],
          total: batchTotal,
          visitedRegions: batchVisitedRegions,
          durationMs: performance.now() - startedAt
        };
      }, { minX: ECOLOGY_SCAN_MIN, maxX: ECOLOGY_SCAN_MAX, startY, endY });

      batch.categories.forEach((value) => categories.add(value));
      batch.species.forEach((value) => species.add(value));
      batch.fantasyCategories.forEach((value) => fantasyCategories.add(value));
      batch.habitats.forEach((value) => habitats.add(value));
      total += batch.total;
      visitedRegions += batch.visitedRegions;
      batchDurationsMs.push(batch.durationMs);
    }
  } finally {
    if (!page.isClosed()) noiseMemoStats = await restoreEcologyCoverageNoiseMemo(page);
  }

  const evidence = {
    categories: [...categories],
    species: [...species],
    fantasyCategories: [...fantasyCategories],
    habitats: [...habitats],
    total,
    visitedRegions,
    batchDurationsMs,
    noiseMemoStats
  };

  expect(evidence.visitedRegions).toBe((ECOLOGY_SCAN_MAX - ECOLOGY_SCAN_MIN + 1) ** 2);
  expect(evidence.noiseMemoStats.hits).toBeGreaterThan(0);
  expect(evidence.noiseMemoStats.misses).toBeGreaterThan(0);
  for (const durationMs of evidence.batchDurationsMs) expect(durationMs).toBeLessThan(ECOLOGY_SCAN_BATCH_BUDGET_MS);
  expect(evidence.total).toBeGreaterThan(20);
  expect(evidence.categories).toContain('domestic');
  expect(evidence.categories).toContain('wild');
  expect(evidence.fantasyCategories.length).toBeGreaterThanOrEqual(3);
  expect(evidence.habitats.length).toBeGreaterThan(3);
  expect(evidence.species.some((s) => ['cattle', 'chicken', 'dog', 'cat', 'horse', 'sheep', 'goat'].includes(s))).toBe(true);
  expect(evidence.species.some((s) => ['deer', 'boar', 'hare', 'wolf', 'fox', 'owl'].includes(s))).toBe(true);
  expect(evidence.species.some((s) => ['mossback-grazer', 'reedkin-watcher', 'crag-maw', 'lantern-wisp'].includes(s))).toBe(true);
});

test('creatures remain Simulation-backed and advance through lightweight foundation behaviors', async ({ page }) => {
  await waitForEcology(page);
  const evidence = await page.evaluate(() => {
    const ecology = window.Game.Ecology;
    const seed = window.Game.State.world.seed;
    let state = null;
    for (let y = -10; y <= 10 && !state; y += 1) {
      for (let x = -10; x <= 10; x += 1) {
        const candidate = ecology.composeRegion(seed, x, y);
        if (candidate.creatures.length >= 2) { state = candidate; break; }
      }
    }
    const advanced = ecology.advanceFoundation(state, 180);
    return {
      original: state,
      advanced,
      directControl: ['moveCreature', 'commandCreature', 'controlCreature', 'attack'].some((name) => typeof ecology[name] === 'function')
    };
  });
  expect(evidence.original.creatures.length).toBeGreaterThan(1);
  expect(evidence.advanced.elapsedGameMinutes).toBe(180);
  for (const creature of evidence.advanced.creatures) {
    expect(creature.authority).toBe('simulation');
    expect(creature.playerControllable).toBe(false);
    expect(['idle', 'forage', 'move', 'flee', 'territorial']).toContain(creature.behavior);
  }
  expect(evidence.directControl).toBe(false);
});

test('unsafe region coordinates and negative elapsed time are rejected', async ({ page }) => {
  await waitForEcology(page);
  const evidence = await page.evaluate(() => {
    const ecology = window.Game.Ecology;
    const seed = window.Game.State.world.seed;
    let unsafeRejected = false;
    let negativeRejected = false;
    try { ecology.composeRegion(seed, Number.MAX_SAFE_INTEGER + 1, 0); } catch (error) { unsafeRejected = error instanceof TypeError; }
    const state = ecology.composeRegion(seed, 0, 0);
    try { ecology.advanceFoundation(state, -1); } catch (error) { negativeRejected = error instanceof TypeError; }
    return { unsafeRejected, negativeRejected };
  });
  expect(evidence.unsafeRejected).toBe(true);
  expect(evidence.negativeRejected).toBe(true);
});
