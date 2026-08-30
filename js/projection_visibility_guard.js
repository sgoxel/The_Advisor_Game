/*
  R04 / #329: presentation-only guard for world-to-screen projections.

  Renderer.gridToScreen historically exposes only finite x/y coordinates and drops
  the underlying clip-space visibility flag. Near the camera plane a behind-camera
  point can therefore produce very large finite coordinates; polygon overlays may
  then span the viewport. This wrapper rejects only projections that cannot
  round-trip through the authoritative Renderer screen-to-ground transform.
  Simulation/world state is untouched.
*/
(function installProjectionVisibilityGuard(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-projection-visibility-guard-v1';
  const ROUND_TRIP_EPSILON = 0.05;
  const INSTALL_RETRY_MS = 80;
  let installed = false;
  let retryTimer = null;
  let rejectedProjectionCount = 0;

  function validRoundTrip(Renderer, projected, row, col, offsetX, offsetY, tileWidth) {
    // screenToGridFloat uses the canonical tile width. Preserve any explicit
    // non-canonical compatibility projection unchanged rather than misclassify it.
    const canonicalTileWidth = Number(Game.State?.world?.tileWidth);
    if (Number.isFinite(Number(tileWidth)) && Number(tileWidth) !== canonicalTileWidth) return true;

    const screenX = Number(projected.x) - (Number(offsetX) || 0);
    const screenY = Number(projected.y) - (Number(offsetY) || 0);
    const roundTrip = Renderer.screenToGridFloat(screenX, screenY);
    if (!roundTrip || !Number.isFinite(Number(roundTrip.row)) || !Number.isFinite(Number(roundTrip.col))) return false;

    return Math.abs(Number(roundTrip.row) - Number(row)) <= ROUND_TRIP_EPSILON &&
      Math.abs(Number(roundTrip.col) - Number(col)) <= ROUND_TRIP_EPSILON;
  }

  function install() {
    if (installed) return true;
    const Renderer = Game.Renderer;
    const canvas = Game.State?.dom?.canvas || global.document?.getElementById?.('gameCanvas');
    if (!Renderer || typeof Renderer.gridToScreen !== 'function' ||
        typeof Renderer.screenToGridFloat !== 'function' || !canvas) return false;

    const rawGridToScreen = Renderer.gridToScreen.bind(Renderer);
    Renderer.gridToScreen = function guardedGridToScreen(row, col, offsetX, offsetY, tileWidth) {
      const projected = rawGridToScreen(row, col, offsetX, offsetY, tileWidth);
      if (!projected || !Number.isFinite(Number(projected.x)) || !Number.isFinite(Number(projected.y))) return projected;

      if (!validRoundTrip(Renderer, projected, row, col, offsetX, offsetY, tileWidth)) {
        rejectedProjectionCount += 1;
        return { x: Number.NaN, y: Number.NaN, projectionVisible: false };
      }

      return { ...projected, projectionVisible: true };
    };

    Game.ProjectionVisibilityGuard = Object.freeze({
      version: VERSION,
      authority: 'presentation-only',
      install,
      snapshot() {
        return Object.freeze({
          version: VERSION,
          authority: 'presentation-only',
          installed,
          rejectedProjectionCount
        });
      }
    });

    installed = true;
    return true;
  }

  function initialize() {
    if (install()) {
      if (retryTimer !== null && typeof global.clearInterval === 'function') global.clearInterval(retryTimer);
      retryTimer = null;
      return;
    }

    if (retryTimer === null && typeof global.setInterval === 'function') {
      retryTimer = global.setInterval(() => {
        if (install()) {
          global.clearInterval(retryTimer);
          retryTimer = null;
        }
      }, INSTALL_RETRY_MS);
    }
  }

  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    global.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})(typeof window !== 'undefined' ? window : globalThis);
