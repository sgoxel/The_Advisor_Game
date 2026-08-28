import { test, expect } from '@playwright/test';

async function waitForHierarchy(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.WorldHierarchy?.refinementInput &&
    window.Game?.WorldComposition?.composeRegion &&
    window.Game?.RegionTerrain?.generateRegion
  ));
}

test('global-to-local hierarchy is deterministic, Simulation-owned and compact', async ({ page }) => {
  await waitForHierarchy(page);
  const evidence = await page.evaluate(() => {
    const h = window.Game.WorldHierarchy;
    const seed = 'hierarchy-seed';
    const minutes = 1440 * 37 + 480;
    const a = h.refinementInput(seed, 21, -17, minutes, { changed: 'bridge-repaired' });
    const b = h.refinementInput(seed, 21, -17, minutes, { changed: 'bridge-repaired' });
    return { a, b };
  });

  expect(evidence.a).toEqual(evidence.b);
  expect(evidence.a.authority).toBe('simulation');
  expect(evidence.a.world.level).toBe('world');
  expect(evidence.a.realm.level).toBe('realm');
  expect(evidence.a.region.level).toBe('region');
  expect(evidence.a.realm.parentId).toBe(evidence.a.world.id);
  expect(evidence.a.region.parentId).toBe(evidence.a.realm.id);
  expect(evidence.a.world.materializedLocalEntities).toBe(false);
  expect(evidence.a.realm.materializedLocalEntities).toBe(false);
  expect(evidence.a.region.materializedLocalEntities).toBe(false);
  expect(evidence.a.world.presentationAuthority).toBe(false);
});

test('refinement is reproducible for far coordinates and independent of visit order', async ({ page }) => {
  await waitForHierarchy(page);
  const evidence = await page.evaluate(() => {
    const h = window.Game.WorldHierarchy;
    const seed = 'unbounded-hierarchy-seed';
    const time = 1440 * 91;
    const firstTarget = h.refinementInput(seed, 1000000, -1000000, time, { event: 4 });
    h.refinementInput(seed, -3, 8, time, { irrelevantVisit: true });
    h.refinementInput(seed, 500, 500, time, {});
    const secondTarget = h.refinementInput(seed, 1000000, -1000000, time, { event: 4 });
    return { firstTarget, secondTarget };
  });

  expect(evidence.firstTarget).toEqual(evidence.secondTarget);
  expect(evidence.firstTarget.region.regionX).toBe(1000000);
  expect(evidence.firstTarget.region.regionY).toBe(-1000000);
  expect(evidence.firstTarget.refinementKey).toMatch(/^[0-9a-f]{8}$/);
});

test('higher-level aggregate state constrains refinement without full local materialization', async ({ page }) => {
  await waitForHierarchy(page);
  const evidence = await page.evaluate(() => {
    const h = window.Game.WorldHierarchy;
    const r = h.refinementInput('aggregate-seed', 0, 0, 1440 * 12, { persistentDeltaCount: 2 });
    const local = h.materializeLocal(r, { importantEntityIds: ['npc:b', 'npc:a'] });
    return { r, local };
  });

  for (const level of ['world', 'realm', 'region']) {
    const aggregate = evidence.r[level].aggregate;
    expect(typeof aggregate.prosperity).toBe('number');
    expect(typeof aggregate.security).toBe('number');
    expect(typeof aggregate.unrest).toBe('number');
  }
  expect(evidence.local.authority).toBe('simulation');
  expect(evidence.local.level).toBe('local');
  expect(evidence.local.importantEntityIds).toEqual(['npc:a', 'npc:b']);
  expect(evidence.local.presentationAuthority).toBe(false);
});

test('significant local outcomes expose deterministic upward aggregate signals', async ({ page }) => {
  await waitForHierarchy(page);
  const evidence = await page.evaluate(() => {
    const h = window.Game.WorldHierarchy;
    const refinement = h.refinementInput('outcome-seed', 2, 3, 1440 * 4, {});
    const positive = h.propagateLocalOutcome(refinement, { kind: 'prosperity', magnitude: 12 });
    const unrest = h.propagateLocalOutcome(refinement, { kind: 'unrest', magnitude: 8 });
    return { refinement, positive, unrest };
  });

  expect(evidence.positive.authority).toBe('simulation');
  expect(evidence.positive.sourceLevel).toBe('local');
  expect(evidence.positive.updatedRegionAggregate.prosperity)
    .toBeGreaterThanOrEqual(evidence.refinement.region.aggregate.prosperity);
  expect(evidence.positive.realmSignal.magnitude).toBe(6);
  expect(evidence.positive.worldSignal.magnitude).toBe(3);
  expect(evidence.unrest.updatedRegionAggregate.unrest)
    .toBeGreaterThanOrEqual(evidence.refinement.region.aggregate.unrest);
});

test('hierarchy surface exposes no direct protagonist or NPC control API', async ({ page }) => {
  await waitForHierarchy(page);
  const evidence = await page.evaluate(() => {
    const h = window.Game.WorldHierarchy;
    return {
      authority: h.authority,
      hasDirectControl: ['movePlayer', 'moveNpc', 'commandNpc', 'controlNpc', 'teleport', 'setPlayerPosition']
        .some((name) => typeof h[name] === 'function')
    };
  });
  expect(evidence.authority).toBe('simulation');
  expect(evidence.hasDirectControl).toBe(false);
});
