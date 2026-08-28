import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.WorldHierarchy?.refinementInput &&
    window.Game?.PoliticalGeography?.baseRegion &&
    window.Game?.SettlementEvolution?.advance &&
    window.Game?.RelevanceBoundedCompute?.prepare
  ));
}

async function findSettlement(page, seed = 'relevance-bounded-seed') {
  return page.evaluate((requestedSeed) => {
    for (let y = -8; y <= 8; y += 1) {
      for (let x = -8; x <= 8; x += 1) {
        const region = window.Game.WorldComposition.composeRegion(requestedSeed, x, y);
        if (region.settlement) return { seed: requestedSeed, x, y };
      }
    }
    return null;
  }, seed);
}

test('irrelevant world size does not increase continuous entity work or change authority', async ({ page }) => {
  await ready(page);
  const target = await findSettlement(page);
  expect(target).not.toBeNull();
  const evidence = await page.evaluate(({ seed, x, y }) => {
    const api = window.Game.RelevanceBoundedCompute;
    const common = {
      authorityEpoch: 'campaign:test',
      authorityRevision: 7,
      priorCampaignMinutes: 0,
      targetCampaignMinutes: 240 * 1440,
      meaningfulEvents: [{ id: 'market-fire', consequence: 'damage' }],
      persistentChanges: { discovered: true }
    };
    const small = api.prepare(seed, x, y, { ...common, irrelevantRegionCount: 0 });
    const huge = api.prepare(seed, x, y, { ...common, irrelevantRegionCount: 1000000 });
    return { small, huge, smallResult: api.compute(small), hugeResult: api.compute(huge) };
  }, target);

  expect(evidence.small.authority).toBe('simulation');
  expect(evidence.small.workPlan.continuousEntityTicks).toBe(0);
  expect(evidence.small.workPlan.continuousWorkUnits).toBe(1);
  expect(evidence.huge.workPlan.continuousWorkUnits).toBe(1);
  expect(evidence.huge.workPlan.irrelevantRegionsKnown).toBe(1000000);
  expect(evidence.huge.workPlan.scalesWithIrrelevantWorldSize).toBe(false);
  expect(evidence.small.inputFingerprint).toBe(evidence.huge.inputFingerprint);
  expect(evidence.smallResult.resultFingerprint).toBe(evidence.hugeResult.resultFingerprint);
});

test('large elapsed-time catch-up is bounded and never replays local micro activity', async ({ page }) => {
  await ready(page);
  const target = await findSettlement(page, 'bounded-catchup-seed');
  const evidence = await page.evaluate(({ seed, x, y }) => {
    const api = window.Game.RelevanceBoundedCompute;
    const days = 3650;
    const job = api.prepare(seed, x, y, {
      authorityEpoch: 'campaign:long-gap',
      authorityRevision: 10,
      priorCampaignMinutes: 0,
      targetCampaignMinutes: days * 1440,
      irrelevantRegionCount: 500000,
      meaningfulEvents: [{ id: 'war-ended', day: 2000 }]
    });
    return { job, result: api.compute(job) };
  }, target);

  expect(evidence.result.boundedCatchUp).toBe(true);
  expect(evidence.result.result.elapsedDays).toBe(3650);
  expect(evidence.result.workAccounting.continuousEntityTicks).toBe(0);
  expect(evidence.result.workAccounting.localMicroActionsReplayed).toBe(0);
  expect(evidence.result.workAccounting.dayNightCyclesReplayed).toBe(0);
  expect(evidence.result.workAccounting.boundedAggregateOperations).toBe(4);
});

test('synchronous and asynchronous execution produce identical authoritative output', async ({ page }) => {
  await ready(page);
  const target = await findSettlement(page, 'async-equivalence-seed');
  const evidence = await page.evaluate(async ({ seed, x, y }) => {
    const api = window.Game.RelevanceBoundedCompute;
    const job = api.prepare(seed, x, y, {
      authorityEpoch: 'campaign:async',
      authorityRevision: 3,
      targetCampaignMinutes: 90 * 1440,
      meaningfulEvents: [{ id: 'bridge-restored' }],
      politicalHistory: { realmId: 'campaign-realm:test' }
    });
    const sync = api.compute(job);
    const asyncFast = await api.computeAsync(job, { delayMs: 0 });
    const asyncSlow = await api.computeAsync(job, { delayMs: 20 });
    return { sync, asyncFast, asyncSlow };
  }, target);

  expect(evidence.asyncFast).toEqual(evidence.sync);
  expect(evidence.asyncSlow).toEqual(evidence.sync);
});

test('completion-order inversion converges to the newest authoritative revision and rejects stale work', async ({ page }) => {
  await ready(page);
  const target = await findSettlement(page, 'completion-order-seed');
  const evidence = await page.evaluate(async ({ seed, x, y }) => {
    const api = window.Game.RelevanceBoundedCompute;
    const olderJob = api.prepare(seed, x, y, {
      authorityEpoch: 'campaign:order',
      authorityRevision: 1,
      targetCampaignMinutes: 30 * 1440,
      meaningfulEvents: [{ id: 'older-event' }]
    });
    const newerJob = api.prepare(seed, x, y, {
      authorityEpoch: 'campaign:order',
      authorityRevision: 2,
      targetCampaignMinutes: 60 * 1440,
      meaningfulEvents: [{ id: 'older-event' }, { id: 'newer-event' }]
    });
    const older = api.compute(olderJob);
    const newer = api.compute(newerJob);

    let chronological = api.initialCommitState('campaign:order');
    chronological = api.acceptResult(chronological, older).state;
    chronological = api.acceptResult(chronological, newer).state;

    let inverted = api.initialCommitState('campaign:order');
    const newerAccepted = api.acceptResult(inverted, await api.computeAsync(newerJob, { delayMs: 0 }));
    inverted = newerAccepted.state;
    const staleAttempt = api.acceptResult(inverted, await api.computeAsync(olderJob, { delayMs: 20 }));
    inverted = staleAttempt.state;

    return { chronological, inverted, newer, staleAttempt, staleKnown: api.isStale(inverted, olderJob) };
  }, target);

  expect(evidence.chronological.resultFingerprint).toBe(evidence.newer.resultFingerprint);
  expect(evidence.inverted.resultFingerprint).toBe(evidence.newer.resultFingerprint);
  expect(evidence.inverted).toEqual(evidence.chronological);
  expect(evidence.staleAttempt.accepted).toBe(false);
  expect(evidence.staleAttempt.reason).toBe('stale-revision');
  expect(evidence.staleKnown).toBe(true);
  expect(evidence.inverted.result.meaningfulEvents.map((entry) => entry.id)).toEqual(['older-event', 'newer-event']);
});

test('visit order does not change deterministic region reconciliation results', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.RelevanceBoundedCompute;
    const seed = 'visit-order-seed';
    const options = { authorityEpoch: 'campaign:visit', authorityRevision: 4, targetCampaignMinutes: 12 * 1440 };
    const coords = [{ x: -3, y: 2 }, { x: 5, y: -4 }, { x: 0, y: 0 }];
    const forward = coords.map(({ x, y }) => api.compute(api.prepare(seed, x, y, options)));
    const reverse = [...coords].reverse().map(({ x, y }) => api.compute(api.prepare(seed, x, y, options))).reverse();
    return { forward, reverse };
  });

  expect(evidence.reverse.map((item) => item.resultFingerprint)).toEqual(evidence.forward.map((item) => item.resultFingerprint));
  expect(evidence.reverse.map((item) => item.inputFingerprint)).toEqual(evidence.forward.map((item) => item.inputFingerprint));
});

test('same-revision conflicts and wrong campaign epochs cannot become authority by timing', async ({ page }) => {
  await ready(page);
  const target = await findSettlement(page, 'authority-boundary-seed');
  const evidence = await page.evaluate(({ seed, x, y }) => {
    const api = window.Game.RelevanceBoundedCompute;
    const base = api.initialCommitState('campaign:A');
    const accepted = api.acceptResult(base, api.compute(api.prepare(seed, x, y, {
      authorityEpoch: 'campaign:A', authorityRevision: 5, targetCampaignMinutes: 1440, meaningfulEvents: [{ id: 'accepted' }]
    })));
    const conflict = api.acceptResult(accepted.state, api.compute(api.prepare(seed, x, y, {
      authorityEpoch: 'campaign:A', authorityRevision: 5, targetCampaignMinutes: 1440, meaningfulEvents: [{ id: 'conflict' }]
    })));
    const wrongEpoch = api.acceptResult(accepted.state, api.compute(api.prepare(seed, x, y, {
      authorityEpoch: 'campaign:B', authorityRevision: 6, targetCampaignMinutes: 2880
    })));
    return { accepted, conflict, wrongEpoch };
  }, target);

  expect(evidence.accepted.accepted).toBe(true);
  expect(evidence.conflict.accepted).toBe(false);
  expect(evidence.conflict.reason).toBe('conflicting-same-revision');
  expect(evidence.wrongEpoch.accepted).toBe(false);
  expect(evidence.wrongEpoch.reason).toBe('authority-epoch-mismatch');
  expect(evidence.conflict.state).toEqual(evidence.accepted.state);
  expect(evidence.wrongEpoch.state).toEqual(evidence.accepted.state);
});
