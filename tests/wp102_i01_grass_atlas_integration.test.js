const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const family = path.join(root, 'textures/tiles/grass');
const manifest = JSON.parse(read('textures/tiles/grass/grass_tiles.manifest.json'));
const descriptions = JSON.parse(read('textures/tiles/grass/grass_tiles.descriptions.json'));
const config = read('js/config.js');
const renderer = read('js/renderer.js');

assert.strictEqual(manifest.family, 'grass');
assert.strictEqual(manifest.atlas.width, 1000);
assert.strictEqual(manifest.atlas.height, 1000);
assert.strictEqual(manifest.atlas.cellSize, 100);
assert.strictEqual(manifest.tiles.length, 100);
assert.strictEqual(descriptions.tiles.length, 100);
assert.strictEqual(new Set(manifest.tiles.map((tile) => tile.semantic_type)).size, 100);

for (let row = 0; row < 10; row += 1) {
  for (let col = 0; col < 10; col += 1) {
    const semantic = `r${String(row).padStart(2, '0')}_c${String(col).padStart(2, '0')}`;
    const filename = `grass_${semantic}_100px.png`;
    assert.ok(fs.existsSync(path.join(family, filename)), `missing ${filename}`);
    const bytes = fs.readFileSync(path.join(family, filename));
    assert.deepStrictEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
}

assert.match(config, /TEXTURE_VARIANT_FILES/);
assert.match(config, /Array\.from\(\{ length: 100 \}/);
assert.match(renderer, /stableTextureVariantIndex/);
assert.match(renderer, /getTileTexturePattern\(textureCtx, "grass", row, col\)/);
assert.match(renderer, /Terrain texture variants loaded/);

console.log('WP-102/I01 grass atlas integration regression: PASS');
