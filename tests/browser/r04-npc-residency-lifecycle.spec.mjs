import { test, expect } from '@playwright/test';

async function ready(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCResidency?.captureAt &&
    window.Game?.NPCResidency?.recordResidentHome &&
    window.Game?.GameTime?.capture &&
    window.Game?.WorldDeltaPersistence?.capture &&
    window.Game?.State?.world?.originVillage?.population?.length
  ), null, { timeout: 20_000 });
  window.Game?.NPCResidency?.sync?.();
  return { pageErrors, consoleErrors };
}

function stable(value) {
  return JSON.stringify(value);
}

async function expectNoUnexpectedErrors(errors) {
  expect(errors.pageErrors, `page errors: ${errors.pageErrors.join('\n')}`).toEqual([]);
  expect(errors.consoleErrors.filter((line) => !/favicon/i.test(line)), `console errors: ${errors.consoleErrors.join('\n')}`).toEqual([]);
}

test('persistent starter-village NPCs have deterministic authoritative homes while transient visitors do not receive fake homes', async ({ page }) => {
  const errors = await ready(page);
  const evidence = await page.evaluate(() => {
    const world = window.Game.State.world;
    const snapshot = window.Game.NPCResidency.captureAt(
      window.Game.GameTime.capture().totalGameMinutes,
      world.seed,
      world.originVillage
    );
    return {
      populationCount: world.originVillage.population.length,
      housingIds: world.originVillage.buildings
        .filter((building) => building.role === 'housing' || building.type === 'home')
        .map((building) => building.id),
      residents: snapshot.residents,
      transients: snapshot.transientVisitors,
      repeated: window.Game.NPCResidency.captureAt(
        window.Game.GameTime.capture().totalGameMinutes,
        world.seed,
        world.originVillage
      )
    };
  });

  const housingIds = new Set(evidence.housingIds);
  expect(evidence.residents).toHaveLength(evidence.populationCount);
  expect(evidence.residents.length).toBeGreaterThan(0);
  expect(evidence.residents.every((npc) => npc.residencyType === 'resident' && npc.persistentLocal === true && npc.transient === false)).toBe(true);
  expect(evidence.residents.every((npc) => housingIds.has(npc.homeBuildingId))).toBe(true);
  expect(evidence.transients.length).toBeGreaterThanOrEqual(1);
  expect(evidence.transients.every((npc) => npc.residencyType === 'transient' && npc.persistentLocal === false && npc.homeBuildingId === null)).toBe(true);
  expect(stable({ residents: evidence.residents, transients: evidence.transients }))
    .toBe(stable({ residents: evidence.repeated.residents, transients: evidence.repeated.transientVisitors }));
  await expectNoUnexpectedErrors(errors);
});

test('traveling merchant enters, works temporarily, and leaves according to authoritative game time', async ({ page }) => {
  const errors = await ready(page);
  const samples = await page.evaluate(() => {
    const api = window.Game.NPCResidency;
    const world = window.Game.State.world;
    const village = world.originVillage;
    const times = [7 * 60 + 30, 8 * 60 + 15, 10 * 60, 16 * 60 + 30, 18 * 60];
    return times.map((time) => {
      const snapshot = api.captureAt(time, world.seed, village);
      const visitor = snapshot.transientVisitors[0];
      return {
        time,
        phase: visitor.phase,
        activity: visitor.activity,
        present: visitor.presentInVillage,
        row: visitor.row,
        col: visitor.col,
        homeBuildingId: visitor.homeBuildingId,
        temporaryActivityBuildingId: visitor.temporaryActivityBuildingId,
        authority: visitor.authority
      };
    });
  });

  expect(samples.map((sample) => sample.phase)).toEqual(['outside', 'entering', 'visiting', 'leaving', 'outside']);
  expect(samples.map((sample) => sample.present)).toEqual([false, true, true, true, false]);
  for (const sample of samples.filter((entry) => entry.present)) {
    expect(Number.isInteger(sample.row)).toBe(true);
    expect(Number.isInteger(sample.col)).toBe(true);
    expect(sample.row).toBeGreaterThanOrEqual(0);
    expect(sample.row).toBeLessThan(100);
    expect(sample.col).toBeGreaterThanOrEqual(0);
    expect(sample.col).toBeLessThan(100);
    expect(sample.authority).toBe('simulation');
    expect(sample.homeBuildingId).toBeNull();
    expect(sample.temporaryActivityBuildingId).toBeTruthy();
  }
  expect(samples[2].activity).toBe('temporary-market-work');
  await expectNoUnexpectedErrors(errors);
});

test('runtime residency state follows GameTime rather than render time', async ({ page }) => {
  const errors = await ready(page);
  const evidence = await page.evaluate(() => {
    window.Game.GameTime.stop();
    const original = window.Game.GameTime.capture();
    window.Game.GameTime.setForTest(10 * 60);
    window.Game.NPCResidency.sync();
    const market = window.Game.NPCResidency.capture();
    window.Game.GameTime.setForTest(16 * 60 + 30);
    window.Game.NPCResidency.sync();
    const leaving = window.Game.NPCResidency.capture();
    window.Game.GameTime.restore(original);
    window.Game.NPCResidency.sync();
    window.Game.GameTime.start();
    return {
      market: market.transientVisitors[0],
      leaving: leaving.transientVisitors[0]
    };
  });

  expect(evidence.market.phase).toBe('visiting');
  expect(evidence.market.activity).toBe('temporary-market-work');
  expect(evidence.leaving.phase).toBe('leaving');
  expect(evidence.leaving.activity).toBe('departing-village');
  await expectNoUnexpectedErrors(errors);
});

test('resident home reassignment persists through the existing world-delta save component and remains capacity-safe', async ({ page }) => {
  const errors = await ready(page);
  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    Game.GameTime.stop();
    const world = Game.State.world;
    const originalDelta = Game.WorldDeltaPersistence.capture(world.seed);
    const base = Game.NPCResidency.captureAt(Game.GameTime.capture().totalGameMinutes, world.seed, world.originVillage);
    const resident = base.residents[0];
    const housing = world.originVillage.buildings.filter((building) => building.role === 'housing' || building.type === 'home');
    const target = housing.find((home) => home.id !== resident.homeBuildingId);
    if (!target) throw new Error('Test requires a second authoritative home.');

    Game.NPCResidency.recordResidentHome(resident.id, target.id);
    const changed = Game.NPCResidency.capture();
    const savedDelta = Game.WorldDeltaPersistence.capture(world.seed);

    Game.WorldDeltaPersistence.clearAll();
    Game.NPCResidency.sync();
    const regenerated = Game.NPCResidency.capture();

    Game.WorldDeltaPersistence.install(savedDelta);
    Game.NPCResidency.sync();
    const restored = Game.NPCResidency.capture();

    Game.WorldDeltaPersistence.install(originalDelta);
    Game.NPCResidency.sync();
    Game.GameTime.start();

    const homeOf = (snapshot) => snapshot.residents.find((entry) => entry.id === resident.id)?.homeBuildingId || null;
    return {
      residentId: resident.id,
      baseHome: resident.homeBuildingId,
      targetHome: target.id,
      changedHome: homeOf(changed),
      regeneratedHome: homeOf(regenerated),
      restoredHome: homeOf(restored),
      savedEntity: savedDelta.regions
        .find((region) => region.regionX === 0 && region.regionY === 0)?.entityChanges
        .find((change) => change.id === `npc-residency:${resident.id}`) || null
    };
  });

  expect(evidence.targetHome).not.toBe(evidence.baseHome);
  expect(evidence.changedHome).toBe(evidence.targetHome);
  expect(evidence.regeneratedHome).toBe(evidence.baseHome);
  expect(evidence.restoredHome).toBe(evidence.targetHome);
  expect(evidence.savedEntity?.state).toMatchObject({ kind: 'r04-npc-residency-v1', homeBuildingId: evidence.targetHome });
  await expectNoUnexpectedErrors(errors);
});
