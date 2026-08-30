/*
  R04 / #244 + #319: bound camera-near clipping of the full-map background.

  The legacy Renderer submits the whole terrain background as two triangles. When
  the camera approaches/intersects that plane, WebGL near-plane clipping can
  stretch one triangle across most of the viewport. This presentation-only guard
  intercepts only that exact six-vertex background draw and replaces it with a
  cached, UV-continuous subdivided mesh. Simulation/world state is untouched.
*/
(function installBackgroundQuadGuard(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const VERSION = 'r04-background-quad-guard-v1';
  const MAX_SEGMENTS_PER_AXIS = 48;
  const TARGET_TILES_PER_SEGMENT = 2.5;
  const INSTALL_RETRY_MS = 100;

  let installed = false;
  let retryTimer = null;
  let meshCache = null;

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

  function bilerp4(p00, p10, p01, p11, sx, sz) {
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

    // Legacy six-vertex layout:
    // c00,c10,c01 / c01,c10,c11.
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

        const q00 = bilerp4(p00, p10, p01, p11, x0, z0);
        const q10 = bilerp4(p00, p10, p01, p11, x1, z0);
        const q01 = bilerp4(p00, p10, p01, p11, x0, z1);
        const q11 = bilerp4(p00, p10, p01, p11, x1, z1);
        const t00 = bilerp4(uv00, uv10, uv01, uv11, x0, z0);
        const t10 = bilerp4(uv00, uv10, uv01, uv11, x1, z0);
        const t01 = bilerp4(uv00, uv10, uv01, uv11, x0, z1);
        const t11 = bilerp4(uv00, uv10, uv01, uv11, x1, z1);

        // Preserve the original winding on every patch.
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
    const State = Game.State;
    const world = State?.world || {};
    const segments = recommendedSegments(world.cols, world.rows);
    const key = cacheKey(positionInput, texCoordInput, segments.x, segments.z);
    if (meshCache && meshCache.key === key) return meshCache.mesh;
    const mesh = buildSubdividedMesh(positionInput, texCoordInput, segments.x, segments.z);
    meshCache = mesh ? { key, mesh } : null;
    return mesh;
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
      legacyVertexCount: 6,
      worldCols: Number(Game.State?.world?.cols) || 0,
      worldRows: Number(Game.State?.world?.rows) || 0
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

      const mesh = getOrBuildMesh(capturedPositions, capturedTexCoords);
      if (!mesh || mesh.vertexCount <= 6) return originalDrawArrays(mode, first, count);

      let previousArrayBinding = null;
      try { previousArrayBinding = gl.getParameter(gl.ARRAY_BUFFER_BINDING); } catch (error) { previousArrayBinding = null; }

      // Attribute pointers already reference these two buffer objects. Replacing
      // their data preserves the shader/matrix state established by Renderer.
      gl.bindBuffer(gl.ARRAY_BUFFER, render.texturePositionBuffer);
      originalBufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STREAM_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, render.textureCoordBuffer);
      originalBufferData(gl.ARRAY_BUFFER, mesh.texCoords, gl.STREAM_DRAW);

      const result = originalDrawArrays(mode, 0, mesh.vertexCount);
      updateStats(mesh);

      // Restore the legacy buffer payload immediately so no later renderer path
      // can accidentally consume the subdivided data without explicitly opting in.
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
      install,
      snapshot() {
        return Game.State?.render?.backgroundMeshGuardStats || Object.freeze({
          version: VERSION,
          authority: 'presentation-only',
          active: false,
          interceptCount: 0,
          vertexCount: 0,
          legacyVertexCount: 6
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
