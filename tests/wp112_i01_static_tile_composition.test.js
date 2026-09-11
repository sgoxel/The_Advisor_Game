const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(root, p));

const compositor = read('js/static_tile_compositor.js');
const utils = read('js/utils.js');
const readme = read('README.md');
const staticStandard = read('.github/STATIC_TILE_COMPOSITION_STANDARD.md');
const textureStandard = read('.github/TEXTURE_ATLAS_STANDARD.md');
const interiors = read('js/starter_village_interiors.js');
const debugExport = read('js/debug_log_export.js');

assert.match(compositor, /COMPOSITE_TILE_PX\s*=\s*100/);
assert.match(compositor, /static-background-plus-dynamic-npc-only/);
assert.match(compositor, /MAX_CACHE_TILES\s*=\s*512/);
assert.match(compositor, /worldBackgroundCanvas/);
assert.match(compositor, /drawImage\(baseSnapshot/);
assert.match(compositor, /npcDynamicException:\s*true/);

assert.match(utils, /js\/static_tile_compositor\.js/);
for (const retired of [
  'starter_village_roads.js',
  'road_runtime_bridge.js',
  'main_road_renderer.js',
  'starter_village_exteriors.js',
  'world_object_renderer.js',
  'starter_village_dev_overlay.js',
  'vector_layer_debug.js'
]) {
  assert.ok(!utils.includes(retired), `utils must not load retired layer ${retired}`);
  assert.ok(!exists(`js/${retired}`), `retired layer file must be deleted: ${retired}`);
}

assert.ok(!interiors.includes("createElement('canvas')"));
assert.ok(!interiors.includes('starterVillageInteriorOverlay'));
assert.ok(!debugExport.includes('vector_layer_debug.js'));

assert.match(readme, /Static 100 × 100 Tile Composition/);
assert.match(readme, /NPC world sprites are the sole normal independently dynamic world-image exception/);
assert.match(readme, /All non-NPC world art is flattened into exact \*\*100 × 100 RGBA logical-tile composites\*\*/);
assert.match(staticStandard, /exact \*\*100 x 100 px RGBA static presentation composite\*\*/);
assert.match(staticStandard, /NPCs are the only normal independently dynamic world-image exception/);
assert.match(textureStandard, /Mandatory 100x100 static composition/);
assert.match(textureStandard, /PNG slices are \*\*source artwork, not independent runtime image objects\*\*/);

console.log('WP-112/I01 static 100x100 tile composition source regression: PASS');
