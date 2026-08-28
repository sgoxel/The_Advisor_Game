import { test, expect } from '@playwright/test';

async function waitForEcology(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.Ecology?.composeRegion &&
    window.Game?.WorldComposition?.composeRegion &&
    window.Game?.State?.world?.seed
  ));
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
  await waitForEcology(page);
  const evidence = await page.evaluate(() => {
    const ecology = window.Game.Ecology;
    const seed = window.Game.State.world.seed;
    const categories = new Set();
    const species = new Set();
    const fantasyCategories = new Set();
    const habitats = new Set();
    let total = 0;
    for (let y = -12; y <= 12; y += 1) {
      for (let x = -12; x <= 12; x += 1) {
        const state = ecology.composeRegion(seed, x, y);
        for (const creature of state.creatures) {
          total += 1;
          categories.add(creature.category);
          species.add(creature.species);
          habitats.add(creature.habitat);
          if (!['domestic', 'wild'].includes(creature.category)) fantasyCategories.add(creature.category);
        }
      }
    }
    return { categories: [...categories], species: [...species], fantasyCategories: [...fantasyCategories], habitats: [...habitats], total };
  });
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
