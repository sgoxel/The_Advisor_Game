import { test, expect } from '@playwright/test';

async function waitForProgression(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.seed &&
    window.Game?.GameTime?.setForTest &&
    window.Game?.CampaignCalendar?.capture &&
    window.Game?.RegionTimeProgression?.progressInactive &&
    window.Game?.WorldHierarchy?.refinementInput &&
    window.Game?.PoliticalGeography?.baseRegion &&
    window.Game?.SettlementEvolution?.advance &&
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
  expect(evidence.inactive.politicalGeography.authority).toBe('simulation');
  expect(evidence.inactive.politicalGeography.baseRealmId).toMatch(/^realm:/);
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
      politics: returned.politicalGeography,
      settlementEvolution: returned.settlementEvolution,
      settlementMaterialization: returned.settlementMaterialization,
      presentationAuthority: returned.presentationAuthority,
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
  expect(evidence.politics.authority).toBe('simulation');
  expect(evidence.politics.basePreserved).toBe(true);
  if (evidence.settlementEvolution) {
    expect(evidence.settlementEvolution.authority).toBe('simulation');
    expect(evidence.settlementMaterialization.authority).toBe('simulation');
  }
  expect(evidence.presentationAuthority).toBe(false);
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
  expect(evidence.restored.politicalGeography.baseRealmId).toMatch(/^realm:/);
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
        politicalRealmId: materialized.politicalGeography.baseRealmId,
        settlementStatus: materialized.settlementEvolution?.status || null,
        settlementMaterialization: materialized.settlementMaterialization,
        presentationAuthority: materialized.presentationAuthority,
        localPresentationAuthority: materialized.local.presentationAuthority,
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
  expect(evidence.caughtUp.politicalGeography.baseRealmId).toMatch(/^realm:/);
  expect(evidence.beforeMaterialize.mode).toBe('inactive-aggregate');
  expect(evidence.materialized.elapsed).toBe(0);
  expect(evidence.materialized.localLevel).toBe('local');
  expect(evidence.materialized.regionId).toBe('region:18:-17');
  expect(evidence.materialized.realmId).toBe('realm:1:-2');
  expect(evidence.materialized.politicalRealmId).toMatch(/^realm:/);
  if (evidence.materialized.settlementMaterialization) {
    expect(evidence.materialized.settlementMaterialization.authority).toBe('simulation');
    expect(evidence.materialized.settlementMaterialization.refinementKey).toBeTruthy();
  }
  expect(evidence.materialized.presentationAuthority).toBe(false);
  expect(evidence.materialized.localPresentationAuthority).toBe(false);
  expect(evidence.materialized.fullDetailReplayTicks).toBe(0);
  expect(evidence.materialized.materializedOffscreenRegions).toBe(0);
});

test('political history and accumulated settlement development survive lazy rematerialization', async ({ page }) => {
  await waitForProgression(page);
  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const time = Game.GameTime;
    const progression = Game.RegionTimeProgression;
    const deltas = Game.WorldDeltaPersistence;
    time.stop();
    deltas.clearAll();

    const seed = String(Game.State.world.seed);
    let target = null;
    for (let y = -4; y <= 4 && !target; y += 1) {
      for (let x = -4; x <= 4; x += 1) {
        if (Game.SettlementEvolution.baseState(seed, x, y)) { target = { x, y }; break; }
      }
    }
    if (!target) throw new Error('Expected a deterministic settlement in representative scan.');

    const basePolitics = Game.PoliticalGeography.baseRegion(seed, target.x, target.y);
    deltas.setRegionFlag(target.x, target.y, 'regionPoliticalHistory', {
      realmId: 'realm:campaign-override',
      provinceId: 'region-polity:campaign-override'
    });

    time.setForTest(1440);
    progression.markActive(target.x, target.y);
    time.setForTest(1440 * 12);
    progression.progressInactive(target.x, target.y);
    const before = progression.capture(target.x, target.y);
    const returned = progression.materializeRelevantRegion(target.x, target.y);
    const after = progression.capture(target.x, target.y);

    return {
      baseRealmId: basePolitics.realm.id,
      currentRealmId: returned.politicalGeography.current.realmId,
      basePreserved: returned.politicalGeography.basePreserved,
      settlementId: returned.settlementEvolution?.settlementId || null,
      history: returned.settlementEvolution?.accumulatedHistory || null,
      materialization: returned.settlementMaterialization,
      beforeHistory: before.settlementEvolution?.accumulatedHistory || null,
      afterHistory: after.settlementEvolution?.accumulatedHistory || null,
      fullDetailReplayTicks: returned.fullDetailReplayTicks
    };
  });

  expect(evidence.baseRealmId).not.toBe('realm:campaign-override');
  expect(evidence.currentRealmId).toBe('realm:campaign-override');
  expect(evidence.basePreserved).toBe(true);
  expect(evidence.settlementId).toBeTruthy();
  expect(evidence.history).toBeTruthy();
  expect(evidence.materialization.authority).toBe('simulation');
  expect(evidence.materialization.sourceBaseFingerprint).toBeTruthy();
  expect(evidence.afterHistory).toEqual(evidence.beforeHistory);
  expect(evidence.fullDetailReplayTicks).toBe(0);
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
