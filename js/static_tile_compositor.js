/*
  WP-112 / #461: unified static world presentation.
  Admin invariant: NPCs are the only normal independently dynamic world-image layer.
  Every non-NPC visual is flattened into one 100x100 RGBA logical-tile composite
  before it reaches the existing background texture upload path.
*/
(function installStaticTileCompositor(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'wp112-static-tile-compositor-v1';
  const COMPOSITE_TILE_PX = 100;
  const SOURCE_TILE_PX = 256;
  const MAX_CACHE_TILES = 512;
  const CARDINAL = Object.freeze([
    { name: 'N', dr: -1, dc: 0 },
    { name: 'E', dr: 0, dc: 1 },
    { name: 'S', dr: 1, dc: 0 },
    { name: 'W', dr: 0, dc: -1 }
  ]);
  const BLOCKED_TERRAIN = new Set(['water', 'deep_water', 'wall', 'cliff', 'blocked']);
  const LEGACY_STATIC_LAYER_IDS = Object.freeze([
    'starterVillageRoadOverlay',
    'starterVillageExteriorOverlay',
    'worldObjectCompositionOverlay',
    'starterVillageDevOverlay',
    'vectorLayerDebugOverlay',
    'starterVillageInteriorOverlay'
  ]);
  const BUILDING_FAMILIES = new Set([
    'home', 'inn', 'village_hall', 'bakery', 'market', 'smithy',
    'workshop', 'guard_post', 'mill', 'farmstead', 'storage', 'well'
  ]);
  const BUILDING_ALIASES = Object.freeze({
    dwelling: 'home', house: 'home', tavern: 'inn', lodging: 'inn',
    hall: 'village_hall', civic: 'village_hall', shop: 'market', food: 'bakery',
    production: 'workshop', guard: 'guard_post', service: 'guard_post',
    farm: 'farmstead', agricultural: 'farmstead', storehouse: 'storage', barn: 'storage'
  });

  const imageCache = new Map();
  const tileCache = new Map();
  const invalidatedTiles = new Set();
  let registryModulePromise = null;
  let roadRegistry = null;
  let mainRoadRegistry = null;
  let buildingRegistry = null;
  let objectRegistry = null;
  let objectRegistryEntries = [];
  let baseSnapshot = null;
  let baseCanvasIdentity = null;
  let lastStaticSignature = '';
  let renderHookInstalled = false;
  let composing = false;
  let composeQueued = false;
  let uploadQueued = false;
  let fullInvalidation = true;
  let lastStats = Object.freeze({
    version: VERSION,
    tilePixelSize: COMPOSITE_TILE_PX,
    staticTiles: 0,
    overlays: 0,
    roads: 0,
    buildings: 0,
    objects: 0,
    cacheTiles: 0,
    legacyLayersRemoved: 0,
    reason: 'not-composed'
  });

  const key = (row, col) => `${row},${col}`;
  const parseKey = (value) => String(value).split(',').map(Number);

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.trunc(width));
    canvas.height = Math.max(1, Math.trunc(height));
    return canvas;
  }

  function detachLegacyStaticLayers() {
    let removed = 0;
    if (typeof document === 'undefined') return removed;
    for (const id of LEGACY_STATIC_LAYER_IDS) {
      const node = document.getElementById(id);
      if (node) {
        node.remove();
        removed += 1;
      }
    }
    return removed;
  }

  function worldDimensions() {
    const world = Game.State?.world;
    return {
      rows: Math.max(1, Math.trunc(Number(world?.rows) || 100)),
      cols: Math.max(1, Math.trunc(Number(world?.cols) || 100))
    };
  }

  function backgroundCellRect(background, row, col) {
    const { rows, cols } = worldDimensions();
    return {
      x: col * background.width / cols,
      y: row * background.height / rows,
      width: background.width / cols,
      height: background.height / rows
    };
  }

  function validCell(row, col) {
    const { rows, cols } = worldDimensions();
    return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < rows && col < cols;
  }

  function captureBaseSnapshot(force = false) {
    const background = Game.State?.render?.worldBackgroundCanvas;
    if (!background || !background.width || !background.height) return false;
    const identityChanged = background !== baseCanvasIdentity
      || !baseSnapshot
      || baseSnapshot.width !== background.width
      || baseSnapshot.height !== background.height;
    if (!force && !identityChanged) return false;
    const snapshot = makeCanvas(background.width, background.height);
    snapshot.getContext('2d').drawImage(background, 0, 0);
    baseSnapshot = snapshot;
    baseCanvasIdentity = background;
    lastStaticSignature = '';
    fullInvalidation = true;
    tileCache.clear();
    return true;
  }

  function registryModule() {
    if (!registryModulePromise) {
      registryModulePromise = import(new URL('js/tile_registry.js', document.baseURI).href);
    }
    return registryModulePromise;
  }

  async function ensureRegistries() {
    const module = await registryModule();
    if (!roadRegistry) roadRegistry = module.createCanonicalRoadTileRegistry();
    if (!mainRoadRegistry) mainRoadRegistry = module.createCanonicalMainRoadTileRegistry();
    if (!buildingRegistry) buildingRegistry = module.createCanonicalStarterBuildingTileRegistry();
    if (!objectRegistry) objectRegistry = new module.SemanticTileRegistry(objectRegistryEntries);
    return module;
  }

  async function configureObjectRegistry(entries) {
    const module = await registryModule();
    objectRegistryEntries = Array.isArray(entries) ? entries.map((entry) => ({ ...entry })) : [];
    objectRegistry = new module.SemanticTileRegistry(objectRegistryEntries);
    invalidateAll('object-registry-change');
    return objectRegistryEntries.length;
  }

  function imageCacheKey(entry) {
    return `${entry.family}:${entry.type}:${entry.size}:${entry.source}`;
  }

  async function loadEntryImage(registry, family, type, size = SOURCE_TILE_PX) {
    const module = await ensureRegistries();
    const entry = registry.resolve(family, type, size);
    const cacheKey = imageCacheKey(entry);
    const cached = imageCache.get(cacheKey);
    if (cached?.state === 'ready') return cached.image;
    if (cached?.state === 'error') throw cached.error;
    if (cached?.promise) return cached.promise;
    const record = { state: 'loading', image: null, error: null, promise: null };
    record.promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        record.state = 'ready';
        record.image = image;
        resolve(image);
      };
      image.onerror = () => {
        record.state = 'error';
        record.error = new Error(`Failed to load static tile asset ${entry.source}.`);
        reject(record.error);
      };
      image.src = module.resolveTileUrl(entry, document.baseURI);
    });
    imageCache.set(cacheKey, record);
    return record.promise;
  }

  function authoritativeRoadTiles() {
    const roads = Game.State?.world?.originVillage?.roadTiles;
    if (!Array.isArray(roads)) return [];
    const deduped = new Map();
    for (const point of roads) {
      const row = Number(point?.row);
      const col = Number(point?.col);
      if (!validCell(row, col)) continue;
      deduped.set(key(row, col), { row, col });
    }
    return [...deduped.values()].sort((a, b) => a.row - b.row || a.col - b.col);
  }

  function roadTopology() {
    const roads = authoritativeRoadTiles();
    const roadSet = new Set(roads.map((point) => key(point.row, point.col)));
    return roads.map((point) => {
      const links = CARDINAL.filter((dir) => roadSet.has(key(point.row + dir.dr, point.col + dir.dc)));
      return { row: point.row, col: point.col, mask: links.map((dir) => dir.name).join(''), degree: links.length };
    });
  }

  function buildingFootprintSet() {
    const buildings = Game.State?.world?.originVillage?.buildings;
    const occupied = new Set();
    if (!Array.isArray(buildings)) return occupied;
    for (const building of buildings) {
      if (building?.passable === true) continue;
      const f = building?.footprint;
      const row = Number(f?.row), col = Number(f?.col), height = Number(f?.height), width = Number(f?.width);
      if (![row, col, height, width].every(Number.isFinite)) continue;
      const entranceRow = Number(building?.entrance?.row);
      const entranceCol = Number(building?.entrance?.col);
      const entranceKey = Number.isInteger(entranceRow) && Number.isInteger(entranceCol)
        ? key(entranceRow, entranceCol) : null;
      for (let r = row; r < row + height; r += 1) {
        for (let c = col; c < col + width; c += 1) {
          const cellKey = key(r, c);
          if (cellKey !== entranceKey) occupied.add(cellKey);
        }
      }
    }
    return occupied;
  }

  function invalidRoadTileSet(topology) {
    const occupied = buildingFootprintSet();
    const world = Game.State?.world;
    const invalid = new Set();
    for (const tile of topology) {
      const tileKey = key(tile.row, tile.col);
      const terrainType = String(world?.terrain?.[tile.row]?.[tile.col]?.type || '').toLowerCase();
      if (occupied.has(tileKey) || BLOCKED_TERRAIN.has(terrainType)) invalid.add(tileKey);
    }
    return invalid;
  }

  function roadVisual(tile) {
    if (!tile || tile.degree <= 0) return null;
    const linked = new Set(String(tile.mask || '').split(''));
    if (tile.degree >= 4) return { family: 'road', type: 'cross', quarterTurns: 0 };
    if (tile.degree === 3) {
      const missing = CARDINAL.find((dir) => !linked.has(dir.name))?.name;
      const quarterTurns = { N: 0, E: 1, S: 2, W: 3 }[missing];
      return quarterTurns === undefined ? null : { family: 'road', type: 't_junction', quarterTurns };
    }
    if (tile.degree === 2) {
      if (linked.has('N') && linked.has('S')) return { family: 'road', type: 'straight_vertical', quarterTurns: 0 };
      if (linked.has('E') && linked.has('W')) return { family: 'road', type: 'straight_horizontal', quarterTurns: 0 };
      if (linked.has('N') && linked.has('E')) return { family: 'road', type: 'turn_ne', quarterTurns: 0 };
      if (linked.has('E') && linked.has('S')) return { family: 'road', type: 'turn_es', quarterTurns: 0 };
      if (linked.has('S') && linked.has('W')) return { family: 'road', type: 'turn_sw', quarterTurns: 0 };
      if (linked.has('W') && linked.has('N')) return { family: 'road', type: 'turn_wn', quarterTurns: 0 };
      return null;
    }
    const direction = CARDINAL.find((dir) => linked.has(dir.name))?.name;
    if (direction === 'N') return { family: 'road', type: 'straight_vertical', quarterTurns: 0, clip: [0, 0, 256, 128] };
    if (direction === 'S') return { family: 'road', type: 'straight_vertical', quarterTurns: 0, clip: [0, 128, 256, 128] };
    if (direction === 'W') return { family: 'road', type: 'straight_horizontal', quarterTurns: 0, clip: [0, 0, 128, 256] };
    if (direction === 'E') return { family: 'road', type: 'straight_horizontal', quarterTurns: 0, clip: [128, 0, 128, 256] };
    return null;
  }

  function roadGrid() {
    const { rows, cols } = worldDimensions();
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
    for (const point of authoritativeRoadTiles()) grid[point.row][point.col] = { type: 'road' };
    return grid;
  }

  function mainRoadVisual(semantic) {
    if (!semantic || !Array.isArray(semantic.memberships) || !semantic.memberships.length) return null;
    if (semantic.kind === 'main-road-intersection' || semantic.orientation === 'cross') {
      return { family: 'main_road', type: 'main_intersection_cross', quarterTurns: 0 };
    }
    const membership = semantic.memberships[0];
    if (semantic.orientation === 'vertical') {
      if (membership.longitudinalRole === 'start' || membership.longitudinalRole === 'end') {
        return { family: 'main_road', type: 'main_transition_vertical', quarterTurns: 0 };
      }
      return { family: 'main_road', type: membership.lane === 'a'
        ? 'main_straight_vertical_left' : 'main_straight_vertical_right', quarterTurns: 0 };
    }
    if (semantic.orientation === 'horizontal') {
      if (membership.longitudinalRole === 'start' || membership.longitudinalRole === 'end') {
        return { family: 'main_road', type: 'main_transition_horizontal', quarterTurns: 0 };
      }
      return { family: 'main_road', type: membership.lane === 'a'
        ? 'main_straight_horizontal_top' : 'main_straight_horizontal_bottom', quarterTurns: 0 };
    }
    return null;
  }

  function canonicalBuildingFamily(building) {
    const raw = String(building?.type || '').toLowerCase();
    const family = BUILDING_ALIASES[raw] || raw;
    return BUILDING_FAMILIES.has(family) ? family : null;
  }

  function entranceCell(building) {
    const f = building?.footprint, e = building?.entrance;
    if (!f || !e) return null;
    const r = Number(f.row), c = Number(f.col), h = Number(f.height), w = Number(f.width);
    const er = Number(e.row), ec = Number(e.col);
    if (![r, c, h, w, er, ec].every(Number.isFinite)) return null;
    if (er === r - 1 && ec >= c && ec < c + w) return { row: 0, col: ec - c, side: 'north' };
    if (er === r + h && ec >= c && ec < c + w) return { row: h - 1, col: ec - c, side: 'south' };
    if (ec === c - 1 && er >= r && er < r + h) return { row: er - r, col: 0, side: 'west' };
    if (ec === c + w && er >= r && er < r + h) return { row: er - r, col: w - 1, side: 'east' };
    return null;
  }

  function buildingSemanticType(building, localRow, localCol, height, width, door) {
    const family = canonicalBuildingFamily(building);
    if (family === 'well') return 'family_feature';
    if (door && door.row === localRow && door.col === localCol) return 'entrance';
    const featureRow = height > 2 ? height - 2 : height - 1;
    const featureCol = Math.floor((width - 1) / 2);
    if (localRow === featureRow && localCol === featureCol) return 'family_feature';
    if (localRow === 0) {
      if (width === 1) return 'roof_ridge';
      if (localCol === 0) return 'roof_corner_nw';
      if (localCol === width - 1) return 'roof_corner_ne';
      if (localCol === Math.floor(width / 2)) return 'roof_ridge';
      return 'roof_edge_n';
    }
    if (localRow === height - 1) {
      if (width === 1) return 'wall_center';
      if (localCol === 0) return 'base_corner_sw';
      if (localCol === width - 1) return 'base_corner_se';
      return localCol % 2 ? 'wall_window' : 'wall_center';
    }
    if (localCol === 0) return 'wall_edge_w';
    if (localCol === width - 1) return 'wall_edge_e';
    return localCol % 2 ? 'wall_window' : 'wall_center';
  }

  function buildingCells() {
    const buildings = Game.State?.world?.originVillage?.buildings;
    if (!Array.isArray(buildings)) return [];
    const cells = [];
    for (const building of buildings) {
      const family = canonicalBuildingFamily(building);
      const f = building?.footprint;
      if (!family || !f) continue;
      const row = Number(f.row), col = Number(f.col);
      const height = Math.trunc(Number(f.height)), width = Math.trunc(Number(f.width));
      if (![row, col, height, width].every(Number.isFinite) || height <= 0 || width <= 0) continue;
      const door = entranceCell(building);
      for (let localRow = 0; localRow < height; localRow += 1) {
        for (let localCol = 0; localCol < width; localCol += 1) {
          const targetRow = row + localRow, targetCol = col + localCol;
          if (!validCell(targetRow, targetCol)) continue;
          cells.push({
            row: targetRow,
            col: targetCol,
            family,
            type: buildingSemanticType(building, localRow, localCol, height, width, door),
            buildingId: String(building?.id || `${family}:${row}:${col}`)
          });
        }
      }
    }
    return cells;
  }

  function parseSemanticKey(value) {
    const parts = String(value || '').split(':').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const size = parts.length >= 3 ? Number(parts[2]) : SOURCE_TILE_PX;
    return Number.isInteger(size) && size > 0 ? { family: parts[0], type: parts[1], size } : null;
  }

  function objectCells() {
    const descriptors = Game.State?.world?.objectPresentationDescriptors;
    if (!Array.isArray(descriptors) || !objectRegistry || !objectRegistryEntries.length) return [];
    const cells = [];
    for (const descriptor of descriptors) {
      if (!descriptor || descriptor.authority !== 'simulation') continue;
      const semantic = parseSemanticKey(descriptor.visual?.semanticKey || descriptor.semanticType);
      if (!semantic || !objectRegistry.has(semantic.family, semantic.type, semantic.size)) continue;
      const occupied = descriptor.footprint?.occupiedCells;
      if (!Array.isArray(occupied) || !occupied.length) continue;
      if (occupied.length > 1) continue;
      const row = Number(occupied[0]?.row), col = Number(occupied[0]?.col);
      if (!validCell(row, col)) continue;
      cells.push({ row, col, family: semantic.family, type: semantic.type, size: semantic.size, objectId: descriptor.objectId });
    }
    return cells;
  }

  function addOverlay(stacks, row, col, overlay) {
    if (!validCell(row, col)) return;
    const cellKey = key(row, col);
    const list = stacks.get(cellKey) || [];
    list.push(overlay);
    stacks.set(cellKey, list);
  }

  async function buildOverlayStacks() {
    await ensureRegistries();
    const stacks = new Map();
    const topology = roadTopology();
    const invalidRoads = invalidRoadTileSet(topology);
    let mainClassification = null;
    try {
      mainClassification = Game.MainRoadSemantics?.classify?.(roadGrid()) || null;
    } catch (_) {}

    const mainByCell = new Map();
    for (const [cellKey, semantic] of Object.entries(mainClassification?.cells || {})) {
      const visual = mainRoadVisual(semantic);
      if (visual) mainByCell.set(cellKey, visual);
    }

    for (const tile of topology) {
      const cellKey = key(tile.row, tile.col);
      if (invalidRoads.has(cellKey)) continue;
      const visual = mainByCell.get(cellKey) || roadVisual(tile);
      if (!visual) continue;
      addOverlay(stacks, tile.row, tile.col, { ...visual, category: 10, source: 'road' });
    }

    for (const cell of buildingCells()) {
      addOverlay(stacks, cell.row, cell.col, {
        family: cell.family,
        type: cell.type,
        size: SOURCE_TILE_PX,
        category: 20,
        source: `building:${cell.buildingId}`
      });
    }

    for (const cell of objectCells()) {
      addOverlay(stacks, cell.row, cell.col, {
        family: cell.family,
        type: cell.type,
        size: cell.size,
        category: 30,
        source: `object:${cell.objectId}`,
        customRegistry: true
      });
    }

    for (const list of stacks.values()) {
      list.sort((a, b) => a.category - b.category
        || String(a.family).localeCompare(String(b.family))
        || String(a.type).localeCompare(String(b.type))
        || String(a.source).localeCompare(String(b.source)));
    }
    return stacks;
  }

  function staticSignature() {
    const world = Game.State?.world;
    const village = world?.originVillage;
    const roads = Array.isArray(village?.roadTiles)
      ? village.roadTiles.map((p) => `${p.row},${p.col}`).sort().join('|') : '';
    const buildings = Array.isArray(village?.buildings)
      ? village.buildings.map((b) => {
          const f = b?.footprint || {}, e = b?.entrance || {};
          return [b?.id, b?.type, f.row, f.col, f.height, f.width, e.row, e.col, b?.passable].join(':');
        }).sort().join('|') : '';
    const objects = Array.isArray(world?.objectPresentationDescriptors)
      ? world.objectPresentationDescriptors.map((d) => {
          const p = d?.position || {};
          return [d?.objectId, d?.semanticType, p.regionX, p.regionY, p.row, p.col, d?.visual?.semanticKey].join(':');
        }).sort().join('|') : '';
    const background = Game.State?.render?.worldBackgroundCanvas;
    return `${world?.seed || ''}|${world?.regionX || 0},${world?.regionY || 0}|${background?.width || 0}x${background?.height || 0}|r:${roads}|b:${buildings}|o:${objects}|or:${objectRegistryEntries.length}`;
  }

  function cachePut(cellKey, canvas, signature) {
    if (tileCache.has(cellKey)) tileCache.delete(cellKey);
    tileCache.set(cellKey, { canvas, signature, usedAt: Date.now() });
    while (tileCache.size > MAX_CACHE_TILES) {
      const oldest = tileCache.keys().next().value;
      tileCache.delete(oldest);
    }
  }

  function drawOverlayImage(ctx, image, overlay) {
    ctx.save();
    if (overlay.clip) {
      const [sx, sy, sw, sh] = overlay.clip;
      ctx.beginPath();
      ctx.rect(
        sx / SOURCE_TILE_PX * COMPOSITE_TILE_PX,
        sy / SOURCE_TILE_PX * COMPOSITE_TILE_PX,
        sw / SOURCE_TILE_PX * COMPOSITE_TILE_PX,
        sh / SOURCE_TILE_PX * COMPOSITE_TILE_PX
      );
      ctx.clip();
    }
    if (overlay.quarterTurns) {
      ctx.translate(COMPOSITE_TILE_PX / 2, COMPOSITE_TILE_PX / 2);
      ctx.rotate(overlay.quarterTurns * Math.PI * 0.5);
      ctx.translate(-COMPOSITE_TILE_PX / 2, -COMPOSITE_TILE_PX / 2);
    }
    ctx.drawImage(image, 0, 0, COMPOSITE_TILE_PX, COMPOSITE_TILE_PX);
    ctx.restore();
  }

  async function composeCell(background, row, col, overlays, signature) {
    const cellKey = key(row, col);
    const rect = backgroundCellRect(background, row, col);
    const tileCanvas = makeCanvas(COMPOSITE_TILE_PX, COMPOSITE_TILE_PX);
    const ctx = tileCanvas.getContext('2d');
    if (!ctx || !baseSnapshot) return { drawn: 0, tileCanvas: null };
    ctx.clearRect(0, 0, COMPOSITE_TILE_PX, COMPOSITE_TILE_PX);
    ctx.drawImage(baseSnapshot, rect.x, rect.y, rect.width, rect.height, 0, 0, COMPOSITE_TILE_PX, COMPOSITE_TILE_PX);
    let drawn = 0;
    for (const overlay of overlays) {
      const registry = overlay.customRegistry ? objectRegistry
        : overlay.family === 'road' ? roadRegistry
        : overlay.family === 'main_road' ? mainRoadRegistry
        : buildingRegistry;
      if (!registry) continue;
      try {
        const image = await loadEntryImage(registry, overlay.family, overlay.type, overlay.size || SOURCE_TILE_PX);
        drawOverlayImage(ctx, image, overlay);
        drawn += 1;
      } catch (error) {
        console.warn(`Static tile overlay unavailable at ${cellKey}: ${overlay.family}:${overlay.type}`, error);
      }
    }
    cachePut(cellKey, tileCanvas, signature);
    return { drawn, tileCanvas };
  }

  function requestBackgroundUpload() {
    if (uploadQueued) return;
    uploadQueued = true;
    global.requestAnimationFrame(() => {
      uploadQueued = false;
      const render = Game.State?.render;
      if (render) {
        render.needsBackgroundUpload = true;
        render.backgroundTextureReady = false;
      }
      if (Game.Renderer?.renderWorld) Game.Renderer.renderWorld(false);
    });
  }

  async function composeNow(reason = 'manual') {
    if (composing) {
      composeQueued = true;
      return false;
    }
    composing = true;
    try {
      detachLegacyStaticLayers();
      const render = Game.State?.render;
      const background = render?.worldBackgroundCanvas;
      if (!background || !background.width || !background.height) return false;
      if (!baseSnapshot || background !== baseCanvasIdentity
        || baseSnapshot.width !== background.width || baseSnapshot.height !== background.height) {
        captureBaseSnapshot(true);
      }
      if (!baseSnapshot) return false;

      const signature = staticSignature();
      const shouldFull = fullInvalidation || signature !== lastStaticSignature;
      if (!shouldFull && invalidatedTiles.size === 0) return true;

      const stacks = await buildOverlayStacks();
      const targetKeys = shouldFull ? new Set(stacks.keys()) : new Set(invalidatedTiles);
      const backgroundCtx = background.getContext('2d');
      if (!backgroundCtx) return false;

      if (shouldFull) {
        backgroundCtx.clearRect(0, 0, background.width, background.height);
        backgroundCtx.drawImage(baseSnapshot, 0, 0);
        tileCache.clear();
      } else {
        for (const cellKey of targetKeys) {
          const [row, col] = parseKey(cellKey);
          if (!validCell(row, col)) continue;
          const rect = backgroundCellRect(background, row, col);
          backgroundCtx.drawImage(baseSnapshot, rect.x, rect.y, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
          tileCache.delete(cellKey);
        }
      }

      let overlaysDrawn = 0;
      let roadCount = 0, buildingCount = 0, objectCount = 0;
      const orderedKeys = [...targetKeys].sort((a, b) => {
        const [ar, ac] = parseKey(a), [br, bc] = parseKey(b);
        return ar - br || ac - bc;
      });
      for (const cellKey of orderedKeys) {
        const overlays = stacks.get(cellKey) || [];
        if (!overlays.length) continue;
        const [row, col] = parseKey(cellKey);
        const cellSignature = `${signature}|${cellKey}|${overlays.map((o) => `${o.family}:${o.type}:${o.category}`).join(',')}`;
        const result = await composeCell(background, row, col, overlays, cellSignature);
        if (!result.tileCanvas) continue;
        const rect = backgroundCellRect(background, row, col);
        backgroundCtx.drawImage(result.tileCanvas, rect.x, rect.y, rect.width, rect.height);
        overlaysDrawn += result.drawn;
        roadCount += overlays.filter((o) => o.source === 'road').length;
        buildingCount += overlays.filter((o) => String(o.source).startsWith('building:')).length;
        objectCount += overlays.filter((o) => String(o.source).startsWith('object:')).length;
      }

      lastStaticSignature = signature;
      invalidatedTiles.clear();
      fullInvalidation = false;
      lastStats = Object.freeze({
        version: VERSION,
        tilePixelSize: COMPOSITE_TILE_PX,
        staticTiles: orderedKeys.length,
        overlays: overlaysDrawn,
        roads: roadCount,
        buildings: buildingCount,
        objects: objectCount,
        cacheTiles: tileCache.size,
        legacyLayersRemoved: detachLegacyStaticLayers(),
        reason,
        backgroundWidth: background.width,
        backgroundHeight: background.height,
        npcDynamicException: true
      });
      requestBackgroundUpload();
      return true;
    } finally {
      composing = false;
      if (composeQueued) {
        composeQueued = false;
        queueCompose('queued');
      }
    }
  }

  function queueCompose(reason = 'scheduled') {
    if (composeQueued) return;
    composeQueued = true;
    global.requestAnimationFrame(() => {
      composeQueued = false;
      composeNow(reason).catch((error) => console.warn('Static tile composition failed.', error));
    });
  }

  function invalidateTile(row, col, reason = 'static-change') {
    if (!validCell(row, col)) return false;
    invalidatedTiles.add(key(row, col));
    queueCompose(reason);
    return true;
  }

  function invalidateTiles(cells, reason = 'static-change') {
    if (!Array.isArray(cells)) return 0;
    let count = 0;
    for (const cell of cells) if (invalidateTile(Number(cell?.row), Number(cell?.col), reason)) count += 1;
    return count;
  }

  function invalidateAll(reason = 'static-change') {
    fullInvalidation = true;
    lastStaticSignature = '';
    queueCompose(reason);
    return true;
  }

  function installRenderHook() {
    if (renderHookInstalled || !Game.Renderer || typeof Game.Renderer.renderWorld !== 'function') return false;
    const prior = Game.Renderer.renderWorld.bind(Game.Renderer);
    Game.Renderer.renderWorld = function staticTileAwareRenderWorld(force) {
      const render = Game.State?.render;
      const baseWasDirty = Boolean(render?.needsBackgroundRebuild);
      const beforeCanvas = render?.worldBackgroundCanvas || null;
      const result = prior(force);
      const afterCanvas = Game.State?.render?.worldBackgroundCanvas || null;
      if (!baseSnapshot || afterCanvas !== baseCanvasIdentity || beforeCanvas !== afterCanvas || baseWasDirty) {
        captureBaseSnapshot(true);
        fullInvalidation = true;
      }
      queueCompose(baseWasDirty ? 'base-background-rebuild' : 'render');
      return result;
    };
    renderHookInstalled = true;
    return true;
  }

  function initialize(attempt = 0) {
    detachLegacyStaticLayers();
    const ready = Boolean(Game.State && Game.Renderer?.renderWorld);
    if (!ready) {
      if (attempt < 160) global.setTimeout(() => initialize(attempt + 1), 50);
      return false;
    }
    installRenderHook();
    captureBaseSnapshot(false);
    queueCompose('initialize');
    return true;
  }

  Game.StaticTileCompositor = Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    tilePixelSize: COMPOSITE_TILE_PX,
    sourceTilePixelSize: SOURCE_TILE_PX,
    layerPolicy: 'static-background-plus-dynamic-npc-only',
    npcDynamicException: true,
    configureObjectRegistry,
    composeNow,
    invalidateTile,
    invalidateTiles,
    invalidateAll,
    detachLegacyStaticLayers,
    diagnostics() { return { ...lastStats, invalidatedTiles: invalidatedTiles.size, fullInvalidation, objectRegistryEntries: objectRegistryEntries.length }; },
    initialize
  });

  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initialize(), { once: true });
  } else {
    initialize();
  }
})(typeof window !== 'undefined' ? window : globalThis);
