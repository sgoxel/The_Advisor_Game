/* Development-only village readability patch: projection guard + building labels. */
(function installStarterVillageDevOverlay() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-starter-village-dev-overlay-v1';
  const LABELS = Object.freeze({
    home: 'House',
    dwelling: 'House',
    house: 'House',
    inn: 'Inn',
    tavern: 'Inn',
    lodging: 'Inn',
    village_hall: 'Village Hall',
    hall: 'Village Hall',
    civic: 'Village Hall',
    bakery: 'Bakery',
    market: 'Market',
    shop: 'Market',
    smithy: 'Blacksmith',
    blacksmith: 'Blacksmith',
    workshop: 'Workshop',
    guard_post: 'Guard Post',
    guard: 'Guard Post',
    mill: 'Mill',
    farmstead: 'Farm',
    farm: 'Farm',
    agricultural: 'Farm',
    storage: 'Storage',
    storehouse: 'Storage',
    barn: 'Storage',
    well: 'Well'
  });

  let labelCanvas = null;
  let renderHookInstalled = false;
  let retryTimer = null;

  function canvasGeometry() {
    const gameCanvas = Game.State?.dom?.canvas || document.getElementById('gameCanvas');
    const host = document.getElementById('center-area');
    if (!gameCanvas || !host) return null;
    const gameRect = gameCanvas.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    return {
      gameCanvas,
      host,
      left: gameRect.left - hostRect.left,
      top: gameRect.top - hostRect.top,
      width: Math.max(1, gameRect.width || gameCanvas.clientWidth || 1),
      height: Math.max(1, gameRect.height || gameCanvas.clientHeight || 1)
    };
  }

  function alignCanvas(canvas, geometry) {
    if (!canvas || !geometry) return;
    Object.assign(canvas.style, {
      position: 'absolute',
      left: `${geometry.left}px`,
      top: `${geometry.top}px`,
      right: 'auto',
      bottom: 'auto',
      width: `${geometry.width}px`,
      height: `${geometry.height}px`,
      pointerEvents: 'none'
    });
  }

  function syncExistingExteriorOverlay(geometry) {
    const exterior = document.getElementById('starterVillageExteriorOverlay');
    if (!exterior || !geometry) return;
    exterior.style.inset = 'auto';
    alignCanvas(exterior, geometry);
    exterior.dataset.projectionGuard = 'enabled';
  }

  function ensureLabelCanvas(geometry) {
    if (!geometry) return null;
    if (!labelCanvas || !labelCanvas.isConnected) {
      labelCanvas = document.createElement('canvas');
      labelCanvas.id = 'starterVillageDevelopmentLabels';
      labelCanvas.setAttribute('aria-hidden', 'true');
      labelCanvas.tabIndex = -1;
      labelCanvas.style.zIndex = '2';
      geometry.host.appendChild(labelCanvas);
    }
    alignCanvas(labelCanvas, geometry);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const targetWidth = Math.round(geometry.width * dpr);
    const targetHeight = Math.round(geometry.height * dpr);
    if (labelCanvas.width !== targetWidth || labelCanvas.height !== targetHeight) {
      labelCanvas.width = targetWidth;
      labelCanvas.height = targetHeight;
    }
    return labelCanvas;
  }

  function isAbsurdProjection(point, width, height) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return true;
    const marginX = Math.max(2048, width * 3.5);
    const marginY = Math.max(1536, height * 3.5);
    return point.x < -marginX || point.x > width + marginX || point.y < -marginY || point.y > height + marginY;
  }

  function withProjectionGuard(callback) {
    const Renderer = Game.Renderer;
    const geometry = canvasGeometry();
    if (!Renderer || typeof Renderer.gridToScreen !== 'function' || !geometry) return callback?.();
    const original = Renderer.gridToScreen;
    Renderer.gridToScreen = function guardedGridToScreen(...args) {
      const point = original.apply(Renderer, args);
      if (isAbsurdProjection(point, geometry.width, geometry.height)) {
        return { x: Number.NaN, y: Number.NaN, visible: false, projectionRejected: true };
      }
      return point;
    };
    try {
      return callback?.();
    } finally {
      Renderer.gridToScreen = original;
    }
  }

  function buildingLabel(building) {
    const type = String(building?.type || '').trim().toLowerCase();
    if (LABELS[type]) return LABELS[type];
    if (!type) return 'Building';
    return type.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function bounds(points) {
    return {
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
      maxY: Math.max(...points.map((p) => p.y))
    };
  }

  function polygonArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) * 0.5;
  }

  function safeFootprint(points, width, height) {
    if (!Array.isArray(points) || points.length !== 4 || !points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) return false;
    const b = bounds(points);
    const spanX = b.maxX - b.minX;
    const spanY = b.maxY - b.minY;
    if (spanX > Math.max(320, width * 0.78) || spanY > Math.max(260, height * 0.78)) return false;
    if (polygonArea(points) > width * height * 0.42) return false;
    return true;
  }

  function projectFootprint(building, width, height) {
    const footprint = building?.footprint;
    if (!footprint || typeof Game.Renderer?.gridToScreen !== 'function') return null;
    const row = Number(footprint.row);
    const col = Number(footprint.col);
    const footprintHeight = Number(footprint.height);
    const footprintWidth = Number(footprint.width);
    if (![row, col, footprintHeight, footprintWidth].every(Number.isFinite) || footprintHeight <= 0 || footprintWidth <= 0) return null;
    const project = (r, c) => Game.Renderer.gridToScreen(r, c, 0, 0);
    const points = [
      project(row, col),
      project(row, col + footprintWidth),
      project(row + footprintHeight, col + footprintWidth),
      project(row + footprintHeight, col)
    ];
    return safeFootprint(points, width, height) ? points : null;
  }

  function drawLabel(ctx, label, x, y, footprintWidth, footprintHeight) {
    const fontSize = Math.max(9, Math.min(12, footprintWidth * 0.12, footprintHeight * 0.18));
    ctx.save();
    ctx.font = `700 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(label);
    const padX = 5;
    const padY = 3;
    const boxWidth = Math.ceil(metrics.width + padX * 2);
    const boxHeight = Math.ceil(fontSize + padY * 2);
    ctx.fillStyle = 'rgba(24,19,16,.88)';
    ctx.strokeStyle = 'rgba(248,236,211,.90)';
    ctx.lineWidth = 1;
    ctx.fillRect(x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight);
    ctx.strokeRect(x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight);
    ctx.fillStyle = '#fff7e8';
    ctx.fillText(label, x, y + 0.5);
    ctx.restore();
  }

  function drawDevelopmentLabels() {
    const geometry = canvasGeometry();
    const buildings = Game.State?.world?.originVillage?.buildings;
    if (!geometry || !Array.isArray(buildings)) return false;
    syncExistingExteriorOverlay(geometry);
    const canvas = ensureLabelCanvas(geometry);
    if (!canvas) return false;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, geometry.width, geometry.height);

    let drawn = 0;
    withProjectionGuard(() => {
      for (const building of buildings) {
        const points = projectFootprint(building, geometry.width, geometry.height);
        if (!points) continue;
        const b = bounds(points);
        if (b.maxX < -40 || b.maxY < -50 || b.minX > geometry.width + 40 || b.minY > geometry.height + 50) continue;
        const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
        const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
        drawLabel(ctx, buildingLabel(building), x, y, Math.max(1, b.maxX - b.minX), Math.max(1, b.maxY - b.minY));
        drawn += 1;
      }
    });
    canvas.dataset.developmentOnly = 'true';
    canvas.dataset.labelCount = String(drawn);
    canvas.dataset.projectionGuard = 'enabled';
    return true;
  }

  function redrawExistingExteriorSafely() {
    const geometry = canvasGeometry();
    if (!geometry) return false;
    syncExistingExteriorOverlay(geometry);
    return withProjectionGuard(() => Game.StarterVillageExteriors?.drawPresentation?.()) !== false;
  }

  function installRenderHook() {
    const Renderer = Game.Renderer;
    if (!Renderer || typeof Renderer.renderWorld !== 'function' || renderHookInstalled) return false;
    const previous = Renderer.renderWorld.bind(Renderer);
    Renderer.renderWorld = function starterVillageDevelopmentAwareRenderWorld(force) {
      const geometry = canvasGeometry();
      if (geometry) syncExistingExteriorOverlay(geometry);
      const result = withProjectionGuard(() => previous(force));
      drawDevelopmentLabels();
      return result;
    };
    renderHookInstalled = true;
    redrawExistingExteriorSafely();
    drawDevelopmentLabels();
    return true;
  }

  function initialize() {
    if (installRenderHook()) {
      if (retryTimer !== null) window.clearInterval(retryTimer);
      retryTimer = null;
      return;
    }
    if (retryTimer === null) {
      retryTimer = window.setInterval(() => {
        if (installRenderHook()) {
          window.clearInterval(retryTimer);
          retryTimer = null;
        }
      }, 100);
    }
  }

  Game.StarterVillageDevOverlay = Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    developmentOnly: true,
    buildingLabel,
    safeFootprint,
    drawDevelopmentLabels,
    redrawExistingExteriorSafely
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
