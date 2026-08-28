import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.WorldComposition?.composeRegion &&
    window.Game?.WorldHierarchy?.refinementInput &&
    window.Game?.CampaignCalendar?.capture &&
    window.Game?.SettlementEvolution?.advance
  ));
}

async function findSettlement(page, seed = null) {
  return page.evaluate((requestedSeed) => {
    const seed = requestedSeed || window.Game.State.world.seed;
    const composition = window.Game.WorldComposition;
    for (let y = -8; y <= 8; y += 1) {
      for (let x = -8; x <= 8; x += 1) {
        const region = composition.composeRegion(seed, x, y);
        if (region.settlement) return { seed, x, y, settlement: region.settlement };
      }
    }
    return null;
  }, seed);
}

test('base settlement development state is deterministic, Simulation-owned and distinct from presentation', async ({ page }) => {
  await ready(page);
  const target = await findSettlement(page, 'settlement-evolution-seed');
  expect(target).not.toBeNull();
  const evidence = await page.evaluate(({ seed, x, y }) => {
    const api = window.Game.SettlementEvolution;
    return { a: api.baseState(seed, x, y), b: api.baseState(seed, x, y) };
  }, target);
  expect(evidence.a).toEqual(evidence.b);
  expect(evidence.a.authority).toBe('simulation');
  expect(evidence.a.base).toBe(true);
  expect(evidence.a.settlementId).toBe(target.settlement.id);
  expect(evidence.a.presentationAuthority).toBe(false);
  expect(Object.keys(evidence.a.metrics).sort()).toEqual(['abandonment','damage','fortification','population','prosperity','resources','security','trade']);
});

test('elapsed authoritative time advances compact state without replaying local ticks', async ({ page }) => {
  await ready(page);
  const target = await findSettlement(page);
  const evidence = await page.evaluate(({ seed, x, y }) => {
    const api = window.Game.SettlementEvolution;
    const start = api.baseState(seed, x, y);
    const advanced = api.advance(seed, x, y, {
      priorState: start,
      campaignMinutes: 30 * 1440,
      constructionSupport: 100,
      hazardPressure: 0,
      warPressure: 0
    });
    return { start, advanced, materialization: api.materializationInput(advanced) };
  }, target);
  expect(evidence.advanced.authority).toBe('simulation');
  expect(evidence.advanced.elapsedDaysApplied).toBe(30);
  expect(evidence.advanced.boundedCatchUp).toBe(true);
  expect(evidence.advanced.localTicksReplayed).toBe(0);
  expect(evidence.advanced.lastGameMinute).toBe(30 * 1440);
  expect(evidence.advanced.hierarchyRefinementKey).toBeTruthy();
  expect(evidence.materialization.authority).toBe('simulation');
  expect(evidence.materialization.refinementKey).toBe(evidence.advanced.hierarchyRefinementKey);
  expect(evidence.materialization.presentationAuthority).toBe(false);
});

test('representative adverse history produces decline/damage instead of resetting to untouched SEED state', async ({ page }) => {
  await ready(page);
  const target = await findSettlement(page, 'settlement-adverse-seed');
  const evidence = await page.evaluate(({ seed, x, y }) => {
    const api = window.Game.SettlementEvolution;
    const base = api.baseState(seed, x, y);
    const damaged = api.advance(seed, x, y, {
      priorState: base,
      campaignMinutes: 30 * 1440,
      warPressure: 100,
      hazardPressure: 100,
      historicalDamage: 100,
      constructionSupport: 0
    });
    const later = api.advance(seed, x, y, {
      priorState: damaged,
      campaignMinutes: 60 * 1440,
      warPressure: 100,
      hazardPressure: 80,
      historicalDamage: 100,
      constructionSupport: 0
    });
    return { base, damaged, later, materialization: api.materializationInput(later) };
  }, target);
  expect(evidence.damaged.accumulatedHistory.damage).toBeGreaterThan(0);
  expect(evidence.later.accumulatedHistory.damage).toBeGreaterThan(evidence.damaged.accumulatedHistory.damage);
  expect(evidence.later.metrics.damage).toBeGreaterThan(evidence.base.metrics.damage);
  expect(['declining','damaged','ruined','abandoned']).toContain(evidence.later.status);
  expect(evidence.materialization.mustDifferFromUntouchedBase).toBe(true);
  expect(evidence.materialization.activeStructureFraction).toBeLessThan(100);
});

test('recovery inputs preserve prior history while improving a damaged settlement', async ({ page }) => {
  await ready(page);
  const target = await findSettlement(page, 'settlement-recovery-seed');
  const evidence = await page.evaluate(({ seed, x, y }) => {
    const api = window.Game.SettlementEvolution;
    const base = api.baseState(seed, x, y);
    const damaged = api.advance(seed, x, y, {
      priorState: base,
      campaignMinutes: 30 * 1440,
      warPressure: 100,
      hazardPressure: 100,
      historicalDamage: 100
    });
    const recovering = api.advance(seed, x, y, {
      priorState: damaged,
      campaignMinutes: 60 * 1440,
      warPressure: 0,
      hazardPressure: 0,
      historicalDamage: 0,
      constructionSupport: 100
    });
    return { damaged, recovering, materialization: api.materializationInput(recovering) };
  }, target);
  expect(evidence.recovering.accumulatedHistory.damage).toBe(evidence.damaged.accumulatedHistory.damage);
  expect(evidence.recovering.accumulatedHistory.recovery).toBeGreaterThan(evidence.damaged.accumulatedHistory.recovery);
  expect(evidence.recovering.metrics.damage).toBeLessThanOrEqual(evidence.damaged.metrics.damage);
  expect(evidence.materialization.mustDifferFromUntouchedBase).toBe(true);
});

test('equivalent inputs are reproducible and backwards chronology is rejected', async ({ page }) => {
  await ready(page);
  const target = await findSettlement(page, 'settlement-repro-seed');
  const evidence = await page.evaluate(({ seed, x, y }) => {
    const api = window.Game.SettlementEvolution;
    const base = api.baseState(seed, x, y);
    const options = { priorState: base, campaignMinutes: 12 * 1440, warPressure: 35, hazardPressure: 20, constructionSupport: 40 };
    const a = api.advance(seed, x, y, options);
    const b = api.advance(seed, x, y, options);
    let backwardsRejected = false;
    try { api.advance(seed, x, y, { priorState: a, campaignMinutes: a.lastGameMinute - 1 }); }
    catch (error) { backwardsRejected = error instanceof RangeError; }
    return { a, b, backwardsRejected };
  }, target);
  expect(evidence.a).toEqual(evidence.b);
  expect(evidence.backwardsRejected).toBe(true);
});
