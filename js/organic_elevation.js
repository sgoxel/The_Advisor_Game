/*
  Organic elevation boundary patch.
  Replaces legacy rounded-rectangle elevation plates with terrain-following
  deterministic curved side walls derived from the authoritative tile grid.
*/
window.Game = window.Game || {};

(function () {
  "use strict";

  let installed = false;

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

  function effectiveElevation(tile) {
    if (!tile) return 1;
    const numeric = Number(tile.elevation);
    const type = String(tile.type || "grass");
    let floor = 1;
    if (type === "lake" || type === "river") floor = 0;
    else if (type === "forest") floor = 2;
    else if (type === "mountain") floor = 3;
    if (!Number.isFinite(numeric)) return floor;
    return Math.max(floor, numeric);
  }

  function cornerPoint(seed, x, y, cols, rows) {
    const edgeLockedX = x <= 0 || x >= cols;
    const edgeLockedY = y <= 0 || y >= rows;
    const amplitude = 0.11;
    const dx = edgeLockedX ? 0 : (hashUnit([seed, "corner-x", x, y]) - 0.5) * amplitude * 2;
    const dy = edgeLockedY ? 0 : (hashUnit([seed, "corner-y", x, y]) - 0.5) * amplitude * 2;
    return {
      x: clamp(x + dx, 0, cols),
      y: clamp(y + dy, 0, rows)
    };
  }

  function buildOrganicElevationEdges(grid, seed) {
    if (!Array.isArray(grid) || !grid.length || !Array.isArray(grid[0])) return [];
    const rows = grid.length;
    const cols = grid[0].length;
    const edges = [];
    const directions = [
      { name: "top", dr: -1, dc: 0, p0: [0, 0], p1: [1, 0], outward: [0, -1] },
      { name: "right", dr: 0, dc: 1, p0: [1, 0], p1: [1, 1], outward: [1, 0] },
      { name: "bottom", dr: 1, dc: 0, p0: [1, 1], p1: [0, 1], outward: [0, 1] },
      { name: "left", dr: 0, dc: -1, p0: [0, 1], p1: [0, 0], outward: [-1, 0] }
    ];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tile = grid[row] && grid[row][col];
        if (!tile) continue;
        const elevation = effectiveElevation(tile);
        if (elevation <= 1) continue;

        for (const dir of directions) {
          const nr = row + dir.dr;
          const nc = col + dir.dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;

          const neighbor = grid[nr] && grid[nr][nc];
          const neighborElevation = effectiveElevation(neighbor);
          const delta = elevation - neighborElevation;
          if (delta <= 0.001) continue;

          const raw0 = { x: col + dir.p0[0], y: row + dir.p0[1] };
          const raw1 = { x: col + dir.p1[0], y: row + dir.p1[1] };
          const p0 = cornerPoint(seed, raw0.x, raw0.y, cols, rows);
          const p1 = cornerPoint(seed, raw1.x, raw1.y, cols, rows);
          const outwardX = dir.outward[0];
          const outwardY = dir.outward[1];
          const tangentX = p1.x - p0.x;
          const tangentY = p1.y - p0.y;
          const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentY));
          const tangentUnitX = tangentX / tangentLength;
          const tangentUnitY = tangentY / tangentLength;
          const edgeNoise = hashUnit([seed, "edge", row, col, dir.name]);
          const sideNoise = hashUnit([seed, "edge-side", row, col, dir.name]);
          const bulge = 0.07 + edgeNoise * 0.11;
          const tangentShift = (sideNoise - 0.5) * 0.08;
          const midpoint = {
            x: (p0.x + p1.x) * 0.5 + outwardX * bulge + tangentUnitX * tangentShift,
            y: (p0.y + p1.y) * 0.5 + outwardY * bulge + tangentUnitY * tangentShift
          };

          edges.push({
            row,
            col,
            type: String(tile.type || "grass"),
            elevation,
            neighborElevation,
            delta,
            p0,
            p1,
            control: midpoint,
            outward: { x: outwardX, y: outwardY },
            depthNoise: 0.92 + hashUnit([seed, "depth", row, col, dir.name]) * 0.16
          });
        }
      }
    }

    return edges;
  }

  function projectGridPoint(Renderer, point) {
    return Renderer.gridToScreen(point.y - 0.5, point.x - 0.5, 0, 0);
  }

  function getTileScreenScale(Renderer, row, col) {
    const center = Renderer.gridToScreen(row, col, 0, 0);
    const east = Renderer.gridToScreen(row, col + 1, 0, 0);
    const south = Renderer.gridToScreen(row + 1, col, 0, 0);
    const eastDistance = Math.hypot(east.x - center.x, east.y - center.y);
    const southDistance = Math.hypot(south.x - center.x, south.y - center.y);
    return Math.max(1, Math.min(eastDistance, southDistance));
  }

  function sideFallbackColor(type) {
    switch (String(type || "")) {
      case "forest": return "rgba(45,72,39,0.96)";
      case "mountain": return "rgba(91,84,73,0.96)";
      case "dirt": return "rgba(120,84,50,0.96)";
      case "settlement": return "rgba(130,105,74,0.96)";
      default: return "rgba(76,74,61,0.96)";
    }
  }

  function getTexturePattern(ctx, State, type) {
    const images = State.render && State.render.textureImages;
    const image = images && images[type];
    if (!image) return null;
    try {
      return ctx.createPattern(image, "repeat");
    } catch (error) {
      return null;
    }
  }

  function drawOrganicElevationWalls() {
    const Game = window.Game || {};
    const State = Game.State;
    const Renderer = Game.Renderer;
    if (!State || !Renderer || !State.world || !State.dom) return;
    if (State.camera && State.camera.showTerrainWalls === false) return;

    const overlay = State.dom.terrainShapeOverlay;
    const ctx = State.dom.terrainShapeOverlayCtx;
    const edges = State.world.organicElevationEdges;
    if (!overlay || !ctx || !Array.isArray(edges) || !edges.length) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const segments = [];

    for (const edge of edges) {
      const a = projectGridPoint(Renderer, edge.p0);
      const b = projectGridPoint(Renderer, edge.p1);
      const c = projectGridPoint(Renderer, edge.control);
      const tileCenter = Renderer.gridToScreen(edge.row, edge.col, 0, 0);
      const rawMid = Renderer.gridToScreen(
        edge.row + edge.outward.y * 0.5,
        edge.col + edge.outward.x * 0.5,
        0,
        0
      );

      if (!a || !b || !c || !tileCenter || !rawMid) continue;
      if (rawMid.y <= tileCenter.y + 0.25) continue;

      const tileScale = getTileScreenScale(Renderer, edge.row, edge.col);
      const depth = clamp(tileScale * 0.18 * Math.max(1, edge.delta) * edge.depthNoise, 4, 24);
      const sortKey = (a.y + b.y + c.y) / 3;
      segments.push({ edge, a, b, c, depth, sortKey });
    }

    segments.sort((lhs, rhs) => lhs.sortKey - rhs.sortKey);

    ctx.save();
    ctx.scale(dpr, dpr);

    for (const segment of segments) {
      const { edge, a, b, c, depth } = segment;
      const bottomA = { x: a.x, y: a.y + depth };
      const bottomB = { x: b.x, y: b.y + depth };
      const bottomC = { x: c.x, y: c.y + depth };

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
      ctx.lineTo(bottomB.x, bottomB.y);
      ctx.quadraticCurveTo(bottomC.x, bottomC.y, bottomA.x, bottomA.y);
      ctx.closePath();
      ctx.clip();

      const pattern = getTexturePattern(ctx, State, edge.type);
      ctx.globalAlpha = 0.98;
      ctx.fillStyle = pattern || sideFallbackColor(edge.type);
      const minX = Math.min(a.x, b.x, c.x, bottomA.x, bottomB.x, bottomC.x) - 3;
      const minY = Math.min(a.y, b.y, c.y) - 3;
      const maxX = Math.max(a.x, b.x, c.x, bottomA.x, bottomB.x, bottomC.x) + 3;
      const maxY = Math.max(bottomA.y, bottomB.y, bottomC.y) + 3;
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

      const shade = ctx.createLinearGradient(0, Math.min(a.y, b.y), 0, Math.max(bottomA.y, bottomB.y));
      shade.addColorStop(0, "rgba(255,255,255,0.08)");
      shade.addColorStop(0.15, "rgba(0,0,0,0.05)");
      shade.addColorStop(0.62, "rgba(0,0,0,0.22)");
      shade.addColorStop(1, "rgba(0,0,0,0.38)");
      ctx.fillStyle = shade;
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = Math.max(0.75, Math.min(1.5, depth * 0.08));
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  function prepareOrganicTerrain(grid, seed) {
    const Game = window.Game || {};
    const State = Game.State;
    if (!State || !State.world) return;
    State.world.organicElevationEdges = buildOrganicElevationEdges(grid, seed || State.world.seed || "organic-elevation");
    State.world.generatedTerrainShapes = [];
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

    // Disable legacy debug/config terrain plates. The real grid becomes the top surface.
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
        // Keep the original call available for compatibility/side effects, but do not
        // return its rounded bounding rectangles to the renderer.
        try { originalBuildGeneratedTerrainShapes(grid, seed); } catch (error) { /* ignore legacy shape failure */ }
        prepareOrganicTerrain(grid, seed);
        return [];
      };
    }

    if (originalRenderWorld) {
      Renderer.renderWorld = function (force) {
        const result = originalRenderWorld(force);
        drawOrganicElevationWalls();
        return result;
      };
    }
  }

  if (typeof window.addEventListener === "function") {
    if (document.readyState === "loading") {
      window.addEventListener("DOMContentLoaded", install, { once: true });
    } else {
      install();
    }
  }
})();
