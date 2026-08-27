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
})();
