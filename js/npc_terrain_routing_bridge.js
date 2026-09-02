/* R04 / #325 + #257 + #260: bind NPC routine routes to shared authoritative terrain routing, building transitions and outdoor worksites. */
(function installNpcTerrainRoutingBridge() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-npc-terrain-routing-bridge-v6';
  let renderHookInstalled = false;

  function key(point) { return `${point.row},${point.col}`; }

  function localPoint(value, binding = null) {
    const rowOffset = Number(binding?.rowOffset || 0);
    const colOffset = Number(binding?.colOffset || 0);
    const hasLocalRow = Number.isFinite(Number(value?.localRow));
    const hasLocalCol = Number.isFinite(Number(value?.localCol));
    return {
      row: Math.trunc(hasLocalRow ? Number(value.localRow) : (Number(value?.row) || 0) - rowOffset),
      col: Math.trunc(hasLocalCol ? Number(value.localCol) : (Number(value?.col) || 0) - colOffset)
    };
  }

  function strategicPoint(local, binding) {
    const rowOffset = Number(binding?.rowOffset || 0);
    const colOffset = Number(binding?.colOffset || 0);
    return { localRow: local.row, localCol: local.col, row: local.row + rowOffset, col: local.col + colOffset };
  }

  function same(a, b) { return Boolean(a && b && a.row === b.row && a.col === b.col); }
  function adjacent(a, b) { return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1; }
  function tileAt(terrain, point) { return terrain?.[point.row]?.[point.col] || null; }

  function dedupe(points) {
    const result = [];
    for (const value of points || []) {
      if (!value) continue;
      const next = { row: Math.trunc(Number(value.row) || 0), col: Math.trunc(Number(value.col) || 0) };
      if (!same(result[result.length - 1], next)) result.push(next);
    }
    return result;
  }

  function interiorForBuilding(world, buildingId) {
    if (!buildingId) return null;
    return world?.buildingInteriors?.interiors?.find?.((item) => String(item.buildingId) === String(buildingId)) || null;
  }

  function pointInsideFootprint(point, footprint) {
    if (!point || !footprint) return false;
    const row = Number(footprint.row), col = Number(footprint.col);
    const height = Number(footprint.height), width = Number(footprint.width);
    return point.row >= row && point.row < row + height && point.col >= col && point.col < col + width;
  }

  function transitionWaypoints(world, anchor, binding, direction) {
    if (!anchor) return [];
    const endpoint = localPoint(anchor, binding);
    const interior = interiorForBuilding(world, anchor.buildingId);
    if (!interior || !pointInsideFootprint(endpoint, interior.footprint)) return [endpoint];

    const entrance = localPoint(interior.entrance, null);
    const door = localPoint(interior.door, null);
    if (direction === 'exit') return dedupe([endpoint, door, entrance]);
    return dedupe([entrance, door, endpoint]);
  }

  function routeBetween(terrain, points, occupied) {
    const waypoints = dedupe(points);
    if (waypoints.length < 2) return waypoints;
    const result = [waypoints[0]];
    for (let index = 1; index < waypoints.length; index += 1) {
      const start = result[result.length - 1];
      const goal = waypoints[index];
      if (same(start, goal)) continue;
      const segment = Game.TerrainRouting.findPath(terrain, start, goal, { occupied, allowGoalOccupied: true });
      if (!segment.length) return [];
      for (const point of segment.slice(1)) result.push(point);
    }
    return dedupe(result);
  }

  function validateRoute(route, terrain) {
    if (!Array.isArray(route) || !route.length) return false;
    for (let index = 0; index < route.length; index += 1) {
      const point = route[index];
      if (!Game.TerrainRouting.isWalkableTile(tileAt(terrain, point))) return false;
      if (index > 0 && !adjacent(route[index - 1], point)) return false;
    }
    return true;
  }

  function repairGoalTransitionFromExisting(existing, goalTransition, terrain) {
    if (!Array.isArray(existing) || !existing.length || !Array.isArray(goalTransition) || goalTransition.length < 2) return [];
    const entrance = goalTransition[0];
    const entranceIndex = existing.findIndex((point) => same(point, entrance));
    if (entranceIndex < 0) return [];

    const approach = existing.slice(0, entranceIndex + 1);
    if (!validateRoute(approach, terrain)) return [];

    // The entrance -> door -> interior-anchor segment is structural building topology.
    // Live NPC occupancy is transient and must not erase this mandatory route template in
    // narrow/shared workplaces; runtime movement remains responsible for collision handling.
    const transition = routeBetween(terrain, goalTransition, new Set());
    if (!transition.length || !validateRoute(transition, terrain)) return [];

    const repaired = dedupe([...approach, ...transition.slice(1)]);
    return validateRoute(repaired, terrain) ? repaired : [];
  }

  function routeLeg(existingRoute, startAnchor, goalAnchor, terrain, occupied, binding, world) {
    const existing = Array.isArray(existingRoute) ? existingRoute.map((value) => localPoint(value, binding)) : [];
    const fallbackStart = existing[0];
    const fallbackGoal = existing[existing.length - 1];
    const start = startAnchor ? localPoint(startAnchor, binding) : fallbackStart;
    const goal = goalAnchor ? localPoint(goalAnchor, binding) : fallbackGoal;
    if (!start || !goal) return { route: existingRoute || [], valid: false, resolved: false };

    const startTransition = startAnchor ? transitionWaypoints(world, startAnchor, binding, 'exit') : [start];
    const goalTransition = goalAnchor ? transitionWaypoints(world, goalAnchor, binding, 'enter') : [goal];
    const waypoints = dedupe([...startTransition, ...goalTransition]);
    let routed = routeBetween(terrain, waypoints, occupied);
    let repairedGoalTransition = false;

    if ((!routed.length || !validateRoute(routed, terrain)) && goalTransition.length > 1) {
      routed = repairGoalTransitionFromExisting(existing, goalTransition, terrain);
      repairedGoalTransition = routed.length > 0;
    }

    if (!routed.length || !validateRoute(routed, terrain)) {
      return { route: existingRoute || [], valid: false, resolved: false };
    }
    return {
      route: routed.map((value) => strategicPoint(value, binding)),
      valid: true,
      resolved: true,
      usesStartTransition: startTransition.length > 1,
      usesGoalTransition: goalTransition.length > 1,
      repairedGoalTransition
    };
  }

  function applyOutdoorWorksiteAnchors(world, npcs, binding) {
    Game.OutdoorWorksites?.sync?.();
    const assignments = new Map((world?.outdoorWorksites?.assignments || []).map((item) => [String(item.id), item]));
    let assignedCount = 0;
    let unavailableCount = 0;
    const records = [];

    for (const npc of npcs || []) {
      const assignment = assignments.get(String(npc.id));
      if (!assignment) {
        npc.outdoorWorksite = null;
        continue;
      }
      if (assignment.status !== 'assigned' || !Number.isInteger(Number(assignment.row)) || !Number.isInteger(Number(assignment.col))) {
        npc.outdoorWorksite = Object.freeze({ authority: 'simulation', worksiteId: assignment.worksiteId || null, worksiteKind: assignment.worksiteKind, resolved: false });
        unavailableCount += 1;
        records.push(Object.freeze({ npcId: npc.id, worksiteId: assignment.worksiteId || null, worksiteKind: assignment.worksiteKind, resolved: false }));
        continue;
      }

      const local = { row: Math.trunc(Number(assignment.row)), col: Math.trunc(Number(assignment.col)) };
      const work = strategicPoint(local, binding);
      npc.anchors = npc.anchors || {};
      npc.anchors.work = {
        ...(npc.anchors.work || {}),
        ...work,
        buildingId: null,
        indoor: false,
        outdoor: true,
        worksiteId: assignment.worksiteId,
        worksiteKind: assignment.worksiteKind,
        source: 'outdoor-worksites',
        capacitySlot: assignment.capacitySlot,
        sharedCapacity: assignment.sharedCapacity
      };
      npc.outdoorWorksite = Object.freeze({
        authority: 'simulation',
        resolved: true,
        worksiteId: assignment.worksiteId,
        worksiteKind: assignment.worksiteKind,
        ...work,
        capacitySlot: assignment.capacitySlot,
        sharedCapacity: assignment.sharedCapacity
      });
      assignedCount += 1;
      records.push(Object.freeze({ npcId: npc.id, worksiteId: assignment.worksiteId, worksiteKind: assignment.worksiteKind, localRow: local.row, localCol: local.col, resolved: true }));
    }

    world.npcOutdoorWorksiteRouting = Object.freeze({
      version: 'r04-outdoor-worksite-routing-v1',
      authority: 'simulation',
      assignmentSource: Game.OutdoorWorksites?.version || null,
      assignedCount,
      unavailableCount,
      records: Object.freeze(records)
    });
    return assignedCount;
  }

  function refreshRoutes() {
    // Route-template reconstruction is authoritative but not presentation-critical. During
    // camera/pointer/zoom interaction, reuse the already-authoritative route state instead of
    // running up to three terrain searches per NPC synchronously inside the render call. The
    // next non-interactive refresh (or an explicit non-render caller) rebuilds the templates.
    // This changes scheduling only; it does not change GameTime, route legality or Simulation truth.
    if (Game.FrameBudgetScheduler?.interactionActive?.()) return false;

    const world = Game.State?.world;
    Game.StarterVillageInteriors?.materialize?.(world);
    const terrain = world?.terrain;
    const npcs = world?.npcs;
    if (!Array.isArray(terrain) || !Array.isArray(npcs) || !npcs.length || !Game.TerrainRouting) return false;
    const binding = world.npcRuntime?.originBinding || { rowOffset: 0, colOffset: 0 };
    const outdoorWorksiteNpcCount = applyOutdoorWorksiteAnchors(world, npcs, binding);
    const occupied = new Set(npcs.map((npc) => key(localPoint(npc, binding))));
    let routed = 0;
    let routeLegCount = 0;
    let invalidRouteCount = 0;
    let buildingTransitionCount = 0;
    let repairedGoalTransitionCount = 0;

    for (const npc of npcs) {
      const routes = npc.spatialRoutes;
      if (!routes?.homeToWork || !routes?.workToSocial || !routes?.socialToHome) continue;
      const ownKey = key(localPoint(npc, binding));
      occupied.delete(ownKey);

      const homeToWork = routeLeg(routes.homeToWork, npc.anchors?.home, npc.anchors?.work, terrain, occupied, binding, world);
      const workToSocial = routeLeg(routes.workToSocial, npc.anchors?.work, npc.anchors?.social, terrain, occupied, binding, world);
      const socialToHome = routeLeg(routes.socialToHome, npc.anchors?.social, npc.anchors?.home, terrain, occupied, binding, world);
      const results = [homeToWork, workToSocial, socialToHome];
      routeLegCount += results.length;
      invalidRouteCount += results.filter((result) => !result.valid).length;
      buildingTransitionCount += results.reduce((sum, result) => sum + Number(Boolean(result.usesStartTransition)) + Number(Boolean(result.usesGoalTransition)), 0);
      repairedGoalTransitionCount += results.filter((result) => result.repairedGoalTransition).length;

      npc.spatialRoutes = {
        homeToWork: homeToWork.route,
        workToSocial: workToSocial.route,
        socialToHome: socialToHome.route
      };
      occupied.add(ownKey);
      routed += 1;
    }

    world.npcTerrainRouting = {
      version: VERSION,
      authority: 'simulation',
      terrainRoutingVersion: Game.TerrainRouting.version,
      interiorRoutingVersion: world.buildingInteriors?.version || null,
      outdoorWorksiteVersion: world.outdoorWorksites?.version || null,
      outdoorWorksiteNpcCount,
      routedNpcCount: routed,
      totalNpcCount: npcs.length,
      routeLegCount,
      invalidRouteCount,
      buildingTransitionCount,
      repairedGoalTransitionCount,
      routeSource: 'authoritative-terrain+occupancy+building-transitions+outdoor-worksites',
      buildingEntranceIntegrated: true,
      outdoorWorksitesIntegrated: true,
      interiorEdgesPreserved: true
    };
    return routed > 0;
  }

  function installRenderHook() {
    const renderer = Game.Renderer;
    if (!renderer || typeof renderer.renderWorld !== 'function' || renderHookInstalled) return false;
    const renderWorld = renderer.renderWorld.bind(renderer);
    renderer.renderWorld = function terrainAwareNpcRenderWorld(force) {
      refreshRoutes();
      return renderWorld(force);
    };
    renderHookInstalled = true;
    return true;
  }

  function initialize() {
    if (!Game.TerrainRouting || !Game.NPCSpatial) return false;
    refreshRoutes();
    installRenderHook();
    return true;
  }

  Game.NPCTerrainRouting = Object.freeze({ version: VERSION, authority: 'simulation', refreshRoutes, initialize, applyOutdoorWorksiteAnchors });

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
    else initialize();
  }
})();
