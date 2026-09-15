(function installShorelineTransitionRuntime(root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.Game = root.Game || {};
    root.Game.ShorelineTransitionRuntime = api;
    api.initialize(root.Game);
  }
})(typeof window !== 'undefined' ? window : globalThis, function shorelineTransitionFactory() {
  'use strict';

  const VERSION = 'wp102-i05-shoreline-runtime-v1';
  const WATER_TYPES = new Set(['lake', 'river', 'water', 'ocean', 'sea', 'deep_water']);
  const EDGE_NAMES = Object.freeze(['N', 'E', 'S', 'W']);
  const CORNER_NAMES = Object.freeze(['NW', 'NE', 'SE', 'SW']);
  const EDGE_SAMPLES = Object.freeze([
    Object.freeze([[-1, -1], [-1, 0], [-1, 1]]),
    Object.freeze([[-1, 1], [0, 1], [1, 1]]),
    Object.freeze([[1, -1], [1, 0], [1, 1]]),
    Object.freeze([[-1, -1], [0, -1], [1, -1]])
  ]);
  const CORNER_SAMPLES = Object.freeze([
    Object.freeze([[-1, -1], [-1, 0], [0, -1], [0, 0]]),
    Object.freeze([[-1, 1], [-1, 0], [0, 1], [0, 0]]),
    Object.freeze([[1, 1], [1, 0], [0, 1], [0, 0]]),
    Object.freeze([[1, -1], [1, 0], [0, -1], [0, 0]])
  ]);

  let installed = false;
  let semantics = null;
  let semanticsPromise = null;
  let gameRef = null;
  let priorRenderWorld = null;
  let appliedTiles = 0;
  let lastReason = 'not-ready';
  let lastError = null;

  function normalizedType(tileOrType) {
    const value = typeof tileOrType === 'string' ? tileOrType : tileOrType && tileOrType.type;
    return String(value || '').trim().toLowerCase();
  }

  function isWaterType(tileOrType) {
    const tile = typeof tileOrType === 'object' && tileOrType ? tileOrType : null;
    return Boolean(tile && tile.water === true) || WATER_TYPES.has(normalizedType(tileOrType));
  }

  function classifyEdge(value, policy = {}) {
    const fraction = Math.max(0, Math.min(1, Number(value) || 0));
    const landMax = Number.isFinite(Number(policy.landMaxWaterFraction)) ? Number(policy.landMaxWaterFraction) : 0.25;
    const waterMin = Number.isFinite(Number(policy.waterMinWaterFraction)) ? Number(policy.waterMinWaterFraction) : 0.75;
    if (fraction <= landMax) return 'L';
    if (fraction >= waterMin) return 'W';
    return 'M';
  }

  function sampleWater(terrain, row, col, fallbackWater) {
    if (!Array.isArray(terrain) || row < 0 || col < 0 || row >= terrain.length || !Array.isArray(terrain[row]) || col >= terrain[row].length) {
      return fallbackWater ? 1 : 0;
    }
    return isWaterType(terrain[row][col]) ? 1 : 0;
  }

  function buildTarget(terrain, row, col, policy = {}) {
    const center = terrain && terrain[row] && terrain[row][col];
    if (!isWaterType(center)) return null;

    const cardinalOffsets = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    const cardinalWater = cardinalOffsets.map(([dr, dc]) => sampleWater(terrain, row + dr, col + dc, true));
    if (cardinalWater.every(Boolean)) return null;

    const edgeWater = EDGE_SAMPLES.map((samples) => {
      const sum = samples.reduce((total, [dr, dc]) => total + sampleWater(terrain, row + dr, col + dc, true), 0);
      return sum / samples.length;
    });
    const edges = edgeWater.map((value) => classifyEdge(value, policy)).join('');
    const cornerThreshold = Number.isFinite(Number(policy.cornerWaterThreshold)) ? Number(policy.cornerWaterThreshold) : 0.5;
    const cornerWater = CORNER_SAMPLES.map((samples) => {
      const sum = samples.reduce((total, [dr, dc]) => total + sampleWater(terrain, row + dr, col + dc, true), 0);
      return sum / samples.length;
    });
    const corners = cornerWater.map((value) => value >= cornerThreshold ? 'W' : 'L').join('');
    return Object.freeze({ row, col, edges, corners, edgeWater: Object.freeze(edgeWater), cornerWater: Object.freeze(cornerWater) });
  }

  function validateSemantics(data) {
    if (!data || data.family !== 'shoreline' || !Array.isArray(data.tiles) || data.tiles.length === 0) {
      throw new Error('Invalid shoreline semantics metadata.');
    }
    if (data.policy && data.policy.compositionMode !== 'opaque-base-transition') {
      throw new Error('Shoreline semantics must use opaque-base-transition composition.');
    }
    if (data.policy && data.policy.rotationAllowed !== false) {
      throw new Error('Shoreline runtime does not rotate source cells.');
    }
    const seen = new Set();
    for (const tile of data.tiles) {
      if (!tile || !/^r\d{2}_c\d{2}$/.test(String(tile.id || '')) || seen.has(tile.id)) throw new Error('Invalid or duplicate shoreline semantic id.');
      if (!/^[LMW]{4}$/.test(String(tile.edges || '')) || !/^[LW]{4}$/.test(String(tile.corners || ''))) throw new Error(`Invalid shoreline edge/corner signature for ${tile.id}.`);
      if (!Array.isArray(tile.edgeWater) || tile.edgeWater.length !== 4 || tile.edgeWater.some((value) => !Number.isFinite(Number(value)))) {
        throw new Error(`Invalid shoreline edge-water measurements for ${tile.id}.`);
      }
      seen.add(tile.id);
    }
    return data;
  }

  function scoreTile(tile, target) {
    if (!tile || !target) return Infinity;
    let score = 0;
    for (let index = 0; index < 4; index += 1) {
      const measured = Math.max(0, Math.min(1, Number(tile.edgeWater[index]) || 0));
      const delta = measured - target.edgeWater[index];
      score += delta * delta * 12;
      const wantedCode = target.edges[index];
      const candidateCode = String(tile.edges || '')[index];
      if (wantedCode !== 'M' && candidateCode !== wantedCode) score += candidateCode === 'M' ? 1.5 : 5;
      else if (wantedCode === 'M' && candidateCode !== 'M') score += 0.35;
    }
    for (let index = 0; index < 4; index += 1) {
      if (String(tile.corners || '')[index] !== target.corners[index]) score += 0.4;
    }
    return score;
  }

  function selectTile(data, terrain, row, col) {
    const validated = validateSemantics(data);
    const target = buildTarget(terrain, row, col, validated.policy || {});
    if (!target) return null;
    let winner = null;
    for (const tile of validated.tiles) {
      const score = scoreTile(tile, target);
      if (!winner || score < winner.score - 1e-9 || (Math.abs(score - winner.score) <= 1e-9 && String(tile.id).localeCompare(String(winner.tile.id)) < 0)) {
        winner = { tile, score };
      }
    }
    return winner ? Object.freeze({ id: winner.tile.id, tile: winner.tile, score: winner.score, target }) : null;
  }

  function semanticIndex(id) {
    const match = /^r(\d{2})_c(\d{2})$/.exec(String(id || ''));
    if (!match) return -1;
    const row = Number(match[1]);
    const col = Number(match[2]);
    if (row < 0 || row > 9 || col < 0 || col > 9) return -1;
    return row * 10 + col;
  }

  function loadSemantics() {
    if (semantics) return Promise.resolve(semantics);
    if (semanticsPromise) return semanticsPromise;
    if (typeof document === 'undefined' || typeof fetch !== 'function') return Promise.reject(new Error('Browser fetch is unavailable for shoreline semantics.'));
    const url = new URL('textures/tiles/shoreline/shoreline_tiles.semantics.json', document.baseURI).href;
    semanticsPromise = fetch(url, { credentials: 'same-origin' })
      .then((response) => {
        if (!response || !response.ok) throw new Error('Failed to load shoreline semantics metadata.');
        return response.json();
      })
      .then((data) => {
        semantics = validateSemantics(data);
        return semantics;
      })
      .catch((error) => {
        semanticsPromise = null;
        lastError = error;
        throw error;
      });
    return semanticsPromise;
  }

  function applyToBackground(reason = 'renderer-rebuild') {
    const Game = gameRef;
    const State = Game && Game.State;
    const render = State && State.render;
    const world = State && State.world;
    const background = render && render.worldBackgroundCanvas;
    const images = render && render.textureVariantImages && render.textureVariantImages.shoreline;
    if (!semantics || !background || !Array.isArray(images) || !images.length || !Array.isArray(world && world.terrain)) return 0;
    const ctx = background.getContext && background.getContext('2d');
    if (!ctx) return 0;
    const rows = Math.max(1, Math.trunc(Number(world.rows) || world.terrain.length || 100));
    const cols = Math.max(1, Math.trunc(Number(world.cols) || (world.terrain[0] && world.terrain[0].length) || 100));
    const cellWidth = background.width / cols;
    const cellHeight = background.height / rows;
    let count = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const selected = selectTile(semantics, world.terrain, row, col);
        if (!selected) continue;
        const index = semanticIndex(selected.id);
        const image = index >= 0 ? images[index] : null;
        if (!image) continue;
        const x = Math.floor(col * cellWidth);
        const y = Math.floor(row * cellHeight);
        const width = Math.max(1, Math.ceil((col + 1) * cellWidth) - x);
        const height = Math.max(1, Math.ceil((row + 1) * cellHeight) - y);
        ctx.drawImage(image, 0, 0, 100, 100, x, y, width, height);
        count += 1;
      }
    }
    appliedTiles = count;
    lastReason = reason;
    lastError = null;
    render.needsBackgroundUpload = true;
    render.backgroundTextureReady = false;
    return count;
  }

  function requestBackgroundRebuild() {
    const Game = gameRef;
    const render = Game && Game.State && Game.State.render;
    if (!render || !Game.Renderer || typeof Game.Renderer.renderWorld !== 'function') return false;
    render.needsBackgroundRebuild = true;
    render.backgroundTextureReady = false;
    Game.Renderer.renderWorld(true);
    return true;
  }

  function installRenderHook() {
    const Game = gameRef;
    if (installed || !Game || !Game.Renderer || typeof Game.Renderer.renderWorld !== 'function') return false;
    priorRenderWorld = Game.Renderer.renderWorld.bind(Game.Renderer);
    Game.Renderer.renderWorld = function shorelineAwareRenderWorld(force) {
      const render = Game.State && Game.State.render;
      const dirtyBefore = Boolean(render && render.needsBackgroundRebuild);
      const before = render && render.worldBackgroundCanvas;
      const result = priorRenderWorld(force);
      const after = Game.State && Game.State.render && Game.State.render.worldBackgroundCanvas;
      if (semantics && (dirtyBefore || before !== after)) applyToBackground(dirtyBefore ? 'background-dirty' : 'background-replaced');
      return result;
    };
    installed = true;
    return true;
  }

  function initialize(Game, attempt = 0) {
    gameRef = Game || gameRef;
    if (!gameRef || !gameRef.State || !gameRef.Renderer || typeof gameRef.Renderer.renderWorld !== 'function') {
      if (typeof setTimeout === 'function' && attempt < 800) setTimeout(() => initialize(gameRef, attempt + 1), 10);
      return false;
    }
    installRenderHook();
    loadSemantics()
      .then(() => {
        const loadPromise = gameRef.State && gameRef.State.render && gameRef.State.render.textureLoadPromise;
        return loadPromise && typeof loadPromise.then === 'function' ? loadPromise : null;
      })
      .then(() => requestBackgroundRebuild())
      .catch((error) => {
        lastError = error;
        lastReason = 'load-error';
        if (typeof console !== 'undefined' && console.warn) console.warn('Shoreline transition runtime unavailable.', error);
      });
    return true;
  }

  function diagnostics() {
    return Object.freeze({
      version: VERSION,
      authority: 'presentation-only',
      installed,
      semanticsReady: Boolean(semantics),
      appliedTiles,
      lastReason,
      error: lastError ? String(lastError.message || lastError) : null,
      rotationAllowed: false,
      compositionMode: 'opaque-base-transition'
    });
  }

  return Object.freeze({
    version: VERSION,
    authority: 'presentation-only',
    edgeNames: EDGE_NAMES,
    cornerNames: CORNER_NAMES,
    isWaterType,
    classifyEdge,
    buildTarget,
    validateSemantics,
    scoreTile,
    selectTile,
    semanticIndex,
    applyToBackground,
    requestBackgroundRebuild,
    initialize,
    diagnostics
  });
});
