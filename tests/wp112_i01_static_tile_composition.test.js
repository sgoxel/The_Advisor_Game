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
assert.match(staticStandard, /Runtime tile: `100x100 RGBA`/);
assert.match(staticStandard, /Non-NPC static visuals resolve into the 100x100 tile composite/);
assert.match(staticStandard, /Do not keep duplicate persistent static image layers/);
assert.match(staticStandard, /NPC visuals may remain dynamic/);
assert.match(textureStandard, /Atlas: `1000x1000 RGBA PNG`/);
assert.match(textureStandard, /Grid: `10x10`/);
assert.match(textureStandard, /Cell: `100x100`/);
assert.match(textureStandard, /Runtime uses committed family/);

console.log('WP-112/I01 static 100x100 tile composition source regression: PASS');
