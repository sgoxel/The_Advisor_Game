const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const family = path.join(root, 'textures/tiles/farm_field');
const manifest = JSON.parse(read('textures/tiles/farm_field/farm_field_tiles.manifest.json'));
const descriptions = JSON.parse(read('textures/tiles/farm_field/farm_field_tiles.descriptions.json'));
const config = read('js/config.js');
const renderer = read('js/renderer.js');

assert.strictEqual(manifest.family, 'farm_field');
assert.strictEqual(manifest.atlas.width, 1000);
assert.strictEqual(manifest.atlas.height, 1000);
assert.strictEqual(manifest.atlas.mode, 'RGBA');
assert.strictEqual(manifest.atlas.columns, 10);
assert.strictEqual(manifest.atlas.rows, 10);
assert.strictEqual(manifest.atlas.cellSize, 100);
assert.strictEqual(manifest.atlas.ordering, 'row-major');
assert.strictEqual(manifest.atlas.sourceWidth, 1254);
assert.strictEqual(manifest.atlas.sourceHeight, 1254);
assert.strictEqual(manifest.atlas.normalizationMode, 'fit');
assert.strictEqual(manifest.tiles.length, 100);
assert.strictEqual(descriptions.tiles.length, 100);
assert.strictEqual(new Set(manifest.tiles.map((tile) => tile.semantic_type)).size, 100);

for (let row = 0; row < 10; row += 1) {
  for (let col = 0; col < 10; col += 1) {
    const semantic = `r${String(row).padStart(2, '0')}_c${String(col).padStart(2, '0')}`;
    const filename = `farm_field_${semantic}_100px.png`;
    assert.ok(fs.existsSync(path.join(family, filename)), `missing ${filename}`);
    const bytes = fs.readFileSync(path.join(family, filename));
    assert.deepStrictEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
}

assert.match(config, /settlement: "tiles\/farm_field\/farm_field_r00_c00_100px\.png"/);
assert.match(config, /settlement: Array\.from\(\{ length: 100 \}/);
assert.match(config, /tiles\/farm_field\/farm_field_r\$\{String\(row\)/);
assert.match(renderer, /stableTextureVariantIndex/);
assert.match(renderer, /TEXTURE_VARIANT_FILES/);

console.log('WP-102/I03 farm-field atlas integration regression: PASS');
