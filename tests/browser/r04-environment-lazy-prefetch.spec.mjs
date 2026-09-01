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
    window.Game?.RegionNavigation?.lazyMetrics &&
    window.Game?.RegionTerrain?.generateRegion &&
    window.Game?.State?.world?.terrain?.length
  ), null, { timeout: 30_000 });
  await page.evaluate(() => {
    if (window.Game.Config) window.Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES = false;
    window.Game.Utils?.loadScriptOnce?.('js/frame_budget_scheduler.js', 'r04FrameBudgetSchedulerModule');
  });
  await page.waitForFunction(() => Boolean(window.Game?.FrameBudgetScheduler?.metrics), null, { timeout: 10_000 });
  await page.evaluate(() => window.Game.FrameBudgetScheduler.wrapRenderer?.());
}

test('region activation keeps center synchronous while neighbor prefetch yields during interaction', async ({ page }) => {
  test.setTimeout(90_000);
  await ready(page);
  const failures = collectRuntimeFailures(page);

  const evidence = await page.evaluate(async () => {
    const nav = window.Game.RegionNavigation;
    const scheduler = window.Game.FrameBudgetScheduler;
    const world = window.Game.State.world;
    const start = world.currentRegion || { x: 0, y: 0 };

    scheduler.noteInteraction('environment-prefetch-test', 300);
    const beforeCompleted = nav.lazyMetrics().completedJobs;
    nav.activate(Number(start.x || 0) + 1, Number(start.y || 0));
    window.Game.Renderer?.renderWorld?.(true);
    const during = {
      capture: nav.capture(),
      metrics: nav.lazyMetrics(),
      scheduler: scheduler.metrics()
    };

    await new Promise((resolve) => setTimeout(resolve, 340));
    for (let attempt = 0; attempt < 20 && nav.lazyMetrics().pendingJobs > 0; attempt += 1) {
      scheduler.runBackgroundSlice(performance.now());
      await new Promise((resolve) => setTimeout(resolve, 8));
    }

    const after = {
      metrics: nav.lazyMetrics(),
      scheduler: scheduler.metrics(),
      prefetched: nav.prefetchSnapshot()
    };
    return { beforeCompleted, during, after };
  });

  expect(evidence.during.capture.activeRows).toBe(100);
  expect(evidence.during.capture.activeCols).toBe(100);
  expect(evidence.during.capture.activeRegionWindow.lazyNeighborPrefetch).toBe(true);
  expect(evidence.during.capture.activeRegionWindow.regions).toHaveLength(1);
  expect(evidence.during.metrics.completedJobs).toBe(evidence.beforeCompleted);
  expect(evidence.during.metrics.pendingJobs).toBeGreaterThan(0);
  expect(evidence.during.metrics.pendingJobs).toBeLessThanOrEqual(8);
  expect(evidence.during.scheduler.interactionActive).toBe(true);

  expect(evidence.after.metrics.pendingJobs).toBe(0);
  expect(evidence.after.metrics.completedJobs).toBeGreaterThan(evidence.beforeCompleted);
  expect(evidence.after.metrics.cacheEntries).toBeLessThanOrEqual(evidence.after.metrics.maxCacheEntries);
  expect(evidence.after.metrics.jobWorstMs).toBeLessThan(50);
  expect(evidence.after.prefetched.length).toBeGreaterThan(0);
  expect(failures).toEqual([]);
});

test('superseded region requests cancel stale prefetch and deterministic fingerprints survive lazy timing', async ({ page }) => {
  test.setTimeout(90_000);
  await ready(page);
  const failures = collectRuntimeFailures(page);

  const evidence = await page.evaluate(async () => {
    const nav = window.Game.RegionNavigation;
    const scheduler = window.Game.FrameBudgetScheduler;
    const world = window.Game.State.world;
    const seed = world.seed;
    const start = world.currentRegion || { x: 0, y: 0 };

    scheduler.noteInteraction('hold-first-generation', 320);
    nav.activate(Number(start.x || 0) + 1, Number(start.y || 0));
    const firstPending = nav.lazyMetrics().pendingJobs;
    nav.activate(Number(start.x || 0) + 2, Number(start.y || 0));
    const afterSupersede = nav.lazyMetrics();

    await new Promise((resolve) => setTimeout(resolve, 360));
    for (let attempt = 0; attempt < 20 && nav.lazyMetrics().pendingJobs > 0; attempt += 1) {
      scheduler.runBackgroundSlice(performance.now());
      await new Promise((resolve) => setTimeout(resolve, 8));
    }

    const current = window.Game.State.world.currentRegion;
    const deterministic = window.Game.RegionTerrain.generateRegion(seed, current.x, current.y);
    const fingerprint = window.Game.RegionTerrain.fingerprint(deterministic);
    const activeFingerprint = window.Game.RegionNavigation.buildActiveRegion(seed, current.x, current.y).meta.fingerprint;
    return {
      firstPending,
      afterSupersede,
      finalMetrics: nav.lazyMetrics(),
      fingerprint,
      activeFingerprint
    };
  });

  expect(evidence.firstPending).toBeGreaterThan(0);
  expect(evidence.afterSupersede.discardedJobs).toBeGreaterThanOrEqual(evidence.firstPending);
  expect(evidence.afterSupersede.pendingJobs).toBeLessThanOrEqual(8);
  expect(evidence.finalMetrics.pendingJobs).toBe(0);
  expect(evidence.finalMetrics.cacheEntries).toBeLessThanOrEqual(24);
  expect(evidence.activeFingerprint).toBe(evidence.fingerprint);
  expect(failures).toEqual([]);
});

test('explicit legacy buildWindow remains deterministic and 3x3-compatible', async ({ page }) => {
  await ready(page);
  const failures = collectRuntimeFailures(page);
  const result = await page.evaluate(() => {
    const seed = window.Game.State.world.seed;
    const first = window.Game.RegionNavigation.buildWindow(seed, 0, 0);
    const second = window.Game.RegionNavigation.buildWindow(seed, 0, 0);
    return {
      rows: first.rows,
      cols: first.cols,
      regions: first.regions.length,
      fingerprintsA: first.regions.map((entry) => entry.fingerprint),
      fingerprintsB: second.regions.map((entry) => entry.fingerprint)
    };
  });
  expect(result.rows).toBe(300);
  expect(result.cols).toBe(300);
  expect(result.regions).toBe(9);
  expect(result.fingerprintsB).toEqual(result.fingerprintsA);
  expect(failures).toEqual([]);
});
