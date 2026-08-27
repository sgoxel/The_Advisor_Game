/*
  Organic terrain transition patch.
  Keeps legacy generated rounded terrain plates disabled, blends land/elevation
  boundaries in the terrain canvas, aligns relief lighting to the rendered world
  rotation, and renders navigation arrows in a floating screen-space overlay.
*/
window.Game = window.Game || {};

(function () {
  "use strict";

  let installed = false;
  const WORLD_ROTATION_DEGREES = 45;
  const BLENDABLE_TYPES = new Set(["grass", "dirt", "forest", "mountain"]);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hashUnit(parts) {
    const text = parts.map((part) => String(part)).join("|");
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0x5bd1e995) >>> 0;
    hash ^= hash >>> 15;
    return (hash >>> 0) / 4294967295;
  }

  function getTile(grid, row, col) {
    return grid && grid[row] && grid[row][col] ? grid[row][col] : null;
  }

  function getTileType(grid, row, col) {
    const tile = getTile(grid, row, col);
    return tile && typeof tile.type === "string" ? tile.type : "grass";
  }

  function effectiveElevation(tile) {
    if (!tile) return 1;
    const type = String(tile.type || "grass");
    const numeric = Number(tile.elevation);
    let fallback = 1;
    if (type === "lake" || type === "river") fallback = 0;
    else if (type === "forest") fallback = 2;
    else if (type === "mountain") fallback = 3;
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(fallback, numeric);
  }

  function canBlendTypes(a, b) {
    return a !== b && BLENDABLE_TYPES.has(a) && BLENDABLE_TYPES.has(b);
  }

  function normalizeDegrees(value) {
    const numeric = Number(value) || 0;
    return ((numeric % 360) + 360) % 360;
  }

  // Renderer rotates the logical map +45 degrees before display. Convert the
  // user-visible/render-space sun azimuth back to logical grid coordinates so
  // relief sampling, highlights and shadows all agree with what is on screen.
  function getLogicalSunDirection(State) {
    const renderAzimuth = normalizeDegrees(State && State.camera ? State.camera.sunAzimuth : 0);
    const logicalAzimuth = (renderAzimuth - WORLD_ROTATION_DEGREES) * Math.PI / 180;
    return {
      x: Math.cos(logicalAzimuth),
      y: Math.sin(logicalAzimuth)
    };
  }

  function prepareOrganicTerrain(grid, seed) {
    const Game = window.Game || {};
    const State = Game.State;
    if (!State || !State.world) return;
    State.world.organicSurfaceSeed = String(seed || State.world.seed || "organic-surface");
    State.world.generatedTerrainShapes = [];
    if (State.render) {
      State.render.organicSurfaceSignature = "";
      State.render.organicSurfacePending = true;
    }
  }

  function getBlendedPattern(ctx, State, typeA, typeB, cache) {
    const key = [typeA, typeB].sort().join("|");
    if (cache.has(key)) return cache.get(key);

    const images = State.render && State.render.textureImages;
    const imageA = images && images[typeA];
    const imageB = images && images[typeB];
    if (!imageA || !imageB || typeof document === "undefined") {
      cache.set(key, null);
      return null;
    }

    try {
      const width = Math.max(32, Math.min(256, imageA.width || 128, imageB.width || 128));
      const height = Math.max(32, Math.min(256, imageA.height || 128, imageB.height || 128));
      const tileCanvas = document.createElement("canvas");
      tileCanvas.width = width;
      tileCanvas.height = height;
      const tileCtx = tileCanvas.getContext("2d", { alpha: false });
      if (!tileCtx) {
        cache.set(key, null);
        return null;
      }

      tileCtx.imageSmoothingEnabled = true;
      tileCtx.globalAlpha = 1;
      tileCtx.drawImage(imageA, 0, 0, width, height);
      tileCtx.globalAlpha = 0.5;
      tileCtx.drawImage(imageB, 0, 0, width, height);
      tileCtx.globalAlpha = 1;

      const pattern = ctx.createPattern(tileCanvas, "repeat");
      cache.set(key, pattern || null);
      return pattern || null;
    } catch (error) {
      cache.set(key, null);
      return null;
    }
  }

  function sharedCornerNoise(seed, axis, boundaryIndex, cornerIndex) {
    return (hashUnit([seed, "organic-corner", axis, boundaryIndex, cornerIndex]) - 0.5) * 2;
  }

  function midpointNoise(seed, axis, boundaryIndex, segmentIndex) {
    return (hashUnit([seed, "organic-mid", axis, boundaryIndex, segmentIndex]) - 0.5) * 2;
  }

  function buildVerticalTransitionPath(ctx, seed, boundaryCol, row, baseX, y0, y1, amplitude) {
    const start = sharedCornerNoise(seed, "v", boundaryCol, row) * amplitude * 0.48;
    const end = sharedCornerNoise(seed, "v", boundaryCol, row + 1) * amplitude * 0.48;
    const middle = midpointNoise(seed, "v", boundaryCol, row) * amplitude;
    const secondHarmonic = midpointNoise(seed, "v2", boundaryCol, row) * amplitude * 0.28;
    const steps = 12;

    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const linear = start + (end - start) * t;
      const bow = Math.sin(Math.PI * t) * middle;
      const detail = Math.sin(Math.PI * 2 * t) * secondHarmonic;
      const x = baseX + linear + bow + detail;
      const y = y0 + (y1 - y0) * t;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  function buildHorizontalTransitionPath(ctx, seed, boundaryRow, col, x0, x1, baseY, amplitude) {
    const start = sharedCornerNoise(seed, "h", boundaryRow, col) * amplitude * 0.48;
    const end = sharedCornerNoise(seed, "h", boundaryRow, col + 1) * amplitude * 0.48;
    const middle = midpointNoise(seed, "h", boundaryRow, col) * amplitude;
    const secondHarmonic = midpointNoise(seed, "h2", boundaryRow, col) * amplitude * 0.28;
    const steps = 12;

    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const linear = start + (end - start) * t;
      const bow = Math.sin(Math.PI * t) * middle;
      const detail = Math.sin(Math.PI * 2 * t) * secondHarmonic;
      const x = x0 + (x1 - x0) * t;
      const y = baseY + linear + bow + detail;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  function strokeTransition(ctx, pattern, transitionWidth) {
    if (!pattern) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = pattern;

    // Broad low-opacity pass hides the tile-grid seam without becoming a hard ribbon.
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = transitionWidth * 1.75;
    ctx.stroke();

    // Main mixed-texture transition.
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = transitionWidth;
    ctx.stroke();

    // Slight center variation keeps the edge readable without a dark outline.
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = transitionWidth * 0.42;
    ctx.stroke();
    ctx.restore();
  }

  function strokeDirectionalRelief(ctx, State, normal, elevationDelta, transitionWidth) {
    if (!ctx || !State || !State.camera || elevationDelta <= 0.001) return;
    if (State.camera.reliefEnabled === false) return;

    const sun = getLogicalSunDirection(State);
    const facing = normal.x * sun.x + normal.y * sun.y;
    const shadowStrength = clamp(Number(State.camera.shadowStrength) || 0.34, 0, 1);
    const highlightStrength = clamp(Number(State.camera.highlightStrength) || 0.22, 0, 1);
    const deltaScale = clamp(elevationDelta, 0.5, 3.5);

    // The normal points from the higher cell into the lower cell. A negative
    // facing value means that lower ground is on the away-from-sun side, so
    // cast the soft shadow into that lower side.
    const shadowFacing = Math.max(0, -facing);
    if (shadowFacing > 0.03 && shadowStrength > 0.01) {
      const alpha = clamp(0.05 + shadowStrength * shadowFacing * 0.34 * deltaScale, 0.04, 0.36);
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(1.2, transitionWidth * (0.18 + 0.05 * deltaScale));
      ctx.strokeStyle = `rgba(24,20,16,${alpha.toFixed(3)})`;
      ctx.shadowColor = `rgba(18,15,12,${(alpha * 0.9).toFixed(3)})`;
      ctx.shadowBlur = Math.max(1, transitionWidth * 0.45);
      ctx.shadowOffsetX = normal.x * transitionWidth * 0.24;
      ctx.shadowOffsetY = normal.y * transitionWidth * 0.24;
      ctx.stroke();
      ctx.restore();
    }

    // Sun-facing cliff/top edge gets a subtle warm highlight. Using the same
    // logical sun vector prevents the highlight and shadow appearing reversed.
    const lightFacing = Math.max(0, facing);
    if (lightFacing > 0.03 && highlightStrength > 0.01) {
      const alpha = clamp(0.025 + highlightStrength * lightFacing * 0.18 * deltaScale, 0.02, 0.20);
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(0.8, transitionWidth * 0.09);
      ctx.strokeStyle = `rgba(255,236,188,${alpha.toFixed(3)})`;
      ctx.stroke();
      ctx.restore();
    }
  }

  function applyOrganicSurfaceTransitions() {
    const Game = window.Game || {};
    const State = Game.State;
    if (!State || !State.world || !State.render) return false;

    const render = State.render;
    const world = State.world;
    const canvas = render.worldBackgroundCanvas;

    if (!render.organicSurfacePending) return false;
    if (render.preserveBackground) {
      render.organicSurfacePending = false;
      return false;
    }
    if (!canvas || !canvas.width || !canvas.height || !Array.isArray(world.terrain) || !world.terrain.length) {
      return false;
    }

    const signature = [
      String(world.seed || world.organicSurfaceSeed || ""),
      world.cols,
      world.rows,
      canvas.width,
      canvas.height,
      String(render.backgroundSource || "generated"),
      normalizeDegrees(State.camera && State.camera.sunAzimuth),
      Number(State.camera && State.camera.sunElevation) || 0,
      Number(State.camera && State.camera.shadowStrength) || 0,
      Number(State.camera && State.camera.highlightStrength) || 0
    ].join("|");
    if (render.organicSurfaceSignature === signature) {
      render.organicSurfacePending = false;
      return false;
    }

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return false;

    const rows = Math.max(1, Number(world.rows) || world.terrain.length);
    const cols = Math.max(1, Number(world.cols) || (world.terrain[0] ? world.terrain[0].length : 1));
    const cellWidth = canvas.width / cols;
    const cellHeight = canvas.height / rows;
    const cellSize = Math.max(1, Math.min(cellWidth, cellHeight));
    const transitionWidth = Math.max(3, cellSize * 0.30);
    const waveAmplitude = Math.max(1, cellSize * 0.14);
    const seed = String(world.seed || world.organicSurfaceSeed || "organic-surface");
    const patternCache = new Map();

    ctx.save();
    ctx.imageSmoothingEnabled = true;

    // Vertical boundaries. One shared organic path is used for texture mixing
    // and directional relief, avoiding mismatched seams or detached strips.
    for (let row = 0; row < rows; row++) {
      const y0 = row * cellHeight;
      const y1 = (row + 1) * cellHeight;
      for (let col = 0; col < cols - 1; col++) {
        const leftTile = getTile(world.terrain, row, col);
        const rightTile = getTile(world.terrain, row, col + 1);
        const leftType = getTileType(world.terrain, row, col);
        const rightType = getTileType(world.terrain, row, col + 1);
        const leftElevation = effectiveElevation(leftTile);
        const rightElevation = effectiveElevation(rightTile);
        const elevationDelta = Math.abs(leftElevation - rightElevation);
        const needsBlend = canBlendTypes(leftType, rightType);
        if (!needsBlend && elevationDelta <= 0.001) continue;

        const baseX = (col + 1) * cellWidth;
        buildVerticalTransitionPath(ctx, seed, col + 1, row, baseX, y0, y1, waveAmplitude);

        if (needsBlend) {
          const pattern = getBlendedPattern(ctx, State, leftType, rightType, patternCache);
          strokeTransition(ctx, pattern, transitionWidth);
        }

        if (elevationDelta > 0.001) {
          const normal = leftElevation > rightElevation ? { x: 1, y: 0 } : { x: -1, y: 0 };
          strokeDirectionalRelief(ctx, State, normal, elevationDelta, transitionWidth);
        }
      }
    }

    // Horizontal boundaries.
    for (let row = 0; row < rows - 1; row++) {
      const baseY = (row + 1) * cellHeight;
      for (let col = 0; col < cols; col++) {
        const topTile = getTile(world.terrain, row, col);
        const bottomTile = getTile(world.terrain, row + 1, col);
        const topType = getTileType(world.terrain, row, col);
        const bottomType = getTileType(world.terrain, row + 1, col);
        const topElevation = effectiveElevation(topTile);
        const bottomElevation = effectiveElevation(bottomTile);
        const elevationDelta = Math.abs(topElevation - bottomElevation);
        const needsBlend = canBlendTypes(topType, bottomType);
        if (!needsBlend && elevationDelta <= 0.001) continue;

        const x0 = col * cellWidth;
        const x1 = (col + 1) * cellWidth;
        buildHorizontalTransitionPath(ctx, seed, row + 1, col, x0, x1, baseY, waveAmplitude);

        if (needsBlend) {
          const pattern = getBlendedPattern(ctx, State, topType, bottomType, patternCache);
          strokeTransition(ctx, pattern, transitionWidth);
        }

        if (elevationDelta > 0.001) {
          const normal = topElevation > bottomElevation ? { x: 0, y: 1 } : { x: 0, y: -1 };
          strokeDirectionalRelief(ctx, State, normal, elevationDelta, transitionWidth);
        }
      }
    }

    ctx.restore();

    render.organicSurfaceSignature = signature;
    render.organicSurfacePending = false;
    render.needsBackgroundUpload = true;
    render.backgroundTextureReady = false;
    render.needsWorldRedraw = true;
    return true;
  }

  function clearDetachedWallOverlay() {
    const Game = window.Game || {};
    const State = Game.State;
    if (!State || !State.dom) return;
    const overlay = State.dom.terrainShapeOverlay;
    const ctx = State.dom.terrainShapeOverlayCtx;
    if (!overlay || !ctx) return;
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, overlay.width, overlay.height);
    } catch (error) {
      // Overlay cleanup is best effort; terrain rendering must continue.
    }
  }

  function getProjectedTileScale(Renderer, row, col) {
    try {
      const center = Renderer.gridToScreen(row, col, 0, 0);
      const east = Renderer.gridToScreen(row, col + 1, 0, 0);
      const south = Renderer.gridToScreen(row + 1, col, 0, 0);
      const eastDistance = Math.hypot(east.x - center.x, east.y - center.y);
      const southDistance = Math.hypot(south.x - center.x, south.y - center.y);
      return Math.max(8, Math.min(eastDistance, southDistance));
    } catch (error) {
      return 40;
    }
  }

  function drawArrowHead(ctx, from, to, size) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    const px = -uy;
    const py = ux;
    const tip = {
      x: from.x + dx * 0.72,
      y: from.y + dy * 0.72
    };
    const baseX = tip.x - ux * size;
    const baseY = tip.y - uy * size;

    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(baseX + px * size * 0.58, baseY + py * size * 0.58);
    ctx.lineTo(baseX - px * size * 0.58, baseY - py * size * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawFloatingPreviewRoute(path) {
    const Game = window.Game || {};
    const State = Game.State;
    const Renderer = Game.Renderer;
    if (!State || !State.dom || !Renderer || !Array.isArray(path) || path.length < 2) return;

    const overlay = State.dom.terrainShapeOverlay;
    const ctx = State.dom.terrainShapeOverlayCtx;
    if (!overlay || !ctx) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const points = [];
    for (const node of path) {
      if (!node || !Number.isFinite(node.row) || !Number.isFinite(node.col)) continue;
      const projected = Renderer.gridToScreen(node.row, node.col, 0, 0);
      if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)) points.push(projected);
    }
    if (points.length < 2) return;

    const firstNode = path[0] || { row: 0, col: 0 };
    const tileScale = getProjectedTileScale(Renderer, firstNode.row || 0, firstNode.col || 0);
    const hoverOffset = clamp(tileScale * 0.12, 9, 24);
    const routeWidth = clamp(tileScale * 0.045, 3.5, 7.5);
    const arrowSize = clamp(tileScale * 0.13, 8, 17);
    const elevated = points.map((point) => ({ x: point.x, y: point.y - hoverOffset }));

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Soft ground shadow provides a clear visual gap between the route and terrain.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y + 1.5);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y + 1.5);
    ctx.strokeStyle = "rgba(20,16,18,0.22)";
    ctx.lineWidth = routeWidth * 1.35;
    ctx.shadowColor = "rgba(0,0,0,0.24)";
    ctx.shadowBlur = Math.max(2, routeWidth * 1.2);
    ctx.stroke();
    ctx.restore();

    // Floating route body. It is drawn in the overlay after WebGL rendering, so
    // terrain texture/elevation cannot depth-fight through it.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(elevated[0].x, elevated[0].y);
    for (let i = 1; i < elevated.length; i++) ctx.lineTo(elevated[i].x, elevated[i].y);
    ctx.strokeStyle = "rgba(247,205,220,0.86)";
    ctx.lineWidth = routeWidth + 2.2;
    ctx.stroke();
    ctx.strokeStyle = "rgba(151,29,73,0.96)";
    ctx.lineWidth = routeWidth;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(151,29,73,0.98)";
    ctx.strokeStyle = "rgba(255,225,235,0.92)";
    ctx.lineWidth = Math.max(1, routeWidth * 0.22);
    for (let i = 0; i < elevated.length - 1; i++) {
      drawArrowHead(ctx, elevated[i], elevated[i + 1], arrowSize);
    }
    ctx.restore();

    // Keep the route from painting across the protagonist sprite at the start.
    if (State.world && State.world.player) {
      try {
        const player = Renderer.gridToScreen(State.world.player.row, State.world.player.col, 0, 0);
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(player.x, player.y - hoverOffset * 0.35, Math.max(12, arrowSize * 1.2), 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } catch (error) {
        // Player clearance is cosmetic only.
      }
    }

    ctx.restore();
  }

  function install() {
    if (installed) return;
    const Game = window.Game || {};
    const State = Game.State;
    const Terrain = Game.Terrain;
    const Renderer = Game.Renderer;
    const Config = Game.Config;
    if (!State || !Terrain || !Renderer || !Config) return;
    installed = true;

    // Legacy configured/debug plates and generated bounding rectangles are kept
    // disabled. Organic elevation is represented on the actual terrain surface.
    Config.TERRAIN_SHAPES = [];

    const originalGenerateWorld = typeof Terrain.generateWorld === "function"
      ? Terrain.generateWorld.bind(Terrain)
      : null;
    const originalBuildGeneratedTerrainShapes = typeof Terrain.buildGeneratedTerrainShapes === "function"
      ? Terrain.buildGeneratedTerrainShapes.bind(Terrain)
      : null;
    const originalRenderWorld = typeof Renderer.renderWorld === "function"
      ? Renderer.renderWorld.bind(Renderer)
      : null;

    if (originalGenerateWorld) {
      Terrain.generateWorld = function (seed, cols, rows) {
        const generated = originalGenerateWorld(seed, cols, rows);
        const grid = generated && generated.grid;
        prepareOrganicTerrain(grid, seed);
        if (generated) generated.generatedTerrainShapes = [];
        return generated;
      };
    }

    if (originalBuildGeneratedTerrainShapes) {
      Terrain.buildGeneratedTerrainShapes = function (grid, seed) {
        prepareOrganicTerrain(grid, seed);
        return [];
      };
    }

    if (originalRenderWorld) {
      Renderer.renderWorld = function (force) {
        const world = State.world || {};
        const previewPath = Array.isArray(world.previewPath) ? world.previewPath.slice() : [];
        const originalPreviewPath = world.previewPath;
        const originalAzimuth = State.camera ? State.camera.sunAzimuth : 0;
        const numericAzimuth = Number(originalAzimuth);

        clearDetachedWallOverlay();

        // Suppress the original ground-level WebGL route and rebuild relief with
        // the sun converted into logical-grid coordinates for the 45-degree map.
        world.previewPath = [];
        if (State.camera && Number.isFinite(numericAzimuth)) {
          State.camera.sunAzimuth = normalizeDegrees(numericAzimuth - WORLD_ROTATION_DEGREES);
        }

        let result;
        try {
          result = originalRenderWorld(force);
        } finally {
          world.previewPath = originalPreviewPath;
          if (State.camera && Number.isFinite(numericAzimuth)) State.camera.sunAzimuth = originalAzimuth;
        }

        applyOrganicSurfaceTransitions();
        clearDetachedWallOverlay();
        drawFloatingPreviewRoute(previewPath);
        return result;
      };
    }
  }

  if (typeof window.addEventListener === "function") {
    if (typeof document !== "undefined" && document.readyState === "loading") {
      window.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
      install();
    }
  }
})();
