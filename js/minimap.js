/* ROAD_PATCH_V2: diagonal connectivity + color fix */
window.Game = window.Game || {};

(function () {
  const State = window.Game.State;
  const Renderer = window.Game.Renderer;
  const UI = window.Game.UI;

  function resizeMinimap() {
    const dom = State.dom;
    const dpr = window.devicePixelRatio || 1;
    dom.minimap.width = Math.round(dom.minimap.clientWidth * dpr);
    dom.minimap.height = Math.round(dom.minimap.clientHeight * dpr);
    dom.miniCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    Renderer.markDirty(false, true);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function getMinimapLayout() {
    const world = State.world;
    const dom = State.dom;
    const width = dom.minimap.clientWidth;
    const height = dom.minimap.clientHeight;
    const padding = Math.max(8, Math.min(16, Math.floor(Math.min(width, height) * 0.08)));
    const sum = Math.max(1, world.cols + world.rows);
    const halfW = Math.max(2, Math.min((width - padding * 2) / sum, (height - padding * 2) / (sum * 0.5)));
    const halfH = Math.max(1, halfW * 0.5);
    const mapWidth = sum * halfW;
    const mapHeight = sum * halfH;
    const centerX = width / 2;
    const originY = (height - mapHeight) / 2;
    return {
      width,
      height,
      centerX,
      originY,
      miniHalfW: halfW,
      miniHalfH: halfH,
      mapWidth,
      mapHeight
    };
  }

  function gridToMinimap(row, col, layout) {
    return {
      x: layout.centerX + (col - row) * layout.miniHalfW,
      y: layout.originY + (row + col + 1) * layout.miniHalfH
    };
  }

  function screenToGridOnMinimap(x, y, layout) {
    const isoX = (x - layout.centerX) / Math.max(0.0001, layout.miniHalfW);
    const isoY = (y - layout.originY) / Math.max(0.0001, layout.miniHalfH) - 1;
    const col = (isoY + isoX) / 2;
    const row = (isoY - isoX) / 2;
    const roundedRow = Math.round(row);
    const roundedCol = Math.round(col);
    if (roundedRow < 0 || roundedCol < 0 || roundedRow >= State.world.rows || roundedCol >= State.world.cols) return null;
    return { row: roundedRow, col: roundedCol };
  }

  function drawDiamond(ctx, cx, cy, halfW, halfH, fillStyle) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - halfH);
    ctx.lineTo(cx + halfW, cy);
    ctx.lineTo(cx, cy + halfH);
    ctx.lineTo(cx - halfW, cy);
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  function drawViewportFrame(layout) {
    const ctx = State.dom.miniCtx;
    const canvas = State.dom.canvas;
    const worldCorners = [
      Renderer.screenToGridFloat(0, 0),
      Renderer.screenToGridFloat(canvas.clientWidth, 0),
      Renderer.screenToGridFloat(canvas.clientWidth, canvas.clientHeight),
      Renderer.screenToGridFloat(0, canvas.clientHeight)
    ];

    const corners = worldCorners.map((p) => {
      const clampedRow = clamp(p.row, 0, State.world.rows - 1);
      const clampedCol = clamp(p.col, 0, State.world.cols - 1);
      return gridToMinimap(clampedRow, clampedCol, layout);
    });

    ctx.save();
    ctx.strokeStyle = '#ff4d4f';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(255, 77, 79, 0.10)';
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function renderMinimap(force) {
    const dom = State.dom;
    const world = State.world;
    if (!dom.minimap || !dom.miniCtx || !world.terrain.length) return;
    if (!force && !State.render.needsMinimapRedraw) return;

    const layout = getMinimapLayout();
    const ctx = dom.miniCtx;
    ctx.clearRect(0, 0, layout.width, layout.height);

    for (let row = 0; row < world.rows; row++) {
      for (let col = 0; col < world.cols; col++) {
        const p = gridToMinimap(row, col, layout);
        drawDiamond(ctx, p.x, p.y, layout.miniHalfW, layout.miniHalfH, Renderer.terrainColor(world.terrain[row][col]));
      }
    }

    drawViewportFrame(layout);

    const playerPos = gridToMinimap(world.player.row, world.player.col, layout);
    // Arcs removed: draw a small diamond for the player marker instead of a circle.
    const pHalfW = Math.max(2, layout.miniHalfW * 0.8);
    const pHalfH = Math.max(1, layout.miniHalfH * 0.45);
    drawDiamond(ctx, playerPos.x, playerPos.y, pHalfW, pHalfH, '#f4f7fb');
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(playerPos.x, playerPos.y - pHalfH);
    ctx.lineTo(playerPos.x + pHalfW, playerPos.y);
    ctx.lineTo(playerPos.x, playerPos.y + pHalfH);
    ctx.lineTo(playerPos.x - pHalfW, playerPos.y);
    ctx.closePath();
    ctx.strokeStyle = '#11151c';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    State.render.needsMinimapRedraw = false;
  }

  function bindMinimapEvents() {
    const dom = State.dom;
    dom.minimap.addEventListener('click', (event) => {
      const rect = dom.minimap.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const picked = screenToGridOnMinimap(x, y, getMinimapLayout());
      if (!picked) return;
      Renderer.centerCameraOnTile(picked.row, picked.col);
      Renderer.markDirty();
      UI.addLog(`Minimap tıklandı: satır=${picked.row}, sütun=${picked.col}. Kamera ilgili noktaya ortalandı.`);
    });
  }

  window.Game.Minimap = { resizeMinimap, renderMinimap, bindMinimapEvents };
})();

/* TERRAIN_WALL_OCCLUSION_FIX_V1
   Keep generated 2.5D elevation walls from painting through neighboring
   generated terrain tops. This is installed after renderer.js is loaded. */
(function installTerrainWallOcclusionFix() {
  const Game = window.Game || {};
  const State = Game.State;
  const Renderer = Game.Renderer;
  const Config = Game.Config;
  if (!State || !Renderer || typeof Renderer.renderWorld !== 'function') return;
  if (Renderer.__terrainWallOcclusionFixInstalled) return;
  Renderer.__terrainWallOcclusionFixInstalled = true;

  const EPSILON = 1e-6;

  function buildRoundedContour(x0, y0, width, height, radius, segmentCount) {
    const points = [];
    const r = Math.max(0, Math.min(Number(radius) || 0, Math.min(width, height) * 0.5));
    const steps = Math.max(3, Number(segmentCount) || 8);
    const addArc = (cx, cy, startAngle, endAngle) => {
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const angle = startAngle + (endAngle - startAngle) * t;
        points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
      }
    };

    if (r <= EPSILON) {
      return [
        { x: x0, y: y0 },
        { x: x0 + width, y: y0 },
        { x: x0 + width, y: y0 + height },
        { x: x0, y: y0 + height }
      ];
    }

    points.push({ x: x0 + r, y: y0 });
    points.push({ x: x0 + width - r, y: y0 });
    addArc(x0 + width - r, y0 + r, -Math.PI / 2, 0);
    points.push({ x: x0 + width, y: y0 + height - r });
    addArc(x0 + width - r, y0 + height - r, 0, Math.PI / 2);
    points.push({ x: x0 + r, y: y0 + height });
    addArc(x0 + r, y0 + height - r, Math.PI / 2, Math.PI);
    points.push({ x: x0, y: y0 + r });
    addArc(x0 + r, y0 + r, Math.PI, Math.PI * 1.5);

    const deduped = [];
    for (const point of points) {
      const previous = deduped[deduped.length - 1];
      if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > 0.001) deduped.push(point);
    }
    return deduped;
  }

  function projectTileCoordinate(xUnits, yUnits) {
    return Renderer.gridToScreen(yUnits - 0.5, xUnits - 0.5, 0, 0);
  }

  function getLowerContour(projected) {
    if (!Array.isArray(projected) || projected.length < 3) return [];
    let leftIndex = 0;
    let rightIndex = 0;
    for (let i = 1; i < projected.length; i++) {
      const point = projected[i];
      const left = projected[leftIndex];
      const right = projected[rightIndex];
      if (!left || point.x < left.x || (Math.abs(point.x - left.x) < 0.001 && point.y > left.y)) leftIndex = i;
      if (!right || point.x > right.x || (Math.abs(point.x - right.x) < 0.001 && point.y > right.y)) rightIndex = i;
    }

    const buildChain = (start, end, step) => {
      const chain = [];
      const count = projected.length;
      let index = start;
      let guard = 0;
      while (guard++ <= count + 1) {
        chain.push(projected[index]);
        if (index === end) break;
        index = (index + step + count) % count;
      }
      return chain;
    };

    const score = (chain) => {
      let weightedY = 0;
      let totalLength = 0;
      for (let i = 0; i < chain.length - 1; i++) {
        const a = chain[i];
        const b = chain[i + 1];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < EPSILON) continue;
        weightedY += ((a.y + b.y) * 0.5) * length;
        totalLength += length;
      }
      return totalLength > 0 ? weightedY / totalLength : -Infinity;
    };

    const forward = buildChain(leftIndex, rightIndex, 1);
    const backward = buildChain(leftIndex, rightIndex, -1);
    return score(forward) >= score(backward) ? forward : backward;
  }

  function boundsForPoints(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      if (!point) continue;
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    return { minX, minY, maxX, maxY };
  }

  function boundsOverlap(a, b, padding) {
    const pad = Math.max(0, Number(padding) || 0);
    return a.minX <= b.maxX + pad && a.maxX + pad >= b.minX &&
      a.minY <= b.maxY + pad && a.maxY + pad >= b.minY;
  }

  function appendPolygon(path, points) {
    if (!path || !points || points.length < 3) return;
    path.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
    path.closePath();
  }

  function createPolygonPath(points) {
    const path = new Path2D();
    appendPolygon(path, points);
    return path;
  }

  function buildProjectedShape(shape, index) {
    if (!shape || shape.visible === false) return null;
    const centerX = Number(shape.positionX);
    const centerY = Number(shape.positionY);
    const width = Number(shape.widthUnits);
    const height = Number(shape.heightUnits);
    if (![centerX, centerY, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;

    const radius = Number.isFinite(shape.cornerCurveUnits) ? Math.max(0, Number(shape.cornerCurveUnits)) : 0;
    const logicalContour = buildRoundedContour(centerX - width * 0.5, centerY - height * 0.5, width, height, radius, 10);
    const projected = logicalContour.map((point) => projectTileCoordinate(point.x, point.y));
    if (projected.length < 3) return null;
    const lowerChain = getLowerContour(projected);
    if (lowerChain.length < 2) return null;

    const bounds = boundsForPoints(projected);
    const depthKey = lowerChain.reduce((sum, point) => sum + point.y, 0) / lowerChain.length;
    return {
      index,
      shape,
      elevation: Number(shape.elevation || 0),
      projected,
      topPath: createPolygonPath(projected),
      lowerChain,
      bounds,
      depthKey
    };
  }

  function clipOutOccluder(ctx, occluder, canvasWidth, canvasHeight) {
    const inverse = new Path2D();
    const marginX = Math.max(32, canvasWidth);
    const marginY = Math.max(32, canvasHeight);
    inverse.rect(-marginX, -marginY, canvasWidth + marginX * 2, canvasHeight + marginY * 2);
    appendPolygon(inverse, occluder.projected);
    ctx.clip(inverse, 'evenodd');
  }

  function createGameplayClip(ctx) {
    const world = State.world || {};
    const cols = Math.max(1, Number(world.cols) || 1);
    const rows = Math.max(1, Number(world.rows) || 1);
    const corners = [
      projectTileCoordinate(0, 0),
      projectTileCoordinate(cols, 0),
      projectTileCoordinate(cols, rows),
      projectTileCoordinate(0, rows)
    ];
    if (corners.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.clip();
  }

  function drawCorrectedGeneratedWalls() {
    const world = State.world || {};
    const shapes = Array.isArray(world.generatedTerrainShapes) ? world.generatedTerrainShapes : [];
    if (!shapes.length) return;

    const overlay = State.dom && State.dom.terrainShapeOverlay;
    const ctx = State.dom && State.dom.terrainShapeOverlayCtx;
    if (!overlay || !ctx) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (!Config || Config.DEFAULT_SHOW_TERRAIN_SHAPE === false) return;
    if (State.camera && State.camera.showTerrainWalls === false) return;
    if (typeof Path2D === 'undefined') return;

    const cssWidth = overlay.width / dpr;
    const cssHeight = overlay.height / dpr;
    const projectedShapes = shapes.map(buildProjectedShape).filter(Boolean);
    if (!projectedShapes.length) return;

    const wallSegments = [];
    for (const projectedShape of projectedShapes) {
      const elevation = projectedShape.elevation;
      if (elevation <= 1) continue;

      const sideDepth = Math.max(5, Math.min(24,
        (projectedShape.bounds.maxY - projectedShape.bounds.minY) * 0.07 * Math.max(1, elevation - 1)));
      const textureKey = typeof projectedShape.shape.texture === 'string' && projectedShape.shape.texture
        ? projectedShape.shape.texture : 'settlement';
      const textureImage = (State.render.textureImages &&
        (State.render.textureImages[textureKey] || State.render.textureImages.grass)) || null;
      const chain = projectedShape.lowerChain;

      for (let i = 0; i < chain.length - 1; i++) {
        const a = chain[i];
        const b = chain[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const segmentLength = Math.hypot(dx, dy);
        if (segmentLength < 1.5) continue;
        if (segmentLength > Math.max(32, Math.max(cssWidth, cssHeight) * 0.35)) continue;

        const a2 = { x: a.x, y: a.y + sideDepth };
        const b2 = { x: b.x, y: b.y + sideDepth };
        const wallBounds = boundsForPoints([a, b, b2, a2]);
        const occluders = projectedShapes.filter((candidate) =>
          candidate.index !== projectedShape.index && boundsOverlap(wallBounds, candidate.bounds, 0.75));

        wallSegments.push({
          a, b, a2, b2, dx, dy, sideDepth, textureImage, occluders, wallBounds,
          sortKey: (a.y + b.y + a2.y + b2.y) * 0.25,
          shapeDepthKey: projectedShape.depthKey,
          shapeIndex: projectedShape.index
        });
      }
    }

    wallSegments.sort((lhs, rhs) => {
      if (Math.abs(lhs.sortKey - rhs.sortKey) > 0.01) return lhs.sortKey - rhs.sortKey;
      if (Math.abs(lhs.shapeDepthKey - rhs.shapeDepthKey) > 0.01) return lhs.shapeDepthKey - rhs.shapeDepthKey;
      return lhs.shapeIndex - rhs.shapeIndex;
    });

    ctx.save();
    ctx.scale(dpr, dpr);
    createGameplayClip(ctx);

    for (const segment of wallSegments) {
      const { a, b, a2, b2, dx, dy, sideDepth, textureImage } = segment;
      const wallPath = createPolygonPath([a, b, b2, a2]);
      ctx.save();
      ctx.clip(wallPath);

      let clipSupported = true;
      for (const occluder of segment.occluders) {
        try {
          clipOutOccluder(ctx, occluder, cssWidth, cssHeight);
        } catch (error) {
          clipSupported = false;
          break;
        }
      }

      if (!clipSupported) {
        ctx.restore();
        const centerX = (a.x + b.x + a2.x + b2.x) * 0.25;
        const centerY = (a.y + b.y + a2.y + b2.y) * 0.25;
        if (segment.occluders.some((occluder) => ctx.isPointInPath(occluder.topPath, centerX, centerY))) continue;
        ctx.save();
        ctx.clip(wallPath);
      }

      if (textureImage) {
        const pattern = ctx.createPattern(textureImage, 'repeat');
        if (pattern) {
          if (typeof pattern.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
            const textureWidth = Math.max(1, textureImage.width || 256);
            const textureHeight = Math.max(1, textureImage.height || 256);
            pattern.setTransform(new DOMMatrix([
              dx / textureWidth, dy / textureWidth, 0,
              Math.max(0.35, sideDepth / textureHeight), a.x, a.y
            ]));
          }
          ctx.fillStyle = pattern;
          ctx.fillRect(segment.wallBounds.minX - 4, segment.wallBounds.minY - 4,
            segment.wallBounds.maxX - segment.wallBounds.minX + 8,
            segment.wallBounds.maxY - segment.wallBounds.minY + 8);
        }
      }

      const gradient = ctx.createLinearGradient(0, a.y, 0, a2.y);
      gradient.addColorStop(0, 'rgba(255,255,255,0.06)');
      gradient.addColorStop(0.08, 'rgba(0,0,0,0.05)');
      gradient.addColorStop(0.55, 'rgba(0,0,0,0.20)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.34)');
      ctx.fillStyle = gradient;
      ctx.fillRect(segment.wallBounds.minX - 4, segment.wallBounds.minY - 4,
        segment.wallBounds.maxX - segment.wallBounds.minX + 8,
        segment.wallBounds.maxY - segment.wallBounds.minY + 8);

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a2.x, a2.y);
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b2.x, b2.y);
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = Math.max(1, sideDepth * 0.018);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  const originalRenderWorld = Renderer.renderWorld;
  Renderer.renderWorld = function renderWorldWithTerrainWallOcclusion(force) {
    const result = originalRenderWorld.call(Renderer, force);
    try {
      drawCorrectedGeneratedWalls();
    } catch (error) {
      console.warn('Terrain wall occlusion fix failed; retaining base renderer output.', error);
    }
    return result;
  };

  Game.TerrainWallOcclusionFix = { redraw: drawCorrectedGeneratedWalls };
})();
