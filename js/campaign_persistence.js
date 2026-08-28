/*
  R02-T05/T06 campaign persistence.

  Export serializes only simulation-owned state admitted by Game.AuthoritativeState.
  Import validates an untrusted save completely before mutating runtime state.
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
  const MAX_DIMENSION = 80;

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

  function createSaveEnvelope(candidate) {
    const authoritativeState = resolveAuthoritativeState(candidate);
    return deepFreeze({
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      authority: 'simulation',
      seedIdentity: authoritativeState.world.seed,
      scope: 'authoritative-only',
      authoritativeState
    });
  }

  function serializeSave(candidate) {
    return JSON.stringify(createSaveEnvelope(candidate));
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
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
    return deepFreeze({ ok: true, envelope: createSaveEnvelope(checked.state), authoritativeState: checked.state });
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
    return deepFreeze({ ok: true, authoritativeState: AuthoritativeState.capture(Game.State) });
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
