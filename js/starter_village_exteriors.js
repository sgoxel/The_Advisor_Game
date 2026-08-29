/*
  R04 / #244: presentation-only exterior materialization for the authoritative starter village.

  Simulation owns building identity, type, footprint, entrance, roads and terrain. This module
  only projects those existing descriptors into the living-map view. It never creates placement
  facts and intentionally does not implement interior navigation, collision or world-sprite logic.
*/
(function installStarterVillageExteriors() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-starter-village-exteriors-v1';

  const TYPE_STYLE = Object.freeze({
    home: Object.freeze({ wall: '#8a6748', roof: '#6c3e35', accent: '#d8b27a' }),
    inn: Object.freeze({ wall: '#8d704e', roof: '#6f3440', accent: '#e8bd69' }),
    village_hall: Object.freeze({ wall: '#817464', roof: '#4d5967', accent: '#d9d0ad' }),
    bakery: Object.freeze({ wall: '#9a7148', roof: '#744536', accent: '#f1c27d' }),
    market: Object.freeze({ wall: '#8c7653', roof: '#5c704c', accent: '#e0c77b' }),
    smithy: Object.freeze({ wall: '#6c6460', roof: '#403f43', accent: '#d9824f' }),
    workshop: Object.freeze({ wall: '#7a644e', roof: '#4e493f', accent: '#c9a86a' }),
    guard_post: Object.freeze({ wall: '#6e7074', roof: '#46505a', accent: '#c9d1d8' }),
    mill: Object.freeze({ wall: '#8a795b', roof: '#58634c', accent: '#d8c58f' }),
    farmstead: Object.freeze({ wall: '#8c724d', roof: '#63583c', accent: '#d7c66e' }),
    well: Object.freeze({ wall: '#6c7379', roof: '#4b535b', accent: '#b9d0d8' })
  });
  const FALLBACK_STYLE = Object.freeze({ wall: '#777066', roof: '#55504a', accent: '#d0c5a8' });

  let overlayCanvas = null;
  let renderHookInstalled = false;

  function ensureOverlay() {
    const gameCanvas = Game.State?.dom?.canvas || document.getElementById('gameCanvas');
    const host = document.getElementById('center-area');
    if (!gameCanvas || !host) return null;
    if (overlayCanvas && overlayCanvas.isConnected) return overlayCanvas;

    overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'starterVillageExteriorOverlay';
    overlayCanvas.setAttribute('aria-hidden', 'true');
    overlayCanvas.tabIndex = -1;
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.inset = '0';
    overlayCanvas.style.width = '100%';
    overlayCanvas.style.height = '100%';
    overlayCanvas.style.pointerEvents = 'none';
    overlayCanvas.style.zIndex = '1';
    host.appendChild(overlayCanvas);
    return overlayCanvas;
  }

  function styleFor(building) {
    return TYPE_STYLE[String(building?.type || '').toLowerCase()] || FALLBACK_STYLE;
  }

  function project(row, col) {
    const point = Game.Renderer?.gridToScreen(row, col, 0, 0);
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  }

  function polygonForFootprint(footprint) {
    if (!footprint) return null;
    const r0 = Number(footprint.row);
    const c0 = Number(footprint.col);
    const r1 = r0 + Number(footprint.height);
    const c1 = c0 + Number(footprint.width);
    if (![r0, c0, r1, c1].every(Number.isFinite)) return null;
    const points = [project(r0, c0), project(r0, c1), project(r1, c1), project(r1, c0)];
    return points.every(Boolean) ? points : null;
  }

  function polygonBounds(points) {
    return {
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
      maxY: Math.max(...points.map((p) => p.y))
    };
  }

  function drawPolygon(ctx, points) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
  }

  function drawBuilding(ctx, building, width, height) {
    const footprint = polygonForFootprint(building.footprint);
    if (!footprint) return false;
    const bounds = polygonBounds(footprint);
    if (bounds.maxX < -24 || bounds.maxY < -24 || bounds.minX > width + 24 || bounds.minY > height + 24) return false;

    const style = styleFor(building);
    ctx.save();

    // Low wall/body mass follows the authoritative footprint exactly.
    drawPolygon(ctx, footprint);
    ctx.fillStyle = style.wall;
    ctx.globalAlpha = building.passable ? 0.45 : 0.82;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(34, 28, 24, 0.92)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // A shallow inset roof/readability plate distinguishes a physical structure while
    // remaining presentation-only. Passable landmarks/markets retain lighter coverage.
    const center = {
      x: footprint.reduce((sum, p) => sum + p.x, 0) / footprint.length,
      y: footprint.reduce((sum, p) => sum + p.y, 0) / footprint.length
    };
    const roof = footprint.map((p) => ({
      x: center.x + (p.x - center.x) * 0.78,
      y: center.y + (p.y - center.y) * 0.78 - Math.min(12, Math.max(3, (bounds.maxY - bounds.minY) * 0.12))
    }));
    drawPolygon(ctx, roof);
    ctx.fillStyle = style.roof;
    ctx.globalAlpha = building.passable ? 0.36 : 0.88;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(28, 24, 22, 0.86)';
    ctx.stroke();

    // Entrance is always projected from the authoritative descriptor and deliberately
    // remains visible for later #253 exterior->interior continuity.
    const entrance = project(Number(building.entrance?.row), Number(building.entrance?.col));
    if (entrance) {
      const radius = Math.max(2.5, Math.min(6, Math.abs(bounds.maxY - bounds.minY) * 0.08));
      ctx.fillStyle = style.accent;
      ctx.strokeStyle = 'rgba(30, 25, 22, 0.95)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(entrance.x, entrance.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
    return true;
  }

  function snapshotDescriptors() {
    const buildings = Game.State?.world?.originVillage?.buildings;
    if (!Array.isArray(buildings)) return [];
    return buildings.map((building) => ({
      id: building.id,
      type: building.type,
      role: building.role,
      passable: building.passable === true,
      footprint: building.footprint ? { ...building.footprint } : null,
      entrance: building.entrance ? { ...building.entrance } : null
    }));
  }

  function drawPresentation() {
    const canvas = ensureOverlay();
    const buildings = Game.State?.world?.originVillage?.buildings;
    if (!canvas || !Game.Renderer || !Array.isArray(buildings)) return false;

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

    let visibleCount = 0;
    const visibleTypes = new Set();
    for (const building of buildings) {
      if (drawBuilding(ctx, building, width, height)) {
        visibleCount += 1;
        visibleTypes.add(String(building.type || 'unknown'));
      }
    }

    canvas.dataset.buildingCount = String(buildings.length);
    canvas.dataset.visibleBuildingCount = String(visibleCount);
    canvas.dataset.visibleBuildingTypes = Array.from(visibleTypes).sort().join(',');
    canvas.dataset.presentationAuthority = 'presentation-only';
    canvas.dataset.descriptorSource = 'originVillage.buildings';
    canvas.dataset.regionSize = String(Game.State?.world?.rows || 0);
    return true;
  }

  function installRenderHook() {
    const Renderer = Game.Renderer;
    if (!Renderer || typeof Renderer.renderWorld !== 'function' || renderHookInstalled) return false;
    const renderWorld = Renderer.renderWorld.bind(Renderer);
    Renderer.renderWorld = function starterVillageExteriorAwareRenderWorld(force) {
      const result = renderWorld(force);
      drawPresentation();
      return result;
    };
    renderHookInstalled = true;
    return true;
  }

  function detachPresentation() {
    if (overlayCanvas && overlayCanvas.parentNode) overlayCanvas.parentNode.removeChild(overlayCanvas);
    overlayCanvas = null;
  }

  function initialize() {
    ensureOverlay();
    installRenderHook();
    drawPresentation();
  }

  Game.StarterVillageExteriors = Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    descriptorSource: 'originVillage.buildings',
    snapshotDescriptors,
    ensureOverlay,
    drawPresentation,
    detachPresentation
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();