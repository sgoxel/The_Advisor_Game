const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const family = path.join(root, 'textures/tiles/low_vegetation');
const manifest = JSON.parse(read('textures/tiles/low_vegetation/low_vegetation_tiles.manifest.json'));
const descriptions = JSON.parse(read('textures/tiles/low_vegetation/low_vegetation_tiles.descriptions.json'));
const runtimeSource = read('js/low_vegetation_runtime.js');
const utils = read('js/utils.js');
const compositor = read('js/static_tile_compositor.js');

assert.strictEqual(manifest.family, 'low_vegetation');
assert.strictEqual(descriptions.family, 'low_vegetation');
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
  const expectedType = `r${String(Math.floor(index / 10)).padStart(2, '0')}_c${String(index % 10).padStart(2, '0')}`;
  assert.strictEqual(tile.index, index);
  assert.strictEqual(tile.semantic_type, expectedType);
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

const sandbox = {
  console,
  setTimeout: () => 0,
  clearTimeout: () => {},
  Game: {}
};
sandbox.globalThis = sandbox;
vm.runInNewContext(runtimeSource, sandbox, { filename: 'low_vegetation_runtime.js' });
const runtime = sandbox.Game.LowVegetationRuntime;

assert.ok(runtime);
assert.strictEqual(runtime.authority, 'presentation-only');
assert.strictEqual(runtime.family, 'low_vegetation');
assert.strictEqual(runtime.tileSize, 100);
assert.strictEqual(runtime.variantCount, 100);
assert.strictEqual(runtime.registryEntries().length, 100);
assert.deepStrictEqual(
  runtime.registryEntries().map((entry) => entry.type),
  manifest.tiles.map((tile) => tile.semantic_type)
);
assert.deepStrictEqual(
  runtime.registryEntries().map((entry) => path.basename(entry.source)),
  manifest.tiles.map((tile) => tile.filename)
);

const rows = 100;
const cols = 100;
const terrain = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({
  type: 'grass',
  elevation: 0,
  tags: new Set()
})));
const world = {
  seed: 'WP102-I07-TEST',
  rows,
  cols,
  terrain,
  originVillage: {
    roadTiles: [{ row: 10, col: 10 }, { row: 10, col: 11 }],
    buildings: [{ footprint: { row: 20, col: 20, height: 3, width: 4 } }]
  }
};
terrain[30][30].tags.add('road');
terrain[40][40].blocked = true;
terrain[50][50].type = 'forest';

const before = JSON.stringify({
  seed: world.seed,
  rows: world.rows,
  cols: world.cols,
  terrain: world.terrain.map((row) => row.map((tile) => ({
    type: tile.type,
    elevation: tile.elevation,
    tags: [...tile.tags],
    blocked: tile.blocked === true
  }))),
  originVillage: world.originVillage
});
const first = runtime.collectOverlayCells(world);
const second = runtime.collectOverlayCells(world);
assert.ok(first.length >= 300 && first.length <= 700, `unexpected low-vegetation density: ${first.length}`);
assert.deepStrictEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)));
assert.strictEqual(new Set(first.map((cell) => `${cell.row},${cell.col}`)).size, first.length);
assert.ok(first.every((cell) => cell.family === 'low_vegetation' && cell.size === 100));
assert.ok(first.every((cell) => /^r\d{2}_c\d{2}$/.test(cell.type)));
assert.ok(!first.some((cell) => cell.row === 10 && (cell.col === 10 || cell.col === 11)));
assert.ok(!first.some((cell) => cell.row >= 20 && cell.row < 23 && cell.col >= 20 && cell.col < 24));
assert.ok(!first.some((cell) => cell.row === 30 && cell.col === 30));
assert.ok(!first.some((cell) => cell.row === 40 && cell.col === 40));
assert.ok(!first.some((cell) => cell.row === 50 && cell.col === 50));
assert.strictEqual(before, JSON.stringify({
  seed: world.seed,
  rows: world.rows,
  cols: world.cols,
  terrain: world.terrain.map((row) => row.map((tile) => ({
    type: tile.type,
    elevation: tile.elevation,
    tags: [...tile.tags],
    blocked: tile.blocked === true
  }))),
  originVillage: world.originVillage
}));

const descriptors = runtime.buildPresentationDescriptors(world);
assert.strictEqual(descriptors.length, first.length);
assert.ok(descriptors.every((descriptor) => descriptor.authority === 'simulation'));
assert.ok(descriptors.every((descriptor) => descriptor.presentationOnly === true));
assert.ok(descriptors.every((descriptor) => descriptor.visual.authority === 'presentation-only'));
assert.ok(descriptors.every((descriptor) => descriptor.footprint.occupiedCells.length === 1));
assert.ok(descriptors.every((descriptor) => descriptor.visual.semanticKey.startsWith('low_vegetation:')));

assert.match(utils, /js\/low_vegetation_runtime\.js/);
assert.ok(utils.indexOf('js/static_tile_compositor.js') < utils.indexOf('js/low_vegetation_runtime.js'));
assert.match(compositor, /objectPresentationDescriptors/);
assert.match(compositor, /category:30/);
assert.match(compositor, /customRegistry:true/);
assert.match(runtimeSource, /configureObjectRegistry\(registryEntries\(\)\)/);
assert.ok(!runtimeSource.includes("createElement('canvas')"));
assert.ok(!runtimeSource.includes('createElement("canvas")'));

console.log('WP-102/I07 low-vegetation runtime integration regression: PASS');
