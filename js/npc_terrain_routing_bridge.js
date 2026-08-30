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

  function strategicPath(localPath, binding) {
    const rowOffset = Number(binding?.rowOffset || 0);
    const colOffset = Number(binding?.colOffset || 0);
    return (localPath || []).map((p) => ({
      localRow: p.row,
      localCol: p.col,
      row: p.row + rowOffset,
      col: p.col + colOffset
    }));
  }

  function route(terrain, from, to, occupied, binding) {
    const path = Game.TerrainRouting?.findPath?.(terrain, localPoint(from), localPoint(to), { occupied, allowGoalOccupied: true }) || [];
    return strategicPath(path, binding);
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
      const home = npc.anchors?.home;
      const work = npc.anchors?.work;
      const social = npc.anchors?.social;
      if (!home || !work || !social) continue;
      const ownKey = `${localPoint(npc).row},${localPoint(npc).col}`;
      occupied.delete(ownKey);
      const homeToWork = route(terrain, home, work, occupied, binding);
      const workToSocial = route(terrain, work, social, occupied, binding);
      const socialToHome = route(terrain, social, home, occupied, binding);
      occupied.add(ownKey);
      if (!homeToWork.length || !workToSocial.length || !socialToHome.length) continue;
      npc.spatialRoutes = { homeToWork, workToSocial, socialToHome };
      routed += 1;
    }

    world.npcTerrainRouting = {
      version: VERSION,
      authority: 'simulation',
      terrainRoutingVersion: Game.TerrainRouting.version,
      routedNpcCount: routed,
      totalNpcCount: npcs.length,
      routeSource: 'authoritative-terrain+occupancy'
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

  Game.NPCTerrainRouting = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    refreshRoutes,
    initialize
  });

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
    else initialize();
  }
})();
