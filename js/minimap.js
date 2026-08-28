/* ROAD_PATCH_V2: diagonal connectivity + color fix */
window.Game = window.Game || {};

(function () {
  const State = window.Game.State;
  const Renderer = window.Game.Renderer;
  const UI = window.Game.UI;
  const R01_SYMBOLS = 'assets/design/r01/strategic-map-symbols.svg';

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
    ctx.fillStyle = 'rgba(10, 14, 20, 0.08)';
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.fill();

    // Designer #65 viewport language: dark outer edge + light inner edge so the
    // frame survives mixed terrain colors without depending on hue alone.
    ctx.strokeStyle = 'rgba(10, 14, 20, 0.92)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(244, 247, 251, 0.96)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function drawCurrentLocationCue(ctx, playerPos, layout) {
    const radius = Math.max(5, Math.min(10, layout.miniHalfW * 1.6));
    const diamondW = Math.max(3, radius * 0.62);
    const diamondH = Math.max(2, radius * 0.42);

    ctx.save();
    ctx.strokeStyle = 'rgba(10, 14, 20, 0.96)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(playerPos.x, playerPos.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(244, 247, 251, 0.98)';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawDiamond(ctx, playerPos.x, playerPos.y, diamondW, diamondH, '#f4f7fb');
    ctx.beginPath();
    ctx.moveTo(playerPos.x, playerPos.y - diamondH);
    ctx.lineTo(playerPos.x + diamondW, playerPos.y);
    ctx.lineTo(playerPos.x, playerPos.y + diamondH);
    ctx.lineTo(playerPos.x - diamondW, playerPos.y);
    ctx.closePath();
    ctx.strokeStyle = '#11151c';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(playerPos.x, playerPos.y, Math.max(1.5, radius * 0.18), 0, Math.PI * 2);
    ctx.fillStyle = '#11151c';
    ctx.fill();
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
    drawCurrentLocationCue(ctx, playerPos, layout);

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

  function ensureReadabilityStyle() {
    if (document.getElementById('r01-map-readability-style')) return;
    const style = document.createElement('style');
    style.id = 'r01-map-readability-style';
    style.textContent = `
      #r01-map-cues{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3}
      .r01-map-cue{position:absolute;display:block;color:#f4f7fb;filter:drop-shadow(0 0 1px #11151c);transform:translate(-50%,-50%)}
      .r01-current-location{width:34px;height:34px}
      .r01-inspection{width:42px;height:42px;color:#ffe39a}
      .r01-route-preview{position:absolute;max-width:min(260px,70vw);padding:4px 7px;border:1px solid rgba(244,247,251,.75);border-radius:4px;background:rgba(12,17,24,.78);color:#f4f7fb;font:600 11px/1.25 system-ui,sans-serif;letter-spacing:.01em;transform:translate(-50%,10px)}
      #center-area button:focus-visible,.bottom-ribbon button:focus-visible,.ribbon button:focus-visible,.ribbon select:focus-visible{outline:2px solid #f4f7fb;outline-offset:2px}
      @media (max-width:700px){.r01-current-location{width:40px;height:40px}.r01-inspection{width:46px;height:46px}.r01-route-preview{font-size:12px}}
      @media (prefers-reduced-motion:reduce){.r01-map-cue,.r01-route-preview{transition:none!important;animation:none!important}}
    `;
    document.head.appendChild(style);
  }

  function createSpriteCue(className, viewBox, fragmentId, ariaLabel) {
    const ns = 'http://www.w3.org/2000/svg';
    const xlink = 'http://www.w3.org/1999/xlink';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', `r01-map-cue ${className}`);
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('aria-label', ariaLabel);
    svg.setAttribute('role', 'img');
    const use = document.createElementNS(ns, 'use');
    const href = `${R01_SYMBOLS}#${fragmentId}`;
    use.setAttribute('href', href);
    use.setAttributeNS(xlink, 'xlink:href', href);
    svg.appendChild(use);
    return svg;
  }

  function ensureMapCueLayer() {
    const center = document.getElementById('center-area');
    if (!center) return null;
    ensureReadabilityStyle();
    let layer = document.getElementById('r01-map-cues');
    if (layer) return layer;

    layer = document.createElement('div');
    layer.id = 'r01-map-cues';
    layer.setAttribute('aria-live', 'polite');

    const current = createSpriteCue('r01-current-location', '0 0 64 64', 'current-location', 'Current protagonist location');
    current.id = 'r01-current-location';
    const inspection = createSpriteCue('r01-inspection', '64 0 64 64', 'inspection', 'Inspected map location');
    inspection.id = 'r01-inspection';
    const preview = document.createElement('div');
    preview.id = 'r01-route-preview';
    preview.className = 'r01-route-preview';
    preview.hidden = true;

    layer.appendChild(current);
    layer.appendChild(inspection);
    layer.appendChild(preview);
    center.appendChild(layer);
    return layer;
  }

  function getPlayerGridPosition(world) {
    const player = world && world.player;
    if (!player) return null;
    if (!player.moving) return { row: player.row, col: player.col };
    const t = clamp(Number(player.progress) || 0, 0, 1);
    return {
      row: player.startRow + (player.targetRow - player.startRow) * t,
      col: player.startCol + (player.targetCol - player.startCol) * t
    };
  }

  function positionCue(element, gridPosition) {
    if (!element) return;
    if (!gridPosition || !Number.isFinite(gridPosition.row) || !Number.isFinite(gridPosition.col)) {
      element.hidden = true;
      return;
    }
    const screen = Renderer.gridToScreen(gridPosition.row, gridPosition.col);
    if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    element.style.left = `${screen.x}px`;
    element.style.top = `${screen.y}px`;
  }

  function getPreviewLabel() {
    const language = document.getElementById('languageSelect');
    return language && language.value === 'tr'
      ? 'Rota önizlemesi · bağlayıcı değil'
      : 'Route preview · non-binding';
  }

  function renderReadabilityCues() {
    const canvas = State && State.dom && State.dom.canvas;
    if (!canvas || !canvas.isConnected || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;

    const layer = ensureMapCueLayer();
    if (!layer) return;
    const world = State.world || {};
    const current = document.getElementById('r01-current-location');
    const inspection = document.getElementById('r01-inspection');
    const preview = document.getElementById('r01-route-preview');

    positionCue(current, getPlayerGridPosition(world));
    positionCue(inspection, world.selected || null);

    const hasPreview = world.selected && Array.isArray(world.previewPath) && world.previewPath.length > 1;
    if (preview) {
      preview.hidden = !hasPreview;
      if (hasPreview) {
        preview.textContent = getPreviewLabel();
        positionCue(preview, world.selected);
      }
    }
  }

  // Integrate the Designer #65 sprite/spec into the real map without changing
  // authoritative world state. Renderer remains the source of map geometry;
  // this wrapper only refreshes non-interactive presentation cues.
  const baseRenderWorld = Renderer.renderWorld;
  if (typeof baseRenderWorld === 'function' && !Renderer.__r01ReadabilityWrapped) {
    Renderer.renderWorld = function (force) {
      const result = baseRenderWorld.call(Renderer, force);
      renderReadabilityCues();
      return result;
    };
    Renderer.__r01ReadabilityWrapped = true;
  }

  window.addEventListener('resize', renderReadabilityCues);
  document.addEventListener('DOMContentLoaded', renderReadabilityCues);

  window.Game.Minimap = { resizeMinimap, renderMinimap, bindMinimapEvents };
})();