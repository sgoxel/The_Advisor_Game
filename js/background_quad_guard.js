/*
  R04 / #244 + #319 + #329: bound camera-near clipping of the full-map background.

  The legacy Renderer submits the whole terrain background as two triangles. When
  close zoom brings part of that plane to/behind the camera near plane, WebGL can
  clip a triangle into a viewport-spanning textured wedge. The first guard split
  the plane into smaller patches; #329 showed that subdivision alone is not
  sufficient at close zoom. This version also rejects only patches that touch the
  camera near-plane safety band. Simulation/world state is untouched.
*/
(function installBackgroundQuadGuard(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-background-quad-guard-v2-near-plane';
  const MAX_SEGMENTS_PER_AXIS = 128;
  const TARGET_TILES_PER_SEGMENT = 1;
  const WORLD_ROTATION_DEGREES = 45;
  const CAMERA_FOV_DEGREES = 45;
  const WEBGL_NEAR_PLANE = 0.1;
  const INSTALL_RETRY_MS = 100;

  let installed = false;
  let retryTimer = null;
  let meshCache = null;
  let filteredMeshCache = null;

  function finite(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function finiteArrayLike(value, expectedLength) {
    return value && typeof value.length === 'number' && value.length === expectedLength &&
      Array.from(value).every((entry) => Number.isFinite(Number(entry)));
  }

  function recommendedSegments(colsInput, rowsInput) {
    const cols = Math.max(1, Number(colsInput) || 1);
    const rows = Math.max(1, Number(rowsInput) || 1);
    return Object.freeze({
      x: Math.max(1, Math.min(MAX_SEGMENTS_PER_AXIS, Math.ceil(cols / TARGET_TILES_PER_SEGMENT))),
      z: Math.max(1, Math.min(MAX_SEGMENTS_PER_AXIS, Math.ceil(rows / TARGET_TILES_PER_SEGMENT)))
    });
  }

  function readVec3(array, vertexIndex) {
    const offset = vertexIndex * 3;
    return [Number(array[offset]), Number(array[offset + 1]), Number(array[offset + 2])];
  }

  function readVec2(array, vertexIndex) {
    const offset = vertexIndex * 2;
    return [Number(array[offset]), Number(array[offset + 1])];
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function bilerp(p00, p10, p01, p11, sx, sz) {
    const top = p00.map((value, index) => lerp(value, p10[index], sx));
    const bottom = p01.map((value, index) => lerp(value, p11[index], sx));
    return top.map((value, index) => lerp(value, bottom[index], sz));
  }

  function pushVertex(target, value) {
    for (let i = 0; i < value.length; i += 1) target.push(value[i]);
  }

  function buildSubdividedMesh(positionInput, texCoordInput, segmentsXInput, segmentsZInput) {
    if (!finiteArrayLike(positionInput, 18) || !finiteArrayLike(texCoordInput, 12)) return null;

    const segmentsX = Math.max(1, Math.trunc(Number(segmentsXInput) || 1));
    const segmentsZ = Math.max(1, Math.trunc(Number(segmentsZInput) || 1));

    // Legacy six-vertex layout: c00,c10,c01 / c01,c10,c11.
    const p00 = readVec3(positionInput, 0);
    const p10 = readVec3(positionInput, 1);
    const p01 = readVec3(positionInput, 2);
    const p11 = readVec3(positionInput, 5);
    const uv00 = readVec2(texCoordInput, 0);
    const uv10 = readVec2(texCoordInput, 1);
    const uv01 = readVec2(texCoordInput, 2);
    const uv11 = readVec2(texCoordInput, 5);

    const positions = [];
    const texCoords = [];

    for (let z = 0; z < segmentsZ; z += 1) {
      const z0 = z / segmentsZ;
      const z1 = (z + 1) / segmentsZ;
      for (let x = 0; x < segmentsX; x += 1) {
        const x0 = x / segmentsX;
        const x1 = (x + 1) / segmentsX;

        const q00 = bilerp(p00, p10, p01, p11, x0, z0);
        const q10 = bilerp(p00, p10, p01, p11, x1, z0);
        const q01 = bilerp(p00, p10, p01, p11, x0, z1);
        const q11 = bilerp(p00, p10, p01, p11, x1, z1);
        const t00 = bilerp(uv00, uv10, uv01, uv11, x0, z0);
        const t10 = bilerp(uv00, uv10, uv01, uv11, x1, z0);
        const t01 = bilerp(uv00, uv10, uv01, uv11, x0, z1);
        const t11 = bilerp(uv00, uv10, uv01, uv11, x1, z1);

        for (const vertex of [q00, q10, q01, q01, q10, q11]) pushVertex(positions, vertex);
        for (const vertex of [t00, t10, t01, t01, t10, t11]) pushVertex(texCoords, vertex);
      }
    }

    return Object.freeze({
      positions: new Float32Array(positions),
      texCoords: new Float32Array(texCoords),
      segmentsX,
      segmentsZ,
      vertexCount: segmentsX * segmentsZ * 6
    });
  }

  function cacheKey(positionInput, texCoordInput, segmentsX, segmentsZ) {
    return `${segmentsX}x${segmentsZ}|${Array.from(positionInput).join(',')}|${Array.from(texCoordInput).join(',')}`;
  }

  function getOrBuildMesh(positionInput, texCoordInput) {
    const world = Game.State?.world || {};
    const segments = recommendedSegments(world.cols, world.rows);
    const key = cacheKey(positionInput, texCoordInput, segments.x, segments.z);
    if (meshCache && meshCache.key === key) return meshCache.mesh;
    const mesh = buildSubdividedMesh(positionInput, texCoordInput, segments.x, segments.z);
    meshCache = mesh ? { key, mesh } : null;
    filteredMeshCache = null;
    return mesh;
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

  function cameraBasis(positionInput) {
    if (!finiteArrayLike(positionInput, 18)) return null;
    const State = Game.State;
    const world = State?.world || {};
    const camera = State?.camera || {};
    const canvas = State?.dom?.canvas;
    if (!canvas) return null;

    const p00 = readVec3(positionInput, 0);
    const p10 = readVec3(positionInput, 1);
    const p01 = readVec3(positionInput, 2);
    const p11 = readVec3(positionInput, 5);
    const cols = Math.max(1, finite(world.cols, 1));
    const rows = Math.max(1, finite(world.rows, 1));
    const worldWidth = Math.max(0.001, Math.hypot(p10[0] - p00[0], p10[2] - p00[2]));
    const worldDepth = Math.max(0.001, Math.hypot(p01[0] - p00[0], p01[2] - p00[2]));
    const tileWidth = worldWidth / cols;
    const tileHeight = worldDepth / rows;
    const centerX = worldWidth * 0.5;
    const centerZ = worldDepth * 0.5;

    const targetLogicalX = centerX - finite(camera.x);
    const targetLogicalZ = centerZ - finite(camera.y);
    const target = rotateAroundCenter(
      targetLogicalX,
      targetLogicalZ,
      WORLD_ROTATION_DEGREES * Math.PI / 180,
      centerX,
      centerZ
    );

    const widthPx = Math.max(1, finite(canvas.clientWidth, canvas.width || 1));
    const heightPx = Math.max(1, finite(canvas.clientHeight, canvas.height || 1));
    const aspect = Math.max(0.001, widthPx / heightPx);
    const pitchDegrees = Math.max(1, Math.min(89.999, finite(camera.pitchAngle, 90)));
    const pitchRad = pitchDegrees * Math.PI / 180;
    const zoom = Math.max(finite(camera.zoom, 1), 0.01);
    const depthStrength = Math.max(0.05, finite(camera.depthStrength, 1));
    const fovY = CAMERA_FOV_DEGREES * Math.PI / 180;
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
    const fitWidthDistance = (worldWidth * 0.5) / Math.tan(fovX / 2);
    const projectedDepth = (worldDepth * 0.5) * Math.max(0.2, Math.sin(pitchRad));
    const fitDepthDistance = projectedDepth / Math.tan(fovY / 2);
    const distance = (Math.max(fitWidthDistance, fitDepthDistance) * (0.72 + depthStrength * 0.08)) / zoom;

    const eye = {
      x: target.x,
      y: Math.max(2, Math.sin(pitchRad) * distance),
      z: target.z + Math.max(2, Math.cos(pitchRad) * distance)
    };
    const fx = target.x - eye.x;
    const fy = -eye.y;
    const fz = target.z - eye.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    const forward = { x: fx / fl, y: fy / fl, z: fz / fl };
    const safeNearDepth = Math.max(WEBGL_NEAR_PLANE * 4, Math.min(tileWidth, tileHeight) * 0.55);

    return Object.freeze({
      eye,
      forward,
      safeNearDepth,
      tileWidth,
      tileHeight,
      zoom,
      pitchDegrees,
      aspect,
      cameraX: finite(camera.x),
      cameraY: finite(camera.y),
      worldWidth,
      worldDepth,
      p11
    });
  }

  function cameraDepth(basis, x, y, z) {
    return (x - basis.eye.x) * basis.forward.x +
      (y - basis.eye.y) * basis.forward.y +
      (z - basis.eye.z) * basis.forward.z;
  }

  function filterMeshForNearPlane(mesh, basis) {
    if (!mesh || !basis) return mesh;
    const positions = [];
    const texCoords = [];
    let rejectedTriangleCount = 0;
    let keptTriangleCount = 0;
    let minimumKeptDepth = Infinity;

    for (let vertex = 0; vertex < mesh.vertexCount; vertex += 3) {
      let safe = true;
      const depths = [];
      for (let local = 0; local < 3; local += 1) {
        const vi = vertex + local;
        const pi = vi * 3;
        const depth = cameraDepth(basis, mesh.positions[pi], mesh.positions[pi + 1], mesh.positions[pi + 2]);
        depths.push(depth);
        if (!Number.isFinite(depth) || depth <= basis.safeNearDepth) safe = false;
      }

      if (!safe) {
        rejectedTriangleCount += 1;
        continue;
      }

      keptTriangleCount += 1;
      minimumKeptDepth = Math.min(minimumKeptDepth, ...depths);
      for (let local = 0; local < 3; local += 1) {
        const vi = vertex + local;
        const pi = vi * 3;
        const ti = vi * 2;
        positions.push(mesh.positions[pi], mesh.positions[pi + 1], mesh.positions[pi + 2]);
        texCoords.push(mesh.texCoords[ti], mesh.texCoords[ti + 1]);
      }
    }

    return Object.freeze({
      positions: new Float32Array(positions),
      texCoords: new Float32Array(texCoords),
      segmentsX: mesh.segmentsX,
      segmentsZ: mesh.segmentsZ,
      vertexCount: positions.length / 3,
      sourceVertexCount: mesh.vertexCount,
      rejectedTriangleCount,
      keptTriangleCount,
      minimumKeptDepth: Number.isFinite(minimumKeptDepth) ? minimumKeptDepth : null,
      safeNearDepth: basis.safeNearDepth
    });
  }

  function filteredCacheKey(mesh, basis) {
    return [
      mesh.vertexCount,
      basis.cameraX.toFixed(4),
      basis.cameraY.toFixed(4),
      basis.zoom.toFixed(4),
      basis.pitchDegrees.toFixed(4),
      basis.aspect.toFixed(6),
      basis.safeNearDepth.toFixed(6)
    ].join('|');
  }

  function getCameraSafeMesh(mesh, positionInput) {
    const basis = cameraBasis(positionInput);
    if (!basis) return mesh;
    const key = filteredCacheKey(mesh, basis);
    if (filteredMeshCache?.key === key) return filteredMeshCache.mesh;
    const filtered = filterMeshForNearPlane(mesh, basis);
    filteredMeshCache = { key, mesh: filtered };
    return filtered;
  }

  function updateStats(mesh) {
    const render = Game.State?.render;
    if (!render || !mesh) return;
    const previous = render.backgroundMeshGuardStats || {};
    render.backgroundMeshGuardStats = Object.freeze({
      version: VERSION,
      authority: 'presentation-only',
      active: true,
      interceptCount: Math.max(0, Number(previous.interceptCount) || 0) + 1,
      segmentsX: mesh.segmentsX,
      segmentsZ: mesh.segmentsZ,
      vertexCount: mesh.vertexCount,
      sourceVertexCount: Number(mesh.sourceVertexCount) || mesh.vertexCount,
      legacyVertexCount: 6,
      rejectedTriangleCount: Math.max(0, Number(mesh.rejectedTriangleCount) || 0),
      keptTriangleCount: Math.max(0, Number(mesh.keptTriangleCount) || Math.floor(mesh.vertexCount / 3)),
      minimumKeptDepth: mesh.minimumKeptDepth == null ? null : Number(mesh.minimumKeptDepth),
      safeNearDepth: Math.max(0, Number(mesh.safeNearDepth) || 0),
      nearPlaneCullActive: true,
      worldCols: Number(Game.State?.world?.cols) || 0,
      worldRows: Number(Game.State?.world?.rows) || 0,
      zoom: Number(Game.State?.camera?.zoom) || 0
    });
  }

  function renderWithSubdivision(previousRenderWorld, force) {
    const State = Game.State;
    const gl = State?.dom?.gl;
    const render = State?.render;
    if (!gl || !render?.textureProgram || !render?.texturePositionBuffer || !render?.textureCoordBuffer || !render?.backgroundTexture) {
      return previousRenderWorld(force);
    }

    const originalBufferData = gl.bufferData.bind(gl);
    const originalDrawArrays = gl.drawArrays.bind(gl);
    let capturedPositions = null;
    let capturedTexCoords = null;

    function guardedBufferData(target, data, usage) {
      if (target === gl.ARRAY_BUFFER && data && typeof data.length === 'number') {
        let binding = null;
        try { binding = gl.getParameter(gl.ARRAY_BUFFER_BINDING); } catch (error) { binding = null; }
        if (binding === render.texturePositionBuffer && data.length === 18) capturedPositions = new Float32Array(data);
        if (binding === render.textureCoordBuffer && data.length === 12) capturedTexCoords = new Float32Array(data);
      }
      return originalBufferData(target, data, usage);
    }

    function guardedDrawArrays(mode, first, count) {
      let currentProgram = null;
      let currentTexture = null;
      try {
        currentProgram = gl.getParameter(gl.CURRENT_PROGRAM);
        currentTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
      } catch (error) {
        return originalDrawArrays(mode, first, count);
      }

      const isLegacyBackgroundDraw = mode === gl.TRIANGLES && first === 0 && count === 6 &&
        currentProgram === render.textureProgram && currentTexture === render.backgroundTexture &&
        capturedPositions && capturedTexCoords;

      if (!isLegacyBackgroundDraw) return originalDrawArrays(mode, first, count);

      const subdivided = getOrBuildMesh(capturedPositions, capturedTexCoords);
      if (!subdivided || subdivided.vertexCount <= 6) return originalDrawArrays(mode, first, count);
      const mesh = getCameraSafeMesh(subdivided, capturedPositions);
      if (!mesh) return originalDrawArrays(mode, first, count);

      let previousArrayBinding = null;
      try { previousArrayBinding = gl.getParameter(gl.ARRAY_BUFFER_BINDING); } catch (error) { previousArrayBinding = null; }

      gl.bindBuffer(gl.ARRAY_BUFFER, render.texturePositionBuffer);
      originalBufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STREAM_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, render.textureCoordBuffer);
      originalBufferData(gl.ARRAY_BUFFER, mesh.texCoords, gl.STREAM_DRAW);

      let result;
      if (mesh.vertexCount > 0) result = originalDrawArrays(mode, 0, mesh.vertexCount);
      updateStats(mesh);

      // Restore the legacy payload so later renderer paths cannot accidentally
      // consume the guarded mesh without explicitly entering this interception.
      gl.bindBuffer(gl.ARRAY_BUFFER, render.texturePositionBuffer);
      originalBufferData(gl.ARRAY_BUFFER, capturedPositions, gl.STREAM_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, render.textureCoordBuffer);
      originalBufferData(gl.ARRAY_BUFFER, capturedTexCoords, gl.STREAM_DRAW);
      if (previousArrayBinding) gl.bindBuffer(gl.ARRAY_BUFFER, previousArrayBinding);

      return result;
    }

    try {
      gl.bufferData = guardedBufferData;
      gl.drawArrays = guardedDrawArrays;
      return previousRenderWorld(force);
    } finally {
      gl.bufferData = originalBufferData;
      gl.drawArrays = originalDrawArrays;
    }
  }

  function install() {
    if (installed) return true;
    const Renderer = Game.Renderer;
    if (!Renderer || typeof Renderer.renderWorld !== 'function') return false;

    const previousRenderWorld = Renderer.renderWorld.bind(Renderer);
    Renderer.renderWorld = function backgroundQuadGuardedRenderWorld(force) {
      return renderWithSubdivision(previousRenderWorld, force);
    };

    Game.BackgroundQuadGuard = Object.freeze({
      version: VERSION,
      authority: 'presentation-only',
      recommendedSegments,
      buildSubdividedMesh,
      cameraBasis,
      filterMeshForNearPlane,
      install,
      snapshot() {
        return Game.State?.render?.backgroundMeshGuardStats || Object.freeze({
          version: VERSION,
          authority: 'presentation-only',
          active: false,
          interceptCount: 0,
          vertexCount: 0,
          legacyVertexCount: 6,
          rejectedTriangleCount: 0,
          nearPlaneCullActive: true
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
