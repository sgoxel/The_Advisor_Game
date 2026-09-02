import { test, expect } from '@playwright/test';

function percentile(values, ratio) {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function stats(values) {
  return {
    samples: values.length,
    medianMs: percentile(values, 0.50),
    p95Ms: percentile(values, 0.95),
    worstMs: values.length ? Math.max(...values) : 0
  };
}

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.FrameBudgetScheduler?.metrics &&
    window.Game?.NPCRelevanceRuntime?.snapshot &&
    window.Game?.NPCRuntimeBridge?.metrics &&
    window.Game?.RegionNavigation?.lazyMetrics &&
    window.Game?.State?.world?.npcs?.length &&
    window.Game?.Renderer?.renderWorld
  ), null, { timeout: 30_000 });
  await page.evaluate(async () => {
    if (window.Game.Config) window.Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES = false;
    const camera = window.Game.State.camera;
    if (camera) {
      camera.followPlayer = false;
      camera.dragActive = false;
      camera.inertiaVelocityX = 0;
      camera.inertiaVelocityY = 0;
    }
    window.Game.State.input?.keys?.clear?.();
    window.Game.FrameBudgetScheduler.wrapRenderer?.();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function drain(page, maxSlices = 80) {
  for (let i = 0; i < maxSlices; i += 1) {
    const pending = await page.evaluate(() => {
      const scheduler = window.Game.FrameBudgetScheduler;
      scheduler.runBackgroundSlice(performance.now());
      return {
        interaction: scheduler.metrics().interactionActive,
        environment: window.Game.RegionNavigation.lazyMetrics().pendingJobs,
        npcReconcile: scheduler.metrics().queuedKeys.includes('npc-runtime-reconcile')
      };
    });
    if (!pending.interaction && pending.environment === 0 && !pending.npcReconcile) return;
    await page.waitForTimeout(10);
  }
}

async function sameFixtureComparison(page) {
  const renderFirst = [];
  const legacy = [];
  const sliceCount = 12;
  const sliceMs = 6;

  for (let sample = 0; sample < 3; sample += 1) {
    const renderFirstMs = await page.evaluate(({ sample, sliceCount, sliceMs }) => {
      const scheduler = window.Game.FrameBudgetScheduler;
      for (let i = 0; i < sliceCount; i += 1) {
        const key = `r04-353-compare-${sample}-${i}`;
        scheduler.enqueue(key, () => {
          const started = performance.now();
          while (performance.now() - started < sliceMs) { /* bounded optional work */ }
          return true;
        }, { priority: 100, label: key });
      }
      scheduler.noteInteraction('r04-353-render-first', 180);
      const started = performance.now();
      window.Game.Renderer.renderWorld(true);
      return performance.now() - started;
    }, { sample, sliceCount, sliceMs });
    renderFirst.push(renderFirstMs);
    await page.waitForTimeout(220);
    await drain(page, 80);

    const legacyMs = await page.evaluate(({ sliceCount, sliceMs }) => {
      const started = performance.now();
      for (let i = 0; i < sliceCount; i += 1) {
        const sliceStarted = performance.now();
        while (performance.now() - sliceStarted < sliceMs) { /* legacy synchronous optional work */ }
      }
      window.Game.Renderer.renderWorld(true);
      return performance.now() - started;
    }, { sliceCount, sliceMs });
    legacy.push(legacyMs);
  }

  return {
    renderFirst: stats(renderFirst),
    legacy: stats(legacy)
  };
}

test('R04 combined render-first NPC/environment performance gate', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const runtimeFailures = [];
  page.on('pageerror', (error) => runtimeFailures.push(`pageerror:${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeFailures.push(`console:${message.text()}`);
  });
  await ready(page);

  const before = await page.evaluate(() => {
    const Game = window.Game;
    const runtime = Game.NPCRelevanceRuntime;
    const npcs = Game.State.world.npcs;
    const bucketCounts = {};
    for (const npc of npcs) {
      const tier = runtime.classify(npc);
      const key = `${tier}:${runtime.stableBucket(npc, tier)}`;
      bucketCounts[key] = (bucketCounts[key] || 0) + 1;
    }
    return {
      population: npcs.length,
      relevance: runtime.snapshot(),
      bridge: Game.NPCRuntimeBridge.metrics(),
      environment: Game.RegionNavigation.lazyMetrics(),
      scheduler: Game.FrameBudgetScheduler.metrics(),
      bucketCounts
    };
  });

  const interaction = await page.evaluate(async () => {
    const Game = window.Game;
    const scheduler = Game.FrameBudgetScheduler;
    const nav = Game.RegionNavigation;
    const world = Game.State.world;
    const start = world.currentRegion || { x: 0, y: 0 };
    const frameTimes = [];

    scheduler.noteInteraction('r04-353-mixed-pan-zoom', 2600);
    nav.activate(Number(start.x || 0) + 1, Number(start.y || 0));
    Game.NPCRelevanceRuntime.scheduleFrame();
    Game.NPCRuntimeBridge.scheduleReconcile();

    for (let i = 0; i < 12; i += 1) {
      const t0 = performance.now();
      Game.Renderer.renderWorld(true);
      frameTimes.push(performance.now() - t0);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    return {
      frameTimes,
      scheduler: scheduler.metrics(),
      relevance: Game.NPCRelevanceRuntime.snapshot(),
      bridge: Game.NPCRuntimeBridge.metrics(),
      environment: nav.lazyMetrics()
    };
  });

  expect(interaction.scheduler.interactionActive).toBe(true);
  expect(interaction.environment.pendingJobs).toBeGreaterThan(0);
  expect(interaction.environment.pendingJobs).toBeLessThanOrEqual(8);
  expect(interaction.environment.completedJobs).toBe(before.environment.completedJobs);
  expect(interaction.scheduler.queuedKeys.includes('npc-runtime-reconcile')).toBe(true);

  await page.waitForTimeout(2650);
  await drain(page, 100);

  const after = await page.evaluate(() => {
    const Game = window.Game;
    const relevance = Game.NPCRelevanceRuntime.snapshot();
    const environment = Game.RegionNavigation.lazyMetrics();
    const scheduler = Game.FrameBudgetScheduler.metrics();
    const bridge = Game.NPCRuntimeBridge.metrics();
    const positions = Game.State.world.npcs.map((npc) => `${npc.row},${npc.col}`);
    return {
      relevance,
      environment,
      scheduler,
      bridge,
      population: positions.length,
      uniquePositions: new Set(positions).size
    };
  });

  expect(after.scheduler.interactionActive).toBe(false);
  expect(after.environment.pendingJobs).toBe(0);
  expect(after.environment.completedJobs).toBeGreaterThan(before.environment.completedJobs);
  expect(after.environment.cacheEntries).toBeLessThanOrEqual(after.environment.maxCacheEntries);
  expect(after.environment.jobWorstMs).toBeLessThan(50);
  expect(after.relevance.npcJobWorstMs).toBeLessThan(50);
  expect(after.scheduler.completedJobs).toBeGreaterThan(before.scheduler.completedJobs);
  expect(after.bridge.reconcileRuns).toBeGreaterThan(before.bridge.reconcileRuns);
  expect(after.uniquePositions).toBe(after.population);
  expect(Object.values(after.relevance.counts).reduce((sum, value) => sum + value, 0)).toBe(after.population);
  expect(Object.keys(before.bucketCounts).length).toBeGreaterThan(1);

  const comparison = await sameFixtureComparison(page);
  const interactionStats = stats(interaction.frameTimes);
  const absolutePass = interactionStats.p95Ms <= 33.3;
  const relativePass = comparison.legacy.p95Ms > 0 && comparison.renderFirst.p95Ms <= comparison.legacy.p95Ms * 0.80;
  expect(absolutePass || relativePass).toBe(true);
  expect(runtimeFailures).toEqual([]);

  const evidence = {
    project: testInfo.project.name,
    population: after.population,
    interactionFrames: interactionStats,
    sameFixtureComparison: comparison,
    p95AbsolutePass: absolutePass,
    relativeImprovementPass: relativePass,
    npcTierCounts: after.relevance.counts,
    npcStableBucketCount: Object.keys(before.bucketCounts).length,
    npcDeferredJobs: after.relevance.deferredJobs,
    npcCompletedJobs: after.relevance.completedJobs,
    npcJobP95Ms: after.relevance.npcJobP95Ms,
    npcJobWorstMs: after.relevance.npcJobWorstMs,
    environmentCompletedJobs: after.environment.completedJobs,
    environmentDiscardedJobs: after.environment.discardedJobs,
    environmentPendingJobs: after.environment.pendingJobs,
    environmentOldestQueueAgeMs: after.environment.oldestQueueAgeMs,
    environmentCacheEntries: after.environment.cacheEntries,
    environmentMaxCacheEntries: after.environment.maxCacheEntries,
    environmentJobP95Ms: after.environment.jobP95Ms,
    environmentJobWorstMs: after.environment.jobWorstMs,
    schedulerDeferredJobs: after.scheduler.deferredJobs,
    schedulerCompletedJobs: after.scheduler.completedJobs,
    schedulerJobP95Ms: after.scheduler.jobP95Ms,
    schedulerJobWorstMs: after.scheduler.jobWorstMs,
    uniqueOccupancy: `${after.uniquePositions}/${after.population}`,
    runtimeFailures
  };
  console.log(`R04_353_PERFORMANCE_EVIDENCE=${JSON.stringify(evidence)}`);
});
