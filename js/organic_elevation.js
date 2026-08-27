/*
  Organic terrain transition patch.
  Keeps legacy generated rounded terrain plates disabled and replaces detached
  screen-space elevation wall bands with same-surface deterministic texture
  transitions drawn directly into the terrain background canvas.
*/
window.Game = window.Game || {};

(function () {
  "use strict";

  let installed = false;
  const BLENDABLE_TYPES = new Set(["grass", "dirt", "forest", "mountain"]);

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

  function getTileType(grid, row, col) {
    const tile = grid && grid[row] && grid[row][col];
    return tile && typeof tile.type === "string" ? tile.type : "grass";
  }

  function canBlendTypes(a, b) {
    return a !== b && BLENDABLE_TYPES.has(a) && BLENDABLE_TYPES.has(b);
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
      tileCtx.globalAlpha = 0.52;
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
    const start = sharedCornerNoise(seed, "v", boundaryCol, row) * amplitude * 0.55;
    const end = sharedCornerNoise(seed, "v", boundaryCol, row + 1) * amplitude * 0.55;
    const middle = midpointNoise(seed, "v", boundaryCol, row) * amplitude;
    const steps = 8;

    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const linear = start + (end - start) * t;
      const bow = Math.sin(Math.PI * t) * middle;
      const x = baseX + linear + bow;
      const y = y0 + (y1 - y0) * t;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  function buildHorizontalTransitionPath(ctx, seed, boundaryRow, col, x0, x1, baseY, amplitude) {
    const start = sharedCornerNoise(seed, "h", boundaryRow, col) * amplitude * 0.55;
    const end = sharedCornerNoise(seed, "h", boundaryRow, col + 1) * amplitude * 0.55;
    const middle = midpointNoise(seed, "h", boundaryRow, col) * amplitude;
    const steps = 8;

    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const linear = start + (end - start) * t;
      const bow = Math.sin(Math.PI * t) * middle;
      const x = x0 + (x1 - x0) * t;
      const y = baseY + linear + bow;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  function strokeTransition(ctx, pattern, lineWidth) {
    if (!pattern) return;
    ctx.save();
    ctx.globalAlpha = 0.90;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = pattern;
    ctx.stroke();

    // A wider low-alpha pass feathers the outside of the mixed texture band.
    ctx.globalAlpha = 0.24;
    ctx.lineWidth = lineWidth * 1.48;
    ctx.stroke();
    ctx.restore();
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
      String(render.backgroundSource || "generated")
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
    const transitionWidth = Math.max(2, cellSize * 0.18);
    const waveAmplitude = Math.max(0.75, cellSize * 0.085);
    const seed = String(world.seed || world.organicSurfaceSeed || "organic-surface");
    const patternCache = new Map();

    ctx.save();
    ctx.imageSmoothingEnabled = true;

    // Vertical boundaries. Paint only once per pair of neighboring cells.
    for (let row = 0; row < rows; row++) {
      const y0 = row * cellHeight;
      const y1 = (row + 1) * cellHeight;
      for (let col = 0; col < cols - 1; col++) {
        const leftType = getTileType(world.terrain, row, col);
        const rightType = getTileType(world.terrain, row, col + 1);
        if (!canBlendTypes(leftType, rightType)) continue;

        const pattern = getBlendedPattern(ctx, State, leftType, rightType, patternCache);
        if (!pattern) continue;

        const baseX = (col + 1) * cellWidth;
        buildVerticalTransitionPath(ctx, seed, col + 1, row, baseX, y0, y1, waveAmplitude);
        strokeTransition(ctx, pattern, transitionWidth);
      }
    }

    // Horizontal boundaries. Paint only once per pair of neighboring cells.
    for (let row = 0; row < rows - 1; row++) {
      const baseY = (row + 1) * cellHeight;
      for (let col = 0; col < cols; col++) {
        const topType = getTileType(world.terrain, row, col);
        const bottomType = getTileType(world.terrain, row + 1, col);
        if (!canBlendTypes(topType, bottomType)) continue;

        const pattern = getBlendedPattern(ctx, State, topType, bottomType, patternCache);
        if (!pattern) continue;

        const x0 = col * cellWidth;
        const x1 = (col + 1) * cellWidth;
        buildHorizontalTransitionPath(ctx, seed, row + 1, col, x0, x1, baseY, waveAmplitude);
        strokeTransition(ctx, pattern, transitionWidth);
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

  function install() {
    if (installed) return;
    const Game = window.Game || {};
    const State = Game.State;
    const Terrain = Game.Terrain;
    const Renderer = Game.Renderer;
    const Config = Game.Config;
    if (!State || !Terrain || !Renderer || !Config) return;
    installed = true;

    // The legacy configured/debug plates and generated bounding rectangles are
    // the source of the detached, manually drawn appearance. Keep them disabled.
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
        // Do not create legacy rounded bounding rectangles for imported terrain.
        prepareOrganicTerrain(grid, seed);
        return [];
      };
    }

    if (originalRenderWorld) {
      Renderer.renderWorld = function (force) {
        clearDetachedWallOverlay();
        const result = originalRenderWorld(force);

        // The background canvas is produced lazily by renderer.js. Once it
        // exists, convert hard land-type seams into deterministic wavy mixed
        // texture transitions in the SAME canvas space. A following frame
        // uploads this modified canvas to WebGL, so no projected wall gap can
        // exist between the transition and the terrain texture.
        if (applyOrganicSurfaceTransitions()) {
          clearDetachedWallOverlay();
        }

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
