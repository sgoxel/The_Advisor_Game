window.Game = window.Game || {};

(function () {
  const State = window.Game.State;
  const Renderer = window.Game.Renderer;
  if (!State || !Renderer) return;

  const FOLLOW_TIME_CONSTANT_MS = 180;
  const MIN_FRAME_MS = 8;
  const MAX_FRAME_MS = 50;
  const SNAP_EPSILON = 0.01;
  const STATUS_LABELS = Object.freeze({
    working: 'Working',
    work: 'Working',
    social: 'Chatting',
    socializing: 'Chatting',
    chatting: 'Chatting',
    eating: 'Eating',
    meal: 'Eating',
    shopping: 'Shopping',
    market: 'Shopping',
    sleeping: 'Sleeping',
    sleep: 'Sleeping',
    resting: 'Resting',
    rest: 'Resting',
    returning: 'Returning Home',
    home: 'Returning Home',
    idle: 'Resting'
  });
  let lastFollowTime = 0;
  let statusBubble = null;
  let statusStyleInstalled = false;

  function markCameraDirty() {
    if (typeof Renderer.markDirty === 'function') Renderer.markDirty(false, true);
  }

  function suspend(reason) {
    if (!State.camera) return;
    State.camera.followPlayer = false;
    State.camera.followSuspendReason = String(reason || 'manual');
    lastFollowTime = 0;
  }

  function resume() {
    if (!State.camera) return;
    State.camera.followPlayer = true;
    State.camera.followSuspendReason = '';
    lastFollowTime = performance.now();
    markCameraDirty();
  }

  function getFollowTarget() {
    const camera = State.camera;
    if (!camera || typeof Renderer.centerCamera !== 'function') return null;
    const startX = camera.x;
    const startY = camera.y;
    Renderer.centerCamera();
    const target = { x: camera.x, y: camera.y };
    camera.x = startX;
    camera.y = startY;
    return target;
  }

  function playerPresentationPosition(player) {
    if (!player) return null;
    if (player.moving && [player.startRow, player.startCol, player.targetRow, player.targetCol].every(Number.isFinite)) {
      const t = Math.max(0, Math.min(1, Number(player.progress) || 0));
      return {
        row: player.startRow + (player.targetRow - player.startRow) * t,
        col: player.startCol + (player.targetCol - player.startCol) * t
      };
    }
    const row = Number(player.row);
    const col = Number(player.col);
    return Number.isFinite(row) && Number.isFinite(col) ? { row, col } : null;
  }

  function normalizeActivity(value) {
    return String(value || '').trim().toLowerCase().replace(/[ _-]+/g, '');
  }

  function currentStatusSemantic() {
    const player = State.world?.player;
    if (!player) return null;
    if (player.moving) return Object.freeze({ key: 'walking', label: 'Walking', source: 'authoritative-movement' });

    const dialogueActive = Boolean(player.inDialogue || player.dialogueActive || State.dialogue?.active);
    if (dialogueActive) return Object.freeze({ key: 'chatting', label: 'Chatting', source: 'authoritative-dialogue' });

    const routine = State.protagonistRoutine || player.dailyRoutine || null;
    const candidates = [
      player.currentActivity,
      player.activity,
      player.intent?.activity,
      routine?.activity,
      routine?.anchor
    ];
    for (const candidate of candidates) {
      const raw = String(candidate || '').trim();
      if (!raw) continue;
      const key = normalizeActivity(raw);
      const mapped = STATUS_LABELS[key];
      if (mapped) return Object.freeze({ key, label: mapped, source: candidate === routine?.activity || candidate === routine?.anchor ? 'authoritative-routine' : 'authoritative-player-state' });
      if (/walk|travel|move|commut|path/.test(key)) return Object.freeze({ key: 'walking', label: 'Walking', source: 'authoritative-player-state' });
      if (/work|mill|smith|farm|guard|bake|trade/.test(key)) return Object.freeze({ key: 'working', label: 'Working', source: 'authoritative-player-state' });
      if (/chat|dialog|social|talk/.test(key)) return Object.freeze({ key: 'chatting', label: 'Chatting', source: 'authoritative-player-state' });
      if (/sleep/.test(key)) return Object.freeze({ key: 'sleeping', label: 'Sleeping', source: 'authoritative-player-state' });
      if (/rest|idle|wait/.test(key)) return Object.freeze({ key: 'resting', label: 'Resting', source: 'authoritative-player-state' });
    }
    return null;
  }

  function ensureStatusStyle() {
    if (statusStyleInstalled || document.getElementById('protagonist-status-bubble-style')) return;
    const style = document.createElement('style');
    style.id = 'protagonist-status-bubble-style';
    style.textContent = `
      #protagonist-status-bubble{position:absolute;z-index:8;pointer-events:none;max-width:min(180px,45vw);padding:4px 8px;border:1px solid rgba(244,247,251,.85);border-radius:999px;background:rgba(12,17,24,.84);color:#f4f7fb;font:600 11px/1.2 system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transform:translate(-50%,-100%);box-shadow:0 1px 5px rgba(0,0,0,.3)}
      #protagonist-status-bubble[hidden]{display:none}
      @media (max-width:700px){#protagonist-status-bubble{font-size:12px;max-width:min(160px,52vw)}}
      @media (prefers-reduced-motion:reduce){#protagonist-status-bubble{transition:none!important;animation:none!important}}
    `;
    document.head.appendChild(style);
    statusStyleInstalled = true;
  }

  function ensureStatusBubble() {
    if (statusBubble?.isConnected) return statusBubble;
    const center = document.getElementById('center-area');
    if (!center) return null;
    ensureStatusStyle();
    statusBubble = document.createElement('div');
    statusBubble.id = 'protagonist-status-bubble';
    statusBubble.setAttribute('role', 'status');
    statusBubble.setAttribute('aria-live', 'polite');
    statusBubble.setAttribute('aria-atomic', 'true');
    statusBubble.dataset.presentationAuthority = 'presentation-only';
    statusBubble.hidden = true;
    center.appendChild(statusBubble);
    return statusBubble;
  }

  function updateStatusBubble() {
    const bubble = ensureStatusBubble();
    if (!bubble) return null;
    const semantic = currentStatusSemantic();
    const position = playerPresentationPosition(State.world?.player);
    if (!semantic || !position || typeof Renderer.gridToScreen !== 'function') {
      bubble.hidden = true;
      bubble.dataset.activity = '';
      return null;
    }
    const point = Renderer.gridToScreen(position.row, position.col, 0, 0);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      bubble.hidden = true;
      return null;
    }
    const zoom = Math.max(0.1, Number(State.camera?.zoom) || 1);
    const verticalOffset = Math.max(38, Math.min(72, 48 * Math.sqrt(zoom)));
    bubble.textContent = semantic.label;
    bubble.dataset.activity = semantic.key;
    bubble.dataset.source = semantic.source;
    bubble.style.left = `${point.x}px`;
    bubble.style.top = `${point.y - verticalOffset}px`;
    bubble.hidden = false;
    return semantic;
  }

  function updateCameraFollow() {
    updateStatusBubble();
    const camera = State.camera;
    if (!camera || !camera.followPlayer || camera.dragActive || !State.world || !State.world.player) {
      lastFollowTime = 0;
      return;
    }

    const target = getFollowTarget();
    if (!target) return;

    const now = performance.now();
    const dt = Math.max(MIN_FRAME_MS, Math.min(MAX_FRAME_MS, lastFollowTime ? now - lastFollowTime : 16.67));
    lastFollowTime = now;
    const alpha = 1 - Math.exp(-dt / FOLLOW_TIME_CONSTANT_MS);
    const dx = target.x - camera.x;
    const dy = target.y - camera.y;

    if (Math.abs(dx) <= SNAP_EPSILON && Math.abs(dy) <= SNAP_EPSILON) {
      camera.x = target.x;
      camera.y = target.y;
      return;
    }

    camera.x += dx * alpha;
    camera.y += dy * alpha;
    markCameraDirty();
  }

  function isEditableTarget(target) {
    return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
  }

  function isCharacterActivationTarget(target) {
    return target instanceof Element && Boolean(target.closest('.character-panel, [data-panel-target="character-panel"]'));
  }

  document.addEventListener('mousemove', (event) => {
    if (!State.camera || !State.camera.dragActive) return;
    if (Math.abs(event.movementX || 0) > 0 || Math.abs(event.movementY || 0) > 0) suspend('pointer-pan');
  }, true);

  document.addEventListener('touchmove', () => {
    if (State.camera && State.camera.dragActive) suspend('touch-pan');
  }, { capture: true, passive: true });

  document.addEventListener('keydown', (event) => {
    if (isCharacterActivationTarget(event.target) && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      resume();
      return;
    }
    if (isEditableTarget(event.target)) return;
    const key = String(event.key || '').toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) suspend('keyboard-pan');
  }, true);

  document.addEventListener('click', (event) => {
    if (isCharacterActivationTarget(event.target)) {
      const directPanelActivation = event.target instanceof Element && Boolean(event.target.closest('.character-panel'));
      if (directPanelActivation) event.stopPropagation();
      resume();
      return;
    }
    if (event.target instanceof Element && event.target.closest('#minimap')) suspend('minimap-pan');
  }, true);

  function prepareCharacterActivation() {
    const panel = document.querySelector('.character-panel');
    if (!panel) return;
    if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '0');
    if (!panel.hasAttribute('role')) panel.setAttribute('role', 'button');
    if (!panel.hasAttribute('aria-label')) panel.setAttribute('aria-label', 'Center camera on protagonist and resume follow');
  }

  prepareCharacterActivation();
  updateStatusBubble();
  document.addEventListener('DOMContentLoaded', () => {
    prepareCharacterActivation();
    updateStatusBubble();
  }, { once: true });

  Renderer.updateCameraFollow = updateCameraFollow;
  window.Game.CameraFollow = {
    suspend,
    resume,
    update: updateCameraFollow,
    isFollowing: () => Boolean(State.camera && State.camera.followPlayer)
  };
  window.Game.ProtagonistStatusBubble = Object.freeze({
    authority: 'presentation-only',
    semantic: currentStatusSemantic,
    update: updateStatusBubble
  });
})();
