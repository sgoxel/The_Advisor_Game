(function(){
  const Game = window.Game = window.Game || {};
  Game.State = {
    dom: {
      canvas: null,
      gl: null,
      terrainShapeOverlay: null,
      terrainShapeOverlayCtx: null,
      minimap: null,
      minimapCtx: null,
      gameArea: null,
      controlPanel: null,
      characterPanel: null,
      dialoguePanel: null,
      minimapPanel: null,
      panelTabs: null,
      panelTabButtons: [],
      panelSurfaces: [],
      advisorInput: null,
      advisorSendBtn: null,
      advisorResponse: null,
      characterStatus: null,
      characterStatusDetails: null,
      characterActivity: null,
      characterActivityDetails: null,
      mainMenuBtn: null,
      settingsBtn: null,
      settingsModal: null,
      closeSettingsBtn: null,
      settingsForm: null,
      resetSettingsBtn: null,
      newGameBtn: null,
      saveBtn: null,
      loadBtn: null,
      exportSaveBtn: null,
      importSaveBtn: null,
      importSaveInput: null,
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
      // Presentation-only world-edge padding. Portrait/rotated projections can
      // expose pixels outside the finite world quad; keep those pixels terrain-
      // compatible instead of rendering black/empty wedges.
      clearColor: [38 / 255, 58 / 255, 28 / 255, 1],
      needsWorldRedraw: true,
      needsMinimapRedraw: true,
      needsBackgroundRebuild: true,
      backgroundVersion: 0,
      backgroundUploadedVersion: -1,
      worldBackgroundCanvas: null,
      worldBackgroundCtx: null,
      backgroundTexture: null,
      colorProgram: null,
      colorPositionLocation: null,
      colorMatrixLocation: null,
      textureProgram: null,
      texturePositionBuffer: null,
      textureCoordBuffer: null,
      texturePositionLocation: null,
      textureCoordLocation: null,
      textureMatrixLocation: null,
      textureSamplerLocation: null,
      roadAppearanceCache: null,
      projectionSafetyStats: null
    },

    world: null,

    camera: {
      x: 0,
      y: 0,
      zoom: 1,
      pitchAngle: 90,
      depthStrength: 1,
      blendPixelSize: 4,
      blendStrength: 0.7,
      noiseGridDivisions: 2,
      showGrid: false,
      showTerrainWalls: true,
      reliefEnabled: true,
      sunAzimuth: 315,
      sunElevation: 45,
      shadowStrength: 0.34,
      highlightStrength: 0.22,
      shadowLength: 5.4
    },

    input: {
      keys: {},
      dragging: false,
      lastX: 0,
      lastY: 0,
      pointerId: null
    },

    ui: {
      activePanel: 'dialogue-panel',
      phonePortraitSurface: 'game',
      advisorResponse: null
    },

    settings: {},
    logs: []
  };
})();
