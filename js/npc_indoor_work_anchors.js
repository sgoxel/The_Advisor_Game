/* R04 / #318: bind indoor professions to deterministic walkable anchors inside their assigned workplace. */
(function installNpcIndoorWorkAnchors(global) {
  'use strict';
  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-npc-indoor-work-anchors-v1';
  let renderHookInstalled = false;

  function key(point) { return `${point.row},${point.col}`; }
  function binding(world) { return world?.npcRuntime?.originBinding || { rowOffset: 0, colOffset: 0 }; }
  function strategic(point, b) {
    return {
      row: Number(point.row) + Number(b.rowOffset || 0),
      col: Number(point.col) + Number(b.colOffset || 0),
      localRow: Number(point.row),
      localCol: Number(point.col)
    };
  }
  function same(a, b) { return Boolean(a && b && Number(a.row) === Number(b.row) && Number(a.col) === Number(b.col)); }
  function interiorFor(world, buildingId) {
    return world?.buildingInteriors?.interiors?.find?.((item) => String(item.buildingId) === String(buildingId)) || null;
  }
  function assignmentMap(world) {
    return new Map((world?.npcWorkplaces?.assignments || []).map((item) => [String(item.id), item]));
  }
  function isOutdoor(assignment) {
    return assignment?.workplaceKind === 'outdoor-worksite-required' || Game.NPCWorkplaces?.outdoorProfessions?.includes?.(assignment?.profession);
  }
  function tileWalkable(world, point) {
    const tile = world?.terrain?.[point.row]?.[point.col];
    return Boolean(tile && Game.TerrainRouting?.isWalkableTile?.(tile));
  }
  function interiorCandidates(world, interior) {
    const door = interior?.door;
    return (interior?.floors || [])
      .filter((point) => !same(point, door))
      .filter((point) => tileWalkable(world, point))
      .slice()
      .sort((a, b) => Number(a.row) - Number(b.row) || Number(a.col) - Number(b.col));
  }

  function assignIndoorAnchors() {
    const world = Game.State?.world;
    if (!world || !Array.isArray(world.npcs)) return false;
    Game.StarterVillageInteriors?.materialize?.(world);
    Game.NPCWorkplaces?.sync?.();
    const assignments = assignmentMap(world);
    const b = binding(world);
    const claimed = new Set();
    const records = [];

    const ordered = world.npcs.slice().sort((a, c) => String(a.id).localeCompare(String(c.id)));
    for (const npc of ordered) {
      const assignment = assignments.get(String(npc.id));
      if (!assignment || isOutdoor(assignment) || assignment.workplaceKind !== 'building' || !assignment.workplaceBuildingId) {
        npc.indoorWorkAnchor = null;
        continue;
      }
      const interior = interiorFor(world, assignment.workplaceBuildingId);
      if (!interior) {
        npc.indoorWorkAnchor = null;
        continue;
      }
      const candidates = interiorCandidates(world, interior).filter((point) => !claimed.has(key(point)));
      if (!candidates.length) {
        npc.indoorWorkAnchor = null;
        records.push({ npcId: npc.id, buildingId: assignment.workplaceBuildingId, resolved: false, reason: 'no-unoccupied-walkable-interior-floor' });
        continue;
      }
      const slot = Math.max(0, Number(assignment.capacitySlot || 0));
      const target = candidates[slot % candidates.length] || candidates[0];
      claimed.add(key(target));
      const work = strategic(target, b);
      npc.anchors = npc.anchors || {};
      npc.anchors.work = {
        ...(npc.anchors.work || {}),
        ...work,
        buildingId: String(assignment.workplaceBuildingId),
        indoor: true,
        source: 'npc-workplaces+starter-village-interiors',
        capacitySlot: assignment.capacitySlot
      };
      npc.indoorWorkAnchor = Object.freeze({
        authority: 'simulation-derived',
        buildingId: String(assignment.workplaceBuildingId),
        ...work,
        capacitySlot: assignment.capacitySlot
      });
      records.push({ npcId: npc.id, buildingId: String(assignment.workplaceBuildingId), localRow: target.row, localCol: target.col, resolved: true });
    }

    world.npcIndoorWorkAnchors = Object.freeze({
      version: VERSION,
      authority: 'simulation-derived',
      assignmentSource: Game.NPCWorkplaces?.version || null,
      interiorSource: world.buildingInteriors?.version || null,
      resolvedCount: records.filter((item) => item.resolved).length,
      unresolvedCount: records.filter((item) => !item.resolved).length,
      records: Object.freeze(records.map(Object.freeze))
    });
    Game.NPCTerrainRouting?.refreshRoutes?.();
    return true;
  }

  function installRenderHook() {
    const renderer = Game.Renderer;
    if (!renderer || typeof renderer.renderWorld !== 'function' || renderHookInstalled) return false;
    const renderWorld = renderer.renderWorld.bind(renderer);
    renderer.renderWorld = function indoorWorkAnchorRenderWorld(force) {
      assignIndoorAnchors();
      return renderWorld(force);
    };
    renderHookInstalled = true;
    return true;
  }

  function initialize() {
    if (!Game.NPCSpatial || !Game.NPCWorkplaces || !Game.StarterVillageInteriors) return false;
    Game.NPCSpatial.ensureSpatialNpcs?.();
    assignIndoorAnchors();
    installRenderHook();
    return true;
  }

  Game.NPCIndoorWorkAnchors = Object.freeze({
    version: VERSION,
    authority: 'simulation-derived',
    assignIndoorAnchors,
    initialize
  });

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
    else initialize();
  }
})(typeof window !== 'undefined' ? window : globalThis);
