/* ROAD_PATCH_V2: diagonal connectivity + color fix */
/*
  FILE PURPOSE:
  Central place for application constants, defaults and UI-adjustable setting limits.
*/

window.Game = window.Game || {};

window.Game.Config = {
  DEFAULT_SEED: "ISOMETRIC_MAP_30032026",
  DEFAULT_COLS: 80,
  DEFAULT_ROWS: 80,

  MIN_MAP_SIZE: 12,
  MAX_MAP_SIZE: 80,

  TILE_WIDTH: 100,
  TILE_HEIGHT: 100,

  DEFAULT_CAMERA_PITCH: 45,
  MIN_CAMERA_PITCH: 20,
  MAX_CAMERA_PITCH: 90,

  DEFAULT_DEPTH_STRENGTH: 1.0,
  MIN_DEPTH_STRENGTH: 0.6,
  MAX_DEPTH_STRENGTH: 1.8,

  DEFAULT_BLEND_PIXEL_SIZE: 4,
  MIN_BLEND_PIXEL_SIZE: 1,
  MAX_BLEND_PIXEL_SIZE: 32,

  DEFAULT_BLEND_STRENGTH: 0.2,
  MIN_BLEND_STRENGTH: 0.0,
  MAX_BLEND_STRENGTH: 0.5,

  DEFAULT_NOISE_GRID_DIVISIONS: 10,
  MIN_NOISE_GRID_DIVISIONS: 1,
  MAX_NOISE_GRID_DIVISIONS: 40,

  DEFAULT_SHOW_GRID: false,
  // Toggle visibility of the terrain overlay shapes (named TERRAIN_SHAPE)
  DEFAULT_SHOW_TERRAIN_SHAPE: true,
  DEFAULT_SHOW_TERRAIN_WALLS: true,

  // TERRAIN_SHAPES: define one or more terrain overlay shapes to draw on the
  // gameplay quad after terrain painting finishes. Each shape object may set:
  // - positionX, positionY: pixel coordinates on the background canvas (null
  //   to use the player position instead)
  // - width, height: size in pixels
  // - cornerCurve: corner radius in pixels (clamped to <= min(width,height)/2)
  // - texture: key from `TEXTURE_FILES` to use as repeating fill (falls back
  //   to cyan if missing)
  // - visible: boolean to enable/disable an individual shape
  // - label: optional text to draw at the shape center
  TERRAIN_SHAPES: [
    {
      positionX: 40,
      positionY: 40,
      width: 400,
      height: 400,
      cornerCurve: 50,
      texture: "settlement",
      visible: true,
      label: " "
    },
    {
      positionX: 45,
      positionY: 45,
      width: 400,
      height: 400,
      cornerCurve: 50,
      texture: "lake",
      visible: true,
      label: " "
    }
  ],

  TEXTURE_DIRECTORY: "textures",
  TEXTURE_FILES: {
    grass: "grass_tile_texture.png",//bright green
    dirt: "dirt_tile_texture.png",//brown
    forest: "forest_tile_texture.png",//dark green
    lake: "lake_tile_texture.png",//dark blue
    river: "river_tile_texture.png",//light blue
    road: "road_tile_texture.png",//gray
    mountain: "mountain_tile_texture.png",//dark gray
    settlement: "settlement_tile_texture.png"//yellow
  },

  DEFAULT_TEXTURE_TINT_STRENGTH: 0.38,

  DEFAULT_RELIEF_ENABLED: true,

  DEFAULT_SUN_AZIMUTH: 45,
  MIN_SUN_AZIMUTH: 0,
  MAX_SUN_AZIMUTH: 359,

  DEFAULT_SUN_ELEVATION: 10,
  MIN_SUN_ELEVATION: 5,
  MAX_SUN_ELEVATION: 85,

  DEFAULT_SHADOW_STRENGTH: 0.34,
  MIN_SHADOW_STRENGTH: 0.0,
  MAX_SHADOW_STRENGTH: 1.0,

  DEFAULT_HIGHLIGHT_STRENGTH: 0.5,
  MIN_HIGHLIGHT_STRENGTH: 0.0,
  MAX_HIGHLIGHT_STRENGTH: 1.0,

  DEFAULT_SHADOW_LENGTH: 1,
  MIN_SHADOW_LENGTH: 1.0,
  MAX_SHADOW_LENGTH: 12.0,

  DEFAULT_START_ZOOM: 5.00,
  MIN_START_ZOOM: 2.0,
  MAX_START_ZOOM: 5.0,
  DEFAULT_ZOOM_STEP: 0.1,

  CAMERA_MOVE_SPEED: 18,

  CAMERA_DRAG_INERTIA_FRICTION: 0.92,
  CAMERA_DRAG_INERTIA_MIN_VELOCITY: 0.02,
  CAMERA_DRAG_TOUCH_MULTIPLIER: 1.15,
};

// Load the terrain-boundary patch while HTML parsing is still in progress so
// its DOMContentLoaded hook is registered before the application initializer.
if (typeof document !== "undefined" && document.readyState === "loading") {
  document.write('<script src="js/organic_elevation.js"><\/script>');
}
