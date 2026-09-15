const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const family = path.join(root, 'textures/tiles/rock_ground_props');
const manifest = JSON.parse(read('textures/tiles/rock_ground_props/rock_ground_props_tiles.manifest.json'));
const descriptions = JSON.parse(read('textures/tiles/rock_ground_props/rock_ground_props_tiles.descriptions.json'));
const config = read('js/config.js');
const renderer = read('js/renderer.js');

assert.strictEqual(manifest.family, 'rock_ground_props');
assert.deepStrictEqual(
  [manifest.atlas.width, manifest.atlas.height, manifest.atlas.mode],
  [1000, 1000, 'RGBA']
);
assert.deepStrictEqual(
  [manifest.atlas.columns, manifest.atlas.rows, manifest.atlas.cellSize, manifest.atlas.ordering],
  [10, 10, 100, 'row-major']
);
assert.strictEqual(manifest.tiles.length, 100);
assert.strictEqual(descriptions.tiles.length, 100);
assert.strictEqual(new Set(manifest.tiles.map((tile) => tile.semantic_type)).size, 100);
assert.deepStrictEqual(
  manifest.tiles.map((tile) => tile.filename),
  descriptions.tiles.map((tile) => tile.filename)
);

const pngInfo = (bytes) => ({
  signature: [...bytes.subarray(0, 8)],
  width: bytes.readUInt32BE(16),
  height: bytes.readUInt32BE(20),
  bitDepth: bytes[24],
  colorType: bytes[25]
});
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const atlasBytes = fs.readFileSync(path.join(family, manifest.atlas.filename));
assert.deepStrictEqual(pngInfo(atlasBytes), {
  signature: [137, 80, 78, 71, 13, 10, 26, 10],
  width: 1000,
  height: 1000,
  bitDepth: 8,
  colorType: 6
});
assert.strictEqual(sha256(atlasBytes), manifest.atlas.sha256);

for (let index = 0; index < manifest.tiles.length; index += 1) {
  const tile = manifest.tiles[index];
  assert.strictEqual(tile.index, index);
  assert.strictEqual(tile.row, Math.floor(index / 10));
  assert.strictEqual(tile.col, index % 10);
  assert.strictEqual(tile.semantic_type, `r${String(tile.row).padStart(2, '0')}_c${String(tile.col).padStart(2, '0')}`);
  const bytes = fs.readFileSync(path.join(family, tile.filename));
  assert.deepStrictEqual(pngInfo(bytes), {
    signature: [137, 80, 78, 71, 13, 10, 26, 10],
    width: 100,
    height: 100,
    bitDepth: 8,
    colorType: 6
  });
  assert.strictEqual(sha256(bytes), tile.sha256, `hash mismatch: ${tile.filename}`);
}

assert.match(config, /mountain: "tiles\/rock_ground_props\/rock_ground_props_r00_c00_100px\.png"/);
assert.match(config, /mountain: Array\.from\(\{ length: 100 \}/);
assert.match(config, /tiles\/rock_ground_props\/rock_ground_props_r\$\{String\(row\)/);
assert.match(renderer, /stableTextureVariantIndex/);
assert.match(renderer, /getTileTexturePattern\(textureCtx, appearance\.type, row, col\)/);
assert.match(renderer, /TEXTURE_VARIANT_FILES/);

console.log('WP-102/I08 rock/ground-props atlas integration regression: PASS');
