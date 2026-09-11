/* WP-111/I03: bounded presentation-only viewport culling hysteresis. */
(function installNpcCullingHysteresis(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'wp111-i03-npc-culling-hysteresis-v1';
  const ENTER_MARGIN_PX = 2;
  const EXIT_MARGIN_PX = 36;
  const activeKeys = new Set();
  const imageCache = new Map();
  let patched = false;

  function finite(value) {
    return Number.isFinite(Number(value));
  }

  function intersectsViewport(point, scale, width, height, marginPx) {
    if (!point || !finite(point.x) || !finite(point.y)) return false;
    const margin = Math.max(0, Number(marginPx) || 0);
    const spriteWidth = Math.max(1, Number(scale?.width) || 1);
    const spriteHeight = Math.max(1, Number(scale?.height) || 1);
    const left = Number(point.x) - spriteWidth / 2;
    const right = Number(point.x) + spriteWidth / 2;
    const top = Number(point.y) - spriteHeight;
    const bottom = Number(point.y);
    return right >= -margin && left <= Number(width) + margin && bottom >= -margin && top <= Number(height) + margin;
  }

  function shouldPresent(key, point, scale, width, height, wasPresented = activeKeys.has(key)) {
    const margin = wasPresented ? EXIT_MARGIN_PX : ENTER_MARGIN_PX;
    return intersectsViewport(point, scale, width, height, margin);
  }

  function requestImage(src, redraw) {
    if (!src || typeof global.Image === 'undefined') return null;
    if (imageCache.has(src)) return imageCache.get(src);
    const record = { status: 'loading', image: null };
    const image = new global.Image();
    image.decoding = 'async';
    image.onload = () => {
      record.status = 'ready';
      record.image = image;
      if (typeof redraw === 'function') redraw();
    };
    image.onerror = () => {
      record.status = 'failed';
      record.image = null;
      if (typeof redraw === 'function') redraw();
    };
    image.src = src;
    imageCache.set(src, record);
    return record;
  }

  function drawFallback(ctx, npc, scale) {
    const radius = Math.max(5, Number(scale?.fallbackRadius) || 7);
    const accent = npc?.activity === 'working' ? '#f1c75b' : '#d8e7ef';
    ctx.fillStyle = 'rgba(20, 28, 36, 0.38)';
    ctx.beginPath();
    ctx.ellipse(radius * 0.5, -radius * 0.35, radius * 1.25, radius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accent;
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

  function drawEntity(ctx, entity, scale, asset, redraw) {
    const record = requestImage(asset, redraw);
    if (record?.status === 'ready' && record.image) {
      ctx.drawImage(record.image, -scale.width / 2, -scale.height, scale.width, scale.height);
      return 'world-space-png';
    }
    drawFallback(ctx, entity, scale);
    return asset ? 'fallback-loading-or-failed' : 'fallback-unmapped';
  }

  function stableNpcKey(npc) {
    return Game.PresentationIdentity?.npc?.(npc) || (npc?.id ? `npc:${String(npc.id)}` : null);
  }

  function stableProtagonistKey(player) {
    return Game.PresentationIdentity?.protagonist?.(player) || null;
  }

  function drawPresentation() {
    const canvas = Game.NPCWorld?.ensureOverlay?.();
    const Renderer = Game.Renderer;
    const world = Game.State?.world;
    if (!canvas || !Renderer?.gridToScreen || !world || !Array.isArray(world.npcs)) return;

    const width = Math.max(1, canvas.clientWidth || Game.State?.dom?.canvas?.clientWidth || 1);
    const height = Math.max(1, canvas.clientHeight || Game.State?.dom?.canvas?.clientHeight || 1);
    const dpr = Math.max(1, global.devicePixelRatio || 1);
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const scale = Game.NPCWorld?.resolveWorldSpaceScale?.(width) || {
      width: 40,
      height: 50,
      fallbackRadius: 7,
      compatibilityIconSize: 50
    };
    const nextKeys = new Set();
    let visibleCount = 0;
    let pngCount = 0;
    let fallbackCount = 0;

    for (const npc of world.npcs) {
      const point = Renderer.gridToScreen(Number(npc.row), Number(npc.col), 0, 0);
      const key = stableNpcKey(npc);
      const wasPresented = key ? activeKeys.has(key) : false;
      if (!shouldPresent(key, point, scale, width, height, wasPresented)) continue;
      if (key) nextKeys.add(key);

      ctx.save();
      ctx.translate(Number(point.x), Number(point.y));
      const asset = Game.NPCWorld?.worldSpaceAssetFor?.(npc) || '';
      const renderKind = drawEntity(ctx, npc, scale, asset, drawPresentation);
      if (renderKind === 'world-space-png') pngCount += 1;
      else fallbackCount += 1;
      ctx.restore();
      visibleCount += 1;
    }

    let protagonistVisible = false;
    let protagonistRenderKind = 'unavailable';
    const player = world.player;
    if (player && finite(player.row) && finite(player.col)) {
      const point = Renderer.gridToScreen(Number(player.row), Number(player.col), 0, 0);
      const key = stableProtagonistKey(player);
      const wasPresented = key ? activeKeys.has(key) : false;
      if (shouldPresent(key, point, scale, width, height, wasPresented)) {
        if (key) nextKeys.add(key);
        ctx.save();
        ctx.translate(Number(point.x), Number(point.y));
        const asset = Game.NPCWorld?.protagonistWorldSpaceAssetFor?.(player) || '';
        protagonistRenderKind = drawEntity(ctx, { activity: 'protagonist' }, scale, asset, drawPresentation);
        ctx.restore();
        protagonistVisible = true;
      }
    }

    activeKeys.clear();
    for (const key of nextKeys) activeKeys.add(key);

    canvas.dataset.npcCount = String(world.npcs.length);
    canvas.dataset.visibleNpcCount = String(visibleCount);
    canvas.dataset.pngNpcCount = String(pngCount);
    canvas.dataset.fallbackNpcCount = String(fallbackCount);
    canvas.dataset.iconSizePx = Number(scale.compatibilityIconSize || scale.height).toFixed(1);
    canvas.dataset.spriteWidthPx = Number(scale.width).toFixed(1);
    canvas.dataset.spriteHeightPx = Number(scale.height).toFixed(1);
    canvas.dataset.spriteAnchor = 'bottom-center-feet';
    canvas.dataset.protagonistVisible = String(protagonistVisible);
    canvas.dataset.protagonistRenderKind = protagonistRenderKind;
    canvas.dataset.cullingHysteresis = VERSION;
    canvas.dataset.cullingEnterMarginPx = String(ENTER_MARGIN_PX);
    canvas.dataset.cullingExitMarginPx = String(EXIT_MARGIN_PX);
    canvas.dataset.presentationAuthority = 'presentation-only';
  }

  function patchNpcPresentation() {
    if (patched || !Game.NPCWorld?.drawPresentation || !Game.Renderer?.gridToScreen) return false;
    Game.NPCWorld.drawPresentation = drawPresentation;
    patched = true;
    return true;
  }

  Game.NPCCullingHysteresis = Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    enterMarginPx: ENTER_MARGIN_PX,
    exitMarginPx: EXIT_MARGIN_PX,
    intersectsViewport,
    shouldPresent,
    drawPresentation,
    patchNpcPresentation
  });

  let attempts = 0;
  const timer = global.setInterval(() => {
    attempts += 1;
    if (patchNpcPresentation() || attempts >= 120) global.clearInterval(timer);
  }, 50);
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => global.setTimeout(patchNpcPresentation, 0), { once: true });
  } else {
    patchNpcPresentation();
  }
})(typeof window !== 'undefined' ? window : globalThis);
