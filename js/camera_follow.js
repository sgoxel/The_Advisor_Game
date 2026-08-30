window.Game = window.Game || {};

(function () {
  const State = window.Game.State;
  const Renderer = window.Game.Renderer;
  if (!State || !Renderer) return;

  const FOLLOW_TIME_CONSTANT_MS = 180;
  const MIN_FRAME_MS = 8;
  const MAX_FRAME_MS = 50;
  const SNAP_EPSILON = 0.01;
  let lastFollowTime = 0;

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

  function updateCameraFollow() {
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
  document.addEventListener('DOMContentLoaded', prepareCharacterActivation, { once: true });

  Renderer.updateCameraFollow = updateCameraFollow;
  window.Game.CameraFollow = {
    suspend,
    resume,
    update: updateCameraFollow,
    isFollowing: () => Boolean(State.camera && State.camera.followPlayer)
  };
})();
