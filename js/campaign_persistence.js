/*
  R02-T05/T06 campaign persistence.

  Export serializes only simulation-owned state admitted by Game.AuthoritativeState.
  Import validates an untrusted save completely before mutating runtime state.
  R02-T17 extends the same versioned envelope with sparse world deltas. Deterministic
  base regions remain regenerable from SEED + coordinates; only meaningful changes
  are stored in worldDeltaState.
  UI integration belongs to R02-T07/#89.
*/
window.Game = window.Game || {};

(function () {
  const Game = window.Game;
  const AuthoritativeState = Game.AuthoritativeState;

  if (!AuthoritativeState) {
    throw new Error('Campaign persistence requires Game.AuthoritativeState.');
  }

  const SAVE_FORMAT = 'the-advisor-game/campaign-save';
  const SAVE_VERSION = 1;
  const MIME_TYPE = 'application/json;charset=utf-8';
  const MAX_DIMENSION = 100;

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function resolveAuthoritativeState(candidate) {
    if (candidate === undefined) return AuthoritativeState.capture(Game.State);
    return deepFreeze(AuthoritativeState.normalize(candidate));
  }

  function resolveWorldDeltaState(seedIdentity, candidate) {
    const api = Game.WorldDeltaPersistence;
    if (!api) {
      return deepFreeze({
        schemaVersion: 1,
        authority: 'simulation',
        seedIdentity,
        terrainGeneratorVersion: 'r02-terrain-v1',
        regionSize: 24,
        regions: []
      });
    }
    return api.capture(seedIdentity, candidate);
  }

  function buildSaveEnvelope(authoritativeState, worldDeltaState) {
    return deepFreeze({
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      authority: 'simulation',
      seedIdentity: authoritativeState.world.seed,
      scope: 'authoritative-only',
      authoritativeState,
      worldDeltaState
    });
  }

  function createSaveEnvelope(candidate, deltaCandidate) {
    const authoritativeState = resolveAuthoritativeState(candidate);
    const worldDeltaState = resolveWorldDeltaState(authoritativeState.world.seed, deltaCandidate);
    return buildSaveEnvelope(authoritativeState, worldDeltaState);
  }

  function serializeSave(candidate, deltaCandidate) {
    return JSON.stringify(createSaveEnvelope(candidate, deltaCandidate));
  }

  function safeFilenamePart(value) {
    const normalized = String(value || 'seed').normalize('NFKC');
    const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
    return safe || 'seed';
  }

  function getSuggestedFilename(candidate) {
    const envelope = createSaveEnvelope(candidate);
    return `advisor-campaign-${safeFilenamePart(envelope.seedIdentity)}-v${SAVE_VERSION}.json`;
  }

  function downloadSave(candidate) {
    const envelope = createSaveEnvelope(candidate);
    const content = JSON.stringify(envelope);
    const filename = `advisor-campaign-${safeFilenamePart(envelope.seedIdentity)}-v${SAVE_VERSION}.json`;
    const blob = new Blob([content], { type: MIME_TYPE });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return Object.freeze({ filename, mimeType: MIME_TYPE, content });
  }

  function invalid(code, message) {
    return deepFreeze({ ok: false, code, message });
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function validateAuthoritativeState(candidate) {
    if (!isPlainObject(candidate) || candidate.schemaVersion !== AuthoritativeState.schemaVersion || candidate.authority !== 'simulation') {
      return invalid('INVALID_AUTHORITATIVE_STATE', 'Save authoritative state schema or authority is invalid.');
    }
    const world = candidate.world;
    if (!isPlainObject(world) || typeof world.seed !== 'string' || !world.seed.length) {
      return invalid('INVALID_WORLD', 'Save world and seed identity are required.');
    }
    if (!Number.isInteger(world.rows) || !Number.isInteger(world.cols) || world.rows < 1 || world.cols < 1 || world.rows > MAX_DIMENSION || world.cols > MAX_DIMENSION) {
      return invalid('INVALID_DIMENSIONS', 'Save world dimensions are invalid or unsupported.');
    }
    if (!Array.isArray(world.terrain) || world.terrain.length !== world.rows) {
      return invalid('INVALID_TERRAIN', 'Save terrain row count does not match world dimensions.');
    }
    for (let row = 0; row < world.rows; row += 1) {
      if (!Array.isArray(world.terrain[row]) || world.terrain[row].length !== world.cols) return invalid('INVALID_TERRAIN', 'Save terrain shape does not match world dimensions.');
      for (const tile of world.terrain[row]) {
        if (!isPlainObject(tile) || typeof tile.type !== 'string' || !tile.type || !Number.isFinite(tile.elevation) || !Array.isArray(tile.tags) || !tile.tags.every((tag) => typeof tag === 'string') || typeof tile.blocked !== 'boolean' || typeof tile.obstacle !== 'boolean') {
          return invalid('INVALID_TERRAIN_TILE', 'Save contains an invalid authoritative terrain tile.');
        }
      }
    }
    const protagonist = world.protagonist;
    if (!isPlainObject(protagonist) || !Number.isInteger(protagonist.row) || !Number.isInteger(protagonist.col) || protagonist.row < 0 || protagonist.col < 0 || protagonist.row >= world.rows || protagonist.col >= world.cols) {
      return invalid('INVALID_PROTAGONIST', 'Save protagonist location is outside the authoritative world.');
    }
    return deepFreeze({ ok: true, state: AuthoritativeState.normalize(candidate) });
  }

  function validateSave(input) {
    let envelope = input;
    if (typeof input === 'string') {
      try { envelope = JSON.parse(input); } catch (_error) { return invalid('INVALID_JSON', 'Campaign save is not valid JSON.'); }
    }
    if (!isPlainObject(envelope)) return invalid('INVALID_ENVELOPE', 'Campaign save must be a JSON object.');
    if (envelope.format !== SAVE_FORMAT) return invalid('UNSUPPORTED_FORMAT', 'Campaign save format is unsupported.');
    if (envelope.version !== SAVE_VERSION) return invalid('UNSUPPORTED_VERSION', `Campaign save version ${String(envelope.version)} is unsupported.`);
    if (envelope.authority !== 'simulation' || envelope.scope !== 'authoritative-only') return invalid('INVALID_AUTHORITY', 'Campaign save authority boundary is invalid.');
    const checked = validateAuthoritativeState(envelope.authoritativeState);
    if (!checked.ok) return checked;
    if (envelope.seedIdentity !== checked.state.world.seed) return invalid('SEED_MISMATCH', 'Campaign save seed identity does not match authoritative state.');

    const deltaApi = Game.WorldDeltaPersistence;
    if (!deltaApi) return invalid('DELTA_API_UNAVAILABLE', 'World delta persistence is unavailable.');
    const deltaChecked = deltaApi.validate(envelope.worldDeltaState, checked.state.world.seed);
    if (!deltaChecked.ok) return deltaChecked;

    return deepFreeze({
      ok: true,
      envelope: buildSaveEnvelope(checked.state, deltaChecked.state),
      authoritativeState: checked.state,
      worldDeltaState: deltaChecked.state
    });
  }

  function installValidatedState(authoritativeState) {
    const state = Game.State;
    const world = authoritativeState.world;
    state.world.seed = world.seed;
    state.world.rows = world.rows;
    state.world.cols = world.cols;
    state.world.terrain = world.terrain.map((row) => row.map((tile) => ({
      type: tile.type,
      elevation: tile.elevation,
      tags: new Set(tile.tags),
      blocked: tile.blocked,
      obstacle: tile.obstacle
    })));
    Object.assign(state.world.player, {
      row: world.protagonist.row,
      col: world.protagonist.col,
      moving: false,
      startRow: world.protagonist.row,
      startCol: world.protagonist.col,
      targetRow: world.protagonist.row,
      targetCol: world.protagonist.col,
      progress: 1,
      pathQueue: []
    });
    state.world.selected = null;
    state.world.hover = null;
    state.world.previewPath = [];
    state.render.needsWorldRedraw = true;
    state.render.needsMinimapRedraw = true;
    state.render.needsBackgroundRebuild = true;
    state.render.needsBackgroundUpload = true;
  }

  function loadSave(input) {
    const checked = validateSave(input);
    if (!checked.ok) return checked;
    installValidatedState(checked.authoritativeState);
    Game.WorldDeltaPersistence.install(checked.worldDeltaState);
    return deepFreeze({
      ok: true,
      authoritativeState: AuthoritativeState.capture(Game.State),
      worldDeltaState: Game.WorldDeltaPersistence.capture(checked.authoritativeState.world.seed)
    });
  }

  Game.CampaignPersistence = Object.freeze({
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    mimeType: MIME_TYPE,
    createSaveEnvelope,
    serializeSave,
    getSuggestedFilename,
    downloadSave,
    validateSave,
    loadSave
  });

  if (!document.querySelector('script[data-r02-persistence-ui]')) {
    const uiScript = document.createElement('script');
    uiScript.src = 'js/persistence_ui.js';
    uiScript.defer = true;
    uiScript.dataset.r02PersistenceUi = 'true';
    document.head.appendChild(uiScript);
  }
})();

/*
  R02-T17 / #112: sparse authoritative world-delta persistence.

  Region base content is not stored here. Game.RegionTerrain deterministically regenerates
  unchanged region truth from compatible SEED + coordinates + generator version. This layer
  stores only meaningful tile/entity/region-flag deviations, validates untrusted data before
  installation, and reconstructs a region as deterministic base + persistent deltas.
*/
(function installWorldDeltaPersistence() {
  const Game = window.Game;
  const SCHEMA_VERSION = 1;
  const FALLBACK_TERRAIN_GENERATOR = 'r02-terrain-v1';
  const FALLBACK_REGION_SIZE = 24;
  const MAX_REGIONS = 512;
  const MAX_TILE_CHANGES = 4096;
  const MAX_ENTITY_CHANGES = 4096;
  const MAX_ENTITY_STATE_BYTES = 32768;
  const MAX_JSON_DEPTH = 8;
  const MAX_JSON_ARRAY = 256;
  const MAX_JSON_KEYS = 256;
  const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const TILE_PATCH_FIELDS = Object.freeze(['type', 'biome', 'elevation', 'water', 'road', 'blocked', 'obstacle']);

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function invalid(code, message) {
    return deepFreeze({ ok: false, code, message });
  }

  function currentGeneratorVersion() {
    return Game.RegionTerrain?.generatorVersion || FALLBACK_TERRAIN_GENERATOR;
  }

  function currentRegionSize() {
    return Game.RegionTerrain?.regionSize || FALLBACK_REGION_SIZE;
  }

  function canonicalSeed(seedInput) {
    if (Game.WorldCoordinates?.canonicalSeed) return Game.WorldCoordinates.canonicalSeed(seedInput);
    return String(seedInput ?? Game.State?.world?.seed ?? '');
  }

  function regionCoordinate(value, label) {
    if (Game.WorldCoordinates?.normalizeCoordinate) return Game.WorldCoordinates.normalizeCoordinate(value, label);
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new TypeError(`${label} must be a safe integer.`);
    return number;
  }

  function localCoordinate(value, label) {
    const number = Number(value);
    const size = currentRegionSize();
    if (!Number.isInteger(number) || number < 0 || number >= size) throw new TypeError(`${label} must be inside the region.`);
    return number;
  }

  function normalizeJsonValue(value, depth = 0) {
    if (depth > MAX_JSON_DEPTH) throw new TypeError('Entity delta state is too deeply nested.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('Entity delta numbers must be finite.');
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_JSON_ARRAY) throw new TypeError('Entity delta array is too large.');
      return value.map((entry) => normalizeJsonValue(entry, depth + 1));
    }
    if (!isPlainObject(value)) throw new TypeError('Entity delta state must contain JSON-safe values only.');
    const keys = Object.keys(value).sort();
    if (keys.length > MAX_JSON_KEYS) throw new TypeError('Entity delta object has too many keys.');
    const normalized = {};
    for (const key of keys) {
      if (FORBIDDEN_KEYS.has(key)) throw new TypeError('Entity delta contains a forbidden key.');
      normalized[key] = normalizeJsonValue(value[key], depth + 1);
    }
    return normalized;
  }

  function normalizeTilePatch(patch) {
    if (!isPlainObject(patch)) throw new TypeError('Tile delta patch must be an object.');
    const normalized = {};
    for (const key of Object.keys(patch).sort()) {
      if (!TILE_PATCH_FIELDS.includes(key)) throw new TypeError(`Unsupported tile delta field: ${key}`);
      const value = patch[key];
      if (key === 'type' || key === 'biome') {
        if (typeof value !== 'string' || !value || value.length > 64) throw new TypeError(`${key} delta must be a short non-empty string.`);
        normalized[key] = value;
      } else if (key === 'elevation') {
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new TypeError('elevation delta must be between 0 and 1.');
        normalized[key] = Number(value.toFixed(6));
      } else {
        if (typeof value !== 'boolean') throw new TypeError(`${key} delta must be boolean.`);
        normalized[key] = value;
      }
    }
    if (!Object.keys(normalized).length) throw new TypeError('Tile delta patch cannot be empty.');
    return normalized;
  }

  function normalizeTileChange(change) {
    if (!isPlainObject(change)) throw new TypeError('Tile change must be an object.');
    return {
      row: localCoordinate(change.row, 'tile delta row'),
      col: localCoordinate(change.col, 'tile delta col'),
      patch: normalizeTilePatch(change.patch)
    };
  }

  function normalizeEntityChange(change) {
    if (!isPlainObject(change) || typeof change.id !== 'string' || !change.id || change.id.length > 256) {
      throw new TypeError('Entity delta requires a stable non-empty id.');
    }
    const removed = change.removed === true;
    const state = removed ? {} : normalizeJsonValue(change.state ?? {});
    if (!isPlainObject(state)) throw new TypeError('Entity delta state must be an object.');
    if (JSON.stringify(state).length > MAX_ENTITY_STATE_BYTES) throw new TypeError('Entity delta state is too large.');
    return { id: change.id, removed, state };
  }

  function normalizeFlags(flags) {
    if (flags === undefined) return {};
    if (!isPlainObject(flags)) throw new TypeError('Region delta flags must be an object.');
    const normalized = normalizeJsonValue(flags);
    if (!isPlainObject(normalized)) throw new TypeError('Region delta flags must be an object.');
    return normalized;
  }

  function normalizeRegion(region) {
    if (!isPlainObject(region)) throw new TypeError('Region delta must be an object.');
    const regionX = regionCoordinate(region.regionX, 'region delta x');
    const regionY = regionCoordinate(region.regionY, 'region delta y');
    const tileChanges = Array.isArray(region.tileChanges) ? region.tileChanges.map(normalizeTileChange) : [];
    const entityChanges = Array.isArray(region.entityChanges) ? region.entityChanges.map(normalizeEntityChange) : [];
    if (tileChanges.length > MAX_TILE_CHANGES || entityChanges.length > MAX_ENTITY_CHANGES) throw new TypeError('Region delta exceeds supported change count.');

    const tileKeys = new Set();
    for (const change of tileChanges) {
      const key = `${change.row}:${change.col}`;
      if (tileKeys.has(key)) throw new TypeError('Region delta contains duplicate tile changes.');
      tileKeys.add(key);
    }
    const entityIds = new Set();
    for (const change of entityChanges) {
      if (entityIds.has(change.id)) throw new TypeError('Region delta contains duplicate entity changes.');
      entityIds.add(change.id);
    }

    tileChanges.sort((a, b) => a.row - b.row || a.col - b.col);
    entityChanges.sort((a, b) => a.id.localeCompare(b.id));
    return {
      regionX,
      regionY,
      tileChanges,
      entityChanges,
      flags: normalizeFlags(region.flags)
    };
  }

  function createEmpty(seedInput) {
    const seedIdentity = canonicalSeed(seedInput);
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      authority: 'simulation',
      seedIdentity,
      terrainGeneratorVersion: currentGeneratorVersion(),
      regionSize: currentRegionSize(),
      regions: []
    });
  }

  function validate(candidate, expectedSeedInput) {
    const expectedSeed = canonicalSeed(expectedSeedInput);
    if (candidate === undefined || candidate === null) return deepFreeze({ ok: true, state: createEmpty(expectedSeed) });
    if (!isPlainObject(candidate)) return invalid('INVALID_WORLD_DELTAS', 'World delta state must be an object.');
    if (candidate.schemaVersion !== SCHEMA_VERSION || candidate.authority !== 'simulation') {
      return invalid('UNSUPPORTED_WORLD_DELTA_SCHEMA', 'World delta schema or authority is unsupported.');
    }
    if (candidate.seedIdentity !== expectedSeed) return invalid('WORLD_DELTA_SEED_MISMATCH', 'World delta seed identity does not match campaign state.');
    if (candidate.terrainGeneratorVersion !== currentGeneratorVersion()) return invalid('UNSUPPORTED_TERRAIN_GENERATOR', 'World delta terrain generator version is incompatible.');
    if (candidate.regionSize !== currentRegionSize()) return invalid('UNSUPPORTED_REGION_SIZE', 'World delta region size is incompatible.');
    if (!Array.isArray(candidate.regions) || candidate.regions.length > MAX_REGIONS) return invalid('INVALID_WORLD_DELTA_REGIONS', 'World delta region list is invalid or too large.');

    try {
      const regions = candidate.regions.map(normalizeRegion);
      const keys = new Set();
      for (const region of regions) {
        const key = `${region.regionX}:${region.regionY}`;
        if (keys.has(key)) throw new TypeError('World delta state contains duplicate regions.');
        keys.add(key);
      }
      regions.sort((a, b) => a.regionY - b.regionY || a.regionX - b.regionX);
      return deepFreeze({
        ok: true,
        state: {
          schemaVersion: SCHEMA_VERSION,
          authority: 'simulation',
          seedIdentity: expectedSeed,
          terrainGeneratorVersion: currentGeneratorVersion(),
          regionSize: currentRegionSize(),
          regions
        }
      });
    } catch (error) {
      return invalid('INVALID_WORLD_DELTAS', error instanceof Error ? error.message : 'World delta state is invalid.');
    }
  }

  function install(candidate) {
    const expectedSeed = canonicalSeed(Game.State?.world?.seed);
    const checked = validate(candidate, expectedSeed);
    if (!checked.ok) throw new TypeError(checked.message);
    Game.State.world.worldDeltaState = deepClone(checked.state);
    return capture(expectedSeed);
  }

  function capture(seedInput, candidate) {
    const seedIdentity = canonicalSeed(seedInput);
    if (candidate !== undefined) {
      const checked = validate(candidate, seedIdentity);
      if (!checked.ok) throw new TypeError(checked.message);
      return checked.state;
    }
    const runtime = Game.State?.world?.worldDeltaState;
    if (!runtime || runtime.seedIdentity !== seedIdentity) {
      const empty = createEmpty(seedIdentity);
      if (Game.State?.world && canonicalSeed(Game.State.world.seed) === seedIdentity) Game.State.world.worldDeltaState = deepClone(empty);
      return empty;
    }
    const checked = validate(runtime, seedIdentity);
    if (!checked.ok) {
      const empty = createEmpty(seedIdentity);
      Game.State.world.worldDeltaState = deepClone(empty);
      return empty;
    }
    return checked.state;
  }

  function mutableCurrent(seedInput) {
    return deepClone(capture(seedInput));
  }

  function findOrCreateRegion(state, regionX, regionY) {
    let region = state.regions.find((entry) => entry.regionX === regionX && entry.regionY === regionY);
    if (!region) {
      region = { regionX, regionY, tileChanges: [], entityChanges: [], flags: {} };
      state.regions.push(region);
    }
    return region;
  }

  function pruneRegion(state, region) {
    if (region.tileChanges.length || region.entityChanges.length || Object.keys(region.flags).length) return;
    state.regions = state.regions.filter((entry) => entry !== region);
  }

  function installMutable(state) {
    const checked = validate(state, state.seedIdentity);
    if (!checked.ok) throw new TypeError(checked.message);
    Game.State.world.worldDeltaState = deepClone(checked.state);
    return checked.state;
  }

  function tilePatchAgainstBase(seedIdentity, regionX, regionY, row, col, patch) {
    const normalized = normalizeTilePatch(patch);
    const terrain = Game.RegionTerrain;
    if (!terrain?.generateRegion) throw new Error('World delta reconstruction requires Game.RegionTerrain.');
    const baseTile = terrain.generateRegion(seedIdentity, regionX, regionY).tiles[row][col];
    const sparse = {};
    for (const key of Object.keys(normalized)) {
      const baseValue = baseTile[key] === undefined && (key === 'blocked' || key === 'obstacle') ? false : baseTile[key];
      if (normalized[key] !== baseValue) sparse[key] = normalized[key];
    }
    return sparse;
  }

  function recordTileDelta(regionXInput, regionYInput, rowInput, colInput, patch) {
    const seedIdentity = canonicalSeed(Game.State.world.seed);
    const regionX = regionCoordinate(regionXInput, 'region delta x');
    const regionY = regionCoordinate(regionYInput, 'region delta y');
    const row = localCoordinate(rowInput, 'tile delta row');
    const col = localCoordinate(colInput, 'tile delta col');
    const sparsePatch = tilePatchAgainstBase(seedIdentity, regionX, regionY, row, col, patch);
    const state = mutableCurrent(seedIdentity);
    const region = findOrCreateRegion(state, regionX, regionY);
    region.tileChanges = region.tileChanges.filter((change) => change.row !== row || change.col !== col);
    if (Object.keys(sparsePatch).length) region.tileChanges.push({ row, col, patch: sparsePatch });
    pruneRegion(state, region);
    return installMutable(state);
  }

  function recordEntityDelta(regionXInput, regionYInput, entityId, statePatch, removed = false) {
    const seedIdentity = canonicalSeed(Game.State.world.seed);
    const regionX = regionCoordinate(regionXInput, 'region delta x');
    const regionY = regionCoordinate(regionYInput, 'region delta y');
    const normalized = normalizeEntityChange({ id: entityId, state: statePatch, removed });
    const state = mutableCurrent(seedIdentity);
    const region = findOrCreateRegion(state, regionX, regionY);
    region.entityChanges = region.entityChanges.filter((change) => change.id !== normalized.id);
    region.entityChanges.push(normalized);
    pruneRegion(state, region);
    return installMutable(state);
  }

  function setRegionFlag(regionXInput, regionYInput, flagName, value) {
    if (typeof flagName !== 'string' || !flagName || flagName.length > 128 || FORBIDDEN_KEYS.has(flagName)) throw new TypeError('Region flag name is invalid.');
    const seedIdentity = canonicalSeed(Game.State.world.seed);
    const regionX = regionCoordinate(regionXInput, 'region delta x');
    const regionY = regionCoordinate(regionYInput, 'region delta y');
    const normalizedValue = normalizeJsonValue(value);
    const state = mutableCurrent(seedIdentity);
    const region = findOrCreateRegion(state, regionX, regionY);
    region.flags[flagName] = normalizedValue;
    pruneRegion(state, region);
    return installMutable(state);
  }

  function clearRegion(regionXInput, regionYInput) {
    const seedIdentity = canonicalSeed(Game.State.world.seed);
    const regionX = regionCoordinate(regionXInput, 'region delta x');
    const regionY = regionCoordinate(regionYInput, 'region delta y');
    const state = mutableCurrent(seedIdentity);
    state.regions = state.regions.filter((region) => region.regionX !== regionX || region.regionY !== regionY);
    return installMutable(state);
  }

  function clearAll() {
    const empty = createEmpty(Game.State.world.seed);
    Game.State.world.worldDeltaState = deepClone(empty);
    return empty;
  }

  function reconstructRegion(seedInput, regionXInput, regionYInput, candidate) {
    const seedIdentity = canonicalSeed(seedInput);
    const regionX = regionCoordinate(regionXInput, 'region reconstruction x');
    const regionY = regionCoordinate(regionYInput, 'region reconstruction y');
    const terrain = Game.RegionTerrain;
    if (!terrain?.generateRegion) throw new Error('World delta reconstruction requires Game.RegionTerrain.');
    const checked = candidate === undefined ? { ok: true, state: capture(seedIdentity) } : validate(candidate, seedIdentity);
    if (!checked.ok) throw new TypeError(checked.message);

    const base = terrain.generateRegion(seedIdentity, regionX, regionY);
    const regionDelta = checked.state.regions.find((entry) => entry.regionX === regionX && entry.regionY === regionY);
    if (!regionDelta) {
      return deepFreeze({
        ...base,
        persistentDeltas: { tileChanges: [], entityChanges: [], flags: {} }
      });
    }

    const tiles = base.tiles.map((row) => row.map((tile) => ({ ...tile })));
    for (const change of regionDelta.tileChanges) {
      Object.assign(tiles[change.row][change.col], change.patch, {
        authority: 'simulation',
        worldX: base.originWorldX + change.col,
        worldY: base.originWorldY + change.row
      });
    }
    const counts = {};
    for (const row of tiles) {
      for (const tile of row) counts[tile.type] = (counts[tile.type] || 0) + 1;
    }

    return deepFreeze({
      ...base,
      counts,
      tiles,
      persistentDeltas: {
        tileChanges: deepClone(regionDelta.tileChanges),
        entityChanges: deepClone(regionDelta.entityChanges),
        flags: deepClone(regionDelta.flags)
      }
    });
  }

  Game.WorldDeltaPersistence = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: 'simulation',
    get terrainGeneratorVersion() { return currentGeneratorVersion(); },
    get regionSize() { return currentRegionSize(); },
    createEmpty,
    validate,
    capture,
    install,
    recordTileDelta,
    recordEntityDelta,
    setRegionFlag,
    clearRegion,
    clearAll,
    reconstructRegion
  });
})();