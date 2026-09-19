const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

const compositor = read('js/static_tile_compositor.js');
const utils = read('js/utils.js');
const renderer = read('js/renderer.js');
const vegetation = read('js/low_vegetation_runtime.js');
const interiors = read('js/starter_village_interiors.js');

assert.match(compositor, /COMPOSITE_TILE_PX\s*=\s*100/);
assert.match(compositor, /MAX_CACHE_TILES\s*=\s*512/);
assert.match(compositor, /layerPolicy:'static-background-plus-dynamic-npc-only'/);
assert.match(compositor, /npcDynamicException:true/);
assert.match(compositor, /source:'road'/);
assert.match(compositor, /source:'building'/);
assert.match(compositor, /configureObjectRegistry/);

assert.match(vegetation, /StaticTileCompositor/);
assert.match(vegetation, /configureObjectRegistry\(registryEntries\(\)\)/);
assert.ok(!vegetation.includes("createElement('canvas')"));
assert.ok(!vegetation.includes('createElement("canvas")'));

assert.match(interiors, /StaticTileCompositor/);
assert.ok(!interiors.includes('starterVillageInteriorOverlay'));
assert.ok(!interiors.includes("createElement('canvas')"));

for (const retired of [
  'starter_village_roads.js',
  'road_runtime_bridge.js',
  'main_road_renderer.js',
  'starter_village_exteriors.js',
  'world_object_renderer.js',
  'starter_village_dev_overlay.js',
  'vector_layer_debug.js'
]) {
  assert.ok(!utils.includes(retired), `normal load path must not load retired static layer ${retired}`);
  assert.ok(!exists(path.join('js', retired)), `retired static layer must remain deleted: ${retired}`);
}

for (const forbiddenId of [
  'starterVillageRoadOverlay',
  'starterVillageInteriorOverlay',
  'starterVillageExteriorOverlay',
  'worldObjectOverlay',
  'vegetationOverlay',
  'treeOverlay',
  'buildingOverlay',
  'roadOverlay'
]) {
  assert.ok(!renderer.includes(forbiddenId), `renderer must not retain independent static world layer ${forbiddenId}`);
}

console.log('Issue #526 non-NPC static layer guard: PASS');
