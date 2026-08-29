/*
  R04 / #244: presentation-only exterior placeholder for the authoritative starter village.

  Simulation owns building identity, type, footprint, entrance, roads and terrain. Until the
  Designer-provided building tile PNG set is integrated, building footprint areas are represented
  by the existing SEED-derived `settlement`/stone terrain tiles. This module intentionally does
  not paint large rectangle/roof overlays over the map.
*/
(function installStarterVillageExteriors() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r04-starter-village-exteriors-v2-stone-placeholder';
  const PLACEHOLDER_MODE = 'existing-settlement-terrain-tiles';

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

  function footprintTerrainStats(building) {
    const terrain = Game.State?.world?.terrain;
    const footprint = building?.footprint;
    if (!Array.isArray(terrain) || !footprint) {
      return { total: 0, settlement: 0 };
    }

    const row0 = Number(footprint.row);
    const col0 = Number(footprint.col);
    const height = Number(footprint.height);
    const width = Number(footprint.width);
    if (![row0, col0, height, width].every(Number.isFinite) || height <= 0 || width <= 0) {
      return { total: 0, settlement: 0 };
    }

    let total = 0;
    let settlement = 0;
    for (let row = row0; row < row0 + height; row += 1) {
      for (let col = col0; col < col0 + width; col += 1) {
        const tile = terrain[row]?.[col];
        if (!tile) continue;
        total += 1;
        if (String(tile.type || '') === 'settlement') settlement += 1;
      }
    }
    return { total, settlement };
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

  function snapshotPlaceholderCoverage() {
    const buildings = Game.State?.world?.originVillage?.buildings;
    if (!Array.isArray(buildings)) return [];
    return buildings.map((building) => ({
      id: building.id,
      type: building.type,
      ...footprintTerrainStats(building)
    }));
  }

  function drawPresentation() {
    const canvas = ensureOverlay();
    const buildings = Game.State?.world?.originVillage?.buildings;
    if (!canvas || !Array.isArray(buildings)) return false;

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

    // Temporary Admin-approved fallback: do not paint footprint rectangles or roof plates.
    // The existing `settlement` terrain tile motif already stamped by the authoritative
    // spatial generator is the visible house/building-area placeholder until tile PNG art lands.
    const coverage = snapshotPlaceholderCoverage();
    const fullyCovered = coverage.filter((item) => item.total > 0 && item.settlement === item.total).length;
    const coveredTiles = coverage.reduce((sum, item) => sum + item.settlement, 0);
    const footprintTiles = coverage.reduce((sum, item) => sum + item.total, 0);
    const visibleTypes = new Set(buildings.map((building) => String(building.type || 'unknown')));

    canvas.dataset.buildingCount = String(buildings.length);
    canvas.dataset.visibleBuildingCount = '0';
    canvas.dataset.visibleBuildingTypes = Array.from(visibleTypes).sort().join(',');
    canvas.dataset.presentationAuthority = 'presentation-only';
    canvas.dataset.descriptorSource = 'originVillage.buildings';
    canvas.dataset.regionSize = String(Game.State?.world?.rows || 0);
    canvas.dataset.placeholderMode = PLACEHOLDER_MODE;
    canvas.dataset.rectangleOverlay = 'disabled';
    canvas.dataset.fullyStoneCoveredBuildings = String(fullyCovered);
    canvas.dataset.stoneCoveredTiles = String(coveredTiles);
    canvas.dataset.footprintTiles = String(footprintTiles);
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
    placeholderMode: PLACEHOLDER_MODE,
    snapshotDescriptors,
    snapshotPlaceholderCoverage,
    ensureOverlay,
    drawPresentation,
    detachPresentation
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
})();