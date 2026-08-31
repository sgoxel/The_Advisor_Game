/* R04 / #331: presentation-only smooth NPC tile motion with age-aware bounded duration. */
(function installNpcMotionPresentation(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-npc-motion-presentation-v1';
  const MIN_TILE_MS = 500;
  const MAX_TILE_MS = 4000;
  const PAUSE_SNAP_MS = 600;
  const LARGE_GAP_MS = 4500;
  const motions = new Map();
  let installed = false;
  let lastObservedRealMs = null;
  let lastObservedGameMinutes = null;
  let unchangedGameTimeSinceMs = null;

  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function nowMs() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  function hashUnit(text) {
    let hash = 2166136261 >>> 0;
    for (const char of String(text)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return (hash >>> 0) / 0xffffffff;
  }

  function ageContextFor(npc) {
    try {
      const world = Game.State?.world;
      const derived = Game.CharacterAge?.deriveFromSeed?.(String(world?.seed || ''), String(npc?.id || ''));
      if (derived?.ok) return derived;
    } catch (_) {}
    return { ok: false, ageYears: 35, lifeStage: { id: 'adult' } };
  }

  function tileDurationMsForAge(ageInput, lifeStageInput = null, characterId = '') {
    const age = clamp(Number.isFinite(Number(ageInput)) ? Number(ageInput) : 35, 0, 110);
    const stage = String(lifeStageInput || Game.CharacterAge?.lifeStageForAge?.(Math.floor(age))?.id || 'adult');
    const stageBase = {
      child: 950,
      adolescent: 500,
      'young-adult': 650,
      adult: 900,
      'mature-adult': 1500,
      'older-adult': 2450
    }[stage] ?? 900;
    const ageProgress = age <= 17 ? 0 : age <= 44 ? (age - 18) * 12 : age <= 64 ? (age - 45) * 28 : (age - 65) * 42;
    const identityVariation = characterId ? Math.round((hashUnit(characterId) - 0.5) * 300) : 0;
    if (age >= 100) return MAX_TILE_MS;
    if (stage === 'adolescent' && age <= 17 && !characterId) return MIN_TILE_MS;
    return Math.round(clamp(stageBase + ageProgress + identityVariation, MIN_TILE_MS, MAX_TILE_MS));
  }

  function durationForNpc(npc) {
    const age = ageContextFor(npc);
    return tileDurationMsForAge(age.ageYears, age.lifeStage?.id, npc?.id || '');
  }

  function authoritativePoint(npc) {
    return { row: Math.trunc(Number(npc?.row) || 0), col: Math.trunc(Number(npc?.col) || 0) };
  }

  function same(a, b) { return a && b && a.row === b.row && a.col === b.col; }
  function adjacent(a, b) { return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1; }

  function observe(now = nowMs()) {
    const world = Game.State?.world;
    if (!Array.isArray(world?.npcs)) return;
    const gameMinutes = Number(Game.GameTime?.capture?.()?.totalGameMinutes ?? world.gameTime?.totalGameMinutes ?? 0);
    const realGap = lastObservedRealMs === null ? 0 : Math.max(0, now - lastObservedRealMs);
    const gameTimeChanged = lastObservedGameMinutes === null || gameMinutes !== lastObservedGameMinutes;
    if (gameTimeChanged) unchangedGameTimeSinceMs = now;
    else if (unchangedGameTimeSinceMs === null) unchangedGameTimeSinceMs = now;
    const pausedTooLong = !gameTimeChanged && now - unchangedGameTimeSinceMs >= PAUSE_SNAP_MS;
    const largeGap = realGap >= LARGE_GAP_MS;

    const liveIds = new Set();
    for (const npc of world.npcs) {
      liveIds.add(npc.id);
      const current = authoritativePoint(npc);
      const prior = motions.get(npc.id);
      if (!prior) {
        motions.set(npc.id, { from: current, to: current, startedAtMs: now, durationMs: durationForNpc(npc), authoritative: current });
        continue;
      }
      if (!same(prior.authoritative, current)) {
        const canInterpolate = adjacent(prior.authoritative, current) && !['hold', 'yield-wait', 'dialogue-position'].includes(String(npc.movementDecision || ''));
        motions.set(npc.id, {
          from: canInterpolate && !largeGap ? prior.authoritative : current,
          to: current,
          startedAtMs: now,
          durationMs: durationForNpc(npc),
          authoritative: current
        });
      } else if (pausedTooLong || largeGap || ['hold', 'yield-wait', 'dialogue-position'].includes(String(npc.movementDecision || ''))) {
        motions.set(npc.id, { ...prior, from: current, to: current, startedAtMs: now, authoritative: current });
      }
    }
    for (const id of motions.keys()) if (!liveIds.has(id)) motions.delete(id);
    lastObservedRealMs = now;
    lastObservedGameMinutes = gameMinutes;
  }

  function presentationPosition(npc, now = nowMs()) {
    const authoritative = authoritativePoint(npc);
    const motion = motions.get(npc?.id);
    if (!motion || !same(motion.authoritative, authoritative) || same(motion.from, motion.to)) return authoritative;
    const elapsed = Math.max(0, now - motion.startedAtMs);
    if (elapsed >= Math.min(motion.durationMs, LARGE_GAP_MS)) return authoritative;
    const t = clamp(elapsed / motion.durationMs, 0, 1);
    return {
      row: motion.from.row + (motion.to.row - motion.from.row) * t,
      col: motion.from.col + (motion.to.col - motion.from.col) * t
    };
  }

  function withPresentationGrid(project) {
    const renderer = Game.Renderer;
    const original = renderer?.gridToScreen;
    const world = Game.State?.world;
    if (!renderer || typeof original !== 'function' || !Array.isArray(world?.npcs)) return project();
    const byTile = new Map(world.npcs.map((npc) => [`${Math.trunc(npc.row)},${Math.trunc(npc.col)}`, npc]));
    renderer.gridToScreen = function motionAwareGridToScreen(row, col, ...rest) {
      const npc = Number.isInteger(Number(row)) && Number.isInteger(Number(col)) ? byTile.get(`${Number(row)},${Number(col)}`) : null;
      if (!npc) return original.call(renderer, row, col, ...rest);
      const p = presentationPosition(npc);
      return original.call(renderer, p.row, p.col, ...rest);
    };
    try { return project(); }
    finally { renderer.gridToScreen = original; }
  }

  function install() {
    if (installed || !Game.Renderer?.renderWorld || !Game.NPCWorld?.drawPresentation || !Game.NPCSpatial?.updateAt) return false;
    const renderer = Game.Renderer;
    const renderWorld = renderer.renderWorld.bind(renderer);
    renderer.renderWorld = function ageAwareNpcMotionRender(force) {
      const result = renderWorld(force);
      observe();
      withPresentationGrid(() => Game.NPCWorld.drawPresentation());
      return result;
    };
    installed = true;
    observe();
    return true;
  }

  Game.NPCMotionPresentation = Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    minTileMs: MIN_TILE_MS,
    maxTileMs: MAX_TILE_MS,
    tileDurationMsForAge,
    durationForNpc,
    observe,
    presentationPosition,
    install
  });

  let attempts = 0;
  const timer = global.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 80) global.clearInterval(timer);
  }, 50);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof window !== 'undefined' ? window : globalThis);
