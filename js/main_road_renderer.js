/*
  R04 / #339: presentation-only renderer for verified two-tile-wide main-road semantics.
  Route topology, legality and classification remain Simulation/#337 authority.
*/
(function installMainRoadRenderer(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-main-road-renderer-v1';
  const FAMILY = 'main_road';
  const SIZE = 256;
  const images = new Map();
  let assetState = 'idle';
  let assetPromise = null;
  let registry = null;
  let renderHookInstalled = false;
  let retryTimer = null;

  const key = (row, col) => `${row},${col}`;

  function roadGrid() {
    const world = Game.State?.world;
    const rows = Number(world?.rows) || 100;
    const cols = Number(world?.cols) || 100;
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
    const roads = world?.originVillage?.roadTiles;
    if (!Array.isArray(roads)) return grid;
    for (const point of roads) {
      const row = Number(point?.row);
      const col = Number(point?.col);
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= rows || col >= cols) continue;
      grid[row][col] = { type: 'road' };
    }
    return grid;
  }

  function classify() {
    if (!Game.MainRoadSemantics?.classify) return null;
    return Game.MainRoadSemantics.classify(roadGrid());
  }

  function visualForSemantic(semantic) {
    if (!semantic || !Array.isArray(semantic.memberships) || !semantic.memberships.length) return null;
    if (semantic.kind === 'main-road-intersection' || semantic.orientation === 'cross') {
      return { type: 'main_intersection_cross', reason: 'intersection' };
    }

    const membership = semantic.memberships[0];
    if (semantic.orientation === 'vertical') {
      if (membership.longitudinalRole === 'start' || membership.longitudinalRole === 'end') {
        return { type: 'main_transition_vertical', reason: 'transition' };
      }
      return {
        type: membership.lane === 'a' ? 'main_straight_vertical_left' : 'main_straight_vertical_right',
        reason: 'paired-straight'
      };
    }

    if (semantic.orientation === 'horizontal') {
      if (membership.longitudinalRole === 'start' || membership.longitudinalRole === 'end') {
        return { type: 'main_transition_horizontal', reason: 'transition' };
      }
      return {
        type: membership.lane === 'a' ? 'main_straight_horizontal_top' : 'main_straight_horizontal_bottom',
        reason: 'paired-straight'
      };
    }
    return null;
  }

  function ensureAssets() {
    if (assetState === 'ready') return Promise.resolve(true);
    if (assetState === 'loading' && assetPromise) return assetPromise;
    if (assetState === 'failed') return Promise.resolve(false);

    assetState = 'loading';
    assetPromise = import(new URL('js/tile_registry.js', document.baseURI).href)
      .then((module) => {
        registry = module.createCanonicalMainRoadTileRegistry();
        const entries = registry.entries().filter((entry) => entry.family === FAMILY && entry.size === SIZE);
        return Promise.all(entries.map((entry) => new Promise((resolve, reject) => {
          const image = new Image();
          image.decoding = 'async';
          image.onload = () => {
            images.set(entry.type, image);
            resolve(entry.type);
          };
          image.onerror = () => reject(new Error(`Failed to load main-road tile: ${entry.type}`));
          image.src = module.resolveTileUrl(entry, document.baseURI);
        })));
      })
      .then(() => {
        assetState = images.size === 15 ? 'ready' : 'failed';
        if (assetState === 'ready') requestAnimationFrame(drawPresentation);
        return assetState === 'ready';
      })
      .catch((error) => {
        assetState = 'failed';
        console.warn('Main-road semantic tiles unavailable; ordinary semantic roads remain active.', error);
        return false;
      });
    return assetPromise;
  }

  function project(row, col) {
    const point = Game.Renderer?.gridToScreen?.(row, col, 0, 0);
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  }

  function drawTile(ctx, row, col, type) {
    const image = images.get(type);
    if (!image) return false;
    const center = project(row + 0.5, col + 0.5);
    const east = project(row + 0.5, col + 1.5);
    const south = project(row + 1.5, col + 0.5);
    if (!center || !east || !south) return false;

    const vx = { x: east.x - center.x, y: east.y - center.y };
    const vy = { x: south.x - center.x, y: south.y - center.y };
    const origin = { x: center.x - (vx.x + vy.x) * 0.5, y: center.y - (vx.y + vy.y) * 0.5 };
    if (![vx.x, vx.y, vy.x, vy.y, origin.x, origin.y].every(Number.isFinite)) return false;

    ctx.save();
    ctx.transform(vx.x / SIZE, vx.y / SIZE, vy.x / SIZE, vy.y / SIZE, origin.x, origin.y);
    ctx.drawImage(image, 0, 0, SIZE, SIZE);
    ctx.restore();
    return true;
  }

  function drawPresentation() {
    const canvas = Game.StarterVillageRoads?.ensureOverlay?.();
    const classification = classify();
    if (!canvas || !classification || !Game.Renderer) return false;
    ensureAssets();
    if (assetState !== 'ready') return false;

    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const dpr = Math.max(1, global.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let drawn = 0;
    let transitions = 0;
    let intersections = 0;
    let unsupported = 0;
    const rendered = [];

    const cells = Object.entries(classification.cells || {}).sort(([a], [b]) => a.localeCompare(b));
    for (const [cellKey, semantic] of cells) {
      const [row, col] = cellKey.split(',').map(Number);
      const visual = visualForSemantic(semantic);
      if (!visual) {
        unsupported += 1;
        continue;
      }
      if (drawTile(ctx, row, col, visual.type)) {
        drawn += 1;
        rendered.push(`${cellKey}:${visual.type}`);
        if (visual.reason === 'transition') transitions += 1;
        if (visual.reason === 'intersection') intersections += 1;
      } else {
        unsupported += 1;
      }
    }

    Object.assign(canvas.dataset, {
      mainRoadRendererVersion: VERSION,
      mainRoadAuthority: 'presentation-only',
      mainRoadClassificationSource: 'Game.MainRoadSemantics',
      mainRoadSegmentCount: String(classification.segments?.length || 0),
      mainRoadCellCount: String(cells.length),
      mainRoadDrawnCount: String(drawn),
      mainRoadTransitionCount: String(transitions),
      mainRoadIntersectionCount: String(intersections),
      mainRoadUnsupportedCount: String(unsupported),
      mainRoadAssetState: assetState,
      mainRoadAssetCount: String(images.size),
      mainRoadRegistry: registry ? 'canonical-main-road-registry' : 'pending',
      mainRoadRenderedTypes: rendered.slice(0, 64).join('|')
    });
    return true;
  }

  function installRenderHook() {
    if (renderHookInstalled || !Game.Renderer || typeof Game.Renderer.renderWorld !== 'function') return false;
    const prior = Game.Renderer.renderWorld.bind(Game.Renderer);
    Game.Renderer.renderWorld = function mainRoadAwareRenderWorld(force) {
      const result = prior(force);
      drawPresentation();
      return result;
    };
    renderHookInstalled = true;
    return true;
  }

  function initialize(attempt = 0) {
    if (!Game.MainRoadSemantics && Game.Utils?.loadScriptOnce) {
      Game.Utils.loadScriptOnce('js/main_road_semantics.js', 'r04MainRoadSemanticsModule');
    }
    const ready = Boolean(Game.MainRoadSemantics?.classify && Game.StarterVillageRoads && Game.Renderer?.renderWorld);
    if (!ready) {
      if (attempt < 80) retryTimer = global.setTimeout(() => initialize(attempt + 1), 50);
      return false;
    }
    if (retryTimer) global.clearTimeout(retryTimer);
    ensureAssets();
    installRenderHook();
    drawPresentation();
    return true;
  }

  Game.MainRoadRenderer = Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    roadGrid,
    classify,
    visualForSemantic,
    ensureAssets,
    drawPresentation,
    initialize
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initialize(), { once: true });
  else initialize();
})(typeof window !== 'undefined' ? window : globalThis);
