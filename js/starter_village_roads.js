/*
  R04 / #277: authoritative starter-village road/path presentation.
  Route existence/connectivity remains Simulation authority; this module only renders it.
*/
(function installStarterVillageRoadPresentation() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-starter-village-roads-v1-continuous-surface';
  const MODE = 'authoritative-continuous-packed-earth';
  const CARDINAL = Object.freeze([
    { name: 'N', dr: -1, dc: 0 },
    { name: 'E', dr: 0, dc: 1 },
    { name: 'S', dr: 1, dc: 0 },
    { name: 'W', dr: 0, dc: -1 }
  ]);
  const BLOCKED_TERRAIN = new Set(['water', 'deep_water', 'wall', 'cliff', 'blocked']);

  let overlayCanvas = null;
  let renderHookInstalled = false;

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
      const f = building?.footprint;
      const row = Number(f?.row), col = Number(f?.col), height = Number(f?.height), width = Number(f?.width);
      if (![row, col, height, width].every(Number.isFinite)) continue;
      for (let r = row; r < row + height; r += 1) {
        for (let c = col; c < col + width; c += 1) occupied.add(key(r, c));
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

  function drawLine(ctx, a, b, width, style) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = style;
    ctx.stroke();
  }

  function drawDisc(ctx, point, radius, style) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = style;
    ctx.fill();
  }

  function drawPresentation() {
    const canvas = ensureOverlay();
    const topology = roadTopology();
    if (!canvas || !Game.Renderer || !topology.length) return false;

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

    const span = projectedTileSpan(topology);
    const roadWidth = clamp(span * 0.74, 5, 30);
    const edgeWidth = clamp(roadWidth * 1.16, roadWidth + 1.5, 36);
    const edgeStyle = 'rgba(83, 61, 39, 0.88)';
    const fillStyle = 'rgba(151, 113, 72, 0.98)';
    const wearStyle = 'rgba(185, 144, 91, 0.30)';
    const invalid = invalidRoadTileSet(topology);
    const byKey = new Map(topology.map((tile) => [key(tile.row, tile.col), tile]));
    const centers = new Map();

    for (const tile of topology) {
      if (invalid.has(key(tile.row, tile.col))) continue;
      const point = project(tile.row + 0.5, tile.col + 0.5);
      if (point) centers.set(key(tile.row, tile.col), point);
    }

    const segments = [];
    for (const tile of topology) {
      const tileKey = key(tile.row, tile.col);
      const from = centers.get(tileKey);
      if (!from) continue;
      for (const dir of [{ dr: 0, dc: 1 }, { dr: 1, dc: 0 }]) {
        const neighborKey = key(tile.row + dir.dr, tile.col + dir.dc);
        if (!byKey.has(neighborKey) || invalid.has(neighborKey)) continue;
        const to = centers.get(neighborKey);
        if (to) segments.push({ from, to });
      }
    }

    // A broad low-contrast edge band fully masks the legacy square/ladder road treatment.
    for (const segment of segments) drawLine(ctx, segment.from, segment.to, edgeWidth, edgeStyle);
    for (const point of centers.values()) drawDisc(ctx, point, edgeWidth / 2, edgeStyle);

    // Continuous packed-earth traveled surface. Round joins keep turns/T/crossroads filled.
    for (const segment of segments) drawLine(ctx, segment.from, segment.to, roadWidth, fillStyle);
    for (const point of centers.values()) drawDisc(ctx, point, roadWidth / 2, fillStyle);

    // Restrained low-frequency wear, deliberately not a repeating rung/square motif.
    const wearWidth = clamp(roadWidth * 0.18, 1, 4);
    for (let i = 0; i < segments.length; i += 5) {
      const segment = segments[i];
      drawLine(ctx, segment.from, segment.to, wearWidth, wearStyle);
    }

    const intersectionCount = topology.filter((tile) => tile.degree >= 3 && !invalid.has(key(tile.row, tile.col))).length;
    const turnCount = topology.filter((tile) => tile.degree === 2 && /^(NE|ES|SW|NW|EN|SE|WS|WN)$/.test(tile.mask)).length;
    const deadEndCount = topology.filter((tile) => tile.degree <= 1 && !invalid.has(key(tile.row, tile.col))).length;
    Object.assign(canvas.dataset, {
      roadTileCount: String(topology.length),
      drawnRoadTileCount: String(centers.size),
      segmentCount: String(segments.length),
      intersectionCount: String(intersectionCount),
      turnCount: String(turnCount),
      deadEndCount: String(deadEndCount),
      invalidTopologyCount: String(invalid.size),
      presentationAuthority: 'presentation-only',
      descriptorSource: 'originVillage.roadTiles',
      presentationMode: MODE,
      connectivity: 'authoritative-cardinal-only',
      legacySquareHolePattern: 'masked',
      regionSize: String(Game.State?.world?.rows || 0),
      roadWidthPx: roadWidth.toFixed(2)
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
    drawPresentation();
  }

  Game.StarterVillageRoads = Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    descriptorSource: 'originVillage.roadTiles',
    presentationMode: MODE,
    snapshotTopology: roadTopology,
    ensureOverlay,
    drawPresentation,
    detachPresentation
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();
