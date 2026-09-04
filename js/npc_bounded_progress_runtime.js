/* R04 / #237 — bounded authoritative NPC route progress on top of existing occupancy/routing. */
(function installNpcBoundedProgressRuntime(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-npc-bounded-progress-v1';
  const TRAVEL_ACTIVITY = Object.freeze({
    'commuting-to-work': 'homeToWork',
    'local-errand': 'workToSocial',
    'returning-home': 'socialToHome'
  });
  const MAX_DIAGNOSTIC_ROWS = 32;
  let installed = false;
  let lastProcessedStateKey = null;
  let lastDiagnostics = null;

  function point(value) {
    return { row: Math.trunc(Number(value?.row) || 0), col: Math.trunc(Number(value?.col) || 0) };
  }
  function same(a, b) { return Boolean(a && b && a.row === b.row && a.col === b.col); }
  function distance(a, b) { return Math.abs(a.row - b.row) + Math.abs(a.col - b.col); }
  function key(value) { const p = point(value); return `${p.row},${p.col}`; }
  function waitDebt(npc) { return Math.max(0, Math.trunc(Number(npc?.movementWaitStreak) || 0)); }
  function clone(value) { try { return JSON.parse(JSON.stringify(value)); } catch (_error) { return null; } }
  function currentMinutes() {
    const value = Number(Game.GameTime?.capture?.()?.totalGameMinutes ?? Game.State?.world?.gameTime?.totalGameMinutes ?? 0);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function routeFor(npc) {
    const routeName = TRAVEL_ACTIVITY[String(npc?.activity || '')];
    const route = routeName ? npc?.spatialRoutes?.[routeName] : null;
    return { routeName, route: Array.isArray(route) ? route.map(point) : [] };
  }

  function nextRouteStep(npc, currentOverride = null) {
    const current = currentOverride ? point(currentOverride) : point(npc);
    const { routeName, route } = routeFor(npc);
    if (!routeName || route.length < 2) return { ok: false, reasonCode: routeName ? 'ROUTE_UNAVAILABLE' : 'NOT_TRAVELLING', routeName, current };

    const exactIndex = route.findIndex((candidate) => same(candidate, current));
    if (exactIndex >= 0) {
      if (exactIndex >= route.length - 1) return { ok: false, reasonCode: 'ROUTE_GOAL_REACHED', routeName, current, routeIndex: exactIndex };
      const next = route[exactIndex + 1];
      if (distance(current, next) !== 1) return { ok: false, reasonCode: 'ROUTE_NOT_ADJACENT', routeName, current, routeIndex: exactIndex };
      return { ok: true, routeName, current, next, routeIndex: exactIndex + 1, routeLength: route.length };
    }

    // Conflict side-steps can temporarily put an NPC next to, rather than exactly on, its
    // canonical route. Rejoin only through an adjacent forward route point; never jump.
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let index = 0; index < route.length; index += 1) {
      const candidateDistance = distance(current, route[index]);
      if (candidateDistance < nearestDistance) {
        nearestDistance = candidateDistance;
        nearestIndex = index;
      }
    }
    for (let index = nearestIndex; index < route.length; index += 1) {
      if (distance(current, route[index]) === 1) {
        return { ok: true, routeName, current, next: route[index], routeIndex: index, routeLength: route.length, rejoin: true };
      }
    }
    return { ok: false, reasonCode: 'ROUTE_REPLAN_REQUIRED', routeName, current, nearestIndex, nearestDistance };
  }

  function applyResolvedNpc(npc, resolved, desired, binding) {
    if (!resolved) return;
    npc.row = resolved.point.row;
    npc.col = resolved.point.col;
    npc.localRow = npc.row - Number(binding?.rowOffset || 0);
    npc.localCol = npc.col - Number(binding?.colOffset || 0);
    npc.intendedRow = desired?.row ?? null;
    npc.intendedCol = desired?.col ?? null;
    npc.movementDecision = resolved.decision || 'hold';
    npc.movementBlockedBy = resolved.blockedBy || null;
    npc.movementWaitStreak = Math.max(0, Math.trunc(Number(resolved.waitStreak) || 0));
  }

  function install() {
    if (installed || !Game.NPCSpatial?.updateAt || !Game.NPCSpatial?.resolveOccupancy) return installed;
    const spatial = Game.NPCSpatial;
    const originalUpdateAt = spatial.updateAt.bind(spatial);
    const originalResolveOccupancy = spatial.resolveOccupancy.bind(spatial);

    function boundedUpdateAt(legacyElapsedMs = null) {
      const worldBefore = Game.State?.world;
      const beforeById = new Map((worldBefore?.npcs || []).map((npc) => [String(npc.id), point(npc)]));
      const relevance = Game.NPCRelevanceRuntime;
      const prePassMinutes = currentMinutes();
      const dueById = new Map((worldBefore?.npcs || []).map((npc) => [
        String(npc.id),
        typeof relevance?.authoritativeDue === 'function' ? relevance.authoritativeDue(npc, prePassMinutes) : true
      ]));
      const result = originalUpdateAt(legacyElapsedMs);
      const world = Game.State?.world;
      if (!world || !Array.isArray(world.npcs) || !world.originVillage) return result;

      const totalGameMinutes = currentMinutes();
      const step = Math.floor(totalGameMinutes);
      const stateKey = `${String(world.seed || '')}|${String(world.npcRuntime?.bindingKey || '')}|${step}`;
      if (lastProcessedStateKey === stateKey) return result;
      lastProcessedStateKey = stateKey;

      const binding = world.npcRuntime?.originBinding || { rowOffset: 0, colOffset: 0 };
      const desiredMap = new Map();
      const fixedNpcIds = new Set();
      const dialogueNpcIds = new Set((world.npcDialogues || []).flatMap((dialogue) => [dialogue?.speakerId, dialogue?.listenerId]).filter(Boolean));
      const travel = [];

      for (const npc of world.npcs) {
        const due = dueById.get(String(npc.id)) ?? true;
        const before = beforeById.get(String(npc.id)) || point(npc);
        const routeStep = due ? nextRouteStep(npc, before) : { ok: false, reasonCode: 'RELEVANCE_NOT_DUE' };

        // Canonical #237 dialogue placement has already reserved an adjacent pair in the
        // first occupancy pass. Keep those authoritative dialogue tiles fixed so this
        // bounded-progress bridge cannot invalidate the stored dialogue adjacency.
        if (dialogueNpcIds.has(npc.id)) {
          fixedNpcIds.add(npc.id);
          desiredMap.set(npc.id, { point: point(npc), activity: npc.activity || 'idle' });
          continue;
        }

        // If the canonical runtime already made one legal adjacent progress step this minute,
        // keep that authoritative result. This bridge only fills the coarse desired-index gap.
        if (due && TRAVEL_ACTIVITY[String(npc.activity || '')] && distance(before, point(npc)) === 1) {
          fixedNpcIds.add(npc.id);
          desiredMap.set(npc.id, { point: point(npc), activity: npc.activity || 'idle' });
          travel.push({ npc, before, requested: point(npc), preResolved: true, routeStep });
          continue;
        }

        if (routeStep.ok) {
          // Re-run only the travelling actors from their prior authoritative tile so the
          // existing #237 occupancy resolver arbitrates all conflicts and fairness debt.
          npc.row = before.row;
          npc.col = before.col;
          npc.localRow = before.row - Number(binding.rowOffset || 0);
          npc.localCol = before.col - Number(binding.colOffset || 0);
          desiredMap.set(npc.id, { point: routeStep.next, activity: npc.activity || 'idle' });
          travel.push({ npc, before, requested: routeStep.next, preResolved: false, routeStep });
        } else {
          // A route-replan gap is not permission to preserve a coarse canonical jump. If a
          // due travelling NPC cannot derive an adjacent continuation from its prior
          // authoritative tile, hold that prior tile for this minute and expose the reason.
          // The next due pass can rejoin once an adjacent route point is available.
          if (due && TRAVEL_ACTIVITY[String(npc.activity || '')] && distance(before, point(npc)) > 1) {
            npc.row = before.row;
            npc.col = before.col;
            npc.localRow = before.row - Number(binding.rowOffset || 0);
            npc.localCol = before.col - Number(binding.colOffset || 0);
            npc.movementDecision = 'yield-wait';
            npc.movementBlockedBy = null;
          }
          fixedNpcIds.add(npc.id);
          desiredMap.set(npc.id, { point: point(npc), activity: npc.activity || 'idle' });
          if (due && TRAVEL_ACTIVITY[String(npc.activity || '')]) travel.push({ npc, before, requested: null, preResolved: true, routeStep });
        }
      }

      const pending = travel.filter((item) => !item.preResolved);
      let resolution = null;
      if (pending.length) {
        resolution = originalResolveOccupancy(world.npcs, desiredMap, {
          village: world.originVillage,
          seed: world.seed,
          step,
          fixedNpcIds
        });
        for (const item of pending) {
          applyResolvedNpc(item.npc, resolution.resolved.get(item.npc.id), item.requested, binding);
        }
      }

      const rows = [];
      let movedCount = 0;
      let blockedCount = 0;
      for (const item of travel) {
        const after = point(item.npc);
        const moved = distance(item.before, after) === 1;
        if (moved) movedCount += 1;
        const blockedReason = item.routeStep?.ok
          ? (moved ? null : (item.npc.movementBlockedBy ? `occupied:${item.npc.movementBlockedBy}` : String(item.npc.movementDecision || 'hold')))
          : item.routeStep?.reasonCode || 'ROUTE_UNAVAILABLE';
        if (!moved && blockedReason) blockedCount += 1;
        if (rows.length < MAX_DIAGNOSTIC_ROWS) {
          rows.push(Object.freeze({
            npcId: String(item.npc.id),
            activity: String(item.npc.activity || 'idle'),
            routeName: item.routeStep?.routeName || null,
            before: item.before,
            requested: item.requested,
            after,
            moved,
            blockedReason,
            movementDecision: item.npc.movementDecision || 'hold',
            fairnessDebt: waitDebt(item.npc),
            routeIndex: Number.isInteger(item.routeStep?.routeIndex) ? item.routeStep.routeIndex : null,
            routeLength: Number.isInteger(item.routeStep?.routeLength) ? item.routeStep.routeLength : null
          }));
        }
      }

      if (world.npcRuntime) {
        world.npcRuntime.boundedProgressVersion = VERSION;
        world.npcRuntime.boundedProgressStateKey = stateKey;
        world.npcRuntime.boundedProgressTravelCount = travel.length;
        world.npcRuntime.boundedProgressMovedCount = movedCount;
        world.npcRuntime.boundedProgressBlockedCount = blockedCount;
        if (resolution) {
          world.npcRuntime.collisionCount = Math.max(Number(world.npcRuntime.collisionCount || 0), Number(resolution.collisionCount || 0));
          world.npcRuntime.sideStepCount = Math.max(Number(world.npcRuntime.sideStepCount || 0), Number(resolution.sideStepCount || 0));
          world.npcRuntime.yieldWaitCount = Math.max(Number(world.npcRuntime.yieldWaitCount || 0), Number(resolution.yieldWaitCount || 0));
        }
      }
      lastDiagnostics = Object.freeze({
        version: VERSION,
        authority: 'simulation',
        totalGameMinutes: Number(totalGameMinutes.toFixed(6)),
        step,
        population: world.npcs.length,
        travelCount: travel.length,
        movedCount,
        blockedCount,
        rows: Object.freeze(rows)
      });
      return result;
    }

    Game.NPCSpatial = Object.freeze({
      ...spatial,
      boundedProgressVersion: VERSION,
      updateAt: boundedUpdateAt
    });
    Game.NPCBoundedProgressRuntime = Object.freeze({
      version: VERSION,
      authority: 'simulation',
      nextRouteStep,
      diagnostics: () => clone(lastDiagnostics),
      install
    });
    installed = true;
    return true;
  }

  Game.NPCBoundedProgressRuntime = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    nextRouteStep,
    diagnostics: () => clone(lastDiagnostics),
    install
  });

  let attempts = 0;
  const timer = global.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 120) global.clearInterval(timer);
  }, 50);
  if (global.document?.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof window !== 'undefined' ? window : globalThis);
