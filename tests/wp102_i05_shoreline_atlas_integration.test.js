const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const family = path.join(root, 'textures/tiles/shoreline');
const manifest = JSON.parse(read('textures/tiles/shoreline/shoreline_tiles.manifest.json'));
const descriptions = JSON.parse(read('textures/tiles/shoreline/shoreline_tiles.descriptions.json'));
const config = read('js/config.js');

assert.strictEqual(manifest.family, 'shoreline');
assert.deepStrictEqual(
  [manifest.atlas.width, manifest.atlas.height, manifest.atlas.mode],
  [1000, 1000, 'RGBA']
);
assert.deepStrictEqual(
  [manifest.atlas.columns, manifest.atlas.rows, manifest.atlas.cellSize, manifest.atlas.ordering],
  [10, 10, 100, 'row-major']
);
assert.strictEqual(manifest.derivedTilePolicy.borderTrimPx, 0);
assert.strictEqual(manifest.tiles.length, 100);
assert.strictEqual(descriptions.tiles.length, 100);
assert.strictEqual(new Set(manifest.tiles.map((tile) => tile.semantic_type)).size, 100);

const atlasBytes = fs.readFileSync(path.join(family, manifest.atlas.filename));
assert.strictEqual(crypto.createHash('sha256').update(atlasBytes).digest('hex'), manifest.atlas.sha256);

for (let row = 0; row < 10; row += 1) {
  for (let col = 0; col < 10; col += 1) {
    const semantic = `r${String(row).padStart(2, '0')}_c${String(col).padStart(2, '0')}`;
    const filename = `shoreline_${semantic}_100px.png`;
    const record = manifest.tiles.find((tile) => tile.semantic_type === semantic);
    assert.ok(record, `missing manifest record ${semantic}`);
    assert.strictEqual(record.filename, filename);
    const bytes = fs.readFileSync(path.join(family, filename));
    assert.deepStrictEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.strictEqual(crypto.createHash('sha256').update(bytes).digest('hex'), record.sha256);
  }
}

assert.match(config, /shoreline: "tiles\/shoreline\/shoreline_r00_c00_100px\.png"/);
assert.match(config, /shoreline: Array\.from\(\{ length: 100 \}/);
assert.match(config, /tiles\/shoreline\/shoreline_r\$\{String\(row\)/);

console.log('WP-102/I05 shoreline atlas registry regression: PASS');
