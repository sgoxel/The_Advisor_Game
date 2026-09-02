import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SemanticTileRegistry, ROAD_TILE_TYPES, MAIN_ROAD_TILE_TYPES,
  STARTER_BUILDING_FAMILIES, STARTER_BUILDING_TILE_TYPES,
  createCanonicalRoadTileRegistry, createCanonicalMainRoadTileRegistry,
  createCanonicalStarterBuildingTileRegistry, loadSemanticTile, resolveTileUrl,
} from '../../js/tile_registry.js';

test('canonical road registry exposes eight deterministic 256px semantic assets', () => {
  const registry = createCanonicalRoadTileRegistry();
  assert.equal(registry.entries().length, 8);
  for (const type of ROAD_TILE_TYPES) {
    assert.deepEqual(registry.resolve('road', type, 256), {
      family: 'road', type, size: 256, source: `textures/tiles/road/road_${type}_256px.png`,
    });
  }
});

test('canonical main-road registry exposes the fifteen occupied atlas cells only', () => {
  const registry = createCanonicalMainRoadTileRegistry();
  assert.equal(registry.entries().length, 15);
  assert.equal(MAIN_ROAD_TILE_TYPES.length, 15);
  for (const type of MAIN_ROAD_TILE_TYPES) {
    assert.deepEqual(registry.resolve('main_road', type, 256), {
      family: 'main_road', type, size: 256, source: `textures/tiles/main_road/main_road_${type}_256px.png`,
    });
  }
  assert.equal(registry.has('main_road', 'transparent_reserve', 256), false);
});

test('starter-building registry exposes all twelve verified families and semantic cells', () => {
  const registry = createCanonicalStarterBuildingTileRegistry();
  assert.equal(STARTER_BUILDING_FAMILIES.length, 12);
  assert.equal(STARTER_BUILDING_TILE_TYPES.length, 12);
  assert.equal(registry.entries().length, 144);
  for (const family of STARTER_BUILDING_FAMILIES) {
    for (const type of STARTER_BUILDING_TILE_TYPES) {
      assert.deepEqual(registry.resolve(family, type, 256), {
        family, type, size: 256,
        source: `textures/tiles/building/${family}/${family}_${type}_256px.png`,
      });
    }
  }
});

test('equivalent input resolves identically regardless of registration order', () => {
  const entries = createCanonicalRoadTileRegistry().entries();
  const forward = new SemanticTileRegistry(entries);
  const reverse = new SemanticTileRegistry([...entries].reverse());
  assert.deepEqual(forward.entries(), reverse.entries());
});

test('missing, duplicate and malformed entries fail safely', () => {
  const registry = new SemanticTileRegistry([{ family: 'road', type: 'cross', size: 256, source: 'textures/tiles/road/road_cross_256px.png' }]);
  assert.throws(() => registry.resolve('road', 'turn_ne', 256), /Missing semantic tile/);
  assert.throws(() => registry.register({ family: 'road', type: 'cross', size: 256, source: 'textures/tiles/road/other.png' }), /Duplicate semantic tile/);
  assert.throws(() => registry.register({ family: 'road', type: 'bad type', size: 256, source: 'x.png' }), /normalized semantic token/);
  assert.throws(() => registry.register({ family: 'road', type: 'turn_ne', size: 256, source: '../escape.png' }), /same-origin relative/);
});

test('same-origin URL resolution never needs atlas coordinates', () => {
  const entry = createCanonicalRoadTileRegistry().resolve('road', 'turn_ne');
  assert.equal(resolveTileUrl(entry, 'https://game.example/app/index.html'), 'https://game.example/app/textures/tiles/road/road_turn_ne_256px.png');
  const mainEntry = createCanonicalMainRoadTileRegistry().resolve('main_road', 'main_intersection_cross');
  assert.equal(resolveTileUrl(mainEntry, 'https://game.example/app/index.html'), 'https://game.example/app/textures/tiles/main_road/main_road_main_intersection_cross_256px.png');
  const buildingEntry = createCanonicalStarterBuildingTileRegistry().resolve('smithy', 'entrance');
  assert.equal(resolveTileUrl(buildingEntry, 'https://game.example/app/index.html'), 'https://game.example/app/textures/tiles/building/smithy/smithy_entrance_256px.png');
});

test('loader uses semantic lookup and same-origin credentials', async () => {
  const registry = createCanonicalRoadTileRegistry();
  let observed;
  const response = { ok: true, status: 200 };
  const loaded = await loadSemanticTile(registry, 'road', 'cross', {
    baseUrl: 'https://game.example/',
    fetchImpl: async (url, options) => { observed = { url, options }; return response; },
  });
  assert.equal(loaded.response, response);
  assert.deepEqual(observed, {
    url: 'https://game.example/textures/tiles/road/road_cross_256px.png',
    options: { credentials: 'same-origin' },
  });
});

test('loader surfaces missing HTTP assets without mutating registry', async () => {
  const registry = createCanonicalRoadTileRegistry();
  const before = registry.entries();
  await assert.rejects(() => loadSemanticTile(registry, 'road', 'cross', {
    baseUrl: 'https://game.example/', fetchImpl: async () => ({ ok: false, status: 404 }),
  }), /Failed to load semantic tile/);
  assert.deepEqual(registry.entries(), before);
});
