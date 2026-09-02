/* R04 / #318 + #346 + #347 + #261: post-routing Simulation integration for anchors, activity legality and direct dialogue. */
(function installNpcIndoorWorkAnchors(global) {
  'use strict';
  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-npc-post-routing-integration-v5';
  let renderHookInstalled = false;
  let assigningIndoorAnchors = false;

  function key(point) { return `${point.row},${point.col}`; }
  function binding(world) { return world?.npcRuntime?.originBinding || { rowOffset: 0, colOffset: 0 }; }
  function strategic(point, b) { return { row: Number(point.row) + Number(b.rowOffset || 0), col: Number(point.col) + Number(b.colOffset || 0), localRow: Number(point.row), localCol: Number(point.col) }; }
  function same(a, b) { return Boolean(a && b && Number(a.row) === Number(b.row) && Number(a.col) === Number(b.col)); }
  function distance(a, b) { return Math.abs(Number(a?.row) - Number(b?.row)) + Math.abs(Number(a?.col) - Number(b?.col)); }
  function interiorFor(world, buildingId) { return world?.buildingInteriors?.interiors?.find?.((item) => String(item.buildingId) === String(buildingId)) || null; }
  function assignmentMap(world) { return new Map((world?.npcWorkplaces?.assignments || []).map((item) => [String(item.id), item])); }
  function isOutdoor(assignment) { return assignment?.workplaceKind === 'outdoor-worksite-required' || Game.NPCWorkplaces?.outdoorProfessions?.includes?.(assignment?.profession); }
  function isGuardDuty(assignment) { return ['guard', 'militia'].includes(String(assignment?.profession || '').trim().toLowerCase()); }
  function tileWalkable(world, point) { const tile = world?.terrain?.[point.row]?.[point.col]; return Boolean(tile && Game.TerrainRouting?.isWalkableTile?.(tile)); }
  function interiorCandidates(world, interior) {
    const door = interior?.door;
    return (interior?.floors || []).filter((point) => !same(point, door)).filter((point) => tileWalkable(world, point)).slice().sort((a, b) => Number(a.row) - Number(b.row) || Number(a.col) - Number(b.col));
  }

  function assignIndoorAnchors() {
    if (assigningIndoorAnchors) return false;
    const world = Game.State?.world;
    if (!world || !Array.isArray(world.npcs)) return false;
    assigningIndoorAnchors = true;
    try {
      Game.StarterVillageInteriors?.materialize?.(world);
      Game.NPCWorkplaces?.sync?.();
      Game.OutdoorWorksites?.sync?.();
      // #261 owns guard duty targets. Re-apply those deterministic anchors before the
      // ordinary indoor-worker pass, then exclude guard/militia from #318's interior work
      // placement so the duty post cannot be overwritten by a guard-post interior.
      Game.GuardShiftRuntime?.sync?.();
      const assignments = assignmentMap(world), b = binding(world), claimed = new Set(), records = [];
      const ordered = world.npcs.slice().sort((a, c) => String(a.id).localeCompare(String(c.id)));
      for (const npc of ordered) {
        const assignment = assignments.get(String(npc.id));
        if (!assignment || isOutdoor(assignment) || isGuardDuty(assignment) || assignment.workplaceKind !== 'building' || !assignment.workplaceBuildingId) { npc.indoorWorkAnchor = null; continue; }
        const interior = interiorFor(world, assignment.workplaceBuildingId);
        if (!interior) { npc.indoorWorkAnchor = null; continue; }
        const candidates = interiorCandidates(world, interior).filter((point) => !claimed.has(key(point)));
        if (!candidates.length) { npc.indoorWorkAnchor = null; records.push({ npcId: npc.id, buildingId: assignment.workplaceBuildingId, resolved: false, reason: 'no-unoccupied-walkable-interior-floor' }); continue; }
        const slot = Math.max(0, Number(assignment.capacitySlot || 0));
        const target = candidates[slot % candidates.length] || candidates[0];
        claimed.add(key(target));
        const work = strategic(target, b);
        npc.anchors = npc.anchors || {};
        npc.anchors.work = { ...(npc.anchors.work || {}), ...work, buildingId: String(assignment.workplaceBuildingId), indoor: true, source: 'npc-workplaces+starter-village-interiors', capacitySlot: assignment.capacitySlot };
        npc.indoorWorkAnchor = Object.freeze({ authority: 'simulation-derived', buildingId: String(assignment.workplaceBuildingId), ...work, capacitySlot: assignment.capacitySlot });
        records.push({ npcId: npc.id, buildingId: String(assignment.workplaceBuildingId), localRow: target.row, localCol: target.col, resolved: true });
      }
      world.npcIndoorWorkAnchors = Object.freeze({ version: VERSION, authority: 'simulation-derived', assignmentSource: Game.NPCWorkplaces?.version || null, interiorSource: world.buildingInteriors?.version || null, resolvedCount: records.filter((item) => item.resolved).length, unresolvedCount: records.filter((item) => !item.resolved).length, records: Object.freeze(records.map(Object.freeze)) });
      Game.NPCTerrainRouting?.refreshRoutes?.();
      return true;
    } finally { assigningIndoorAnchors = false; }
  }

  function applyActivityLocationLegality() {
    const world = Game.State?.world;
    if (!world || !Array.isArray(world.npcs) || typeof Game.NPCLife?.applyActivityLocationGate !== 'function') return false;
    for (const npc of world.npcs) {
      const schedule = npc.dailySchedule || Game.NPCLife.scheduleState?.(npc, Game.GameTime?.capture?.()?.totalGameMinutes);
      if (!schedule) continue;
      npc.dailySchedule = schedule;
      Game.NPCLife.applyActivityLocationGate(npc, schedule, { world });
    }
    world.npcActivityLocationGate = Object.freeze({ version: 'r04-activity-location-gate-v1', authority: 'simulation', checkedCount: world.npcs.length, blockedCount: world.npcs.filter((npc) => npc.activityLocationState?.legal === false).length });
    return true;
  }

  function conversationValidity(npc, world = Game.State?.world) {
    const partnerId = npc?.dialogueWith;
    if (!partnerId) return Object.freeze({ valid: false, reason: 'missing-partner-id', partner: null });
    if (String(partnerId) === String(npc.id)) return Object.freeze({ valid: false, reason: 'self-partner', partner: null });
    const partner = world?.npcs?.find?.((candidate) => String(candidate.id) === String(partnerId)) || null;
    if (!partner) return Object.freeze({ valid: false, reason: 'partner-unavailable', partner: null });
    if (Number(npc.regionX || 0) !== Number(partner.regionX || 0) || Number(npc.regionY || 0) !== Number(partner.regionY || 0)) return Object.freeze({ valid: false, reason: 'different-local-context', partner });
    if (String(partner.dialogueWith || '') !== String(npc.id)) return Object.freeze({ valid: false, reason: 'non-reciprocal-partner', partner });
    const separation = distance(npc, partner);
    if (separation !== 1) return Object.freeze({ valid: false, reason: separation === 0 ? 'same-tile-illegal' : 'partner-not-adjacent', partner, separation });
    return Object.freeze({ valid: true, reason: 'reciprocal-adjacent-pair', partner, separation: 1 });
  }

  function reconcileConversations() {
    const world = Game.State?.world;
    if (!world || !Array.isArray(world.npcs)) return false;
    const validPairs = new Map();
    const originalDialogue = Array.isArray(world.npcDialogues) ? world.npcDialogues.slice() : [];
    for (const npc of world.npcs) {
      if (!npc.dialogueWith) continue;
      const validity = conversationValidity(npc, world);
      if (!validity.valid) {
        const partnerId = validity.partner?.id || null;
        npc.intendedDialogueWith = partnerId;
        npc.dialogueWith = null;
        npc.dialogueLine = null;
        if (['talking', 'chatting'].includes(String(npc.activity || '').toLowerCase())) npc.activity = partnerId ? 'waiting' : 'social';
        npc.conversationState = Object.freeze({ authority: 'simulation', valid: false, reason: validity.reason, intendedPartnerId: partnerId });
        continue;
      }
      const partner = validity.partner;
      const pairIds = [String(npc.id), String(partner.id)].sort();
      const pairKey = pairIds.join('|');
      npc.intendedDialogueWith = null;
      npc.activity = 'talking';
      npc.conversationState = Object.freeze({ authority: 'simulation', valid: true, reason: 'reciprocal-adjacent-pair', partnerId: partner.id });
      if (!validPairs.has(pairKey)) {
        const existing = originalDialogue.find((item) => pairIds.includes(String(item.speakerId)) && pairIds.includes(String(item.listenerId)));
        validPairs.set(pairKey, Object.freeze({
          authority: 'presentation-context', authoritativeFact: false,
          speakerId: existing?.speakerId || npc.id, listenerId: existing?.listenerId || partner.id,
          line: existing?.line || npc.dialogueLine || partner.dialogueLine || `${npc.name || npc.id} and ${partner.name || partner.id} are talking.`, adjacent: true
        }));
      }
    }
    world.npcDialogues = Array.from(validPairs.values());
    world.npcConversationGuard = Object.freeze({ version: 'r04-adjacent-conversation-guard-v1', authority: 'simulation', validPairCount: validPairs.size });
    return true;
  }

  function installRenderHook() {
    const renderer = Game.Renderer;
    if (!renderer || typeof renderer.renderWorld !== 'function' || renderHookInstalled) return false;
    const renderWorld = renderer.renderWorld.bind(renderer);
    renderer.renderWorld = function postRoutingNpcIntegrationRenderWorld(force) {
      assignIndoorAnchors();
      const result = renderWorld(force);
      applyActivityLocationLegality();
      reconcileConversations();
      return result;
    };
    renderHookInstalled = true;
    return true;
  }

  function initialize() {
    if (!Game.NPCSpatial || !Game.NPCWorkplaces || !Game.StarterVillageInteriors) return false;
    Game.NPCSpatial.ensureSpatialNpcs?.();
    assignIndoorAnchors();
    applyActivityLocationLegality();
    reconcileConversations();
    installRenderHook();
    return true;
  }

  Game.NPCIndoorWorkAnchors = Object.freeze({ version: VERSION, authority: 'simulation-derived', assignIndoorAnchors, applyActivityLocationLegality, conversationValidity, reconcileConversations, initialize });
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
    else initialize();
  }
})(typeof window !== 'undefined' ? window : globalThis);