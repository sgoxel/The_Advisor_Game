const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const context = { console };
context.window = context;
context.document = {
  readyState: 'complete',
  addEventListener() {},
  getElementById() { return null; }
};
vm.createContext(context);
for (const file of ['js/config.js', 'js/rng.js', 'js/spatial_world.js', 'js/region_road_continuity.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

const { Game } = context;
assert(Game.RegionTerrain, 'RegionTerrain must be installed');
assert(Game.RegionRoadContinuity?.installed, 'RegionRoadContinuity must be installed');
assert.strictEqual(Game.RegionRoadContinuity.authority, 'simulation');

function assertRoad(tile, message) {
  assert.strictEqual(tile.type, 'road', `${message}: type`);
  assert.strictEqual(tile.road, true, `${message}: road flag`);
  assert.strictEqual(tile.water, false, `${message}: water flag`);
}

function verifyEastWest(seed, leftX, regionY) {
  const rightX = leftX + 1;
  const left = Game.RegionTerrain.generateRegion(seed, leftX, regionY);
  const right = Game.RegionTerrain.generateRegion(seed, rightX, regionY);
  const leftAgain = Game.RegionTerrain.generateRegion(seed, leftX, regionY);
  const rightAgain = Game.RegionTerrain.generateRegion(seed, rightX, regionY);
  let crossings = 0;

  for (let row = 0; row < 100; row += 1) {
    const a = left.tiles[row][99];
    const b = right.tiles[row][0];
    const baseA = Game.RegionTerrain.sampleTile(seed, a.worldX, a.worldY);
    const baseB = Game.RegionTerrain.sampleTile(seed, b.worldX, b.worldY);
    const bothWalkable = !baseA.water && baseA.type !== 'mountain' && !baseB.water && baseB.type !== 'mountain';
    const shouldBridge = bothWalkable && (baseA.road || baseB.road);

    assert.strictEqual(a.worldX + 1, b.worldX, 'east/west seam must use adjacent world X');
    assert.strictEqual(a.worldY, b.worldY, 'east/west seam must preserve world Y');
    assert.strictEqual(a.type, leftAgain.tiles[row][99].type, 'left road topology must regenerate deterministically');
    assert.strictEqual(b.type, rightAgain.tiles[row][0].type, 'right road topology must regenerate deterministically');

    if (shouldBridge) {
      crossings += 1;
      assertRoad(a, 'left exit must be authoritative road');
      assertRoad(b, 'right entry must be authoritative road');
    }
  }

  return crossings;
}

function verifyNorthSouth(seed, regionX, northY) {
  const southY = northY + 1;
  const north = Game.RegionTerrain.generateRegion(seed, regionX, northY);
  const south = Game.RegionTerrain.generateRegion(seed, regionX, southY);
  const northAgain = Game.RegionTerrain.generateRegion(seed, regionX, northY);
  const southAgain = Game.RegionTerrain.generateRegion(seed, regionX, southY);
  let crossings = 0;

  for (let col = 0; col < 100; col += 1) {
    const a = north.tiles[99][col];
    const b = south.tiles[0][col];
    const baseA = Game.RegionTerrain.sampleTile(seed, a.worldX, a.worldY);
    const baseB = Game.RegionTerrain.sampleTile(seed, b.worldX, b.worldY);
    const bothWalkable = !baseA.water && baseA.type !== 'mountain' && !baseB.water && baseB.type !== 'mountain';
    const shouldBridge = bothWalkable && (baseA.road || baseB.road);

    assert.strictEqual(a.worldY + 1, b.worldY, 'north/south seam must use adjacent world Y');
    assert.strictEqual(a.worldX, b.worldX, 'north/south seam must preserve world X');
    assert.strictEqual(a.type, northAgain.tiles[99][col].type, 'north road topology must regenerate deterministically');
    assert.strictEqual(b.type, southAgain.tiles[0][col].type, 'south road topology must regenerate deterministically');

    if (shouldBridge) {
      crossings += 1;
      assertRoad(a, 'north exit must be authoritative road');
      assertRoad(b, 'south entry must be authoritative road');
    }
  }

  return crossings;
}

let totalCrossings = 0;
for (const seed of ['WP041-ROAD-A', 'WP041-ROAD-B', 'WP041-ROAD-C']) {
  totalCrossings += verifyEastWest(seed, 0, 0);
  totalCrossings += verifyNorthSouth(seed, 0, 0);
  totalCrossings += verifyEastWest(seed, -1, -1);
  totalCrossings += verifyNorthSouth(seed, -1, -1);
}
assert(totalCrossings > 0, 'fixture seeds must exercise at least one shared-edge road crossing');

console.log(`WP-041/I04 region road continuity regression: PASS (${totalCrossings} shared-edge crossings)`);
