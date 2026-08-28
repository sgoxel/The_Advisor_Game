import { test, expect } from '@playwright/test';

async function loadContract(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.WorldCoordinates && window.Game?.RNG));
}

test('campaign origin and region identity are canonical and deterministic', async ({ page }) => {
  await loadContract(page);

  const result = await page.evaluate(() => {
    const W = window.Game.WorldCoordinates;
    const a = W.describeRegion('  Kingdom-Seed  ', 0, 0);
    const b = W.describeRegion('Kingdom-Seed', '0', -0);
    return {
      origin: W.origin,
      finiteBoundary: W.hasGameplayFiniteBoundary,
      sameIdentity: a.id === b.id,
      sameGenerationSeed: a.generationSeed === b.generationSeed,
      seed: a.seed,
      x: a.x,
      y: a.y,
      descriptorFrozen: Object.isFrozen(a),
      contractFrozen: Object.isFrozen(W)
    };
  });

  expect(result.origin).toEqual({ x: 0, y: 0 });
  expect(result.finiteBoundary).toBe(false);
  expect(result.sameIdentity).toBe(true);
  expect(result.sameGenerationSeed).toBe(true);
  expect(result.seed).toBe('Kingdom-Seed');
  expect(result.x).toBe(0);
  expect(result.y).toBe(0);
  expect(result.descriptorFrozen).toBe(true);
  expect(result.contractFrozen).toBe(true);
});

test('positive and negative neighboring regions are visit-order independent', async ({ page }) => {
  await loadContract(page);

  const result = await page.evaluate(() => {
    const W = window.Game.WorldCoordinates;
    const seed = 'WORLD-ADJACENCY';
    const first = W.adjacentRegions(seed, -17, 23);

    // Deliberately request unrelated identities between equivalent lookups.
    W.describeRegion(seed, 999, -999);
    W.adjacentRegion(seed, 40, 40, 'south');

    const second = W.adjacentRegions(seed, -17, 23);
    return {
      first: Object.fromEntries(Object.entries(first).map(([key, value]) => [key, { id: value.id, x: value.x, y: value.y, generationSeed: value.generationSeed }])),
      second: Object.fromEntries(Object.entries(second).map(([key, value]) => [key, { id: value.id, x: value.x, y: value.y, generationSeed: value.generationSeed }]))
    };
  });

  expect(result.first).toEqual(result.second);
  expect(result.first.north).toMatchObject({ x: -17, y: 22 });
  expect(result.first.east).toMatchObject({ x: -16, y: 23 });
  expect(result.first.south).toMatchObject({ x: -17, y: 24 });
  expect(result.first.west).toMatchObject({ x: -18, y: 23 });
});

test('region identity ignores presentation caches and ambient randomness', async ({ page }) => {
  await loadContract(page);

  const result = await page.evaluate(() => {
    const W = window.Game.WorldCoordinates;
    const before = W.describeRegion('CACHE-INDEPENDENCE', 1250000, -1250000);

    window.Game.State.camera.x = 987654;
    window.Game.State.camera.y = -456789;
    window.Game.State.world.selected = { row: 4, col: 9 };
    window.Game.State.world.hover = { row: 7, col: 2 };
    window.Game.State.render.needsWorldRedraw = !window.Game.State.render.needsWorldRedraw;

    const originalRandom = Math.random;
    const originalNow = Date.now;
    Math.random = () => { throw new Error('authoritative region identity must not use Math.random'); };
    Date.now = () => { throw new Error('authoritative region identity must not use wall-clock time'); };
    let after;
    try {
      after = W.describeRegion('CACHE-INDEPENDENCE', 1250000, -1250000);
    } finally {
      Math.random = originalRandom;
      Date.now = originalNow;
    }

    return {
      before: { id: before.id, generationSeed: before.generationSeed, x: before.x, y: before.y },
      after: { id: after.id, generationSeed: after.generationSeed, x: after.x, y: after.y }
    };
  });

  expect(result.after).toEqual(result.before);
  expect(result.after).toMatchObject({ x: 1250000, y: -1250000 });
});

test('coordinates are never clamped to a gameplay map edge and invalid coordinates fail closed', async ({ page }) => {
  await loadContract(page);

  const result = await page.evaluate(() => {
    const W = window.Game.WorldCoordinates;
    const far = W.describeRegion('UNBOUNDED', -9000000, 9000000);
    const fartherWest = W.adjacentRegion('UNBOUNDED', far.x, far.y, 'west');
    const errors = [];
    for (const value of [1.25, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      try {
        W.describeRegion('UNBOUNDED', value, 0);
      } catch (error) {
        errors.push(error instanceof TypeError);
      }
    }
    return { far: { x: far.x, y: far.y }, fartherWest: { x: fartherWest.x, y: fartherWest.y }, errors };
  });

  expect(result.far).toEqual({ x: -9000000, y: 9000000 });
  expect(result.fartherWest).toEqual({ x: -9000001, y: 9000000 });
  expect(result.errors).toEqual([true, true, true]);
});
