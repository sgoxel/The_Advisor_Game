/*
  WP-102/I07 #501: low-vegetation presentation integration.

  The Admin-provided 100px family is presentation-only. Placement is derived from
  Simulation-owned terrain and village footprints, then handed to WP-112's existing
  static compositor as Simulation-backed presentation descriptors. No blocking,
  interaction, pathfinding, terrain semantics or persistent Simulation state is changed.
*/
(function installLowVegetationRuntime(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'wp102-i07-low-vegetation-v1';
  const FAMILY = 'low_vegetation';
  const TILE_SIZE = 100;
  const VARIANT_COUNT = 100;
  const PLACEMENT_PERCENT = 5;
  const GENERATED_BY = VERSION;
  const EXCLUDED_TAGS = new Set([
    'blocked', 'obstacle', 'road', 'path', 'settlement', 'building',
    'farm', 'field', 'water', 'stream', 'lake', 'river', 'mountain'
  ]);
  const RENDER_HOOK_MARKER = '__wp102I07LowVegetationRenderHook';

  let lastTerrainRef = null;
  let lastVillageRef = null;
  let lastSeed = null;
  let lastRows = null;
  let lastCols = null;
  let registryConfigured = false;
  let refreshPromise = null;
  let refreshQueued = false;

  function hash32(text) {
    let hash = 2166136261 >>> 0;
    const value = String(text);
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
  }

  function semanticType(index) {
    const row = Math.floor(index / 10);
    const col = index % 10;
    return `r${String(row).padStart(2, '0')}_c${String(col).padStart(2, '0')}`;
  }

  const REGISTRY_ENTRIES = Object.freeze(Array.from({ length: VARIANT_COUNT }, (_, index) => {
    const type = semanticType(index);
    return Object.freeze({
      family: FAMILY,
      type,
      size: TILE_SIZE,
      source: `textures/tiles/low_vegetation/low_vegetation_${type}_100px.png`
    });
  }));

  function registryEntries() {
    return REGISTRY_ENTRIES.map((entry) => ({ ...entry }));
  }

  function tagSet(tile) {
    const tags = tile?.tags;
    if (tags instanceof Set) return tags;
    if (Array.isArray(tags)) return new Set(tags.map((tag) => String(tag).toLowerCase()));
    return new Set();
  }

  function eligibleTerrain(tile) {
    if (!tile || String(tile.type || '').toLowerCase() !== 'grass') return false;
    if (tile.blocked === true || tile.obstacle === true) return false;
    const tags = tagSet(tile);
    for (const tag of tags) {
      if (EXCLUDED_TAGS.has(String(tag).toLowerCase())) return false;
    }
    return true;
  }

  function excludedVillageCells(world) {
    const excluded = new Set();
    const village = world?.originVillage;
    const roads = Array.isArray(village?.roadTiles) ? village.roadTiles : [];
    for (const road of roads) {
      const row = Number(road?.row);
      const col = Number(road?.col);
      if (Number.isInteger(row) && Number.isInteger(col)) excluded.add(`${row},${col}`);
    }

    const buildings = Array.isArray(village?.buildings) ? village.buildings : [];
    for (const building of buildings) {
      const footprint = building?.footprint;
      const row = Number(footprint?.row);
      const col = Number(footprint?.col);
      const height = Math.trunc(Number(footprint?.height));
      const width = Math.trunc(Number(footprint?.width));
      if (![row, col, height, width].every(Number.isFinite) || height <= 0 || width <= 0) continue;
      for (let localRow = 0; localRow < height; localRow += 1) {
        for (let localCol = 0; localCol < width; localCol += 1) {
          excluded.add(`${row + localRow},${col + localCol}`);
        }
      }
    }
    return excluded;
  }

  function selectionForCell(seed, row, col) {
    const identity = `${String(seed)}|${row},${col}|${FAMILY}`;
    if ((hash32(`${identity}|place`) % 100) >= PLACEMENT_PERCENT) return null;
    const variantIndex = hash32(`${identity}|variant`) % VARIANT_COUNT;
    return { variantIndex, type: semanticType(variantIndex) };
  }

  function collectOverlayCells(world = Game.State?.world) {
    const terrain = world?.terrain;
    if (!Array.isArray(terrain) || !terrain.length) return [];
    const excluded = excludedVillageCells(world);
    const seed = String(world?.seed ?? '');
    const rows = Math.min(Math.max(0, Math.trunc(Number(world?.rows) || terrain.length)), terrain.length);
    const cells = [];

    for (let row = 0; row < rows; row += 1) {
      const terrainRow = Array.isArray(terrain[row]) ? terrain[row] : [];
      const cols = Math.min(Math.max(0, Math.trunc(Number(world?.cols) || terrainRow.length)), terrainRow.length);
      for (let col = 0; col < cols; col += 1) {
        if (excluded.has(`${row},${col}`) || !eligibleTerrain(terrainRow[col])) continue;
        const selected = selectionForCell(seed, row, col);
        if (!selected) continue;
        cells.push(Object.freeze({
          row,
          col,
          family: FAMILY,
          type: selected.type,
          size: TILE_SIZE,
          variantIndex: selected.variantIndex
        }));
      }
    }
    return cells;
  }

  function buildPresentationDescriptors(world = Game.State?.world) {
    return collectOverlayCells(world).map((cell) => Object.freeze({
      authority: 'simulation',
      presentationOnly: true,
      objectId: `${FAMILY}:${cell.row}:${cell.col}`,
      semanticType: `${cell.family}:${cell.type}:${cell.size}`,
      position: Object.freeze({ regionX: 0, regionY: 0, row: cell.row, col: cell.col }),
      footprint: Object.freeze({ occupiedCells: Object.freeze([{ row: cell.row, col: cell.col }]) }),
      visual: Object.freeze({
        semanticKey: `${cell.family}:${cell.type}:${cell.size}`,
        generatedBy: GENERATED_BY,
        authority: 'presentation-only'
      })
    }));
  }

  function sourceChanged(world) {
    return world?.terrain !== lastTerrainRef
      || world?.originVillage !== lastVillageRef
      || String(world?.seed ?? '') !== lastSeed
      || Number(world?.rows) !== lastRows
      || Number(world?.cols) !== lastCols;
  }

  function rememberSource(world) {
    lastTerrainRef = world?.terrain || null;
    lastVillageRef = world?.originVillage || null;
    lastSeed = String(world?.seed ?? '');
    lastRows = Number(world?.rows);
    lastCols = Number(world?.cols);
  }

  async function refresh(reason = 'manual', force = false) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const world = Game.State?.world;
      const compositor = Game.StaticTileCompositor;
      if (!world || !Array.isArray(world.terrain) || !world.terrain.length || !compositor) return false;
      if (!force && registryConfigured && !sourceChanged(world)) return true;

      const generated = buildPresentationDescriptors(world);
      const existing = Array.isArray(world.objectPresentationDescriptors)
        ? world.objectPresentationDescriptors.filter((descriptor) => descriptor?.visual?.generatedBy !== GENERATED_BY)
        : [];

      // This array is a renderer-facing presentation cache. AuthoritativeState deliberately
      // excludes it; coordinates come from Simulation-owned terrain/village data above.
      world.objectPresentationDescriptors = existing.concat(generated);

      if (!registryConfigured || force) {
        await compositor.configureObjectRegistry(registryEntries());
        registryConfigured = true;
      } else {
        compositor.invalidateAll(`low-vegetation:${reason}`);
      }
      rememberSource(world);
      return true;
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  function scheduleRefresh(reason = 'scheduled', force = false) {
    if (refreshQueued) return;
    refreshQueued = true;
    global.setTimeout(() => {
      refreshQueued = false;
      refresh(reason, force).catch((error) => console.warn('Low-vegetation presentation refresh failed.', error));
    }, 0);
  }

  function install(attempt = 0) {
    const renderer = Game.Renderer;
    const compositor = Game.StaticTileCompositor;
    if (!Game.State || !renderer || typeof renderer.renderWorld !== 'function' || !compositor) {
      if (attempt < 240) global.setTimeout(() => install(attempt + 1), 50);
      return false;
    }

    if (!renderer.renderWorld[RENDER_HOOK_MARKER]) {
      const prior = renderer.renderWorld.bind(renderer);
      const wrapped = function lowVegetationAwareRender(force) {
        const result = prior(force);
        scheduleRefresh(force ? 'forced-render' : 'render');
        return result;
      };
      Object.defineProperty(wrapped, RENDER_HOOK_MARKER, { value: true });
      renderer.renderWorld = wrapped;
    }

    scheduleRefresh('install', true);
    return true;
  }

  Game.LowVegetationRuntime = Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    family: FAMILY,
    tileSize: TILE_SIZE,
    variantCount: VARIANT_COUNT,
    placementPercent: PLACEMENT_PERCENT,
    registryEntries,
    collectOverlayCells,
    buildPresentationDescriptors,
    refresh,
    install
  });

  install();
})(typeof window !== 'undefined' ? window : globalThis);
