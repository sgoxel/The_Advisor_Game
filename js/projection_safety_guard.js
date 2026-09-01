/*
  R04 / #329: presentation-only projection safety guard.

  Canvas/DOM presentation layers consume Renderer.gridToScreen(). At close zoom,
  points on the ground can approach or cross the camera near plane. The legacy
  projection returned enormous finite screen coordinates in that case, so later
  2D transforms/polygons could expand across the viewport. This guard rejects
  only those unsafe presentation projections; Simulation/world coordinates are
  never changed.
*/
(function installProjectionSafetyGuard(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-projection-safety-guard-v1';
  const WORLD_ROTATION_DEGREES = 45;
  const CAMERA_FOV_DEGREES = 45;
  const WEBGL_NEAR_PLANE = 0.1;
  const INSTALL_RETRY_MS = 100;

  let retryTimer = null;
  let rejectedCount = 0;

  function finite(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function degToRad(value) {
    return finite(value) * Math.PI / 180;
  }

  function rotateAroundCenter(x, z, angleRad, centerX, centerZ) {
    const dx = x - centerX;
    const dz = z - centerZ;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    return {
      x: centerX + dx * cosA - dz * sinA,
      z: centerZ + dx * sinA + dz * cosA
    };
  }

  function cameraBasis(tileWidthInput) {
    const State = Game.State;
    const Renderer = Game.Renderer;
    const world = State?.world;
    const camera = State?.camera;
    const canvas = State?.dom?.canvas;
    if (!world || !camera || !canvas || !Renderer?.getGridMetrics) return null;

    const metrics = Renderer.getGridMetrics(tileWidthInput);
    const tileWidth = Math.max(0.001, finite(metrics?.tileWidth, finite(world.tileWidth, 1)));
    const tileHeight = Math.max(0.001, finite(metrics?.tileHeight, tileWidth));
    const width = Math.max(tileWidth, finite(world.cols, 1) * tileWidth);
    const depth = Math.max(tileHeight, finite(world.rows, 1) * tileHeight);
    const centerX = width * 0.5;
    const centerZ = depth * 0.5;
    const targetLogicalX = centerX - finite(camera.x);
    const targetLogicalZ = centerZ - finite(camera.y);
    const target = rotateAroundCenter(
      targetLogicalX,
      targetLogicalZ,
      degToRad(WORLD_ROTATION_DEGREES),
      centerX,
      centerZ
    );

    const aspect = Math.max(0.001, finite(canvas.clientWidth, canvas.width || 1) / Math.max(1, finite(canvas.clientHeight, canvas.height || 1)));
    const pitchDegrees = Math.max(1, Math.min(89.999, finite(camera.pitchAngle, 90)));
    const pitchRad = degToRad(pitchDegrees);
    const zoom = Math.max(finite(camera.zoom, 1), 0.01);
    const depthStrength = Math.max(0.05, finite(camera.depthStrength, 1));
    const fovY = degToRad(CAMERA_FOV_DEGREES);
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
    const fitWidthDistance = (width * 0.5) / Math.tan(fovX / 2);
    const projectedDepth = (depth * 0.5) * Math.max(0.2, Math.sin(pitchRad));
    const fitDepthDistance = projectedDepth / Math.tan(fovY / 2);
    const baseDistance = Math.max(fitWidthDistance, fitDepthDistance);
    const distance = (baseDistance * (0.72 + depthStrength * 0.08)) / zoom;

    const eye = {
      x: target.x,
      y: Math.max(2, Math.sin(pitchRad) * distance),
      z: target.z + Math.max(2, Math.cos(pitchRad) * distance)
    };
    const forwardRaw = {
      x: target.x - eye.x,
      y: -eye.y,
      z: target.z - eye.z
    };
    const forwardLength = Math.hypot(forwardRaw.x, forwardRaw.y, forwardRaw.z) || 1;
    const forward = {
      x: forwardRaw.x / forwardLength,
      y: forwardRaw.y / forwardLength,
      z: forwardRaw.z / forwardLength
    };

    // A half-tile margin prevents 2D basis vectors from exploding even when a
    // point is technically just in front of WebGL's 0.1 near plane.
    const safeNearDepth = Math.max(WEBGL_NEAR_PLANE * 4, Math.min(tileWidth, tileHeight) * 0.55);

    return Object.freeze({
      tileWidth,
      tileHeight,
      width,
      depth,
      centerX,
      centerZ,
      target,
      eye,
      forward,
      safeNearDepth,
      zoom,
      pitchDegrees,
      aspect
    });
  }

  function classifyWorldPoint(worldXInput, worldZInput, tileWidthInput) {
    const basis = cameraBasis(tileWidthInput);
    if (!basis) return Object.freeze({ safe: true, reason: 'basis-unavailable', cameraDepth: Infinity });

    const worldX = finite(worldXInput, NaN);
    const worldZ = finite(worldZInput, NaN);
    if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
      return Object.freeze({ safe: false, reason: 'non-finite-world-point', cameraDepth: -Infinity, safeNearDepth: basis.safeNearDepth });
    }

    const renderPoint = rotateAroundCenter(
      worldX,
      worldZ,
      degToRad(WORLD_ROTATION_DEGREES),
      basis.centerX,
      basis.centerZ
    );
    const dx = renderPoint.x - basis.eye.x;
    const dy = -basis.eye.y;
    const dz = renderPoint.z - basis.eye.z;
    const cameraDepth = dx * basis.forward.x + dy * basis.forward.y + dz * basis.forward.z;
    const safe = Number.isFinite(cameraDepth) && cameraDepth > basis.safeNearDepth;

    return Object.freeze({
      safe,
      reason: safe ? 'safe' : 'near-or-behind-camera',
      cameraDepth,
      safeNearDepth: basis.safeNearDepth,
      zoom: basis.zoom,
      pitchDegrees: basis.pitchDegrees
    });
  }

  function classifyGridPoint(rowInput, colInput, tileWidthInput) {
    const Renderer = Game.Renderer;
    const world = Game.State?.world;
    if (!Renderer?.getGridMetrics || !world) return Object.freeze({ safe: true, reason: 'renderer-unavailable', cameraDepth: Infinity });
    const metrics = Renderer.getGridMetrics(tileWidthInput);
    const tileWidth = Math.max(0.001, finite(metrics?.tileWidth, finite(world.tileWidth, 1)));
    const tileHeight = Math.max(0.001, finite(metrics?.tileHeight, tileWidth));
    const row = finite(rowInput, NaN);
    const col = finite(colInput, NaN);
    if (!Number.isFinite(row) || !Number.isFinite(col)) {
      return Object.freeze({ safe: false, reason: 'non-finite-grid-point', cameraDepth: -Infinity });
    }
    return classifyWorldPoint(col * tileWidth + tileWidth * 0.5, row * tileHeight + tileHeight * 0.5, tileWidthInput);
  }

  function invalidProjection(classification) {
    rejectedCount += 1;
    const State = Game.State;
    if (State?.render) {
      State.render.projectionSafetyStats = Object.freeze({
        version: VERSION,
        authority: 'presentation-only',
        rejectedCount,
        lastReason: classification?.reason || 'unsafe',
        lastCameraDepth: finite(classification?.cameraDepth, -1),
        safeNearDepth: finite(classification?.safeNearDepth, 0),
        zoom: finite(State.camera?.zoom, 0)
      });
    }
    return Object.freeze({
      x: Number.NaN,
      y: Number.NaN,
      visible: false,
      projectionRejected: true,
      cameraDepth: classification?.cameraDepth
    });
  }

  function install() {
    const Renderer = Game.Renderer;
    if (!Renderer || typeof Renderer.gridToScreen !== 'function') return false;
    const current = Renderer.gridToScreen;
    if (current.__projectionSafetyGuard === VERSION) return true;

    const source = current.bind(Renderer);
    const wrapped = function projectionSafeGridToScreen(row, col, offsetX, offsetY, tileWidth) {
      const classification = classifyGridPoint(row, col, tileWidth);
      if (!classification.safe) return invalidProjection(classification);
      const projected = source(row, col, offsetX, offsetY, tileWidth);
      if (!projected || !Number.isFinite(Number(projected.x)) || !Number.isFinite(Number(projected.y))) {
        return invalidProjection(Object.freeze({
          safe: false,
          reason: 'non-finite-screen-projection',
          cameraDepth: classification.cameraDepth,
          safeNearDepth: classification.safeNearDepth
        }));
      }
      if (projected.visible === false) return invalidProjection(classification);
      return Object.assign({}, projected, { visible: true, projectionRejected: false, cameraDepth: classification.cameraDepth });
    };
    Object.defineProperty(wrapped, '__projectionSafetyGuard', { value: VERSION });
    Object.defineProperty(wrapped, '__projectionSafetySource', { value: current });
    Renderer.gridToScreen = wrapped;

    Game.ProjectionSafetyGuard = Object.freeze({
      version: VERSION,
      authority: 'presentation-only',
      install,
      cameraBasis,
      classifyWorldPoint,
      classifyGridPoint,
      snapshot() {
        return Game.State?.render?.projectionSafetyStats || Object.freeze({
          version: VERSION,
          authority: 'presentation-only',
          rejectedCount,
          lastReason: null
        });
      }
    });
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
