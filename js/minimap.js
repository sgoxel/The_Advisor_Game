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
