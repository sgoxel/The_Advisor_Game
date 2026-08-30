/*
  Development foundation: the protagonist is a resident of the village, not an idle camera token.
  This module derives a low-priority daily routine from authoritative game time + current profession.
  It never teleports or directly moves the protagonist; Advisor/career/autonomous Simulation actions remain authoritative.
*/
(function installProtagonistRoutine(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-protagonist-routine-v1';
  const REFRESH_MS = 1000;
  const ROLE_ALIASES = Object.freeze({
    peasant: 'farmer',
    villager: 'default',
    farmer: 'farmer',
    farmhand: 'farmer',
    herder: 'herder',
    shepherd: 'herder',
    blacksmith: 'blacksmith',
    smith: 'blacksmith',
    innkeeper: 'innkeeper',
    tavernkeeper: 'innkeeper',
    baker: 'baker',
    trader: 'trader',
    merchant: 'merchant',
    guard: 'guard'
  });
  const WORK_BUILDING_TYPES = Object.freeze({
    farmer: Object.freeze(['farmstead', 'farm', 'mill']),
    herder: Object.freeze(['farmstead', 'farm']),
    blacksmith: Object.freeze(['smithy', 'blacksmith', 'workshop']),
    innkeeper: Object.freeze(['inn', 'tavern', 'lodging']),
    baker: Object.freeze(['bakery', 'market']),
    trader: Object.freeze(['market', 'shop']),
    merchant: Object.freeze(['market', 'shop']),
    guard: Object.freeze(['guard_post', 'guard', 'village_hall']),
    default: Object.freeze(['market', 'workshop', 'farmstead'])
  });
  const HOME_TYPES = Object.freeze(['home', 'house', 'dwelling']);
  const SOCIAL_TYPES = Object.freeze(['inn', 'tavern', 'market', 'village_hall', 'hall']);

  let timer = null;

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => freeze(value[key]));
    return value;
  }

  function hash32(value) {
    let hash = 2166136261 >>> 0;
    for (const char of String(value || '')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function currentProfile() {
    const existing = Game.State?.characterProfile;
    if (Game.CharacterProgressionProfile?.isCurrentProfile?.(existing)) return existing;
    return Game.CharacterProgressionProfile?.normalize?.(Game.State?.world?.seed, 'protagonist', existing) || existing || null;
  }

  function routineRole(profileInput = currentProfile()) {
    const profession = text(profileInput?.currentProfession || profileInput?.baseProfession || 'default').toLowerCase();
    if (ROLE_ALIASES[profession]) return ROLE_ALIASES[profession];
    if (profession.includes('smith')) return 'blacksmith';
    if (profession.includes('farm') || profession.includes('peasant')) return 'farmer';
    if (profession.includes('inn') || profession.includes('tavern')) return 'innkeeper';
    if (profession.includes('bake')) return 'baker';
    if (profession.includes('trade')) return 'trader';
    if (profession.includes('merchant')) return 'merchant';
    if (profession.includes('guard') || profession.includes('watch')) return 'guard';
    if (profession.includes('herd') || profession.includes('shepherd')) return 'herder';
    return 'default';
  }

  function buildingType(building) {
    return text(building?.type).toLowerCase();
  }

  function candidatesForTypes(types) {
    const buildings = Game.State?.world?.originVillage?.buildings;
    if (!Array.isArray(buildings)) return [];
    const allowed = new Set(types.map((type) => String(type).toLowerCase()));
    return buildings.filter((building) => allowed.has(buildingType(building)));
  }

  function deterministicPick(candidates, salt) {
    if (!candidates.length) return null;
    const seed = text(Game.State?.world?.seed) || 'world';
    const characterId = text(currentProfile()?.characterId) || 'protagonist';
    return candidates[hash32(`${seed}|${characterId}|${salt}`) % candidates.length];
  }

  function anchorPoint(building) {
    if (!building) return null;
    const entranceRow = Number(building.entrance?.row);
    const entranceCol = Number(building.entrance?.col);
    if (Number.isFinite(entranceRow) && Number.isFinite(entranceCol)) {
      return freeze({ row: entranceRow, col: entranceCol, source: 'entrance' });
    }
    const row = Number(building.footprint?.row);
    const col = Number(building.footprint?.col);
    const height = Number(building.footprint?.height);
    const width = Number(building.footprint?.width);
    if ([row, col, height, width].every(Number.isFinite)) {
      return freeze({ row: row + Math.max(0, height - 1) / 2, col: col + Math.max(0, width - 1) / 2, source: 'footprint-center' });
    }
    return null;
  }

  function resolveAnchors(role) {
    const home = deterministicPick(candidatesForTypes(HOME_TYPES), 'home');
    const work = deterministicPick(candidatesForTypes(WORK_BUILDING_TYPES[role] || WORK_BUILDING_TYPES.default), `work:${role}`);
    const social = deterministicPick(candidatesForTypes(SOCIAL_TYPES), 'social');
    return freeze({
      home: home ? { buildingId: text(home.id) || null, buildingType: buildingType(home), point: anchorPoint(home) } : null,
      work: work ? { buildingId: text(work.id) || null, buildingType: buildingType(work), point: anchorPoint(work) } : null,
      social: social ? { buildingId: text(social.id) || null, buildingType: buildingType(social), point: anchorPoint(social) } : null
    });
  }

  function scheduleState(totalGameMinutesInput = null, profileInput = currentProfile()) {
    const role = routineRole(profileInput);
    const totalGameMinutes = totalGameMinutesInput === null
      ? Game.GameTime?.capture?.()?.totalGameMinutes
      : Number(totalGameMinutesInput);
    if (!Number.isFinite(totalGameMinutes) || totalGameMinutes < 0) return null;

    const npcSchedule = Game.NPCLife?.scheduleState?.({ id: 'protagonist', occupation: role }, totalGameMinutes);
    if (!npcSchedule) return null;
    const anchors = resolveAnchors(role);
    const activeAnchor = anchors[npcSchedule.anchor] || null;
    const profession = text(profileInput?.currentProfession || profileInput?.baseProfession || 'Peasant') || 'Peasant';
    return freeze({
      version: VERSION,
      authority: 'character-routine',
      characterId: text(profileInput?.characterId) || 'protagonist',
      rank: text(profileInput?.rank) || 'Peasant',
      profession,
      routineRole: role,
      totalGameMinutes: Number(totalGameMinutes.toFixed(6)),
      minuteOfDay: npcSchedule.minuteOfDay,
      activity: npcSchedule.activity,
      anchor: npcSchedule.anchor,
      targetBuildingId: activeAnchor?.buildingId || null,
      targetBuildingType: activeAnchor?.buildingType || null,
      target: activeAnchor?.point || null,
      anchors,
      priority: 'baseline-resident-routine',
      canYieldToAdvisor: true,
      canYieldToCareerIntent: true,
      canYieldToSimulationAction: true,
      directMovementAuthority: false,
      playerControllable: true
    });
  }

  function refresh(totalGameMinutesInput = null) {
    const state = scheduleState(totalGameMinutesInput);
    if (!state || !Game.State) return state;
    Game.State.protagonistRoutine = state;
    if (Game.State.world?.player) Game.State.world.player.dailyRoutine = state;
    return state;
  }

  function buildRoutineOpportunity(contextInput = {}) {
    const state = scheduleState(contextInput.campaignMinute ?? null);
    if (!state || !state.targetBuildingId) return null;
    const contextRevision = Number(contextInput.contextRevision);
    const actorId = text(contextInput.actorId) || state.characterId;
    return freeze({
      id: `routine:${state.routineRole}:${state.anchor}:${state.targetBuildingId}`,
      source: 'protagonist-resident-routine',
      actorId,
      goalType: state.anchor === 'work' ? 'daily-work' : state.anchor === 'social' ? 'daily-social' : 'daily-home',
      actionType: 'move',
      targetRef: state.targetBuildingId,
      locationRef: text(contextInput.locationRef) || null,
      priority: -100,
      urgency: 5,
      distance: 0,
      expectedContextRevision: Number.isFinite(contextRevision) ? Math.max(0, Math.trunc(contextRevision)) : 0,
      routine: state
    });
  }

  function start() {
    refresh();
    if (timer !== null || typeof global.setInterval !== 'function') return;
    timer = global.setInterval(() => refresh(), REFRESH_MS);
  }

  function stop() {
    if (timer !== null && typeof global.clearInterval === 'function') global.clearInterval(timer);
    timer = null;
  }

  Game.ProtagonistRoutine = Object.freeze({
    version: VERSION,
    authority: 'character-routine',
    routineRole,
    resolveAnchors,
    scheduleState,
    refresh,
    buildRoutineOpportunity,
    start,
    stop
  });

  if (global.document) {
    if (global.document.readyState === 'loading') global.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
