/* R04 / #172 + WP-001 — bounded production driver for the autonomous protagonist pipeline. */
(function installAutonomousProtagonistRuntime(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'wp001-autonomous-protagonist-runtime-v2-tavern-advice';
  const POLL_MS = 1000;
  const DECISION_INTERVAL_MINUTES = 1;
  const TAVERN_TYPES = new Set(['inn', 'tavern']);
  const BASE_PRIORITY = -100;
  const TAVERN_URGENCY = 4;
  const CONTINUATION_PRIORITY = -99;
  let timer = null;
  let running = false;
  let lastTrace = null;

  function text(value) { return typeof value === 'string' ? value.trim() : ''; }
  function integer(value, fallback = 0) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : fallback;
  }
  function coordinate(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
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

  function worldRegionCoordinates(world, player) {
    const current = world?.currentRegion || {};
    return {
      regionX: integer(player?.regionX, integer(current.x, 0)),
      regionY: integer(player?.regionY, integer(current.y, 0))
    };
  }

  function fallbackContext() {
    const world = Game.State?.world || {};
    const player = world.player || {};
    const clock = Game.GameTime?.capture?.();
    const seed = text(world.seed) || 'campaign';
    const row = integer(player.row, 0), col = integer(player.col, 0);
    const region = worldRegionCoordinates(world, player);
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
      regionRef: text(world.regionRef) || `region:${region.regionX},${region.regionY}`,
      regionX: region.regionX,
      regionY: region.regionY,
      contextRevision: Math.max(0, integer(explicitRevision, 0)),
      campaignMinute: Math.max(0, Math.floor(Number(clock?.totalGameMinutes) || 0)),
      actorStateRef: `player:${row},${col}`,
      knownFactRefs: []
    };
  }

  function authoritativeContext() {
    const world = Game.State?.world || {};
    const player = world.player || {};
    const fromAdvisor = Game.AdvisorChatUI?.authoritativeContext?.();
    const context = fromAdvisor && fromAdvisor.authority === 'simulation' ? { ...fromAdvisor } : fallbackContext();
    const region = worldRegionCoordinates(world, player);
    context.regionX = integer(context.regionX, region.regionX);
    context.regionY = integer(context.regionY, region.regionY);
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

  function buildingType(building) { return text(building?.type).toLowerCase(); }

  function resolveLocalTavern() {
    const buildings = Game.State?.world?.originVillage?.buildings;
    if (!Array.isArray(buildings)) return null;
    const candidates = buildings
      .map((building) => {
        const id = text(building?.id);
        const type = buildingType(building);
        const row = coordinate(building?.entrance?.row);
        const col = coordinate(building?.entrance?.col);
        if (!id || !TAVERN_TYPES.has(type) || row === null || col === null) return null;
        return { building, id, type, row, col };
      })
      .filter(Boolean)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!candidates.length) return null;
    const selected = candidates[0];
    return freeze({
      buildingId: selected.id,
      buildingType: selected.type,
      point: { row: selected.row, col: selected.col }
    });
  }

  function tavernOpportunityId(buildingId) {
    return `visit-tavern-inn:${text(buildingId)}`;
  }

  function continuationActive(context, checkpoint, opportunityId) {
    return Boolean(checkpoint
      && text(checkpoint.lastStatus).toLowerCase() === 'resolved'
      && text(checkpoint.selectedOpportunityId) === opportunityId
      && text(checkpoint.worldRef) === text(context.worldRef)
      && text(checkpoint.regionRef) === text(context.regionRef));
  }

  function buildTavernOpportunity(contextInput = {}, checkpoint = null) {
    const context = contextInput && typeof contextInput === 'object' ? contextInput : {};
    const player = Game.State?.world?.player || {};
    const tavern = resolveLocalTavern();
    if (!tavern) return null;
    const playerRow = coordinate(player.row), playerCol = coordinate(player.col);
    if (playerRow === null || playerCol === null) return null;
    if (playerRow === tavern.point.row && playerCol === tavern.point.col) return null;
    const id = tavernOpportunityId(tavern.buildingId);
    const continuing = continuationActive(context, checkpoint, id);
    return freeze({
      id,
      source: 'authoritative-world-opportunity',
      actorId: text(context.actorId) || text(Game.State?.world?.protagonist?.id) || text(player.id) || 'protagonist:main',
      goalType: 'visit-tavern-inn',
      actionType: 'move',
      targetRef: tavern.buildingId,
      locationRef: text(context.locationRef) || `tile:${playerRow},${playerCol}`,
      priority: continuing ? CONTINUATION_PRIORITY : BASE_PRIORITY,
      urgency: TAVERN_URGENCY,
      distance: Math.abs(tavern.point.row - playerRow) + Math.abs(tavern.point.col - playerCol),
      expectedContextRevision: Math.max(0, integer(context.contextRevision, 0)),
      destination: {
        kind: 'building-entrance',
        buildingId: tavern.buildingId,
        buildingType: tavern.buildingType,
        point: { row: tavern.point.row, col: tavern.point.col }
      },
      continuation: continuing === true,
      directMovementAuthority: false
    });
  }

  function targetPointForOpportunity(opportunity) {
    const source = opportunity?.destination?.point || opportunity?.routine?.target || opportunity?.target || null;
    const row = coordinate(source?.row);
    const col = coordinate(source?.col);
    return row === null || col === null ? null : freeze({ row, col });
  }

  function alreadyAtTarget(opportunity, player = Game.State?.world?.player || {}) {
    const target = targetPointForOpportunity(opportunity);
    if (!target) return false;
    return integer(player.row) === target.row && integer(player.col) === target.col;
  }

  function buildOpportunities(contextInput = {}, checkpoint = null) {
    const context = contextInput && typeof contextInput === 'object' ? contextInput : {};
    const player = Game.State?.world?.player || {};
    const routine = Game.ProtagonistRoutine?.buildRoutineOpportunity?.(context) || null;
    const tavern = buildTavernOpportunity(context, checkpoint);
    return freeze([routine, tavern]
      .filter(Boolean)
      .filter((opportunity) => !alreadyAtTarget(opportunity, player)));
  }

  function routeForOpportunity(context, opportunity) {
    const world = Game.State?.world;
    const player = world?.player;
    const target = targetPointForOpportunity(opportunity);
    const routing = Game.TerrainRouting;
    if (!world || !player || !Array.isArray(world.terrain) || !routing?.findPath) {
      return freeze({ ok: false, reasonCode: 'RUNTIME_ROUTE_API_UNAVAILABLE', opportunityId: text(opportunity?.id) || null });
    }
    if (!target) {
      return freeze({ ok: false, reasonCode: 'OPPORTUNITY_TARGET_UNAVAILABLE', opportunityId: text(opportunity?.id) || null });
    }
    const start = { row: integer(player.row), col: integer(player.col) };
    const goal = { row: target.row, col: target.col };
    const path = routing.findPath(world.terrain, start, goal, {
      occupied: occupiedTiles(world, player),
      allowGoalOccupied: false
    });
    if (!Array.isArray(path) || !path.length) {
      return freeze({ ok: false, reasonCode: 'OPPORTUNITY_ROUTE_NOT_FOUND', opportunityId: text(opportunity?.id) || null, start, goal });
    }
    if (path.length === 1) {
      return freeze({ ok: false, reasonCode: 'OPPORTUNITY_TARGET_REACHED', opportunityId: text(opportunity?.id) || null, start, goal });
    }

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
    const route = {
      opportunityId: text(opportunity?.id),
      kind: 'spatial',
      destinationRef,
      validationContext,
      resolutionContext: {
        authority: 'simulation',
        revision: context.contextRevision,
        spatialRules: [{ destinationRef, row: next.row, col: next.col }]
      }
    };
    return freeze({
      ok: true,
      opportunityId: route.opportunityId,
      start,
      goal,
      next: { row: next.row, col: next.col },
      pathLength: path.length,
      route,
      execution: {
        authority: 'simulation',
        revision: context.contextRevision,
        routes: [route]
      }
    });
  }

  function routeForRoutine(context, opportunity) {
    return routeForOpportunity(context, opportunity);
  }

  function executionForOpportunities(context, opportunitiesInput) {
    const opportunities = Array.isArray(opportunitiesInput) ? opportunitiesInput : [];
    const outcomes = opportunities.map((opportunity) => routeForOpportunity(context, opportunity));
    const routes = outcomes.filter((outcome) => outcome.ok && outcome.route).map((outcome) => outcome.route);
    return freeze({
      execution: { authority: 'simulation', revision: context.contextRevision, routes },
      outcomes: outcomes.map((outcome) => ({
        opportunityId: outcome.opportunityId || null,
        ok: outcome.ok === true,
        reasonCode: outcome.reasonCode || 'OK',
        start: outcome.start || null,
        next: outcome.next || null,
        goal: outcome.goal || null,
        pathLength: outcome.pathLength || 0
      }))
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
      const checkpoint = loop.readCheckpoint?.(context) || null;
      const opportunities = buildOpportunities(context, checkpoint);
      if (!opportunities.length) return diagnostic('idle', 'NO_RUNTIME_OPPORTUNITY', { context, checkpoint });

      const prepared = loop.prepare(context, opportunities);
      if (prepared.status !== 'ready' || !prepared.prepared) {
        return diagnostic(prepared.status || 'idle', prepared.reasonCode || 'DECISION_NOT_READY', {
          context,
          checkpoint,
          candidateOpportunityIds: opportunities.map((item) => item.id),
          prepared
        });
      }

      const routed = executionForOpportunities(context, prepared.prepared.opportunities);
      const advisorInfluence = Game.AdvisorChatUI?.peekPendingInfluenceForDecision?.(context) || null;
      const result = loop.resolvePrepared(prepared.prepared, context, routed.execution, advisorInfluence);
      if (advisorInfluence && result.status !== 'stale') Game.AdvisorChatUI?.markPendingInfluenceConsumed?.();

      const selectedOpportunityId = text(result?.execution?.selectedOpportunityId) || null;
      const selected = opportunities.find((item) => item.id === selectedOpportunityId) || null;
      const selectedTarget = targetPointForOpportunity(selected);
      return diagnostic(result.status, result.reasonCode || 'OK', {
        context,
        checkpoint,
        candidateOpportunityIds: opportunities.map((item) => item.id),
        selectedOpportunityId,
        targetBuildingId: selected?.destination?.buildingId || selected?.routine?.targetBuildingId || null,
        targetBuildingType: selected?.destination?.buildingType || selected?.routine?.targetBuildingType || null,
        target: selectedTarget,
        routeOutcomes: routed.outcomes,
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
    basePriority: BASE_PRIORITY,
    continuationPriority: CONTINUATION_PRIORITY,
    authoritativeContext,
    resolveLocalTavern,
    tavernOpportunityId,
    continuationActive,
    buildTavernOpportunity,
    targetPointForOpportunity,
    buildOpportunities,
    routeForOpportunity,
    routeForRoutine,
    executionForOpportunities,
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
