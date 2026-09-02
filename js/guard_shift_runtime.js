/* R04 / #261: deterministic day/night guard-shift policy over existing NPCSpatial/#257 routing. */
(function installGuardShiftRuntime() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-guard-shift-runtime-v2-spatial-integration';
  const MINUTES_PER_DAY = 24 * 60;
  const DAY_START = 6 * 60;
  const NIGHT_START = 18 * 60;
  const COMMUTE_MINUTES = 60;
  let spatialBridgeInstalled = false;
  let renderHookInstalled = false;
  let applying = false;

  function normalized(value) { return String(value ?? '').trim().toLowerCase().replace(/[ _]+/g, '-'); }
  function isGuard(npc) { return ['guard', 'militia'].includes(normalized(npc?.currentProfession || npc?.profession || npc?.occupation || npc?.role)); }
  function binding(world) { return world?.npcRuntime?.originBinding || { rowOffset: 0, colOffset: 0 }; }
  function strategic(local, b) {
    return {
      row: Number(local.row) + Number(b.rowOffset || 0),
      col: Number(local.col) + Number(b.colOffset || 0),
      localRow: Number(local.row),
      localCol: Number(local.col)
    };
  }
  function minuteOfDay(totalGameMinutes) {
    const value = Number(totalGameMinutes || 0);
    return ((value % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  }
  function onDuty(shift, minute) {
    return shift === 'day' ? minute >= DAY_START && minute < NIGHT_START : minute >= NIGHT_START || minute < DAY_START;
  }
  function sinceStart(shift, minute) {
    if (shift === 'day') return minute - DAY_START;
    return minute >= NIGHT_START ? minute - NIGHT_START : minute + MINUTES_PER_DAY - NIGHT_START;
  }
  function sinceEnd(shift, minute) {
    if (shift === 'day') return minute >= NIGHT_START ? minute - NIGHT_START : minute + MINUTES_PER_DAY - NIGHT_START;
    return minute >= DAY_START ? minute - DAY_START : minute + MINUTES_PER_DAY - DAY_START;
  }
  function routePoint(route, progress, sampleRoutePoint) {
    if (typeof sampleRoutePoint === 'function') return sampleRoutePoint(route, progress);
    if (!Array.isArray(route) || !route.length) return null;
    const t = Math.max(0, Math.min(1, Number(progress) || 0));
    return route[Math.min(route.length - 1, Math.floor(t * route.length))] || null;
  }
  function gameMinutes() {
    const captured = Game.GameTime?.capture?.();
    const value = Number(captured?.totalGameMinutes ?? Game.State?.world?.gameTime?.totalGameMinutes ?? 0);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function sync() {
    const world = Game.State?.world;
    if (!world || !Array.isArray(world.npcs)) return false;
    Game.GuardDutyAnchors?.sync?.();
    Game.NPCWorkplaces?.sync?.();
    const anchors = world.guardDutyAnchors?.anchors || [];
    const guards = world.npcs.filter(isGuard).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (!anchors.length || !guards.length) {
      world.guardShiftRuntime = Object.freeze({ version: VERSION, authority: 'simulation', assignmentCount: 0, activeAnchorCount: 0, assignments: Object.freeze([]) });
      return false;
    }

    const b = binding(world);
    const assignments = [];
    for (let index = 0; index < guards.length; index += 1) {
      const npc = guards[index];
      const pairIndex = Math.floor(index / 2);
      const anchor = anchors[pairIndex % anchors.length];
      const shift = index % 2 === 0 ? 'day' : 'night';
      const duty = strategic(anchor, b);
      npc.anchors = npc.anchors || {};
      npc.anchors.work = {
        ...(npc.anchors.work || {}),
        ...duty,
        buildingId: null,
        indoor: false,
        outdoor: true,
        guardDuty: true,
        dutyAnchorId: anchor.id,
        dutySide: anchor.side,
        source: 'guard-duty-anchors'
      };
      // Off-duty guards return through the same authoritative home anchor. Giving the
      // routing bridge a home-backed social endpoint yields a legal duty->home leg without
      // introducing another route algorithm.
      npc.anchors.social = { ...(npc.anchors.home || npc.anchors.social), guardOffDutyHome: true };
      npc.guardShiftAssignment = Object.freeze({
        authority: 'simulation',
        shift,
        dutyAnchorId: anchor.id,
        dutySide: anchor.side,
        workplaceBuildingId: anchor.workplaceBuildingId || null,
        dayStartMinute: DAY_START,
        nightStartMinute: NIGHT_START
      });
      assignments.push(Object.freeze({ npcId: npc.id, shift, dutyAnchorId: anchor.id, dutySide: anchor.dutySide, row: duty.row, col: duty.col, workplaceBuildingId: anchor.workplaceBuildingId || null }));
    }

    world.guardShiftRuntime = Object.freeze({
      version: VERSION,
      authority: 'simulation',
      clockAuthority: 'Game.GameTime',
      dayWindow: Object.freeze({ startMinute: DAY_START, endMinute: NIGHT_START }),
      nightWindow: Object.freeze({ startMinute: NIGHT_START, endMinute: DAY_START }),
      commuteMinutes: COMMUTE_MINUTES,
      activeAnchorCount: new Set(assignments.map((entry) => entry.dutyAnchorId)).size,
      assignmentCount: assignments.length,
      assignments: Object.freeze(assignments)
    });
    return true;
  }

  function desiredFor(npc, totalGameMinutes, sampleRoutePoint) {
    const assignment = npc?.guardShiftAssignment;
    if (!assignment?.dutyAnchorId) return null;
    const minute = minuteOfDay(totalGameMinutes);
    if (onDuty(assignment.shift, minute)) {
      const elapsed = Math.max(0, sinceStart(assignment.shift, minute));
      if (elapsed < COMMUTE_MINUTES) {
        return {
          point: routePoint(npc.spatialRoutes?.homeToWork, elapsed / COMMUTE_MINUTES, sampleRoutePoint) || npc.anchors?.work,
          activity: 'commuting-to-guard-duty'
        };
      }
      return { point: npc.anchors?.work, activity: 'guarding' };
    }

    const elapsedOffDuty = Math.max(0, sinceEnd(assignment.shift, minute));
    if (elapsedOffDuty < COMMUTE_MINUTES) {
      return {
        point: routePoint(npc.spatialRoutes?.workToSocial, elapsedOffDuty / COMMUTE_MINUTES, sampleRoutePoint) || npc.anchors?.home,
        activity: 'returning-from-guard-duty'
      };
    }
    return { point: npc.anchors?.home, activity: 'off-duty' };
  }

  // Apply only guard targets through the existing #237 occupancy resolver. Non-guards are
  // fixed at their already-authoritative positions, so #261 does not create a second route
  // engine or move unrelated NPCs. #257 routes supply the sampled commute points.
  function applyAt(totalGameMinutesInput = null) {
    if (applying) return false;
    const world = Game.State?.world;
    const spatial = Game.NPCSpatial;
    if (!world || !Array.isArray(world.npcs) || typeof spatial?.resolveOccupancy !== 'function') return false;
    const totalGameMinutes = totalGameMinutesInput == null ? gameMinutes() : Number(totalGameMinutesInput);
    // Re-entering through NPCSpatial/render wrappers at the same authoritative GameTime must
    // be observationally stable. Re-running occupancy here can otherwise rewrite only the
    // guard movementDecision (for example move -> hold) without any Simulation-time advance.
    if (Number(world.guardShiftRuntime?.lastAppliedGameMinutes) === totalGameMinutes) return true;
    applying = true;
    try {
      sync();
      const desiredMap = new Map();
      const fixedNpcIds = new Set();
      const guards = [];
      for (const npc of world.npcs) {
        if (isGuard(npc) && npc.guardShiftAssignment?.dutyAnchorId) {
          const desired = desiredFor(npc, totalGameMinutes);
          if (desired?.point) {
            desiredMap.set(npc.id, desired);
            guards.push(npc);
            continue;
          }
        }
        fixedNpcIds.add(npc.id);
        desiredMap.set(npc.id, { point: { row: npc.row, col: npc.col }, activity: npc.activity || 'idle' });
      }
      if (!guards.length) return false;

      const resolution = spatial.resolveOccupancy(world.npcs, desiredMap, {
        village: world.originVillage,
        seed: world.seed,
        step: Math.floor(Number(totalGameMinutes) || 0),
        fixedNpcIds
      });
      const b = binding(world);
      let activeDutyCount = 0;
      for (const npc of guards) {
        const resolved = resolution.resolved.get(npc.id);
        const desired = desiredMap.get(npc.id);
        if (!resolved || !desired) continue;
        npc.row = resolved.point.row;
        npc.col = resolved.point.col;
        npc.localRow = npc.row - Number(b.rowOffset || 0);
        npc.localCol = npc.col - Number(b.colOffset || 0);
        npc.activity = desired.activity;
        npc.movementDecision = resolved.decision;
        npc.dialogueWith = null;
        npc.dialogueLine = null;
        if (desired.activity === 'guarding') activeDutyCount += 1;
        Game.NPCRelevanceRuntime?.markAuthoritativeUpdated?.(npc, totalGameMinutes);
      }

      const prior = world.guardShiftRuntime || {};
      world.guardShiftRuntime = Object.freeze({
        ...prior,
        version: VERSION,
        authority: 'simulation',
        clockAuthority: 'Game.GameTime',
        lastAppliedGameMinutes: totalGameMinutes,
        activeDutyCount,
        collisionCount: resolution.collisionCount,
        sideStepCount: resolution.sideStepCount,
        yieldWaitCount: resolution.yieldWaitCount
      });
      return true;
    } finally {
      applying = false;
    }
  }

  function installSpatialBridge() {
    if (spatialBridgeInstalled || !Game.NPCSpatial || typeof Game.NPCSpatial.updateAt !== 'function') return spatialBridgeInstalled;
    const spatial = Game.NPCSpatial;
    const originalUpdateAt = spatial.updateAt.bind(spatial);
    Game.NPCSpatial = Object.freeze({
      ...spatial,
      updateAt(...args) {
        const result = originalUpdateAt(...args);
        applyAt();
        return result;
      }
    });
    spatialBridgeInstalled = true;
    return true;
  }

  function installRenderHook() {
    if (renderHookInstalled || !Game.Renderer || typeof Game.Renderer.renderWorld !== 'function') return renderHookInstalled;
    const renderWorld = Game.Renderer.renderWorld.bind(Game.Renderer);
    Game.Renderer.renderWorld = function guardShiftRenderWorld(...args) {
      const result = renderWorld(...args);
      applyAt();
      return result;
    };
    renderHookInstalled = true;
    return true;
  }

  function initialize() {
    if (!Game.NPCSpatial || !Game.GuardDutyAnchors) return false;
    Game.NPCSpatial.ensureSpatialNpcs?.();
    sync();
    installSpatialBridge();
    installRenderHook();
    applyAt();
    return true;
  }

  Game.GuardShiftRuntime = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    clockAuthority: 'Game.GameTime',
    dayStartMinute: DAY_START,
    nightStartMinute: NIGHT_START,
    commuteMinutes: COMMUTE_MINUTES,
    isGuard,
    sync,
    desiredFor,
    applyAt,
    installSpatialBridge,
    installRenderHook,
    initialize
  });

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
    else initialize();
  }
})();
