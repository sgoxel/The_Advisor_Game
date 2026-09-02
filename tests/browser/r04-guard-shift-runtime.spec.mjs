import { test, expect } from '@playwright/test';

async function ready(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.GuardShiftRuntime?.applyAt &&
    window.Game?.GuardDutyAnchors?.sync &&
    window.Game?.NPCSpatial?.resolveOccupancy &&
    window.Game?.NPCTerrainRouting?.refreshRoutes &&
    window.Game?.State?.world?.originVillage &&
    Array.isArray(window.Game?.State?.world?.npcs) &&
    window.Game.State.world.npcs.length > 0
  ), null, { timeout: 30_000 });
  return { pageErrors, consoleErrors };
}

function pointKey(value) {
  return `${Math.trunc(Number(value?.row))},${Math.trunc(Number(value?.col))}`;
}

function routeContains(route, point) {
  return Array.isArray(route) && route.some((entry) => Number(entry.row) === Number(point?.row) && Number(entry.col) === Number(point?.col));
}

test('guard assignments are deterministic and pair day/night shifts on authoritative duty anchors', async ({ page }) => {
  const errors = await ready(page);
  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    Game.GameTime.stop();
    Game.NPCSpatial.ensureSpatialNpcs();
    Game.GuardShiftRuntime.sync();
    Game.NPCTerrainRouting.refreshRoutes();
    Game.GuardShiftRuntime.sync();

    const first = JSON.parse(JSON.stringify(Game.State.world.guardShiftRuntime));
    const npcAssignmentsFirst = Game.State.world.npcs
      .filter((npc) => npc.guardShiftAssignment?.dutyAnchorId)
      .map((npc) => ({
        id: npc.id,
        shift: npc.guardShiftAssignment.shift,
        dutyAnchorId: npc.guardShiftAssignment.dutyAnchorId,
        dutySide: npc.guardShiftAssignment.dutySide,
        workplaceBuildingId: npc.guardShiftAssignment.workplaceBuildingId,
        home: { row: npc.anchors.home.row, col: npc.anchors.home.col },
        work: { row: npc.anchors.work.row, col: npc.anchors.work.col, guardDuty: npc.anchors.work.guardDuty, outdoor: npc.anchors.work.outdoor, source: npc.anchors.work.source }
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    Game.GuardShiftRuntime.sync();
    const second = JSON.parse(JSON.stringify(Game.State.world.guardShiftRuntime));
    const npcAssignmentsSecond = Game.State.world.npcs
      .filter((npc) => npc.guardShiftAssignment?.dutyAnchorId)
      .map((npc) => ({ id: npc.id, shift: npc.guardShiftAssignment.shift, dutyAnchorId: npc.guardShiftAssignment.dutyAnchorId, dutySide: npc.guardShiftAssignment.dutySide }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    return { first, second, npcAssignmentsFirst, npcAssignmentsSecond };
  });

  expect(evidence.first.authority).toBe('simulation');
  expect(evidence.first.clockAuthority).toBe('Game.GameTime');
  expect(evidence.first.assignmentCount).toBeGreaterThanOrEqual(2);
  expect(evidence.first.assignments).toEqual(evidence.second.assignments);
  expect(evidence.npcAssignmentsFirst.map(({ id, shift, dutyAnchorId, dutySide }) => ({ id, shift, dutyAnchorId, dutySide }))).toEqual(evidence.npcAssignmentsSecond);
  expect(new Set(evidence.npcAssignmentsFirst.map((item) => item.shift))).toEqual(new Set(['day', 'night']));

  for (const assignment of evidence.npcAssignmentsFirst) {
    expect(assignment.work.guardDuty).toBe(true);
    expect(assignment.work.outdoor).toBe(true);
    expect(assignment.work.source).toBe('guard-duty-anchors');
  }

  const byAnchor = new Map();
  for (const assignment of evidence.npcAssignmentsFirst) {
    const pair = byAnchor.get(assignment.dutyAnchorId) || [];
    pair.push(assignment.shift);
    byAnchor.set(assignment.dutyAnchorId, pair);
  }
  expect(Array.from(byAnchor.values()).some((shifts) => shifts.includes('day') && shifts.includes('night'))).toBe(true);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors.filter((line) => !/favicon/i.test(line))).toEqual([]);
});

test('pure guard policy uses authoritative GameTime windows and existing route legs', async ({ page }) => {
  const errors = await ready(page);
  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    Game.GameTime.stop();
    Game.NPCSpatial.ensureSpatialNpcs();
    Game.GuardShiftRuntime.sync();
    Game.NPCTerrainRouting.refreshRoutes();
    Game.GuardShiftRuntime.sync();
    const guards = Game.State.world.npcs.filter((npc) => npc.guardShiftAssignment?.dutyAnchorId);
    const day = guards.find((npc) => npc.guardShiftAssignment.shift === 'day');
    const night = guards.find((npc) => npc.guardShiftAssignment.shift === 'night');
    if (!day || !night) throw new Error('Expected representative day and night guard assignments.');

    function sample(npc, minute) {
      const desired = Game.GuardShiftRuntime.desiredFor(npc, minute);
      return {
        activity: desired?.activity || null,
        point: desired?.point ? { row: desired.point.row, col: desired.point.col } : null,
        home: { row: npc.anchors.home.row, col: npc.anchors.home.col },
        work: { row: npc.anchors.work.row, col: npc.anchors.work.col },
        homeToWork: npc.spatialRoutes.homeToWork.map((p) => ({ row: p.row, col: p.col })),
        workToSocial: npc.spatialRoutes.workToSocial.map((p) => ({ row: p.row, col: p.col }))
      };
    }

    return {
      dayCommute: sample(day, 6 * 60 + 30),
      dayDuty: sample(day, 7 * 60 + 30),
      dayReturn: sample(day, 18 * 60 + 30),
      dayOff: sample(day, 20 * 60),
      nightCommute: sample(night, 18 * 60 + 30),
      nightDuty: sample(night, 19 * 60 + 30),
      nightReturn: sample(night, 6 * 60 + 30),
      nightOff: sample(night, 8 * 60)
    };
  });

  expect(evidence.dayCommute.activity).toBe('commuting-to-guard-duty');
  expect(routeContains(evidence.dayCommute.homeToWork, evidence.dayCommute.point)).toBe(true);
  expect(evidence.dayDuty.activity).toBe('guarding');
  expect(pointKey(evidence.dayDuty.point)).toBe(pointKey(evidence.dayDuty.work));
  expect(evidence.dayReturn.activity).toBe('returning-from-guard-duty');
  expect(routeContains(evidence.dayReturn.workToSocial, evidence.dayReturn.point)).toBe(true);
  expect(evidence.dayOff.activity).toBe('off-duty');
  expect(pointKey(evidence.dayOff.point)).toBe(pointKey(evidence.dayOff.home));

  expect(evidence.nightCommute.activity).toBe('commuting-to-guard-duty');
  expect(routeContains(evidence.nightCommute.homeToWork, evidence.nightCommute.point)).toBe(true);
  expect(evidence.nightDuty.activity).toBe('guarding');
  expect(pointKey(evidence.nightDuty.point)).toBe(pointKey(evidence.nightDuty.work));
  expect(evidence.nightReturn.activity).toBe('returning-from-guard-duty');
  expect(routeContains(evidence.nightReturn.workToSocial, evidence.nightReturn.point)).toBe(true);
  expect(evidence.nightOff.activity).toBe('off-duty');
  expect(pointKey(evidence.nightOff.point)).toBe(pointKey(evidence.nightOff.home));
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors.filter((line) => !/favicon/i.test(line))).toEqual([]);
});

test('authoritative application rotates duty collision-safely and reconstructs assignment identity', async ({ page }) => {
  const errors = await ready(page);
  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    Game.GameTime.stop();
    Game.NPCSpatial.ensureSpatialNpcs();
    Game.GuardShiftRuntime.sync();
    Game.NPCTerrainRouting.refreshRoutes();
    Game.GuardShiftRuntime.sync();

    const assignmentBaseline = Game.State.world.npcs
      .filter((npc) => npc.guardShiftAssignment?.dutyAnchorId)
      .map((npc) => ({ id: npc.id, shift: npc.guardShiftAssignment.shift, dutyAnchorId: npc.guardShiftAssignment.dutyAnchorId }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    function apply(minute) {
      if (Game.State.world.npcRuntime) Game.State.world.npcRuntime.lastRoutineStateKey = null;
      Game.GuardShiftRuntime.applyAt(minute);
      const npcs = Game.State.world.npcs;
      const occupied = npcs.map((npc) => `${npc.row},${npc.col}`);
      const guards = npcs.filter((npc) => npc.guardShiftAssignment?.dutyAnchorId).map((npc) => ({
        id: npc.id,
        shift: npc.guardShiftAssignment.shift,
        dutyAnchorId: npc.guardShiftAssignment.dutyAnchorId,
        row: npc.row,
        col: npc.col,
        activity: npc.activity,
        movementDecision: npc.movementDecision,
        home: { row: npc.anchors.home.row, col: npc.anchors.home.col },
        work: { row: npc.anchors.work.row, col: npc.anchors.work.col }
      }));
      return {
        uniqueOccupancy: new Set(occupied).size === occupied.length,
        guards,
        runtime: JSON.parse(JSON.stringify(Game.State.world.guardShiftRuntime))
      };
    }

    const dayState = apply(8 * 60);
    const nightState = apply(20 * 60);
    const dawnHandoff = apply(6 * 60);
    const duskHandoff = apply(18 * 60);

    for (const npc of Game.State.world.npcs) delete npc.guardShiftAssignment;
    Game.GuardShiftRuntime.sync();
    const reconstructed = Game.State.world.npcs
      .filter((npc) => npc.guardShiftAssignment?.dutyAnchorId)
      .map((npc) => ({ id: npc.id, shift: npc.guardShiftAssignment.shift, dutyAnchorId: npc.guardShiftAssignment.dutyAnchorId }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    return { assignmentBaseline, reconstructed, dayState, nightState, dawnHandoff, duskHandoff };
  });

  expect(evidence.reconstructed).toEqual(evidence.assignmentBaseline);
  for (const state of [evidence.dayState, evidence.nightState, evidence.dawnHandoff, evidence.duskHandoff]) {
    expect(state.uniqueOccupancy).toBe(true);
    expect(state.runtime.authority).toBe('simulation');
    expect(state.runtime.clockAuthority).toBe('Game.GameTime');
    expect(state.runtime.lastAppliedGameMinutes).toBeGreaterThanOrEqual(0);
  }

  expect(evidence.dayState.guards.filter((guard) => guard.shift === 'day').every((guard) => guard.activity === 'guarding')).toBe(true);
  expect(evidence.dayState.guards.filter((guard) => guard.shift === 'night').every((guard) => guard.activity === 'off-duty')).toBe(true);
  expect(evidence.nightState.guards.filter((guard) => guard.shift === 'night').every((guard) => guard.activity === 'guarding')).toBe(true);
  expect(evidence.nightState.guards.filter((guard) => guard.shift === 'day').every((guard) => guard.activity === 'off-duty')).toBe(true);

  for (const state of [evidence.dawnHandoff, evidence.duskHandoff]) {
    const byAnchor = new Map();
    for (const guard of state.guards) {
      const key = guard.dutyAnchorId;
      const list = byAnchor.get(key) || [];
      list.push(guard);
      byAnchor.set(key, list);
    }
    for (const pair of byAnchor.values()) {
      if (pair.length < 2) continue;
      expect(new Set(pair.map((guard) => `${guard.row},${guard.col}`)).size).toBe(pair.length);
    }
  }

  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors.filter((line) => !/favicon/i.test(line))).toEqual([]);
});
