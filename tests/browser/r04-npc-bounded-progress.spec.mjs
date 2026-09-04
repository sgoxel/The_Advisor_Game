import { test, expect } from '@playwright/test';

test('dense starter-village travel makes bounded authoritative progress without overlap', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCBoundedProgressRuntime?.diagnostics &&
    window.Game?.NPCSpatial?.boundedProgressVersion &&
    window.Game?.GameTime?.setForTest &&
    window.Game?.State?.world?.rows === 100 &&
    Array.isArray(window.Game?.State?.world?.npcs) &&
    window.Game.State.world.npcs.length >= 16 &&
    window.Game?.State?.world?.npcTerrainRouting?.routedNpcCount >= 10
  ));

  const result = await page.evaluate(() => {
    const Game = window.Game;
    Game.GameTime.stop();
    const world = Game.State.world;
    const snapshots = [];
    const movedIds = new Set();
    const travelIds = new Set();
    let allUnique = true;
    let maxDelta = 0;
    let diagnosticShapeOk = true;
    let previous = new Map(world.npcs.map((npc) => [String(npc.id), { row: npc.row, col: npc.col }]));
    const configuredCadences = Object.values(Game.NPCRelevanceRuntime?.cadenceMinutes || {})
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0);
    const maxAuthoritativeCadence = Math.max(10, ...configuredCadences);
    const finalMinute = 240 + Math.ceil(maxAuthoritativeCadence);

    // #351 deliberately phases background authoritative work by NPC identity. Exercise at
    // least one complete configured cadence so #237 proves bounded progress without forcing
    // every background NPC to become due inside an older, shorter fixed sampling window.
    for (let minute = 240; minute <= finalMinute; minute += 1) {
      Game.GameTime.setForTest(minute);
      Game.NPCSpatial.updateAt();
      const positions = world.npcs.map((npc) => ({
        id: String(npc.id), row: npc.row, col: npc.col,
        activity: String(npc.activity || ''), decision: String(npc.movementDecision || '')
      }));
      if (new Set(positions.map((npc) => `${npc.row},${npc.col}`)).size !== positions.length) allUnique = false;

      for (const npc of positions) {
        const before = previous.get(npc.id);
        if (!before) continue;
        const delta = Math.abs(npc.row - before.row) + Math.abs(npc.col - before.col);
        maxDelta = Math.max(maxDelta, delta);
        if (['commuting-to-work', 'local-errand', 'returning-home'].includes(npc.activity)) {
          travelIds.add(npc.id);
          if (delta === 1) movedIds.add(npc.id);
        }
      }
      previous = new Map(positions.map((npc) => [npc.id, { row: npc.row, col: npc.col }]));
      const diagnostics = Game.NPCBoundedProgressRuntime.diagnostics();
      if (diagnostics?.rows?.length) {
        diagnosticShapeOk = diagnosticShapeOk && diagnostics.rows.every((row) => (
          typeof row.npcId === 'string' &&
          row.before && Number.isInteger(row.before.row) && Number.isInteger(row.before.col) &&
          Object.prototype.hasOwnProperty.call(row, 'blockedReason') &&
          Number.isInteger(row.fairnessDebt)
        ));
      }
      snapshots.push({ minute, diagnostics, positions });
    }

    const finalDiagnostics = Game.NPCBoundedProgressRuntime.diagnostics();
    return {
      population: world.npcs.length,
      travelCount: travelIds.size,
      progressedCount: movedIds.size,
      progressedIds: [...movedIds].sort(),
      allUnique,
      maxDelta,
      diagnosticShapeOk,
      maxAuthoritativeCadence,
      finalDiagnostics,
      snapshots: snapshots.map((entry) => ({
        minute: entry.minute,
        travelCount: entry.diagnostics?.travelCount ?? 0,
        movedCount: entry.diagnostics?.movedCount ?? 0,
        blockedCount: entry.diagnostics?.blockedCount ?? 0
      }))
    };
  });

  expect(result.population).toBeGreaterThanOrEqual(16);
  expect(result.travelCount).toBeGreaterThanOrEqual(10);
  expect(result.progressedCount, JSON.stringify({ cadence: result.maxAuthoritativeCadence, snapshots: result.snapshots })).toBeGreaterThanOrEqual(10);
  expect(result.allUnique).toBe(true);
  expect(result.maxDelta).toBeLessThanOrEqual(1);
  expect(result.diagnosticShapeOk).toBe(true);
  expect(result.finalDiagnostics.authority).toBe('simulation');
  expect(result.finalDiagnostics.population).toBe(result.population);
  expect(result.finalDiagnostics.rows.length).toBeLessThanOrEqual(32);
  expect(pageErrors).toEqual([]);
});

test('same authoritative minute is idempotent and blocked travel exposes an evidenced reason', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.NPCSpatial?.boundedProgressVersion && window.Game?.GameTime?.setForTest));

  const result = await page.evaluate(() => {
    const Game = window.Game;
    Game.GameTime.stop();
    Game.GameTime.setForTest(240);
    Game.NPCSpatial.updateAt();
    const first = Game.State.world.npcs.map((npc) => ({ id: String(npc.id), row: npc.row, col: npc.col }));
    const firstDiagnostics = Game.NPCBoundedProgressRuntime.diagnostics();
    Game.NPCSpatial.updateAt(987654321);
    const second = Game.State.world.npcs.map((npc) => ({ id: String(npc.id), row: npc.row, col: npc.col }));
    const secondDiagnostics = Game.NPCBoundedProgressRuntime.diagnostics();
    const stalledRows = (secondDiagnostics?.rows || []).filter((row) => !row.moved);
    return { first, second, firstDiagnostics, secondDiagnostics, stalledRows };
  });

  expect(result.second).toEqual(result.first);
  expect(result.secondDiagnostics.step).toBe(result.firstDiagnostics.step);
  for (const row of result.stalledRows) expect(row.blockedReason).toBeTruthy();
});

test('route-step selection stays anchored to the preserved pre-update authoritative tile', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.NPCBoundedProgressRuntime?.nextRouteStep));

  const result = await page.evaluate(() => {
    const npc = {
      id: 'bounded-origin-regression',
      activity: 'local-errand',
      row: 50,
      col: 50,
      spatialRoutes: {
        workToSocial: [
          { row: 10, col: 10 },
          { row: 10, col: 11 },
          { row: 10, col: 12 },
          { row: 50, col: 50 }
        ]
      }
    };
    return window.Game.NPCBoundedProgressRuntime.nextRouteStep(npc, { row: 10, col: 10 });
  });

  expect(result.ok).toBe(true);
  expect(result.current).toEqual({ row: 10, col: 10 });
  expect(result.next).toEqual({ row: 10, col: 11 });
  expect(Math.abs(result.next.row - result.current.row) + Math.abs(result.next.col - result.current.col)).toBe(1);
});
