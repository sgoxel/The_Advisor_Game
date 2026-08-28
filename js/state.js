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
    - seeded world identity and dimensions;
    - deterministic generation parameters;
    - row-major terrain type/elevation;
    - protagonist simulation location/direction.

    Presentation/runtime-only values intentionally excluded include camera, DOM,
    render caches, input state, logs/i18n, tile hover/selection/route previews and
    transient protagonist animation/path fields. The API is read-only: it can
    capture/normalize/canonicalize simulation state but exposes no setter that UI
    code could use to promote presentation state into authoritative truth.
  */
  const AUTH_SCHEMA_VERSION = 1;
  const AUTH_FIELD_PATHS = Object.freeze([
    'world.seed',
    'world.rows',
    'world.cols',
    'world.tileWidth',
    'world.tileHeight',
    'world.params',
    'world.terrain[].type',
    'world.terrain[].elevation',
    'world.player.row',
    'world.player.col',
    'world.player.direction'
  ]);

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function integer(value, fallback) {
    return Math.trunc(finiteNumber(value, fallback));
  }

  function canonicalData(value) {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value)) return value.map(canonicalData);
    if (typeof value === 'object') {
      const output = {};
      Object.keys(value).sort().forEach((key) => {
        const child = value[key];
        if (child === undefined || typeof child === 'function') return;
        output[key] = canonicalData(child);
      });
      return output;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'boolean' || typeof value === 'string') return value;
    return String(value);
  }

  function normalizeTerrain(terrain, rows, cols) {
    const source = Array.isArray(terrain) ? terrain : [];
    const normalized = [];
    for (let row = 0; row < rows; row += 1) {
      const sourceRow = Array.isArray(source[row]) ? source[row] : [];
      const normalizedRow = [];
      for (let col = 0; col < cols; col += 1) {
        const tile = sourceRow[col] && typeof sourceRow[col] === 'object' ? sourceRow[col] : {};
        normalizedRow.push({
          type: typeof tile.type === 'string' && tile.type ? tile.type : 'grass',
          elevation: finiteNumber(tile.elevation, 0)
        });
      }
      normalized.push(normalizedRow);
    }
    return normalized;
  }

  function normalizeAuthoritativeState(candidate) {
    const root = candidate && typeof candidate === 'object' ? candidate : {};
    const world = root.world && typeof root.world === 'object' ? root.world : root;
    const player = world.player && typeof world.player === 'object' ? world.player : {};
    const rows = Math.max(0, integer(world.rows, 0));
    const cols = Math.max(0, integer(world.cols, 0));

    return {
      schemaVersion: AUTH_SCHEMA_VERSION,
      authority: 'simulation',
      world: {
        seed: world.seed === undefined || world.seed === null ? '' : String(world.seed),
        rows,
        cols,
        tileWidth: finiteNumber(world.tileWidth, 0),
        tileHeight: finiteNumber(world.tileHeight, 0),
        params: canonicalData(world.params),
        terrain: normalizeTerrain(world.terrain, rows, cols),
        player: {
          row: integer(player.row, 0),
          col: integer(player.col, 0),
          direction: typeof player.direction === 'string' && player.direction ? player.direction : 's'
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

  window.Game.AuthoritativeState = Object.freeze({
    schemaVersion: AUTH_SCHEMA_VERSION,
    authority: 'simulation',
    fields: AUTH_FIELD_PATHS,
    capture: captureAuthoritativeState,
    normalize: normalizeAuthoritativeState,
    canonicalStringify
  });
})();
