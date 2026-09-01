import { test, expect } from '@playwright/test';

function collectRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror:${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console:${message.text()}`);
  });
  return failures;
}

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCRelevanceRuntime?.snapshot &&
    window.Game?.FrameBudgetScheduler?.metrics &&
    window.Game?.NPCRuntimeBridge?.scheduleReconcile &&
    window.Game?.State?.world?.npcs?.length
  ), null, { timeout: 30_000 });
}

test('stable NPC identity produces deterministic distributed authoritative-time buckets', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);

  const distribution = await page.evaluate(() => {
    const runtime = window.Game.NPCRelevanceRuntime;
    const ids = Array.from({ length: 160 }, (_, index) => ({ id: `representative-${index}` }));
    const first = ids.map((npc) => runtime.stableBucket(npc, runtime.tiers.DISTANT));
    const second = ids.map((npc) => runtime.stableBucket(npc, runtime.tiers.DISTANT));
    const counts = first.reduce((map, bucket) => {
      map[bucket] = (map[bucket] || 0) + 1;
      return map;
    }, {});
    return { first, second, counts, cadence: runtime.cadenceMinutes.distant };
  });

  expect(distribution.second).toEqual(distribution.first);
  expect(new Set(distribution.first).size).toBeGreaterThanOrEqual(Math.min(10, distribution.cadence - 1));
  expect(Math.max(...Object.values(distribution.counts))).toBeLessThan(distribution.first.length / 3);
  expect(failures).toEqual([]);
});

test('relevance tiers distinguish visible/near work from distant compact work without renderer truth', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);

  const evidence = await page.evaluate(() => {
    const runtime = window.Game.NPCRelevanceRuntime;
    const player = window.Game.State.world.player;
    const real = window.Game.State.world.npcs[0];
    const critical = runtime.classify(real);
    const distant = runtime.classify({ id: 'far-probe', row: Number(player.row) + 90, col: Number(player.col) + 90 });
    runtime.scheduleFrame();
    const snapshot = runtime.snapshot();
    return {
      critical,
      distant,
      authority: snapshot.authority,
      compactStatePersisted: snapshot.compactStatePersisted,
      counts: snapshot.counts,
      entries: snapshot.entries.length,
      population: window.Game.State.world.npcs.length
    };
  });

  expect(['critical', 'nearby']).toContain(evidence.critical);
  expect(evidence.distant).toBe('distant');
  expect(evidence.authority).toBe('scheduling-only');
  expect(evidence.compactStatePersisted).toBe(false);
  expect(evidence.entries).toBe(evidence.population);
  expect(Object.values(evidence.counts).reduce((sum, value) => sum + value, 0)).toBe(evidence.population);
  expect(failures).toEqual([]);
});

test('camera interaction defers NPC detail/reconcile work and idle frame slack drains it', async ({ page }) => {
  test.setTimeout(90_000);
  const failures = collectRuntimeFailures(page);
  await ready(page);

  const during = await page.evaluate(() => {
    const scheduler = window.Game.FrameBudgetScheduler;
    scheduler.noteInteraction('npc-performance-test', 260);
    window.Game.NPCRelevanceRuntime.scheduleFrame();
    window.Game.NPCRuntimeBridge.scheduleReconcile();
    window.Game.Renderer.renderWorld(true);
    return {
      scheduler: scheduler.metrics(),
      relevance: window.Game.NPCRelevanceRuntime.snapshot(),
      bridge: window.Game.NPCRuntimeBridge.metrics()
    };
  });

  expect(during.scheduler.interactionActive).toBe(true);
  expect(during.scheduler.queuedKeys.some((key) => key === 'npc-runtime-reconcile')).toBe(true);
  expect(during.bridge.reconcileRequests).toBeGreaterThan(0);
  expect(during.relevance.deferredJobs).toBeGreaterThanOrEqual(0);

  await page.waitForTimeout(310);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const depth = await page.evaluate(() => window.Game.FrameBudgetScheduler.metrics().queueDepth);
    if (depth === 0) break;
    await page.evaluate(() => window.Game.Renderer.renderWorld(true));
    await page.waitForTimeout(16);
  }

  const after = await page.evaluate(() => ({
    scheduler: window.Game.FrameBudgetScheduler.metrics(),
    relevance: window.Game.NPCRelevanceRuntime.snapshot(),
    bridge: window.Game.NPCRuntimeBridge.metrics(),
    uniquePositions: new Set(window.Game.State.world.npcs.map((npc) => `${npc.row},${npc.col}`)).size,
    population: window.Game.State.world.npcs.length
  }));

  expect(after.scheduler.queueDepth).toBe(0);
  expect(after.bridge.reconcileRuns).toBeGreaterThan(0);
  expect(after.relevance.completedJobs).toBeGreaterThan(0);
  expect(after.relevance.npcJobWorstMs).toBeLessThan(50);
  expect(after.uniquePositions).toBe(after.population);
  expect(failures).toEqual([]);
});

test('same authoritative minute does not rematerialize all NPC spatial state on repeated renders', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);

  const evidence = await page.evaluate(async () => {
    const before = window.Game.NPCRelevanceRuntime.snapshot();
    const startKey = window.Game.State.world.npcRuntime?.lastRoutineStateKey || '';
    const startPositions = window.Game.State.world.npcs.map((npc) => `${npc.id}:${npc.row},${npc.col}`);
    for (let index = 0; index < 30; index += 1) window.Game.Renderer.renderWorld(true);
    await new Promise((resolve) => setTimeout(resolve, 220));
    window.Game.Renderer.renderWorld(true);
    const after = window.Game.NPCRelevanceRuntime.snapshot();
    return {
      startKey,
      endKey: window.Game.State.world.npcRuntime?.lastRoutineStateKey || '',
      startPositions,
      endPositions: window.Game.State.world.npcs.map((npc) => `${npc.id}:${npc.row},${npc.col}`),
      beforeJobs: before.completedJobs,
      afterJobs: after.completedJobs,
      queueDepth: window.Game.FrameBudgetScheduler.metrics().queueDepth
    };
  });

  expect(evidence.endKey).toBe(evidence.startKey);
  expect(evidence.endPositions).toEqual(evidence.startPositions);
  expect(evidence.afterJobs - evidence.beforeJobs).toBeLessThanOrEqual(evidence.startPositions.length);
  expect(evidence.queueDepth).toBeLessThanOrEqual(2);
  expect(failures).toEqual([]);
});
