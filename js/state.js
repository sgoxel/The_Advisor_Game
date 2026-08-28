/* ROAD_PATCH_V2: diagonal connectivity + color fix */
/*
  FILE PURPOSE:
  Hold shared mutable runtime state for the whole application.
*/

window.Game = window.Game || {};

(function () {
  const Config = window.Game.Config;

  window.Game.State = {
    world: {
      rows: Config.DEFAULT_ROWS,
      cols: Config.DEFAULT_COLS,
      tileWidth: Config.TILE_WIDTH,
      tileHeight: Config.TILE_HEIGHT,
      selected: null,
      hover: null,
      player: {
        row: Math.floor(Config.DEFAULT_ROWS / 2),
        col: Math.floor(Config.DEFAULT_COLS / 2),
        moving: false,
        startRow: Math.floor(Config.DEFAULT_ROWS / 2),
        startCol: Math.floor(Config.DEFAULT_COLS / 2),
        targetRow: Math.floor(Config.DEFAULT_ROWS / 2),
        targetCol: Math.floor(Config.DEFAULT_COLS / 2),
        moveStartTime: 0,
        moveDuration: 180,
        progress: 1,
        direction: 's',
        pathQueue: []
      },
      seed: Config.DEFAULT_SEED,
      terrain: [],
      params: null,
      previewPath: []
    },

    camera: {
      x: 0,
      y: 0,
      moveSpeed: Config.CAMERA_MOVE_SPEED,
      dragActive: false,
      lastX: 0,
      lastY: 0,
      lastDragTime: 0,
      movedWhileDragging: false,
      inertiaVelocityX: 0,
      inertiaVelocityY: 0,
      inertiaFriction: Config.CAMERA_DRAG_INERTIA_FRICTION,
      inertiaMinVelocity: Config.CAMERA_DRAG_INERTIA_MIN_VELOCITY,
      touchDragMultiplier: Config.CAMERA_DRAG_TOUCH_MULTIPLIER,
      zoom: Config.DEFAULT_START_ZOOM,
      minZoom: Config.MIN_START_ZOOM,
      maxZoom: Config.MAX_START_ZOOM,
      zoomStep: Config.DEFAULT_ZOOM_STEP,
      followPlayer: true,
      pitchAngle: Config.DEFAULT_CAMERA_PITCH,
      depthStrength: Config.DEFAULT_DEPTH_STRENGTH,
      showGrid: Config.DEFAULT_SHOW_GRID,
      showTerrainWalls: Config.DEFAULT_SHOW_TERRAIN_WALLS,
      blendPixelSize: Config.DEFAULT_BLEND_PIXEL_SIZE,
      blendStrength: Config.DEFAULT_BLEND_STRENGTH,

      noiseGridDivisions: Config.DEFAULT_NOISE_GRID_DIVISIONS,
      reliefEnabled: Config.DEFAULT_RELIEF_ENABLED,
      sunAzimuth: Config.DEFAULT_SUN_AZIMUTH,
      sunElevation: Config.DEFAULT_SUN_ELEVATION,
      shadowStrength: Config.DEFAULT_SHADOW_STRENGTH,
      highlightStrength: Config.DEFAULT_HIGHLIGHT_STRENGTH,
      shadowLength: Config.DEFAULT_SHADOW_LENGTH
    },

    input: {
      keys: new Set(),
      lastTileClick: null,
      lastTileClickTime: 0,
      doubleClickThresholdMs: 500,
      mouseX: 0,
      mouseY: 0
    },

    dom: {
      canvas: null,
      gl: null,
      minimap: null,
      miniCtx: null,

      settingsModal: null,
      settingsBtn: null,
      applySettingsBtn: null,
      cancelSettingsBtn: null,
      mainMenuBtn: null,
      mainMenuDropdown: null,
      menuGithubBtn: null,
      menuSaveBtn: null,
      menuLoadBtn: null,
      menuExportMasksBtn: null,

      logModal: null,
      logBtn: null,
      closeLogBtn: null,
      logText: null,

      seedInput: null,
      mapWidthInput: null,
      mapHeightInput: null,
      cameraPitchInput: null,
      depthStrengthInput: null,
      blendPixelSizeInput: null,

      blendStrengthInput: null,
      noiseGridDivisionsInput: null,
      showGridInput: null,
      showTerrainWallsInput: null,
      reliefEnabledInput: null,
      sunAzimuthInput: null,
      sunElevationInput: null,
      shadowStrengthInput: null,
      highlightStrengthInput: null,
      shadowLengthInput: null,

      dialogText: null,
      languageSelect: null,
      loadingOverlay: null,

      top: {
        goldValue: null,
        healthText: null,
        staminaText: null,
        manaText: null,
        healthBar: null,
        staminaBar: null,
        manaBar: null
      },

      params: {},
      textureInfo: {}
    },

    render: {
      program: null,
      positionBuffer: null,
      colorLocation: null,
      positionLocation: null,
      resolutionLocation: null,
      clearColor: [18 / 255, 25 / 255, 32 / 255, 1],
      needsWorldRedraw: true,
      needsMinimapRedraw: true,
      needsBackgroundRebuild: true,
      needsBackgroundUpload: true,
      backgroundUploadBlocked: false,
      backgroundTextureReady: false,
      worldBackgroundCanvas: null,
      textureImages: {},
      texturePatterns: {},
      textureLoadPromise: null,
      textureLoadStatus: "idle"
    },

    log: {
      lines: [],
      maxLines: 500
    },

    i18n: {
      current: 'en',
      messages: {}
    }
  };

  /*
    R02 authoritative campaign-state boundary.

    Simulation-owned truth admitted by this contract today:
    - the visible seed identity and world dimensions;
    - row-major terrain semantics (type, elevation and gameplay-relevant tags/flags);
    - the autonomous protagonist's world location.

    Deliberately derived/presentation-only R01 values are excluded: tile pixel size,
    generated parameter summaries, camera, DOM/render/input caches, hover/selection,
    path previews, locale/log data and transient movement/facing animation fields.
    Seed parsing/RNG stream derivation belongs to R02-T02/#84 and is not duplicated
    here. The API is read-only and exposes no setter that UI/presentation code can
    use to install candidate data as authoritative simulation truth.
  */
  const AUTH_SCHEMA_VERSION = 1;
  const AUTH_FIELD_PATHS = Object.freeze([
    'world.seed',
    'world.rows',
    'world.cols',
    'world.terrain[].type',
    'world.terrain[].elevation',
    'world.terrain[].tags',
    'world.terrain[].blocked',
    'world.terrain[].obstacle',
    'world.protagonist.row',
    'world.protagonist.col'
  ]);

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function integer(value, fallback) {
    return Math.trunc(finiteNumber(value, fallback));
  }

  function normalizeTags(tags) {
    let source = [];
    if (tags instanceof Set) source = Array.from(tags);
    else if (Array.isArray(tags)) source = tags;

    return Array.from(new Set(source
      .map((tag) => String(tag))
      .filter((tag) => tag.length > 0)))
      .sort();
  }

  function normalizeTerrain(terrain, rows, cols) {
    const source = Array.isArray(terrain) ? terrain : [];
    const normalized = [];
    for (let row = 0; row < rows; row += 1) {
      const sourceRow = Array.isArray(source[row]) ? source[row] : [];
      const normalizedRow = [];
      for (let col = 0; col < cols; col += 1) {
        const tile = sourceRow[col] && typeof sourceRow[col] === 'object' ? sourceRow[col] : {};
        const tags = normalizeTags(tile.tags);
        normalizedRow.push({
          type: typeof tile.type === 'string' && tile.type ? tile.type : 'grass',
          elevation: finiteNumber(tile.elevation, 0),
          tags,
          blocked: tile.blocked === true || tags.includes('blocked'),
          obstacle: tile.obstacle === true || tags.includes('obstacle')
        });
      }
      normalized.push(normalizedRow);
    }
    return normalized;
  }

  function clampCoordinate(value, size) {
    if (size <= 0) return 0;
    return Math.min(size - 1, Math.max(0, integer(value, 0)));
  }

  function normalizeAuthoritativeState(candidate) {
    const root = candidate && typeof candidate === 'object' ? candidate : {};
    const world = root.world && typeof root.world === 'object' ? root.world : root;
    const legacyPlayer = world.player && typeof world.player === 'object' ? world.player : {};
    const protagonist = world.protagonist && typeof world.protagonist === 'object'
      ? world.protagonist
      : legacyPlayer;
    const rows = Math.max(0, integer(world.rows, 0));
    const cols = Math.max(0, integer(world.cols, 0));

    return {
      schemaVersion: AUTH_SCHEMA_VERSION,
      authority: 'simulation',
      world: {
        seed: world.seed === undefined || world.seed === null ? '' : String(world.seed),
        rows,
        cols,
        terrain: normalizeTerrain(world.terrain, rows, cols),
        protagonist: {
          row: clampCoordinate(protagonist.row, rows),
          col: clampCoordinate(protagonist.col, cols)
        }
      }
    };
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function captureAuthoritativeState(runtimeState) {
    return deepFreeze(normalizeAuthoritativeState(runtimeState || window.Game.State));
  }

  function canonicalStringify(candidate) {
    return JSON.stringify(normalizeAuthoritativeState(candidate));
  }

  let lastGeneratedInitialization = null;

  function materializeAuthoritativeTerrain(terrain) {
    return terrain.map((row) => row.map((tile) => ({
      type: tile.type,
      elevation: tile.elevation,
      tags: new Set(tile.tags),
      blocked: tile.blocked,
      obstacle: tile.obstacle
    })));
  }

  function bindGeneratedWorldInitialization() {
    const Terrain = window.Game.Terrain;
    const RNG = window.Game.RNG;
    if (!Terrain || !RNG || typeof Terrain.generateWorld !== 'function') return false;
    if (Terrain.generateWorld.__r02AuthoritativeInitialization === true) return true;

    const generateWorld = Terrain.generateWorld.bind(Terrain);
    const wrappedGenerateWorld = function (seedInput, colsInput, rowsInput) {
      const canonicalSeed = RNG.normalizeSeed(seedInput, Config.DEFAULT_SEED);
      const cols = Math.max(1, integer(colsInput, Config.DEFAULT_COLS));
      const rows = Math.max(1, integer(rowsInput, Config.DEFAULT_ROWS));
      const generated = generateWorld(canonicalSeed, cols, rows);
      const fallbackStart = {
        row: Math.floor(rows / 2),
        col: Math.floor(cols / 2)
      };
      const playerStart = generated && generated.playerStart ? generated.playerStart : fallbackStart;
      const authoritative = deepFreeze(normalizeAuthoritativeState({
        world: {
          seed: canonicalSeed,
          rows,
          cols,
          terrain: generated && generated.grid,
          protagonist: playerStart
        }
      }));

      lastGeneratedInitialization = authoritative;
      window.Game.State.world.seed = authoritative.world.seed;
      window.Game.State.world.rows = authoritative.world.rows;
      window.Game.State.world.cols = authoritative.world.cols;

      return {
        ...(generated || {}),
        grid: materializeAuthoritativeTerrain(authoritative.world.terrain),
        playerStart: {
          row: authoritative.world.protagonist.row,
          col: authoritative.world.protagonist.col
        }
      };
    };

    Object.defineProperty(wrappedGenerateWorld, '__r02AuthoritativeInitialization', {
      value: true,
      enumerable: false
    });
    Terrain.generateWorld = wrappedGenerateWorld;
    return true;
  }

  function getLastGeneratedInitialization() {
    return lastGeneratedInitialization;
  }

  window.Game.AuthoritativeState = Object.freeze({
    schemaVersion: AUTH_SCHEMA_VERSION,
    authority: 'simulation',
    fields: AUTH_FIELD_PATHS,
    capture: captureAuthoritativeState,
    normalize: normalizeAuthoritativeState,
    canonicalStringify,
    getLastGeneratedInitialization
  });

  window.addEventListener('DOMContentLoaded', bindGeneratedWorldInitialization);
})();
