import { test, expect } from '@playwright/test';

async function waitForProgression(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.seed &&
    window.Game?.GameTime?.setForTest &&
    window.Game?.CampaignCalendar?.capture &&
    window.Game?.RegionTimeProgression?.progressInactive &&
    window.Game?.WorldHierarchy?.refinementInput &&
    window.Game?.WorldDeltaPersistence?.reconstructRegion &&
    window.Game?.CampaignPersistence?.loadSave
  ));
}

test('inactive regions advance from authoritative game time without full-detail ticking', async ({ page }) => {
  await waitForProgression(page);
  const evidence = await page.evaluate(() => {
    const time = window.Game.GameTime;
    const progression = window.Game.RegionTimeProgression;
    const deltas = window.Game.WorldDeltaPersistence;
    time.stop();
    deltas.clearAll();
    time.setForTest(480);
    const active = progression.markActive(2, -3);
    time.setForTest(660);
    const inactive = progression.progressInactive(2, -3);
    return { active, inactive, stored: progression.capture(2, -3) };
  });

  expect(evidence.active.authority).toBe('simulation');
  expect(evidence.active.mode).toBe('active-high-detail');
  expect(evidence.inactive.mode).toBe('inactive-aggregate');
  expect(evidence.inactive.advancedGameMinutes).toBe(180);
  expect(evidence.inactive.totalElapsedGameMinutes).toBe(180);
  expect(evidence.inactive.coarseTicks).toBe(3);
  expect(evidence.inactive.fullDetailReplayTicks).toBe(0);
  expect(evidence.inactive.materializedLocalEntities).toBe(0);
  expect(evidence.inactive.hierarchy.world.id).toMatch(/^world:/);
  expect(evidence.inactive.hierarchy.realm.id).toMatch(/^realm:/);
  expect(evidence.inactive.hierarchy.region.id).toBe('region:2:-3');
  expect(evidence.stored.lastSimulatedGameMinute).toBe(660);
});

test('returning to a region reconstructs persistent deltas after elapsed off-screen time', async ({ page }) => {
  await waitForProgression(page);
  const evidence = await page.evaluate(() => {
    const time = window.Game.GameTime;
    const progression = window.Game.RegionTimeProgression;
    const deltas = window.Game.WorldDeltaPersistence;
    time.stop();
    deltas.clearAll();
    time.setForTest(1000);
    progression.markActive(-1, 2);
    deltas.recordEntityDelta(-1, 2, 'npc:elapsed:merchant', { activity: 'market', stamina: 64 });
    deltas.setRegionFlag(-1, 2, 'harvestReady', false);
    time.setForTest(1125);
    const returned = progression.returnToRegion(-1, 2, { importantEntityIds: ['npc:elapsed:merchant'] });
    return {
      elapsed: returned.elapsedGameMinutes,
      mode: returned.progression.mode,
      entity: returned.region.persistentDeltas.entityChanges.find((item) => item.id === 'npc:elapsed:merchant'),
      flags: returned.region.persistentDeltas.flags,
      local: returned.local,
      hierarchy: returned.hierarchy,
      fullDetailReplayTicks: returned.fullDetailReplayTicks,
      materializedOffscreenRegions: returned.materializedOffscreenRegions
    };
  });

  expect(evidence.elapsed).toBe(125);
  expect(evidence.mode).toBe('active-high-detail');
  expect(evidence.entity).toMatchObject({ id: 'npc:elapsed:merchant', state: { activity: 'market', stamina: 64 } });
  expect(evidence.flags.harvestReady).toBe(false);
  expect(evidence.local.authority).toBe('simulation');
  expect(evidence.local.detailPolicy).toBe('active-with-retained-important-detail');
  expect(evidence.hierarchy.region.id).toBe('region:-1:2');
  expect(evidence.fullDetailReplayTicks).toBe(0);
  expect(evidence.materializedOffscreenRegions).toBe(0);
});

test('region progression survives campaign save/load and rejects backwards time', async ({ page }) => {
  await waitForProgression(page);
  const evidence = await page.evaluate(() => {
    const time = window.Game.GameTime;
    const progression = window.Game.RegionTimeProgression;
    const deltas = window.Game.WorldDeltaPersistence;
    const persistence = window.Game.CampaignPersistence;
    time.stop();
    deltas.clearAll();
    time.setForTest(300);
    progression.markActive(4, 5);
    time.setForTest(420);
    progression.progressInactive(4, 5);
    const saved = persistence.serializeSave();
    deltas.clearAll();
    const loaded = persistence.loadSave(saved);
    const restored = progression.capture(4, 5);
    let backwardsRejected = false;
    try { progression.progressInactive(4, 5, 419); } catch (error) { backwardsRejected = error instanceof RangeError; }
    return { loadedOk: loaded.ok, restored, backwardsRejected };
  });

  expect(evidence.loadedOk).toBe(true);
  expect(evidence.restored.authority).toBe('simulation');
  expect(evidence.restored.mode).toBe('inactive-aggregate');
  expect(evidence.restored.lastSimulatedGameMinute).toBe(420);
  expect(evidence.restored.totalElapsedGameMinutes).toBe(120);
  expect(evidence.restored.hierarchy.region.id).toBe('region:4:5');
  expect(evidence.backwardsRejected).toBe(true);
});

test('lazy catch-up consumes authoritative campaign chronology and refines hierarchy only when relevant', async ({ page }) => {
  await waitForProgression(page);
  const evidence = await page.evaluate(() => {
    const time = window.Game.GameTime;
    const progression = window.Game.RegionTimeProgression;
    const deltas = window.Game.WorldDeltaPersistence;
    time.stop();
    deltas.clearAll();
    time.setForTest(1440);
    progression.markActive(18, -17);
    time.setForTest(4320);
    const caughtUp = progression.catchUpInactive(18, -17);
    const beforeMaterialize = progression.capture(18, -17);
    const materialized = progression.materializeRelevantRegion(18, -17);
    return {
      caughtUp,
      beforeMaterialize,
      materialized: {
        elapsed: materialized.elapsedGameMinutes,
        localLevel: materialized.local.level,
        regionId: materialized.hierarchy.region.id,
        realmId: materialized.hierarchy.realm.id,
        presentationAuthority: materialized.local.presentationAuthority,
        fullDetailReplayTicks: materialized.fullDetailReplayTicks,
        materializedOffscreenRegions: materialized.materializedOffscreenRegions
      }
    };
  });

  expect(evidence.caughtUp.advancedGameMinutes).toBe(2880);
  expect(evidence.caughtUp.campaignCalendar.dayIndex).toBe(3);
  expect(evidence.caughtUp.lazyCatchUp).toBe(true);
  expect(evidence.caughtUp.fullDetailReplayTicks).toBe(0);
  expect(evidence.caughtUp.materializedLocalEntities).toBe(0);
  expect(evidence.beforeMaterialize.mode).toBe('inactive-aggregate');
  expect(evidence.materialized.elapsed).toBe(0);
  expect(evidence.materialized.localLevel).toBe('local');
  expect(evidence.materialized.regionId).toBe('region:18:-17');
  expect(evidence.materialized.realmId).toBe('realm:1:-2');
  expect(evidence.materialized.presentationAuthority).toBe(false);
  expect(evidence.materialized.fullDetailReplayTicks).toBe(0);
  expect(evidence.materialized.materializedOffscreenRegions).toBe(0);
});

test('progression API preserves authority boundaries and coordinate validation', async ({ page }) => {
  await waitForProgression(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.RegionTimeProgression;
    let unsafeRejected = false;
    try { api.markActive(Number.MAX_SAFE_INTEGER + 10, 0); } catch (error) { unsafeRejected = error instanceof TypeError; }
    return {
      authority: api.authority,
      unsafeRejected,
      hasDirectMovement: ['movePlayer', 'moveProtagonist', 'commandNpc', 'setPlayerRegion'].some((name) => typeof api[name] === 'function')
    };
  });

  expect(evidence.authority).toBe('simulation');
  expect(evidence.unsafeRejected).toBe(true);
  expect(evidence.hasDirectMovement).toBe(false);
});
