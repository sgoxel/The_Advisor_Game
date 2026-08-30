/* R04 / #325: bind NPC exterior routine routes to shared authoritative terrain routing. */
(function installNpcTerrainRoutingBridge() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-npc-terrain-routing-bridge-v1';
  let renderHookInstalled = false;

  function localPoint(value) {
    return {
      row: Math.trunc(Number(value?.localRow ?? value?.row) || 0),
      col: Math.trunc(Number(value?.localCol ?? value?.col) || 0)
    };
  }

  function strategicPoint(local, binding) {
    const rowOffset = Number(binding?.rowOffset || 0);
    const colOffset = Number(binding?.colOffset || 0);
    return { localRow: local.row, localCol: local.col, row: local.row + rowOffset, col: local.col + colOffset };
  }

  function tileAt(terrain, point) { return terrain?.[point.row]?.[point.col] || null; }

  function exteriorSegment(existingRoute, terrain, occupied, binding) {
    const route = Array.isArray(existingRoute) ? existingRoute.map(localPoint) : [];
    if (route.length < 2) return existingRoute || [];
    let first = -1;
    let last = -1;
    for (let index = 0; index < route.length; index += 1) {
      if (Game.TerrainRouting.isWalkableTile(tileAt(terrain, route[index]))) { first = index; break; }
    }
    for (let index = route.length - 1; index >= 0; index -= 1) {
      if (Game.TerrainRouting.isWalkableTile(tileAt(terrain, route[index]))) { last = index; break; }
    }
    if (first < 0 || last < first) return existingRoute;
    const middle = Game.TerrainRouting.findPath(terrain, route[first], route[last], { occupied, allowGoalOccupied: true });
    if (!middle.length) return existingRoute;
    const composed = [
      ...route.slice(0, first),
      ...middle,
      ...route.slice(last + 1)
    ];
    const deduped = [];
    for (const value of composed) {
      const previous = deduped[deduped.length - 1];
      if (!previous || previous.row !== value.row || previous.col !== value.col) deduped.push(value);
    }
    return deduped.map((value) => strategicPoint(value, binding));
  }

  function refreshRoutes() {
    const world = Game.State?.world;
    const terrain = world?.terrain;
    const npcs = world?.npcs;
    if (!Array.isArray(terrain) || !Array.isArray(npcs) || !npcs.length || !Game.TerrainRouting) return false;
    const binding = world.npcRuntime?.originBinding || { rowOffset: 0, colOffset: 0 };
    const occupied = new Set(npcs.map((npc) => `${localPoint(npc).row},${localPoint(npc).col}`));
    let routed = 0;

    for (const npc of npcs) {
      const routes = npc.spatialRoutes;
      if (!routes?.homeToWork || !routes?.workToSocial || !routes?.socialToHome) continue;
      const ownKey = `${localPoint(npc).row},${localPoint(npc).col}`;
      occupied.delete(ownKey);
      const homeToWork = exteriorSegment(routes.homeToWork, terrain, occupied, binding);
      const workToSocial = exteriorSegment(routes.workToSocial, terrain, occupied, binding);
      const socialToHome = exteriorSegment(routes.socialToHome, terrain, occupied, binding);
      occupied.add(ownKey);
      npc.spatialRoutes = { homeToWork, workToSocial, socialToHome };
      routed += 1;
    }

    world.npcTerrainRouting = {
      version: VERSION,
      authority: 'simulation',
      terrainRoutingVersion: Game.TerrainRouting.version,
      routedNpcCount: routed,
      totalNpcCount: npcs.length,
      routeSource: 'authoritative-terrain+occupancy',
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
