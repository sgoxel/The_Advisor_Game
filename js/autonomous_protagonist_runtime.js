/* R04 / #172 — bounded production driver for the existing autonomous protagonist pipeline. */
(function installAutonomousProtagonistRuntime(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-autonomous-protagonist-runtime-v1';
  const POLL_MS = 1000;
  const DECISION_INTERVAL_MINUTES = 1;
  let timer = null;
  let running = false;
  let lastTrace = null;

  function text(value) { return typeof value === 'string' ? value.trim() : ''; }
  function integer(value, fallback = 0) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : fallback;
  }
  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => freeze(value[key]));
    return value;
  }
  function copy(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (_error) { return null; }
  }

  function fallbackContext() {
    const world = Game.State?.world || {};
    const player = world.player || {};
    const clock = Game.GameTime?.capture?.();
    const seed = text(world.seed) || 'campaign';
    const row = integer(player.row, 0), col = integer(player.col, 0);
    const explicitRevision = [
      Game.State?.simulation?.contextRevision,
      world.contextRevision,
      world.spatialRevision,
      player.contextRevision,
      player.spatialRevision
    ].find((value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0);
    return {
      authority: 'simulation',
      actorId: text(world.protagonist?.id) || text(player.id) || 'protagonist:main',
      campaignRef: `campaign:${seed}`,
      locationRef: `tile:${row},${col}`,
      worldRef: `seed:${seed}`,
      regionRef: text(world.regionRef) || `region:${integer(player.regionX, integer(world.currentRegion?.x, 0))},${integer(player.regionY, integer(world.currentRegion?.y, 0))}`,
      contextRevision: Math.max(0, integer(explicitRevision, 0)),
      campaignMinute: Math.max(0, Math.floor(Number(clock?.totalGameMinutes) || 0)),
      actorStateRef: `player:${row},${col}`,
      knownFactRefs: []
    };
  }

  function authoritativeContext() {
    const fromAdvisor = Game.AdvisorChatUI?.authoritativeContext?.();
    const context = fromAdvisor && fromAdvisor.authority === 'simulation' ? { ...fromAdvisor } : fallbackContext();
    context.intervalMinutes = DECISION_INTERVAL_MINUTES;
    return context;
  }

  function occupiedTiles(world, player) {
    const occupied = new Set();
    for (const npc of Array.isArray(world?.npcs) ? world.npcs : []) {
      if (!npc || npc.active === false || npc.removed === true) continue;
      const row = Number(npc.row), col = Number(npc.col);
      if (Number.isSafeInteger(row) && Number.isSafeInteger(col)) occupied.add(`${row},${col}`);
    }
    occupied.delete(`${integer(player?.row)},${integer(player?.col)}`);
    return occupied;
  }

  function routeForRoutine(context, opportunity) {
    const world = Game.State?.world;
    const player = world?.player;
    const target = opportunity?.routine?.target;
    const routing = Game.TerrainRouting;
    if (!world || !player || !Array.isArray(world.terrain) || !routing?.findPath) {
      return freeze({ ok: false, reasonCode: 'RUNTIME_ROUTE_API_UNAVAILABLE' });
    }
    const targetRow = Math.trunc(Number(target?.row));
    const targetCol = Math.trunc(Number(target?.col));
    if (!Number.isSafeInteger(targetRow) || !Number.isSafeInteger(targetCol)) {
      return freeze({ ok: false, reasonCode: 'ROUTINE_TARGET_UNAVAILABLE' });
    }
    const start = { row: integer(player.row), col: integer(player.col) };
    const goal = { row: targetRow, col: targetCol };
    const path = routing.findPath(world.terrain, start, goal, {
      occupied: occupiedTiles(world, player),
      allowGoalOccupied: false
    });
    if (!path.length) return freeze({ ok: false, reasonCode: 'ROUTINE_ROUTE_NOT_FOUND', start, goal });
    if (path.length === 1) return freeze({ ok: false, reasonCode: 'ROUTINE_TARGET_REACHED', start, goal });

    const next = path[1];
    const destinationRef = `tile:${next.row},${next.col}`;
    const validationContext = {
      authority: 'simulation',
      actorId: context.actorId,
      campaignRef: context.campaignRef,
      locationRef: context.locationRef,
      worldRef: context.worldRef,
      regionRef: context.regionRef,
      revision: context.contextRevision,
      actorTags: ['walking'],
      actions: { move: { enabled: true, requiresDestination: true } },
      destinations: [{
        ref: destinationRef,
        worldRef: context.worldRef,
        regionRef: context.regionRef,
        available: true,
        traversable: true
      }]
    };
    return freeze({
      ok: true,
      start,
      goal,
      next: { row: next.row, col: next.col },
      pathLength: path.length,
      execution: {
        authority: 'simulation',
        revision: context.contextRevision,
        routes: [{
          opportunityId: opportunity.id,
          kind: 'spatial',
          destinationRef,
          validationContext,
          resolutionContext: {
            authority: 'simulation',
            revision: context.contextRevision,
            spatialRules: [{ destinationRef, row: next.row, col: next.col }]
          }
        }]
      }
    });
  }

  function diagnostic(status, reasonCode, details = {}) {
    const world = Game.State?.world || {};
    const player = world.player || {};
    lastTrace = freeze({
      version: VERSION,
      authority: 'simulation',
      status,
      reasonCode,
      actorId: text(world.protagonist?.id) || text(player.id) || 'protagonist:main',
      row: integer(player.row),
      col: integer(player.col),
      campaignMinute: Math.max(0, Math.floor(Number(Game.GameTime?.capture?.()?.totalGameMinutes) || 0)),
      observedAtMs: Math.round(typeof performance !== 'undefined' ? performance.now() : Date.now()),
      ...copy(details)
    });
    return lastTrace;
  }

  function tick() {
    if (running) return diagnostic('wait', 'RUNTIME_TICK_IN_PROGRESS');
    running = true;
    try {
      const loop = Game.AutonomousDecisionLoop;
      const routine = Game.ProtagonistRoutine;
      const resolver = Game.WorldActionResolution;
      if (!loop?.prepare || !loop?.resolvePrepared || !routine?.buildRoutineOpportunity || !resolver?.resolveSpatial || !Game.TerrainRouting?.findPath) {
        return diagnostic('wait', 'RUNTIME_DEPENDENCY_UNAVAILABLE');
      }
      const world = Game.State?.world;
      const player = world?.player;
      if (!world || !player || !Array.isArray(world.terrain) || !Game.GameTime?.capture?.()) {
        return diagnostic('wait', 'AUTHORITATIVE_WORLD_UNAVAILABLE');
      }

      const context = authoritativeContext();
      const opportunity = routine.buildRoutineOpportunity(context);
      if (!opportunity) return diagnostic('idle', 'NO_ROUTINE_OPPORTUNITY', { context });

      const prepared = loop.prepare(context, [opportunity]);
      if (prepared.status !== 'ready' || !prepared.prepared) {
        return diagnostic(prepared.status || 'idle', prepared.reasonCode || 'DECISION_NOT_READY', { context, prepared });
      }

      const route = routeForRoutine(context, opportunity);
      if (!route.ok) return diagnostic('idle', route.reasonCode, { context, opportunityId: opportunity.id, route });

      const advisorInfluence = Game.AdvisorChatUI?.peekPendingInfluenceForDecision?.(context) || null;
      const result = loop.resolvePrepared(prepared.prepared, context, route.execution, advisorInfluence);
      if (advisorInfluence && result.status !== 'stale') Game.AdvisorChatUI?.markPendingInfluenceConsumed?.();
      return diagnostic(result.status, result.reasonCode || 'OK', {
        context,
        opportunityId: opportunity.id,
        targetBuildingId: opportunity.routine?.targetBuildingId || null,
        route: { start: route.start, next: route.next, goal: route.goal, pathLength: route.pathLength },
        result
      });
    } catch (error) {
      return diagnostic('rejected', 'RUNTIME_EXCEPTION', { message: text(error?.message) || String(error) });
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer !== null || typeof global.setInterval !== 'function') return;
    tick();
    timer = global.setInterval(tick, POLL_MS);
  }
  function stop() {
    if (timer !== null && typeof global.clearInterval === 'function') global.clearInterval(timer);
    timer = null;
  }
  function diagnostics() { return lastTrace ? copy(lastTrace) : null; }

  Game.AutonomousProtagonistRuntime = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    pollMs: POLL_MS,
    decisionIntervalMinutes: DECISION_INTERVAL_MINUTES,
    authoritativeContext,
    routeForRoutine,
    tick,
    start,
    stop,
    diagnostics
  });

  if (global.document) {
    if (global.document.readyState === 'loading') global.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
