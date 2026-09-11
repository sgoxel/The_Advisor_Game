/* R04 / #331 + WP-111/I02: presentation-only smooth NPC tile motion with bounded retention. */
(function installNpcMotionPresentation(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'wp111-i02-npc-motion-presentation-v2';
  const MIN_TILE_MS = 500;
  const MAX_TILE_MS = 4000;
  const PAUSE_SNAP_MS = 600;
  const LARGE_GAP_MS = 4500;
  const RETENTION_MS = 250;
  const motions = new Map();
  const retained = new Map();
  const retainedImageCache = new Map();
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

  function stableIdentityStillExists(id) {
    const world = Game.State?.world;
    const population = world?.originVillage?.population;
    if (!Array.isArray(population)) return false;
    return population.some((person) => String(person?.id || '') === String(id || ''));
  }

  function snapshotPresentationNpc(npc, now) {
    return Object.freeze({
      id: String(npc.id),
      authority: 'presentation-only',
      occupation: String(npc.occupation || ''),
      activity: String(npc.activity || ''),
      row: Number(npc.row),
      col: Number(npc.col),
      lastSeenMs: now
    });
  }

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
      liveIds.add(String(npc.id));
      retained.set(String(npc.id), snapshotPresentationNpc(npc, now));
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
    for (const id of motions.keys()) if (!liveIds.has(String(id))) motions.delete(id);
    for (const [id, snapshot] of retained.entries()) {
      if (liveIds.has(id)) continue;
      if (!stableIdentityStillExists(id) || now - snapshot.lastSeenMs > RETENTION_MS) retained.delete(id);
    }
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

  function retainedForFrame(now = nowMs()) {
    const world = Game.State?.world;
    const liveIds = new Set(Array.isArray(world?.npcs) ? world.npcs.map((npc) => String(npc?.id || '')) : []);
    const result = [];
    for (const [id, snapshot] of retained.entries()) {
      if (liveIds.has(id)) continue;
      if (!stableIdentityStillExists(id) || now - snapshot.lastSeenMs > RETENTION_MS) continue;
      result.push(snapshot);
    }
    return result;
  }

  function requestRetainedImage(src) {
    if (!src || typeof Image === 'undefined') return null;
    if (retainedImageCache.has(src)) return retainedImageCache.get(src);
    const record = { status: 'loading', image: null };
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => { record.status = 'ready'; record.image = image; };
    image.onerror = () => { record.status = 'failed'; record.image = null; };
    image.src = src;
    retainedImageCache.set(src, record);
    return record;
  }

  function drawFallback(ctx, scale) {
    const radius = scale.fallbackRadius;
    ctx.fillStyle = '#d8e7ef';
    ctx.strokeStyle = '#26343d';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, -radius * 3.25, radius * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-radius * 0.7, -radius * 2.5);
    ctx.lineTo(radius * 0.7, -radius * 2.5);
    ctx.lineTo(radius * 0.95, -radius * 0.55);
    ctx.lineTo(-radius * 0.95, -radius * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawRetainedPresentations(now = nowMs()) {
    const canvas = Game.NPCWorld?.ensureOverlay?.();
    const renderer = Game.Renderer;
    if (!canvas || !renderer?.gridToScreen) return 0;
    const snapshots = retainedForFrame(now);
    if (!snapshots.length) return 0;
    const width = Math.max(1, canvas.clientWidth || Game.State?.dom?.canvas?.clientWidth || 1);
    const height = Math.max(1, canvas.clientHeight || Game.State?.dom?.canvas?.clientHeight || 1);
    const dpr = Math.max(1, global.devicePixelRatio || 1);
    const scale = Game.NPCWorld?.resolveWorldSpaceScale?.(width) || { width: 40, height: 50, fallbackRadius: 7 };
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let drawn = 0;
    for (const snapshot of snapshots) {
      const point = renderer.gridToScreen(snapshot.row, snapshot.col, 0, 0);
      if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
      if (point.x < -scale.width || point.y < -scale.height || point.x > width + scale.width || point.y > height + scale.height) continue;
      ctx.save();
      ctx.translate(point.x, point.y);
      const asset = Game.NPCWorld?.worldSpaceAssetFor?.({ authority: 'simulation', occupation: snapshot.occupation }) || '';
      const record = requestRetainedImage(asset);
      if (record?.status === 'ready' && record.image) ctx.drawImage(record.image, -scale.width / 2, -scale.height, scale.width, scale.height);
      else drawFallback(ctx, scale);
      ctx.restore();
      drawn += 1;
    }
    canvas.dataset.retainedNpcCount = String(drawn);
    canvas.dataset.retentionMs = String(RETENTION_MS);
    return drawn;
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
      const now = nowMs();
      observe(now);
      withPresentationGrid(() => Game.NPCWorld.drawPresentation());
      drawRetainedPresentations(now);
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
    retentionMs: RETENTION_MS,
    tileDurationMsForAge,
    durationForNpc,
    observe,
    presentationPosition,
    retainedForFrame,
    drawRetainedPresentations,
    install
  });

  let attempts = 0;
  const timer = global.setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 80) global.clearInterval(timer);
  }, 50);
  if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(typeof window !== 'undefined' ? window : globalThis);
