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
  });
}

test('interaction frames defer optional jobs and idle render slack resumes them', async ({ page }) => {
  test.setTimeout(90_000);
  const failures = collectRuntimeFailures(page);
  await ready(page);

  const evidence = await page.evaluate(async () => {
    const scheduler = window.Game.FrameBudgetScheduler;
    let executions = 0;
    for (let index = 0; index < 12; index += 1) {
      scheduler.enqueue(`test-job-${index}`, () => {
        const started = performance.now();
        while (performance.now() - started < 0.35) { /* bounded representative slice */ }
        executions += 1;
        return true;
      }, { priority: index % 3, label: `test job ${index}` });
    }

    scheduler.noteInteraction('automated-pan', 260);
    window.Game.Renderer.renderWorld(true);
    const during = { executions, metrics: scheduler.metrics() };

    await new Promise((resolve) => setTimeout(resolve, 300));
    for (let attempt = 0; attempt < 12 && scheduler.metrics().queueDepth > 0; attempt += 1) {
      window.Game.Renderer.renderWorld(true);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const after = { executions, metrics: scheduler.metrics() };
    return { during, after };
  });

  expect(evidence.during.executions).toBe(0);
  expect(evidence.during.metrics.interactionActive).toBe(true);
  expect(evidence.during.metrics.queueDepth).toBe(12);
  expect(evidence.during.metrics.deferredJobs).toBeGreaterThanOrEqual(12);
  expect(evidence.after.executions).toBe(12);
  expect(evidence.after.metrics.queueDepth).toBe(0);
  expect(evidence.after.metrics.completedJobs).toBeGreaterThanOrEqual(12);
  expect(evidence.after.metrics.jobWorstMs).toBeLessThan(50);
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

  await page.waitForTimeout(180);
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
  const result = await page.evaluate(async () => {
    const scheduler = window.Game.FrameBudgetScheduler;
    const world = window.Game.State.world;
    const before = JSON.stringify({
      seed: world.seed,
      rows: world.rows,
      cols: world.cols,
      player: { row: world.player.row, col: world.player.col }
    });
    const values = [];
    scheduler.enqueue('dedupe-world-job', () => { values.push('old'); return true; }, { version: '1' });
    scheduler.enqueue('dedupe-world-job', () => { values.push('new'); return true; }, { version: '2' });
    await new Promise((resolve) => setTimeout(resolve, 180));
    window.Game.Renderer.renderWorld(true);
    const after = JSON.stringify({
      seed: world.seed,
      rows: world.rows,
      cols: world.cols,
      player: { row: world.player.row, col: world.player.col }
    });
    return { values, before, after, metrics: scheduler.metrics() };
  });

  expect(result.values).toEqual(['new']);
  expect(result.after).toBe(result.before);
  expect(result.metrics.authority).toBe('scheduling-only');
  expect(result.metrics.failedJobs).toBe(0);
  expect(failures).toEqual([]);
});
