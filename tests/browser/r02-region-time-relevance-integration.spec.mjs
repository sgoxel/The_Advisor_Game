import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.seed &&
    window.Game?.GameTime?.setForTest &&
    window.Game?.RegionTimeProgression?.prepareInactiveReconciliation &&
    window.Game?.RelevanceBoundedCompute?.compute &&
    window.Game?.WorldDeltaPersistence?.clearAll
  ));
}

test('inactive progression consumes relevance-bounded scheduling without scaling with irrelevant world size', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    Game.GameTime.stop();
    Game.WorldDeltaPersistence.clearAll();
    Game.GameTime.setForTest(1440);
    Game.RegionTimeProgression.markActive(3, -2);

    const smallJob = Game.RegionTimeProgression.prepareInactiveReconciliation(3, -2, 1440 * 101, { irrelevantRegionCount: 0 });
    const hugeJob = Game.RegionTimeProgression.prepareInactiveReconciliation(3, -2, 1440 * 101, { irrelevantRegionCount: 1000000 });
    const small = Game.RelevanceBoundedCompute.compute(smallJob);
    const huge = Game.RelevanceBoundedCompute.compute(hugeJob);

    Game.GameTime.setForTest(1440 * 101);
    const progressed = Game.RegionTimeProgression.progressInactive(3, -2);
    return { small, huge, progressed };
  });

  expect(evidence.small.resultFingerprint).toBe(evidence.huge.resultFingerprint);
  expect(evidence.small.workAccounting.continuousEntityTicks).toBe(0);
  expect(evidence.huge.workAccounting.continuousWorkUnits).toBe(evidence.small.workAccounting.continuousWorkUnits);
  expect(evidence.huge.workAccounting.scalesWithIrrelevantWorldSize).toBe(false);
  expect(evidence.progressed.relevanceBoundedScheduling.boundedCatchUp).toBe(true);
  expect(evidence.progressed.relevanceBoundedScheduling.workAccounting.continuousEntityTicks).toBe(0);
  expect(evidence.progressed.relevanceBoundedScheduling.workAccounting.localMicroActionsReplayed).toBe(0);
  expect(evidence.progressed.relevanceBoundedScheduling.presentationAuthority).toBe(false);
});

test('late reconciliation cannot overwrite a newer authoritative regional scheduling state', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const progression = Game.RegionTimeProgression;
    const compute = Game.RelevanceBoundedCompute;
    Game.GameTime.stop();
    Game.WorldDeltaPersistence.clearAll();
    Game.GameTime.setForTest(100);
    progression.markActive(-4, 5);

    const olderJob = progression.prepareInactiveReconciliation(-4, 5, 200);
    const newerJob = progression.prepareInactiveReconciliation(-4, 5, 300);
    const newer = progression.acceptInactiveReconciliation(-4, 5, compute.compute(newerJob));
    const lateOlder = progression.acceptInactiveReconciliation(-4, 5, compute.compute(olderJob));
    const stored = progression.capture(-4, 5).relevanceBoundedScheduling;
    return { newer, lateOlder, stored };
  });

  expect(evidence.newer.accepted).toBe(true);
  expect(evidence.lateOlder.accepted).toBe(false);
  expect(evidence.lateOlder.reason).toBe('stale-revision');
  expect(evidence.stored.authorityRevision).toBe(evidence.newer.state.authorityRevision);
  expect(evidence.stored.resultFingerprint).toBe(evidence.newer.state.resultFingerprint);
});

test('materialization carries scheduling evidence while preserving Simulation authority', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    Game.GameTime.stop();
    Game.WorldDeltaPersistence.clearAll();
    Game.GameTime.setForTest(720);
    Game.RegionTimeProgression.markActive(1, 1);
    Game.GameTime.setForTest(720 + 3650 * 1440);
    return Game.RegionTimeProgression.materializeRelevantRegion(1, 1);
  });

  expect(evidence.authority).toBe('simulation');
  expect(evidence.presentationAuthority).toBe(false);
  expect(evidence.fullDetailReplayTicks).toBe(0);
  expect(evidence.materializedOffscreenRegions).toBe(0);
  expect(evidence.relevanceBoundedScheduling.boundedCatchUp).toBe(true);
  expect(evidence.relevanceBoundedScheduling.workAccounting.dayNightCyclesReplayed).toBe(0);
  expect(evidence.relevanceBoundedScheduling.workAccounting.boundedAggregateOperations).toBe(4);
});
