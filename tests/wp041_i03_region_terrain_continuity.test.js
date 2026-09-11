const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const context = { console };
context.window = context;
vm.createContext(context);
for (const file of ['js/config.js', 'js/rng.js', 'js/spatial_world.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

const { Game } = context;
assert(Game.RegionTerrain, 'RegionTerrain must be installed');
assert.strictEqual(Game.RegionTerrain.regionSize, 100);
assert.strictEqual(Game.RegionTerrain.authority, 'simulation');

function tileSignature(tile) {
  return JSON.stringify({
    type: tile.type,
    water: Boolean(tile.water),
    road: Boolean(tile.road),
    worldX: tile.worldX,
    worldY: tile.worldY
  });
}

function verifyPair(seed, ax, ay, bx, by, direction) {
  const a = Game.RegionTerrain.generateRegion(seed, ax, ay);
  const b = Game.RegionTerrain.generateRegion(seed, bx, by);
  const againA = Game.RegionTerrain.generateRegion(seed, ax, ay);
  const againB = Game.RegionTerrain.generateRegion(seed, bx, by);

  assert.strictEqual(Game.RegionTerrain.fingerprint(a), Game.RegionTerrain.fingerprint(againA), 'same SEED/coordinates must reproduce region A');
  assert.strictEqual(Game.RegionTerrain.fingerprint(b), Game.RegionTerrain.fingerprint(againB), 'same SEED/coordinates must reproduce region B');

  for (let i = 0; i < 100; i += 1) {
    let left;
    let right;
    if (direction === 'east') {
      left = a.tiles[i][99];
      right = b.tiles[i][0];
      assert.strictEqual(left.worldX + 1, right.worldX, 'east/west seam world X must be contiguous');
      assert.strictEqual(left.worldY, right.worldY, 'east/west seam world Y must match');
    } else {
      left = a.tiles[99][i];
      right = b.tiles[0][i];
      assert.strictEqual(left.worldY + 1, right.worldY, 'south/north seam world Y must be contiguous');
      assert.strictEqual(left.worldX, right.worldX, 'south/north seam world X must match');
    }
    assert.strictEqual(tileSignature(left), tileSignature(direction === 'east' ? againA.tiles[i][99] : againA.tiles[99][i]), 'source seam tile must regenerate identically');
    assert.strictEqual(tileSignature(right), tileSignature(direction === 'east' ? againB.tiles[i][0] : againB.tiles[0][i]), 'destination seam tile must regenerate identically');
  }
}

for (const seed of ['WP041-SEAM-A', 'WP041-SEAM-B']) {
  verifyPair(seed, 0, 0, 1, 0, 'east');
  verifyPair(seed, 0, 0, 0, 1, 'south');
  verifyPair(seed, -1, -1, 0, -1, 'east');
  verifyPair(seed, -1, -1, -1, 0, 'south');
}

console.log('WP-041/I03 region terrain continuity regression: PASS');
