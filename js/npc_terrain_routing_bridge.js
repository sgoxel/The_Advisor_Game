/* R04 / #325 + #257: bind NPC routine routes to shared authoritative terrain routing and building transitions. */
(function installNpcTerrainRoutingBridge() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-npc-terrain-routing-bridge-v3';
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

  function repairGoalTransitionFromExisting(existing, goalTransition, terrain, occupied) {
    if (!Array.isArray(existing) || !existing.length || !Array.isArray(goalTransition) || goalTransition.length < 2) return [];
    const entrance = goalTransition[0];
    const entranceIndex = existing.findIndex((point) => same(point, entrance));
    if (entranceIndex < 0) return [];

    const approach = existing.slice(0, entranceIndex + 1);
    if (!validateRoute(approach, terrain)) return [];
    const transition = routeBetween(terrain, goalTransition, occupied);
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
      routed = repairGoalTransitionFromExisting(existing, goalTransition, terrain, occupied);
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

  function refreshRoutes() {
    const world = Game.State?.world;
    Game.StarterVillageInteriors?.materialize?.(world);
    const terrain = world?.terrain;
    const npcs = world?.npcs;
    if (!Array.isArray(terrain) || !Array.isArray(npcs) || !npcs.length || !Game.TerrainRouting) return false;
    const binding = world.npcRuntime?.originBinding || { rowOffset: 0, colOffset: 0 };
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
      routedNpcCount: routed,
      totalNpcCount: npcs.length,
      routeLegCount,
      invalidRouteCount,
      buildingTransitionCount,
      repairedGoalTransitionCount,
      routeSource: 'authoritative-terrain+occupancy+building-transitions',
      buildingEntranceIntegrated: true,
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

  Game.NPCTerrainRouting = Object.freeze({ version: VERSION, authority: 'simulation', refreshRoutes, initialize });

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
    else initialize();
  }
})();
