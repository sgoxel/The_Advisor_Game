/* ROAD_PATCH_V2: diagonal connectivity + color fix */
/*
  FILE PURPOSE:
  Handle mouse and keyboard input for camera, tile picking, zoom, and non-binding path preview.
*/

window.Game = window.Game || {};

(function () {
  const State = window.Game.State;
  const Renderer = window.Game.Renderer;
  const UI = window.Game.UI;
  const Utils = window.Game.Utils;

  function getGridNeighbors(row, col) {
    return [
      { row: row - 1, col, diagonal: false },
      { row: row + 1, col, diagonal: false },
      { row, col: col - 1, diagonal: false },
      { row, col: col + 1, diagonal: false },
      { row: row - 1, col: col - 1, diagonal: true },
      { row: row - 1, col: col + 1, diagonal: true },
      { row: row + 1, col: col - 1, diagonal: true },
      { row: row + 1, col: col + 1, diagonal: true }
    ];
  }

  function isInsideWorld(row, col) {
    return row >= 0 && row < State.world.rows && col >= 0 && col < State.world.cols;
  }

  function getTile(row, col) {
    if (!isInsideWorld(row, col)) return null;
    return State.world.terrain[row] ? State.world.terrain[row][col] : null;
  }

  function isBlockedTile(row, col) {
    const tile = getTile(row, col);
    if (!tile) return true;
    if (tile.type === 'lake' || tile.type === 'river' || tile.type === 'mountain' || tile.type === 'forest') return true;
    if (tile.blocked === true || tile.obstacle === true) return true;
    if (tile.tags && (tile.tags.has('obstacle') || tile.tags.has('blocked'))) return true;
    return false;
  }

  function stepCost(row, col, mode, diagonal) {
    const tile = getTile(row, col);
    if (!tile) return Infinity;
    if (isBlockedTile(row, col)) return Infinity;

    const diagonalFactor = diagonal ? 1.4142 : 1.0;
    const onRoad = tile.type === 'road' || (tile.tags && tile.tags.has('road'));
    const onSettlement = tile.type === 'settlement' || (tile.tags && tile.tags.has('settlement'));
    const onHill = tile.type === 'mountain' || (tile.tags && tile.tags.has('mountain'));

    let baseCost = 1.0;
    if (mode === 'roadPreferred') {
      if (onRoad) baseCost = 0.55;
      else if (onSettlement) baseCost = 1.0;
      else if (onHill) baseCost = 2.2;
      else baseCost = 1.8;
    } else {
      if (onRoad) baseCost = 0.80;
      else if (onSettlement) baseCost = 1.0;
      else if (onHill) baseCost = 1.7;
      else baseCost = 1.0;
    }

    return baseCost * diagonalFactor;
  }

  function heuristic(row, col, targetRow, targetCol) {
    const dx = Math.abs(targetCol - col);
    const dy = Math.abs(targetRow - row);
    const diag = Math.min(dx, dy);
    const straight = Math.max(dx, dy) - diag;
    return diag * 1.4142 + straight;
  }

  function reconstructPath(parent, startKey, targetKey) {
    if (!parent.has(targetKey) && startKey !== targetKey) return [];
    const path = [];
    let cursor = targetKey;
    while (cursor) {
      const [row, col] = cursor.split(',').map(Number);
      path.push({ row, col });
      if (cursor === startKey) break;
      cursor = parent.get(cursor);
    }
    path.reverse();
    return path;
  }

  function findPathWithMode(startRow, startCol, targetRow, targetCol, mode) {
    if (!isInsideWorld(targetRow, targetCol) || isBlockedTile(targetRow, targetCol)) return [];
    const startKey = `${startRow},${startCol}`;
    const targetKey = `${targetRow},${targetCol}`;
    if (startKey === targetKey) return [{ row: startRow, col: startCol }];

    const open = [{ row: startRow, col: startCol, key: startKey, priority: 0 }];
    const parent = new Map();
    const gScore = new Map([[startKey, 0]]);
    const closed = new Set();

    while (open.length) {
      open.sort((a, b) => a.priority - b.priority);
      const current = open.shift();
      if (!current) break;
      if (closed.has(current.key)) continue;
      if (current.key === targetKey) return reconstructPath(parent, startKey, targetKey);
      closed.add(current.key);

      for (const next of getGridNeighbors(current.row, current.col)) {
        if (!isInsideWorld(next.row, next.col) || isBlockedTile(next.row, next.col)) continue;
        const nextKey = `${next.row},${next.col}`;
        const tentative = (gScore.get(current.key) || 0) + stepCost(next.row, next.col, mode, next.diagonal);
        if (tentative >= (gScore.get(nextKey) ?? Infinity)) continue;
        parent.set(nextKey, current.key);
        gScore.set(nextKey, tentative);
        open.push({
          row: next.row,
          col: next.col,
          key: nextKey,
          priority: tentative + heuristic(next.row, next.col, targetRow, targetCol)
        });
      }
    }
    return [];
  }

  function chooseBestPath(targetRow, targetCol) {
    const world = State.world;
    const player = world.player;
    const startRow = player.moving ? player.targetRow : player.row;
    const startCol = player.moving ? player.targetCol : player.col;

    const directPath = findPathWithMode(startRow, startCol, targetRow, targetCol, 'direct');
    const roadPath = findPathWithMode(startRow, startCol, targetRow, targetCol, 'roadPreferred');

    if (!roadPath.length) return directPath;
    if (!directPath.length) return roadPath;

    const directCost = directPath.reduce((sum, node, index) => {
      if (index === 0) return 0;
      const prev = directPath[index - 1];
      return sum + stepCost(node.row, node.col, 'direct', prev.row !== node.row && prev.col !== node.col);
    }, 0);

    const roadCost = roadPath.reduce((sum, node, index) => {
      if (index === 0) return 0;
      const prev = roadPath[index - 1];
      return sum + stepCost(node.row, node.col, 'roadPreferred', prev.row !== node.row && prev.col !== node.col);
    }, 0);

    const roadTileCount = roadPath.reduce((count, node) => {
      const tile = getTile(node.row, node.col);
      return count + ((tile && (tile.type === 'road' || (tile.tags && tile.tags.has('road')))) ? 1 : 0);
    }, 0);

    if (roadTileCount >= 2 && roadCost <= directCost * 1.5) return roadPath;
    return directPath;
  }

  function buildPathToTarget(targetRow, targetCol) {
    return chooseBestPath(targetRow, targetCol);
  }

  function getCanvasMousePosition(event) {
    const canvas = State.dom.canvas;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function getCanvasTouchPosition(event) {
    const canvas = State.dom.canvas;
    const rect = canvas.getBoundingClientRect();
    const touch = event.touches && event.touches[0]
      ? event.touches[0]
      : (event.changedTouches && event.changedTouches[0] ? event.changedTouches[0] : null);
    if (!touch) return null;
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }

  function advanceToNextQueuedStep(now) {
    const player = State.world.player;
    if (!player.pathQueue || !player.pathQueue.length) {
      player.moving = false;
      player.progress = 1;
      Renderer.centerCamera();
      return false;
    }

    const next = player.pathQueue.shift();
    player.startRow = player.row;
    player.startCol = player.col;
    player.targetRow = next.row;
    player.targetCol = next.col;
    player.moveStartTime = now;
    player.progress = 0;
    player.moving = true;
    return true;
  }

  function resetCameraInertia() {
    const camera = State.camera;
    camera.inertiaVelocityX = 0;
    camera.inertiaVelocityY = 0;
  }

  function beginCameraDrag(pos) {
    const camera = State.camera;
    camera.dragActive = true;
    camera.movedWhileDragging = false;
    camera.lastX = pos.x;
    camera.lastY = pos.y;
    camera.lastDragTime = performance.now();
    resetCameraInertia();
  }

  function applyDragDelta(pos, multiplier = 1) {
    const camera = State.camera;
    const now = performance.now();
    const dt = Math.max(1, now - (camera.lastDragTime || now));
    const dx = pos.x - camera.lastX;
    const dy = pos.y - camera.lastY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) camera.movedWhileDragging = true;
    const pan = Renderer.convertRenderDeltaToCameraDelta(-dx * multiplier, -dy * multiplier);
    camera.x += pan.dx;
    camera.y += pan.dy;
    camera.inertiaVelocityX = pan.dx / dt;
    camera.inertiaVelocityY = pan.dy / dt;
    camera.lastX = pos.x;
    camera.lastY = pos.y;
    camera.lastDragTime = now;
    Renderer.markDirty();
  }

  function endCameraDrag() {
    const camera = State.camera;
    camera.dragActive = false;
    camera.lastDragTime = 0;
    if (Math.abs(camera.inertiaVelocityX) < camera.inertiaMinVelocity) camera.inertiaVelocityX = 0;
    if (Math.abs(camera.inertiaVelocityY) < camera.inertiaMinVelocity) camera.inertiaVelocityY = 0;
  }

  function selectTileForInspection(picked) {
    const world = State.world;
    const input = State.input;
    world.selected = picked;
    world.previewPath = buildPathToTarget(picked.row, picked.col);
    input.lastTileClick = null;
    input.lastTileClickTime = 0;
    Renderer.markDirty(true, true);
    UI.addLog(`Tile seçildi; rota yalnızca önizlemedir: satır=${picked.row}, sütun=${picked.col}`);
  }

  function isEditableKeyboardTarget(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return true;
    return target instanceof HTMLElement && target.isContentEditable;
  }

  function bindInputEvents() {
    const dom = State.dom;
    const camera = State.camera;
    const input = State.input;
    const world = State.world;

    dom.canvas.addEventListener('mousemove', (event) => {
      const pos = getCanvasMousePosition(event);
      input.mouseX = pos.x;
      input.mouseY = pos.y;

      if (camera.dragActive) {
        applyDragDelta(pos);
      }

      const picked = Renderer.pickTile(pos.x, pos.y);
      if ((picked && (!world.hover || world.hover.row !== picked.row || world.hover.col !== picked.col)) || (!picked && world.hover)) {
        world.hover = picked;
        Renderer.markDirty(true, false);
      }
    });

    dom.canvas.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      const pos = getCanvasMousePosition(event);
      input.mouseX = pos.x;
      input.mouseY = pos.y;
      beginCameraDrag(pos);
      dom.canvas.classList.add('dragging');
    });

    dom.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const pos = getCanvasMousePosition(event);
      input.mouseX = pos.x;
      input.mouseY = pos.y;
      const oldZoom = camera.zoom;
      const direction = event.deltaY < 0 ? 1 : -1;
      const newZoom = Utils.clamp(Number((oldZoom + direction * camera.zoomStep).toFixed(2)), camera.minZoom, camera.maxZoom);
      if (newZoom === oldZoom) return;
      camera.zoom = newZoom;
      Renderer.markDirty();
      UI.addLog(`Zoom değiştirildi: ${newZoom.toFixed(2)}x`);
    }, { passive: false });

    window.addEventListener('mouseup', () => {
      endCameraDrag();
      dom.canvas.classList.remove('dragging');
    });

    dom.canvas.addEventListener('mouseleave', () => {
      endCameraDrag();
      dom.canvas.classList.remove('dragging');
      if (world.hover) {
        world.hover = null;
        Renderer.markDirty(true, false);
      }
    });

    dom.canvas.addEventListener('click', (event) => {
      if (camera.movedWhileDragging) {
        camera.movedWhileDragging = false;
        return;
      }
      const pos = getCanvasMousePosition(event);
      input.mouseX = pos.x;
      input.mouseY = pos.y;
      const picked = Renderer.pickTile(pos.x, pos.y);
      if (!picked) return;
      selectTileForInspection(picked);
    });

    dom.canvas.addEventListener('touchstart', (event) => {
      if (!event.touches || event.touches.length !== 1) return;
      const pos = getCanvasTouchPosition(event);
      if (!pos) return;
      event.preventDefault();
      input.mouseX = pos.x;
      input.mouseY = pos.y;
      beginCameraDrag(pos);
      dom.canvas.classList.add('dragging');
    }, { passive: false });

    dom.canvas.addEventListener('touchmove', (event) => {
      if (!camera.dragActive) return;
      const pos = getCanvasTouchPosition(event);
      if (!pos) return;
      event.preventDefault();
      input.mouseX = pos.x;
      input.mouseY = pos.y;
      applyDragDelta(pos, camera.touchDragMultiplier || 1);
    }, { passive: false });

    dom.canvas.addEventListener('touchend', (event) => {
      const pos = getCanvasTouchPosition(event);
      endCameraDrag();
      dom.canvas.classList.remove('dragging');
      if (!pos) return;
      input.mouseX = pos.x;
      input.mouseY = pos.y;
      if (camera.movedWhileDragging) {
        camera.movedWhileDragging = false;
        return;
      }

      const picked = Renderer.pickTile(pos.x, pos.y);
      if (!picked) return;
      selectTileForInspection(picked);
    }, { passive: false });

    dom.canvas.addEventListener('touchcancel', () => {
      endCameraDrag();
      camera.movedWhileDragging = false;
      dom.canvas.classList.remove('dragging');
    }, { passive: true });

    window.addEventListener('keydown', (event) => {
      if (!dom.settingsModal.classList.contains('hidden')) {
        if (event.key === 'Escape') UI.closeSettingsModal();
        return;
      }
      if (!dom.logModal.classList.contains('hidden')) {
        if (event.key === 'Escape') UI.closeLogModal();
        return;
      }
      if (isEditableKeyboardTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) event.preventDefault();
      input.keys.add(key);
    });

    window.addEventListener('keyup', (event) => {
      input.keys.delete(event.key.toLowerCase());
    });
  }

  function updateCameraFromKeyboard() {
    const input = State.input;
    const camera = State.camera;
    let moved = false;
    let renderDx = 0;
    let renderDz = 0;
    if (input.keys.has('w') || input.keys.has('arrowup')) { renderDz -= camera.moveSpeed; moved = true; }
    if (input.keys.has('s') || input.keys.has('arrowdown')) { renderDz += camera.moveSpeed; moved = true; }
    if (input.keys.has('a') || input.keys.has('arrowleft')) { renderDx -= camera.moveSpeed; moved = true; }
    if (input.keys.has('d') || input.keys.has('arrowright')) { renderDx += camera.moveSpeed; moved = true; }
    if (moved) {
      const pan = Renderer.convertRenderDeltaToCameraDelta(renderDx, renderDz);
      camera.x += pan.dx;
      camera.y += pan.dy;
    }
    if (moved) Renderer.markDirty();
  }

  function updateCameraInertia(deltaMs) {
    const camera = State.camera;
    if (camera.dragActive) return;
    const dt = Math.max(0.5, Math.min(32, Number(deltaMs) || 16.67));
    if (!camera.inertiaVelocityX && !camera.inertiaVelocityY) return;

    camera.x += camera.inertiaVelocityX * dt;
    camera.y += camera.inertiaVelocityY * dt;

    const friction = Math.pow(camera.inertiaFriction || 0.92, dt / 16.67);
    camera.inertiaVelocityX *= friction;
    camera.inertiaVelocityY *= friction;

    if (Math.abs(camera.inertiaVelocityX) < (camera.inertiaMinVelocity || 0.02)) camera.inertiaVelocityX = 0;
    if (Math.abs(camera.inertiaVelocityY) < (camera.inertiaMinVelocity || 0.02)) camera.inertiaVelocityY = 0;

    Renderer.markDirty();
  }

  function updatePlayerMovement(now) {
    const player = State.world.player;
    if (!player || !player.moving) return;
    const duration = Math.max(1, player.moveDuration || 180);
    player.progress = Math.min(1, (now - player.moveStartTime) / duration);
    if (player.progress >= 1) {
      player.row = player.targetRow;
      player.col = player.targetCol;
      player.moving = false;
      player.startRow = player.row;
      player.startCol = player.col;
      player.progress = 1;
      if (!advanceToNextQueuedStep(now)) Renderer.centerCamera();
    }
    Renderer.markDirty();
  }

  window.Game.Input = {
    bindInputEvents,
    updateCameraFromKeyboard,
    updateCameraInertia,
    updatePlayerMovement,
    buildPathToTarget,
    isBlockedTile
  };
})();