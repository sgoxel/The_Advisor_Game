/*
  R04 / #277 + Admin-priority #286: authoritative starter-village road/path presentation.
  Route existence/connectivity remains Simulation authority; this module only renders it.
*/
(function installStarterVillageRoadPresentation() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-starter-village-roads-v3-semantic-only-png';
  const MODE = 'authoritative-semantic-transparent-png';
  const CARDINAL = Object.freeze([
    { name: 'N', dr: -1, dc: 0 },
    { name: 'E', dr: 0, dc: 1 },
    { name: 'S', dr: 1, dc: 0 },
    { name: 'W', dr: 0, dc: -1 }
  ]);
  const BLOCKED_TERRAIN = new Set(['water', 'deep_water', 'wall', 'cliff', 'blocked']);

  let overlayCanvas = null;
  let renderHookInstalled = false;
  let semanticAssetState = 'idle';
  let semanticAssetPromise = null;
  let semanticTileModule = null;
  let semanticRoadRegistry = null;
  const semanticImages = new Map();

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const key = (row, col) => `${row},${col}`;

  function authoritativeRoadTiles() {
    const roads = Game.State?.world?.originVillage?.roadTiles;
    if (!Array.isArray(roads)) return [];
    const deduped = new Map();
    for (const point of roads) {
      const row = Number(point?.row);
      const col = Number(point?.col);
      if (!Number.isInteger(row) || !Number.isInteger(col)) continue;
      deduped.set(key(row, col), { row, col });
    }
    return Array.from(deduped.values()).sort((a, b) => a.row - b.row || a.col - b.col);
  }

  function roadTopology() {
    const roads = authoritativeRoadTiles();
    const roadSet = new Set(roads.map((point) => key(point.row, point.col)));
    return roads.map((point) => {
      const links = CARDINAL.filter((dir) => roadSet.has(key(point.row + dir.dr, point.col + dir.dc)));
      return {
        row: point.row,
        col: point.col,
        mask: links.map((dir) => dir.name).join(''),
        degree: links.length
      };
    });
  }

  function ensureOverlay() {
    const gameCanvas = Game.State?.dom?.canvas || document.getElementById('gameCanvas');
    const host = document.getElementById('center-area');
    if (!gameCanvas || !host) return null;
    if (overlayCanvas && overlayCanvas.isConnected) return overlayCanvas;

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'starterVillageRoadOverlay';
    overlayCanvas.setAttribute('aria-hidden', 'true');
    overlayCanvas.tabIndex = -1;
    Object.assign(overlayCanvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '0'
    });
    host.appendChild(overlayCanvas);
    return overlayCanvas;
  }

  function project(row, col) {
    const point = Game.Renderer?.gridToScreen(row, col, 0, 0);
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  }

  function projectedTileSpan(topology) {
    const sample = topology[Math.floor(topology.length / 2)] || topology[0];
    if (!sample) return 16;
    const center = project(sample.row + 0.5, sample.col + 0.5);
    if (!center) return 16;
    const east = project(sample.row + 0.5, sample.col + 1.5);
    const south = project(sample.row + 1.5, sample.col + 0.5);
    const spans = [east, south]
      .filter(Boolean)
      .map((point) => Math.hypot(point.x - center.x, point.y - center.y))
      .filter((value) => Number.isFinite(value) && value > 0.5);
    return spans.length ? Math.min(...spans) : 16;
  }

  function buildingFootprintSet() {
    const buildings = Game.State?.world?.originVillage?.buildings;
    const occupied = new Set();
    if (!Array.isArray(buildings)) return occupied;
    for (const building of buildings) {
      // Simulation explicitly permits passable structures (for example the village well/market)
      // to share authoritative road tiles. They are compatible crossings, not blocked footprints.
      if (building?.passable === true) continue;
      const f = building?.footprint;
      const row = Number(f?.row), col = Number(f?.col), height = Number(f?.height), width = Number(f?.width);
      if (![row, col, height, width].every(Number.isFinite)) continue;
      const entranceRow = Number(building?.entrance?.row);
      const entranceCol = Number(building?.entrance?.col);
      const entranceKey = Number.isInteger(entranceRow) && Number.isInteger(entranceCol)
        ? key(entranceRow, entranceCol)
        : null;
      for (let r = row; r < row + height; r += 1) {
        for (let c = col; c < col + width; c += 1) {
          const cellKey = key(r, c);
          // Building entrances are authoritative road/path endpoints. Their pixels may visually
          // meet the doorway even when the entrance coordinate lies on the footprint boundary;
          // the presentation layer must not erase that Simulation-owned road descriptor.
          if (cellKey !== entranceKey) occupied.add(cellKey);
        }
      }
    }
    return occupied;
  }

  function invalidRoadTileSet(topology) {
    const world = Game.State?.world;
    const occupied = buildingFootprintSet();
    const invalid = new Set();
    for (const tile of topology) {
      const tileKey = key(tile.row, tile.col);
      if (occupied.has(tileKey)) {
        invalid.add(tileKey);
        continue;
      }
      const terrainType = String(world?.terrain?.[tile.row]?.[tile.col]?.type || '').toLowerCase();
      if (BLOCKED_TERRAIN.has(terrainType)) invalid.add(tileKey);
    }
    return invalid;
  }

  function semanticVisualForTopology(tile) {
    if (!tile || tile.degree <= 0) return null;
    const linked = new Set(String(tile.mask || '').split(''));

    if (tile.degree >= 4) return { type: 'cross', quarterTurns: 0 };

    if (tile.degree === 3) {
      const missing = CARDINAL.find((dir) => !linked.has(dir.name))?.name;
      const quarterTurns = { N: 0, E: 1, S: 2, W: 3 }[missing];
      if (quarterTurns === undefined) return null;
      return { type: 't_junction', quarterTurns };
    }

    if (tile.degree === 2) {
      if (linked.has('N') && linked.has('S')) return { type: 'straight_vertical', quarterTurns: 0 };
      if (linked.has('E') && linked.has('W')) return { type: 'straight_horizontal', quarterTurns: 0 };
      if (linked.has('N') && linked.has('E')) return { type: 'turn_ne', quarterTurns: 0 };
      if (linked.has('E') && linked.has('S')) return { type: 'turn_es', quarterTurns: 0 };
      if (linked.has('S') && linked.has('W')) return { type: 'turn_sw', quarterTurns: 0 };
      if (linked.has('W') && linked.has('N')) return { type: 'turn_wn', quarterTurns: 0 };
      return null;
    }

    const direction = CARDINAL.find((dir) => linked.has(dir.name))?.name;
    if (direction === 'N') return { type: 'straight_vertical', quarterTurns: 0, clip: [0, 0, 256, 128] };
    if (direction === 'S') return { type: 'straight_vertical', quarterTurns: 0, clip: [0, 128, 256, 128] };
    if (direction === 'W') return { type: 'straight_horizontal', quarterTurns: 0, clip: [0, 0, 128, 256] };
    if (direction === 'E') return { type: 'straight_horizontal', quarterTurns: 0, clip: [128, 0, 128, 256] };
    return null;
  }

  function semanticImage(type) {
    return semanticImages.get(type) || null;
  }

  function ensureSemanticAssets() {
    if (semanticAssetState === 'ready') return Promise.resolve(true);
    if (semanticAssetState === 'loading' && semanticAssetPromise) return semanticAssetPromise;
    if (semanticAssetState === 'failed') return Promise.resolve(false);

    semanticAssetState = 'loading';
    const moduleUrl = new URL('js/tile_registry.js', document.baseURI).href;
    semanticAssetPromise = import(moduleUrl)
      .then((module) => {
        semanticTileModule = module;
        semanticRoadRegistry = module.createCanonicalRoadTileRegistry();
        const entries = semanticRoadRegistry.entries().filter((entry) => entry.family === 'road' && entry.size === 256);
        return Promise.all(entries.map((entry) => new Promise((resolve, reject) => {
          const image = new Image();
          image.decoding = 'async';
          image.onload = () => {
            semanticImages.set(entry.type, image);
            resolve(entry.type);
          };
          image.onerror = () => reject(new Error(`Failed to load semantic road tile: ${entry.type}`));
          image.src = module.resolveTileUrl(entry, document.baseURI);
        })));
      })
      .then(() => {
        semanticAssetState = semanticImages.size >= 8 ? 'ready' : 'failed';
        if (semanticAssetState === 'ready') {
          requestAnimationFrame(() => drawPresentation());
          return true;
        }
        return false;
      })
      .catch((error) => {
        semanticAssetState = 'failed';
        console.warn('Semantic road tiles unavailable; legacy road rendering remains disabled.', error);
        return false;
      });
    return semanticAssetPromise;
  }

  function drawSemanticTile(ctx, tile, visual) {
    const image = semanticImage(visual?.type);
    if (!image) return false;

    const center = project(tile.row + 0.5, tile.col + 0.5);
    const east = project(tile.row + 0.5, tile.col + 1.5);
    const south = project(tile.row + 1.5, tile.col + 0.5);
    if (!center || !east || !south) return false;

    const vx = { x: east.x - center.x, y: east.y - center.y };
    const vy = { x: south.x - center.x, y: south.y - center.y };
    const origin = {
      x: center.x - (vx.x + vy.x) * 0.5,
      y: center.y - (vx.y + vy.y) * 0.5
    };
    if (![vx.x, vx.y, vy.x, vy.y, origin.x, origin.y].every(Number.isFinite)) return false;

    ctx.save();
    ctx.transform(vx.x / 256, vx.y / 256, vy.x / 256, vy.y / 256, origin.x, origin.y);

    if (visual.clip) {
      const [x, y, width, height] = visual.clip;
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
    }

    if (visual.quarterTurns) {
      ctx.translate(128, 128);
      ctx.rotate(visual.quarterTurns * Math.PI * 0.5);
      ctx.translate(-128, -128);
    }

    ctx.drawImage(image, 0, 0, 256, 256);
    ctx.restore();
    return true;
  }


  function drawPresentation() {
    const canvas = ensureOverlay();
    const topology = roadTopology();
    if (!canvas || !Game.Renderer || !topology.length) return false;

    ensureSemanticAssets();

    const width = Math.max(1, canvas.clientWidth || Game.State?.dom?.canvas?.clientWidth || 1);
    const height = Math.max(1, canvas.clientHeight || Game.State?.dom?.canvas?.clientHeight || 1);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const invalid = invalidRoadTileSet(topology);
    let semanticDrawnCount = 0;
    let semanticUnsupportedCount = 0;

    if (semanticAssetState === 'ready') {
      for (const tile of topology) {
        if (invalid.has(key(tile.row, tile.col))) continue;
        const visual = semanticVisualForTopology(tile);
        if (!visual) {
          semanticUnsupportedCount += 1;
          continue;
        }
        if (drawSemanticTile(ctx, tile, visual)) semanticDrawnCount += 1;
        else semanticUnsupportedCount += 1;
      }
    }

    const intersectionCount = topology.filter((tile) => tile.degree >= 3 && !invalid.has(key(tile.row, tile.col))).length;
    const turnCount = topology.filter((tile) => tile.degree === 2 && /^(NE|ES|SW|NW|EN|SE|WS|WN)$/.test(tile.mask)).length;
    const deadEndCount = topology.filter((tile) => tile.degree <= 1 && !invalid.has(key(tile.row, tile.col))).length;
    const drawnRoadTileCount = semanticDrawnCount;

    Object.assign(canvas.dataset, {
      roadTileCount: String(topology.length),
      drawnRoadTileCount: String(drawnRoadTileCount),
      segmentCount: '0',
      intersectionCount: String(intersectionCount),
      turnCount: String(turnCount),
      deadEndCount: String(deadEndCount),
      invalidTopologyCount: String(invalid.size),
      presentationAuthority: 'presentation-only',
      descriptorSource: 'originVillage.roadTiles',
      presentationMode: semanticAssetState === 'ready' ? MODE : (semanticAssetState === 'failed' ? 'semantic-road-assets-unavailable' : 'semantic-road-assets-loading'),
      connectivity: 'authoritative-cardinal-only',
      legacySquareHolePattern: 'masked',
      regionSize: String(Game.State?.world?.rows || 0),
      roadWidthPx: 'semantic-tile',
      semanticTileState: semanticAssetState,
      semanticAssetCount: String(semanticImages.size),
      semanticDrawnCount: String(semanticDrawnCount),
      semanticUnsupportedCount: String(semanticUnsupportedCount),
      vectorFallbackCount: '0',
      legacyVectorRenderer: 'disabled',
      legacyTerrainRoadOverlay: 'disabled',
      semanticRegistry: semanticRoadRegistry && semanticTileModule ? 'canonical-road-registry' : 'pending'
    });
    return true;
  }

  function installRenderHook() {
    const Renderer = Game.Renderer;
    if (!Renderer || typeof Renderer.renderWorld !== 'function' || renderHookInstalled) return false;
    const renderWorld = Renderer.renderWorld.bind(Renderer);
    Renderer.renderWorld = function starterVillageRoadAwareRenderWorld(force) {
      const result = renderWorld(force);
      drawPresentation();
      return result;
    };
    renderHookInstalled = true;
    return true;
  }

  function detachPresentation() {
    if (overlayCanvas?.parentNode) overlayCanvas.parentNode.removeChild(overlayCanvas);
    overlayCanvas = null;
  }

  function initialize() {
    ensureOverlay();
    installRenderHook();
    ensureSemanticAssets();
    drawPresentation();
  }

  Game.StarterVillageRoads = Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    descriptorSource: 'originVillage.roadTiles',
    presentationMode: MODE,
    snapshotTopology: roadTopology,
    semanticVisualForTopology,
    ensureSemanticAssets,
    ensureOverlay,
    drawPresentation,
    detachPresentation
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();
