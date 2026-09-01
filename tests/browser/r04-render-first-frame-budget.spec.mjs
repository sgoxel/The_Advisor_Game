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
    window.Game?.FrameBudgetScheduler?.metrics &&
    window.Game?.State?.world?.terrain?.length &&
    window.Game?.Renderer?.renderWorld
  ), null, { timeout: 30_000 });
  await page.evaluate(() => {
    const camera = window.Game.State.camera;
    camera.followPlayer = false;
    camera.dragActive = false;
    camera.inertiaVelocityX = 0;
    camera.inertiaVelocityY = 0;
    window.Game.State.input?.keys?.clear?.();
    // This suite owns scheduling semantics, not NPC bubble semantics. Suppress the
    // presentation-only contextual wrapper so live NPC schedule ticks cannot make an
    // unrelated render invariant abort the scheduler fixture while jobs are draining.
    if (window.Game.Config) window.Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES = false;
  });
  await expect.poll(
    () => page.evaluate(() => window.Game.FrameBudgetScheduler.metrics().interactionActive),
    { timeout: 10_000 }
  ).toBe(false);
}

async function waitForIdleScheduler(page) {
  await expect.poll(
    () => page.evaluate(() => window.Game.FrameBudgetScheduler.metrics().interactionActive),
    { timeout: 10_000 }
  ).toBe(false);
}

test('interaction frames defer optional jobs and idle render slack resumes them', async ({ page }) => {
  test.setTimeout(90_000);
  const failures = collectRuntimeFailures(page);
  await ready(page);

  const during = await page.evaluate(() => {
    const scheduler = window.Game.FrameBudgetScheduler;
    window.__frameBudgetExecutions = 0;
    for (let index = 0; index < 12; index += 1) {
      scheduler.enqueue(`test-job-${index}`, () => {
        const started = performance.now();
        while (performance.now() - started < 0.35) { /* bounded representative slice */ }
        window.__frameBudgetExecutions += 1;
        return true;
      }, { priority: index % 3, label: `test job ${index}` });
    }
    scheduler.noteInteraction('automated-pan', 260);
    window.Game.Renderer.renderWorld(true);
    return { executions: window.__frameBudgetExecutions, metrics: scheduler.metrics() };
  });

  expect(during.executions).toBe(0);
  expect(during.metrics.interactionActive).toBe(true);
  expect(during.metrics.queueDepth).toBe(12);
  expect(during.metrics.deferredJobs).toBeGreaterThanOrEqual(12);

  await waitForIdleScheduler(page);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const depth = await page.evaluate(() => window.Game.FrameBudgetScheduler.metrics().queueDepth);
    if (depth === 0) break;
    await page.evaluate(() => window.Game.Renderer.renderWorld(true));
    await page.waitForTimeout(20);
  }

  const after = await page.evaluate(() => ({
    executions: window.__frameBudgetExecutions,
    metrics: window.Game.FrameBudgetScheduler.metrics()
  }));
  expect(after.executions).toBe(12);
  expect(after.metrics.queueDepth).toBe(0);
  expect(after.metrics.completedJobs).toBeGreaterThanOrEqual(12);
  expect(after.metrics.jobWorstMs).toBeLessThan(50);
  expect(failures).toEqual([]);
});

test('real wheel interaction protects rendering before optional background work', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);
  const canvas = page.locator('#gameCanvas');
  await canvas.hover();

  await page.evaluate(() => {
    window.__frameBudgetWheelJobRuns = 0;
    window.Game.FrameBudgetScheduler.enqueue('wheel-guard-job', () => {
      window.__frameBudgetWheelJobRuns += 1;
      return true;
    });
  });

  await page.mouse.wheel(0, -120);
  await page.evaluate(() => window.Game.Renderer.renderWorld(true));
  expect(await page.evaluate(() => window.__frameBudgetWheelJobRuns)).toBe(0);

  await waitForIdleScheduler(page);
  await page.evaluate(() => window.Game.Renderer.renderWorld(true));
  await expect.poll(() => page.evaluate(() => window.__frameBudgetWheelJobRuns)).toBe(1);

  const metrics = await page.evaluate(() => window.Game.FrameBudgetScheduler.metrics());
  expect(metrics.interactionFrames).toBeGreaterThan(0);
  expect(metrics.failedJobs).toBe(0);
  expect(metrics.renderWorstMs).toBeLessThan(50);
  expect(failures).toEqual([]);
});

test('stable job keys deduplicate superseded optional work without changing Simulation state', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);
  const before = await page.evaluate(() => {
    const world = window.Game.State.world;
    window.__frameBudgetDedupeValues = [];
    window.Game.FrameBudgetScheduler.enqueue('dedupe-world-job', () => { window.__frameBudgetDedupeValues.push('old'); return true; }, { version: '1' });
    window.Game.FrameBudgetScheduler.enqueue('dedupe-world-job', () => { window.__frameBudgetDedupeValues.push('new'); return true; }, { version: '2' });
    return JSON.stringify({ seed: world.seed, rows: world.rows, cols: world.cols, player: { row: world.player.row, col: world.player.col } });
  });

  await waitForIdleScheduler(page);
  await page.evaluate(() => window.Game.Renderer.renderWorld(true));

  const result = await page.evaluate(() => {
    const world = window.Game.State.world;
    return {
      values: window.__frameBudgetDedupeValues,
      after: JSON.stringify({ seed: world.seed, rows: world.rows, cols: world.cols, player: { row: world.player.row, col: world.player.col } }),
      metrics: window.Game.FrameBudgetScheduler.metrics()
    };
  });

  expect(result.values).toEqual(['new']);
  expect(result.after).toBe(before);
  expect(result.metrics.authority).toBe('scheduling-only');
  expect(result.metrics.failedJobs).toBe(0);
  expect(failures).toEqual([]);
});
