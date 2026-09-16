const TOKEN_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

// WP-104/I09 #490: compatibility aliases for the shared interior/cutaway
// compositor semantics that were introduced before the final Admin atlas
// metadata was locked. The registry key remains the compositor-facing semantic,
// while the source path is redirected to the truthful canonical 100px filename.
// This is presentation-only and never changes Simulation authority.
export const INTERIOR_CUTAWAY_RUNTIME_SOURCE_BY_TYPE = Object.freeze({
  wood_floor_horizontal_dark: 'wood_floor_dark_horizontal',
  wood_floor_horizontal_mixed: 'wood_floor_mixed_planks',
  wood_floor_vertical_plank: 'wood_floor_vertical_planks',
  wood_floor_horizontal_rustic: 'wood_floor_irregular_horizontal',
  wood_floor_horizontal_light: 'wood_floor_light_horizontal',
  wood_floor_herringbone: 'wood_floor_herringbone',
  wood_floor_panel_inset: 'wood_floor_wide_horizontal',
  stone_floor_cobble_light: 'stone_floor_irregular_light',
  stone_floor_cobble_mossy: 'stone_floor_mossy_cobble',
  stone_floor_flagstone_light: 'stone_floor_large_slabs',
  earth_floor_compacted_dark: 'earth_floor_packed',
  timber_plaster_cutaway_wall_horizontal: 'timber_cutaway_boundary_01',
  timber_plaster_cutaway_wall_vertical: 'timber_cutaway_boundary_02',
  timber_plaster_cutaway_wall_l_01: 'timber_cutaway_boundary_03',
  timber_plaster_cutaway_wall_l_02: 'timber_cutaway_boundary_04',
  timber_plaster_window_wall_wide: 'window_lowwall_boundary_01',
  timber_doorway_frame_wide: 'doorway_threshold_01',
  timber_post_single_01: 'floor_wall_transition_01',
  stone_cutaway_wall_horizontal: 'stone_cutaway_boundary_01',
  stone_cutaway_wall_vertical: 'stone_cutaway_boundary_02',
  stone_cutaway_wall_l_01: 'stone_cutaway_boundary_03',
  stone_cutaway_wall_l_02: 'stone_cutaway_boundary_04',
  stone_window_wall: 'window_lowwall_boundary_02',
  stone_arch_doorway: 'doorway_threshold_02',
  stone_wall_niche: 'floor_wall_transition_02',
});

function requireToken(value, label) {
  if (typeof value !== 'string' || !TOKEN_RE.test(value)) {
    throw new Error(`${label} must be a normalized semantic token.`);
  }
  return value;
}

function requireSize(value) {
  if (!Number.isInteger(value) || value <= 0) throw new Error('Tile size must be a positive integer.');
  return value;
}

function normalizePath(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Tile source path must be a non-empty string.');
  const source = value.trim().replace(/\\/g, '/');
  if (source.startsWith('/') || source.includes('://') || source.split('/').includes('..')) {
    throw new Error('Tile source path must be a same-origin relative repository path.');
  }
  return source;
}

export function semanticTileKey(family, type, size = 256) {
  return `${requireToken(family, 'Tile family')}:${requireToken(type, 'Tile type')}:${requireSize(size)}`;
}

export class SemanticTileRegistry {
  constructor(entries = []) {
    this._entries = new Map();
    for (const entry of entries) this.register(entry);
  }

  register(entry) {
    if (!entry || typeof entry !== 'object') throw new Error('Tile registry entry must be an object.');
    const family = requireToken(entry.family, 'Tile family');
    const type = requireToken(entry.type, 'Tile type');
    const size = requireSize(entry.size ?? 256);
    let source = normalizePath(entry.source);
    if (family === 'interior_cutaway' && size === 100) {
      const canonicalType = INTERIOR_CUTAWAY_RUNTIME_SOURCE_BY_TYPE[type];
      if (canonicalType) {
        source = `textures/tiles/interior_cutaway/interior_cutaway_${canonicalType}_100px.png`;
      }
    }
    const key = semanticTileKey(family, type, size);
    if (this._entries.has(key)) throw new Error(`Duplicate semantic tile entry: ${key}.`);
    const normalized = Object.freeze({ family, type, size, source });
    this._entries.set(key, normalized);
    return normalized;
  }

  resolve(family, type, size = 256) {
    const key = semanticTileKey(family, type, size);
    const entry = this._entries.get(key);
    if (!entry) throw new Error(`Missing semantic tile entry: ${key}.`);
    return entry;
  }

  has(family, type, size = 256) {
    return this._entries.has(semanticTileKey(family, type, size));
  }

  entries() {
    return [...this._entries.values()].sort((a, b) => semanticTileKey(a.family, a.type, a.size).localeCompare(semanticTileKey(b.family, b.type, b.size)));
  }
}

export const ROAD_TILE_TYPES = Object.freeze([
  'straight_vertical',
  'straight_horizontal',
  'cross',
  'turn_ne',
  'turn_es',
  'turn_sw',
  'turn_wn',
  't_junction',
]);

export const LOCAL_ROAD_TILE_SIZE = 100;
export const ROAD_TILE_SOURCE_BY_TYPE = Object.freeze({
  straight_vertical: 'road_r00_c00_100px.png',
  straight_horizontal: 'road_r00_c01_100px.png',
  cross: 'road_r00_c05_100px.png',
  turn_ne: 'road_r00_c03_100px.png',
  turn_es: 'road_r00_c03_100px.png',
  turn_sw: 'road_r00_c03_100px.png',
  turn_wn: 'road_r00_c03_100px.png',
  t_junction: 'road_r01_c02_100px.png',
});

export const MAIN_ROAD_TILE_TYPES = Object.freeze([
  'main_straight_vertical_left',
  'main_straight_vertical_right',
  'main_straight_horizontal_top',
  'main_straight_horizontal_bottom',
  'main_turn_ne_inner',
  'main_turn_ne_outer',
  'main_turn_es_inner',
  'main_turn_es_outer',
  'main_turn_sw_inner',
  'main_turn_sw_outer',
  'main_turn_wn_inner',
  'main_turn_wn_outer',
  'main_transition_vertical',
  'main_transition_horizontal',
  'main_intersection_cross',
]);

export const STARTER_BUILDING_FAMILIES = Object.freeze([
  'home', 'inn', 'village_hall', 'bakery', 'market', 'smithy',
  'workshop', 'guard_post', 'mill', 'farmstead', 'storage', 'well',
]);

export const STARTER_BUILDING_TILE_TYPES = Object.freeze([
  'roof_corner_nw', 'roof_edge_n', 'roof_corner_ne', 'roof_ridge',
  'wall_edge_w', 'wall_center', 'wall_edge_e', 'wall_window',
  'base_corner_sw', 'entrance', 'base_corner_se', 'family_feature',
]);

export function createCanonicalRoadTileRegistry() {
  return new SemanticTileRegistry(ROAD_TILE_TYPES.map((type) => ({
    family: 'road',
    type,
    size: LOCAL_ROAD_TILE_SIZE,
    source: `textures/tiles/road/${ROAD_TILE_SOURCE_BY_TYPE[type]}`,
  })));
}

export function createCanonicalMainRoadTileRegistry() {
  return new SemanticTileRegistry(MAIN_ROAD_TILE_TYPES.map((type) => ({
    family: 'main_road',
    type,
    size: 256,
    source: `textures/tiles/main_road/main_road_${type}_256px.png`,
  })));
}

export function createCanonicalStarterBuildingTileRegistry() {
  return new SemanticTileRegistry(STARTER_BUILDING_FAMILIES.flatMap((family) =>
    STARTER_BUILDING_TILE_TYPES.map((type) => ({
      family,
      type,
      size: 256,
      source: `textures/tiles/building/${family}/${family}_${type}_256px.png`,
    }))));
}

export function resolveTileUrl(entry, baseUrl = globalThis.location?.href ?? 'http://localhost/') {
  if (!entry || typeof entry !== 'object') throw new Error('Tile entry is required.');
  const source = normalizePath(entry.source);
  const base = new URL(baseUrl);
  const url = new URL(source, base);
  if (url.origin !== base.origin) throw new Error('Tile URL must remain same-origin.');
  return url.href;
}

export async function loadSemanticTile(registry, family, type, options = {}) {
  if (!(registry instanceof SemanticTileRegistry)) throw new Error('A SemanticTileRegistry is required.');
  const entry = registry.resolve(family, type, options.size ?? 256);
  const url = resolveTileUrl(entry, options.baseUrl);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation is available for tile loading.');
  const response = await fetchImpl(url, { credentials: 'same-origin' });
  if (!response || !response.ok) throw new Error(`Failed to load semantic tile ${semanticTileKey(entry.family, entry.type, entry.size)}.`);
  return { entry, url, response };
}
