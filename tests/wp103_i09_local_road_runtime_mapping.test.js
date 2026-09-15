const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const registrySource = fs.readFileSync(path.join(root, 'js', 'tile_registry.js'), 'utf8');
const compositorSource = fs.readFileSync(path.join(root, 'js', 'static_tile_compositor.js'), 'utf8');
const semanticPath = path.join(root, 'textures', 'tiles', 'road', 'road_runtime_semantics.json');
const semantics = JSON.parse(fs.readFileSync(semanticPath, 'utf8'));

assert.strictEqual(semantics.family, 'road');
assert.strictEqual(semantics.sourceTileSize, 100);
assert.strictEqual(semantics.constraints.simulationAuthority, false);
assert.strictEqual(semantics.constraints.logicalCompositeSize, 100);
assert.strictEqual(semantics.constraints.noIndependentPersistentRoadLayer, true);

const expectedSources = {
  straight_vertical: 'road_r00_c00_100px.png',
  straight_horizontal: 'road_r00_c01_100px.png',
  cross: 'road_r00_c05_100px.png',
  t_junction: 'road_r01_c02_100px.png',
  turn_wn: 'road_r00_c03_100px.png',
  turn_ne: 'road_r00_c03_100px.png',
  turn_es: 'road_r00_c03_100px.png',
  turn_sw: 'road_r00_c03_100px.png',
};

for (const [type, filename] of Object.entries(expectedSources)) {
  assert(semantics.semantics[type], `Missing semantic mapping for ${type}.`);
  assert.strictEqual(semantics.semantics[type].source, filename, `Unexpected semantic source for ${type}.`);
  const fullPath = path.join(root, 'textures', 'tiles', 'road', filename);
  assert(fs.existsSync(fullPath), `Mapped road source does not exist: ${filename}.`);
  const png = fs.readFileSync(fullPath);
  assert(png.length > 8, `Mapped road source is empty: ${filename}.`);
  assert.deepStrictEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10], `Mapped road source is not PNG: ${filename}.`);
}

assert.strictEqual(semantics.semantics.turn_wn.quarterTurns, 0);
assert.strictEqual(semantics.semantics.turn_ne.quarterTurns, 1);
assert.strictEqual(semantics.semantics.turn_es.quarterTurns, 2);
assert.strictEqual(semantics.semantics.turn_sw.quarterTurns, 3);
assert.strictEqual(semantics.deadEndPolicy.sourceHalfSize, 50);
assert.strictEqual(semantics.deadEndPolicy.clipAtCompositeTime, true);

assert(registrySource.includes('export const LOCAL_ROAD_TILE_SIZE = 100;'), 'Road registry must expose the 100px local-road source size.');
for (const filename of new Set(Object.values(expectedSources))) {
  assert(registrySource.includes(filename), `Road registry must reference ${filename}.`);
}
assert(!registrySource.includes('textures/tiles/road/road_${type}_256px.png'), 'Local-road registry must not use deleted legacy 256px semantic filenames.');
assert(registrySource.includes('size: LOCAL_ROAD_TILE_SIZE'), 'Local-road registry entries must resolve at 100px.');

assert(compositorSource.includes("const LOCAL_ROAD_TILE_PX = 100;"), 'Compositor must declare the 100px local-road source size.');
assert(compositorSource.includes("q={S:0,W:1,N:2,E:3}[m]"), 'T-junction rotation must match the committed missing-S base tile.');
assert(compositorSource.includes("type:'turn_ne',quarterTurns:1"), 'NE corner must rotate the WN base once.');
assert(compositorSource.includes("type:'turn_es',quarterTurns:2"), 'ES corner must rotate the WN base twice.');
assert(compositorSource.includes("type:'turn_sw',quarterTurns:3"), 'SW corner must rotate the WN base three times.');
assert(compositorSource.includes("clip:[0,0,100,50]"), 'North dead end must use 100px/50px clipping.');
assert(compositorSource.includes("clip:[0,50,100,50]"), 'South dead end must use 100px/50px clipping.');
assert(compositorSource.includes("clip:[0,0,50,100]"), 'West dead end must use 100px/50px clipping.');
assert(compositorSource.includes("clip:[50,0,50,100]"), 'East dead end must use 100px/50px clipping.');
assert(compositorSource.includes('sx/sourcePx*COMPOSITE_TILE_PX'), 'Clip scaling must use each overlay source size rather than a global 256px assumption.');
assert(compositorSource.includes("source:'road'"), 'Roads must remain part of the unified static composition path.');
assert(!compositorSource.includes('starterVillageRoadOverlay'), 'Runtime must not recreate an independent persistent road overlay.');

console.log('wp103_i09_local_road_runtime_mapping: PASS');
