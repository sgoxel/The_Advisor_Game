/*
  R02-T16 / #111 + R04 / #228: local NPC world presence and character-derived presentation.

  Simulation owns NPC identity, location, activity and routine state. Rendering is a
  derived 2D overlay projected onto the existing strategic world; it never becomes
  gameplay authority and exposes no player-control surface.
*/
(function installNpcWorldFoundation() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-character-world-icons-v1';
  const CYCLE_MS = 24000;
  const MAX_VISIBLE_NPCS = 16;

  const OCCUPATION_ROLE = Object.freeze({
    innkeeper: 'lodging',
    baker: 'food',
    trader: 'trade',
    blacksmith: 'production',
    carpenter: 'labor',
    laborer: 'labor',
    farmer: 'trade',
    herder: 'trade',
    guard: 'guard',
    miller: 'production',
    woodcutter: 'labor',
    healer: 'landmark',
    villager: 'trade'
  });

  // #227 identity families are presentation mappings only. The occupation key comes
  // from authoritative NPC state; loading success/failure cannot alter that state.
  const WORLD_ICON_BY_OCCUPATION = Object.freeze({
    guard: 'assets/characters/world/guard.png',
    healer: 'assets/characters/world/healer.png',
    innkeeper: 'assets/characters/world/merchant.png',
    trader: 'assets/characters/world/merchant.png',
    baker: 'assets/characters/world/worker.png',
    blacksmith: 'assets/characters/world/worker.png',
    carpenter: 'assets/characters/world/worker.png',
    laborer: 'assets/characters/world/worker.png',
    farmer: 'assets/characters/world/worker.png',
    herder: 'assets/characters/world/worker.png',
    miller: 'assets/characters/world/worker.png',
    woodcutter: 'assets/characters/world/worker.png',
    villager: 'assets/characters/world/villager.png'
  });

  let overlayCanvas = null;
  let renderHookInstalled = false;
  let terrainHookInstalled = false;
  const worldIconCache = new Map();

  function stableOffset(id) {
    const text = String(id || 'npc');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash % CYCLE_MS;
  }

  function clonePoint(point) {
    return { row: Number(point.row), col: Number(point.col) };
  }

  function buildingForRole(buildings, role, fallback) {
    return buildings.find((building) => building.role === role) || fallback;
  }

  function resolveOriginBinding(world, village) {
    const localOrigin = world.originBaseState?.protagonistOrigin || {};
    const player = world.player || {};
    const localRow = Number.isFinite(Number(localOrigin.localRow))
      ? Number(localOrigin.localRow)
      : Number(village.center?.row || 0);
    const localCol = Number.isFinite(Number(localOrigin.localCol))
      ? Number(localOrigin.localCol)
      : Number(village.center?.col || 0);
    const strategicRow = Number.isFinite(Number(player.row)) ? Number(player.row) : localRow;
    const strategicCol = Number.isFinite(Number(player.col)) ? Number(player.col) : localCol;
    return {
      localRow,
      localCol,
      strategicRow,
      strategicCol,
      rowOffset: strategicRow - localRow,
      colOffset: strategicCol - localCol
    };
  }

  function strategicPoint(point, binding) {
    const local = clonePoint(point);
    return {
      localRow: local.row,
      localCol: local.col,
      row: local.row + binding.rowOffset,
      col: local.col + binding.colOffset
    };
  }

  function buildNpcState(person, index, village, binding) {
    const buildings = Array.isArray(village.buildings) ? village.buildings : [];
    const home = buildings.find((building) => building.id === person.homeBuildingId) || buildings[0];
    const workRole = OCCUPATION_ROLE[person.occupation] || 'trade';
    const work = buildingForRole(buildings, workRole, home);
    const social = buildingForRole(buildings, 'trade', buildingForRole(buildings, 'landmark', home));
    const start = home || work || social || { row: village.center?.row || 0, col: village.center?.col || 0 };
    const homePoint = strategicPoint(start, binding);
    const workPoint = strategicPoint(work || start, binding);
    const socialPoint = strategicPoint(social || start, binding);

    return {
      id: person.id,
      authority: 'simulation',
      name: person.name,
      occupation: person.occupation,
      regionX: Number(person.regionX || 0),
      regionY: Number(person.regionY || 0),
      row: homePoint.row,
      col: homePoint.col,
      localRow: homePoint.localRow,
      localCol: homePoint.localCol,
      activity: 'home',
      controlledBy: 'simulation',
      playerControllable: false,
      routineOffsetMs: stableOffset(`${person.id}|${index}`),
      anchors: {
        home: { buildingId: home?.id || null, ...homePoint },
        work: { buildingId: work?.id || null, ...workPoint },
        social: { buildingId: social?.id || null, ...socialPoint }
      }
    };
  }

  function bindFromOriginVillage() {
    const State = Game.State;
    const world = State && State.world;
    const village = world && world.originVillage;
    if (!world || !village || !Array.isArray(village.population)) return false;

    const seed = String(world.seed || '');
    const binding = resolveOriginBinding(world, village);
    const bindingKey = `${binding.localRow},${binding.localCol}->${binding.strategicRow},${binding.strategicCol}`;
    const existingRuntime = world.npcRuntime;
    if (
      existingRuntime &&
      existingRuntime.version === VERSION &&
      existingRuntime.seed === seed &&
      existingRuntime.bindingKey === bindingKey &&
      Array.isArray(world.npcs)
    ) {
      return true;
    }

    const previousById = new Map(Array.isArray(world.npcs) ? world.npcs.map((npc) => [npc.id, npc]) : []);
    world.npcs = village.population.slice(0, MAX_VISIBLE_NPCS).map((person, index) => {
      const previous = previousById.get(person.id);
      if (
        previous &&
        previous.authority === 'simulation' &&
        existingRuntime?.version === VERSION &&
        existingRuntime?.seed === seed &&
        existingRuntime?.bindingKey === bindingKey
      ) return previous;
      return buildNpcState(person, index, village, binding);
    });
    world.npcRuntime = {
      version: VERSION,
      authority: 'simulation',
      seed,
      bindingKey,
      originBinding: binding,
      startedAtMs: typeof performance !== 'undefined' ? performance.now() : 0,
      lastElapsedMs: 0
    };
    return true;
  }

  function interpolate(a, b, t) {
    return a + (b - a) * t;
  }

  function segmentFor(npc, elapsedMs) {
    const position = ((Math.max(0, Number(elapsedMs) || 0) + npc.routineOffsetMs) % CYCLE_MS) / CYCLE_MS;
    if (position < 0.25) return { from: npc.anchors.home, to: npc.anchors.work, t: position / 0.25, activity: 'commuting-to-work' };
    if (position < 0.50) return { from: npc.anchors.work, to: npc.anchors.work, t: 0, activity: 'working' };
    if (position < 0.75) return { from: npc.anchors.work, to: npc.anchors.social, t: (position - 0.50) / 0.25, activity: 'local-errand' };
    return { from: npc.anchors.social, to: npc.anchors.home, t: (position - 0.75) / 0.25, activity: 'returning-home' };
  }

  function updateAt(elapsedMs) {
    if (!bindFromOriginVillage()) return false;
    const world = Game.State.world;
    const runtime = world.npcRuntime;
    const value = Math.max(0, Number(elapsedMs) || 0);
    for (const npc of world.npcs) {
      const segment = segmentFor(npc, value);
      npc.row = interpolate(segment.from.row, segment.to.row, segment.t);
      npc.col = interpolate(segment.from.col, segment.to.col, segment.t);
      npc.localRow = npc.row - runtime.originBinding.rowOffset;
      npc.localCol = npc.col - runtime.originBinding.colOffset;
      npc.activity = segment.activity;
    }
    runtime.lastElapsedMs = value;
    return true;
  }

  function ensureOverlay() {
    const gameCanvas = Game.State?.dom?.canvas || document.getElementById('gameCanvas');
    const host = document.getElementById('center-area');
    if (!gameCanvas || !host) return null;
    if (overlayCanvas && overlayCanvas.isConnected) return overlayCanvas;

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'npcWorldOverlay';
    overlayCanvas.setAttribute('aria-hidden', 'true');
    overlayCanvas.tabIndex = -1;
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.inset = '0';
    overlayCanvas.style.width = '100%';
    overlayCanvas.style.height = '100%';
    overlayCanvas.style.pointerEvents = 'none';
    overlayCanvas.style.zIndex = '2';
    host.appendChild(overlayCanvas);
    return overlayCanvas;
  }

  function worldIconAssetFor(npc) {
    if (!npc || npc.authority !== 'simulation') return '';
    return WORLD_ICON_BY_OCCUPATION[String(npc.occupation || '').toLowerCase()] || '';
  }

  function requestWorldIcon(src) {
    if (!src || typeof Image === 'undefined') return null;
    if (worldIconCache.has(src)) return worldIconCache.get(src);
    const record = { status: 'loading', image: null };
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      record.status = 'ready';
      record.image = image;
      // Loading is presentation-only. Redrawing does not mutate Simulation state.
      drawPresentation();
    };
    image.onerror = () => {
      record.status = 'failed';
      record.image = null;
      drawPresentation();
    };
    image.src = src;
    worldIconCache.set(src, record);
    return record;
  }

  function preloadWorldIcons() {
    for (const src of new Set(Object.values(WORLD_ICON_BY_OCCUPATION))) requestWorldIcon(src);
  }

  function drawNeutralPersonFallback(ctx, npc, radius) {
    const accent = npc.activity === 'working' ? '#f1c75b' : '#d8e7ef';
    ctx.fillStyle = 'rgba(20, 28, 36, 0.38)';
    ctx.beginPath();
    ctx.ellipse(radius * 0.5, radius * 1.1, radius * 1.25, radius * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.strokeStyle = '#26343d';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, -radius * 1.8, radius * 0.72, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-radius * 0.7, -radius * 1.05);
    ctx.lineTo(radius * 0.7, -radius * 1.05);
    ctx.lineTo(radius * 0.95, radius * 0.9);
    ctx.lineTo(-radius * 0.95, radius * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawNpcCharacter(ctx, npc, radius) {
    const asset = worldIconAssetFor(npc);
    const record = requestWorldIcon(asset);
    if (record?.status === 'ready' && record.image) {
      const size = Math.max(18, Math.min(32, radius * 5.2));
      ctx.drawImage(record.image, -size / 2, -size * 0.82, size, size);
      return 'png';
    }
    drawNeutralPersonFallback(ctx, npc, radius);
    return asset ? 'fallback-loading-or-failed' : 'fallback-unmapped';
  }

  function drawPresentation() {
    const canvas = ensureOverlay();
    const Renderer = Game.Renderer;
    const world = Game.State?.world;
    if (!canvas || !Renderer || !world || !Array.isArray(world.npcs)) return;

    const width = Math.max(1, canvas.clientWidth || Game.State.dom.canvas?.clientWidth || 1);
    const height = Math.max(1, canvas.clientHeight || Game.State.dom.canvas?.clientHeight || 1);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    let visibleCount = 0;
    let pngCount = 0;
    let fallbackCount = 0;
    for (const npc of world.npcs) {
      const point = Renderer.gridToScreen(npc.row, npc.col, 0, 0);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
      if (point.x < -20 || point.y < -30 || point.x > width + 20 || point.y > height + 30) continue;

      const radius = Math.max(3, Math.min(6, width / 180));
      ctx.save();
      ctx.translate(point.x, point.y);
      const renderKind = drawNpcCharacter(ctx, npc, radius);
      if (renderKind === 'png') pngCount += 1;
      else fallbackCount += 1;
      ctx.restore();
      visibleCount += 1;
    }
    canvas.dataset.npcCount = String(world.npcs.length);
    canvas.dataset.visibleNpcCount = String(visibleCount);
    canvas.dataset.pngNpcCount = String(pngCount);
    canvas.dataset.fallbackNpcCount = String(fallbackCount);
    canvas.dataset.presentationAuthority = 'presentation-only';
  }

  function installTerrainHook() {
    const Terrain = Game.Terrain;
    if (!Terrain || typeof Terrain.generateWorld !== 'function' || terrainHookInstalled) return false;
    const generateWorld = Terrain.generateWorld.bind(Terrain);
    Terrain.generateWorld = function npcAwareGenerateWorld(seedInput, colsInput, rowsInput) {
      const result = generateWorld(seedInput, colsInput, rowsInput);
      bindFromOriginVillage();
      return result;
    };
    terrainHookInstalled = true;
    return true;
  }

  function installRenderHook() {
    const Renderer = Game.Renderer;
    if (!Renderer || typeof Renderer.renderWorld !== 'function' || renderHookInstalled) return false;
    const renderWorld = Renderer.renderWorld.bind(Renderer);
    Renderer.renderWorld = function npcAwareRenderWorld(force) {
      const runtime = Game.State?.world?.npcRuntime;
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      updateAt(runtime ? now - runtime.startedAtMs : 0);
      const result = renderWorld(force);
      drawPresentation();
      return result;
    };
    renderHookInstalled = true;
    return true;
  }

  function capture() {
    return JSON.parse(JSON.stringify(Game.State?.world?.npcs || []));
  }

  function detachPresentation() {
    if (overlayCanvas && overlayCanvas.parentNode) overlayCanvas.parentNode.removeChild(overlayCanvas);
    overlayCanvas = null;
  }

  function initialize() {
    bindFromOriginVillage();
    installTerrainHook();
    installRenderHook();
    preloadWorldIcons();
    ensureOverlay();
    drawPresentation();
  }

  Game.NPCWorld = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    presentationAuthority: 'presentation-only',
    maxVisibleNpcs: MAX_VISIBLE_NPCS,
    worldIconAssetFor,
    bindFromOriginVillage,
    updateAt,
    capture,
    ensureOverlay,
    detachPresentation,
    drawPresentation
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();
