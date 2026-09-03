import { test, expect } from '@playwright/test';

test('populated starter village drives one bounded autonomous protagonist step through Simulation', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.AutonomousProtagonistRuntime?.tick &&
    window.Game?.AutonomousDecisionLoop?.resolvePrepared &&
    window.Game?.ProtagonistRoutine?.buildRoutineOpportunity &&
    window.Game?.TerrainRouting?.findPath &&
    window.Game?.WorldActionResolution?.resolveSpatial &&
    window.Game?.GameTime?.setForTest &&
    window.Game?.State?.world?.rows === 100 &&
    Array.isArray(window.Game?.State?.world?.npcs) &&
    window.Game.State.world.npcs.length >= 16
  ));

  const result = await page.evaluate(() => {
    const Game = window.Game;
    const runtime = Game.AutonomousProtagonistRuntime;
    runtime.stop();
    Game.GameTime.stop();
    Game.WorldDeltaPersistence?.clearAll?.();

    const player = Game.State.world.player;
    const beforeNpcState = Game.State.world.npcs.map((npc) => ({ id: npc.id, row: npc.row, col: npc.col }));
    const start = { row: player.row, col: player.col };
    const attempts = [];
    let resolved = null;

    for (const minute of [600, 720, 1080, 1260, 1320]) {
      Game.WorldDeltaPersistence?.clearAll?.();
      Game.GameTime.setForTest(minute);
      Game.ProtagonistRoutine.refresh(minute);
      const trace = runtime.tick();
      attempts.push(trace);
      if (trace?.status === 'resolved' && trace?.result?.execution?.simulationStatus === 'resolved') {
        resolved = trace;
        break;
      }
    }

    return {
      start,
      end: { row: player.row, col: player.col },
      resolved,
      attempts,
      npcStable: JSON.stringify(beforeNpcState) === JSON.stringify(Game.State.world.npcs.map((npc) => ({ id: npc.id, row: npc.row, col: npc.col }))),
      population: Game.State.world.npcs.length,
      schedulerPresent: Boolean(Game.FrameBudgetScheduler?.metrics),
      runtimeDiagnostics: runtime.diagnostics()
    };
  });

  expect(result.population).toBeGreaterThanOrEqual(16);
  expect(result.schedulerPresent).toBe(true);
  expect(result.resolved, JSON.stringify(result.attempts)).toBeTruthy();
  expect(result.resolved.route.pathLength).toBeGreaterThan(1);
  expect(result.resolved.route.next).toEqual(result.end);
  expect(Math.abs(result.end.row - result.resolved.route.start.row) + Math.abs(result.end.col - result.resolved.route.start.col)).toBe(1);
  expect(result.end).not.toEqual(result.start);
  expect(result.npcStable).toBe(true);
  expect(result.runtimeDiagnostics.actorId).toBeTruthy();
  expect(result.runtimeDiagnostics.reasonCode).toBe('OK');
  expect(errors).toEqual([]);
});

test('runtime preserves deterministic wait/reconsideration and never binds player preview as movement authority', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.AutonomousProtagonistRuntime?.tick && window.Game?.Input?.buildPathToTarget));

  const result = await page.evaluate(() => {
    const Game = window.Game;
    Game.AutonomousProtagonistRuntime.stop();
    Game.GameTime.stop();
    Game.WorldDeltaPersistence?.clearAll?.();
    Game.GameTime.setForTest(600);
    const player = Game.State.world.player;
    const before = { row: player.row, col: player.col };

    // Input path construction remains a preview only; it must not mutate protagonist truth.
    const preview = Game.Input.buildPathToTarget(Math.max(0, player.row - 1), player.col);
    const afterPreview = { row: player.row, col: player.col };

    Game.ProtagonistRoutine.refresh(600);
    const first = Game.AutonomousProtagonistRuntime.tick();
    const afterFirst = { row: player.row, col: player.col };
    const second = Game.AutonomousProtagonistRuntime.tick();
    const afterSecond = { row: player.row, col: player.col };
    return { before, previewLength: preview.length, afterPreview, first, afterFirst, second, afterSecond };
  });

  expect(result.afterPreview).toEqual(result.before);
  expect(result.first.status).toBe('resolved');
  expect(result.afterFirst).not.toEqual(result.before);
  expect(['wait', 'idle']).toContain(result.second.status);
  expect(result.afterSecond).toEqual(result.afterFirst);
});
