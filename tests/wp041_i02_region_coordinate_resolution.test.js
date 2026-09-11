const assert = require('assert');
require('../js/region_transition_resolution.js');

const resolve = globalThis.Game.RegionTransitionResolution.resolve;
const world = { rows: 100, cols: 100 };

function intent(direction, x, y, row, col) {
  const map = {
    north: [0, -1, 'south'], east: [1, 0, 'west'],
    south: [0, 1, 'north'], west: [-1, 0, 'east']
  }[direction];
  return {
    type: 'adjacent-region-crossing-intent', authority: 'simulation-request', direction,
    actorId: 'protagonist:main', fromRegion: { x, y }, fromTile: { row, col },
    regionDelta: { x: map[0], y: map[1] }, requestedEntryEdge: map[2]
  };
}

assert.deepStrictEqual(resolve(world, intent('north', 2, 3, 0, 44)).toRegion, { x: 2, y: 2 });
assert.deepStrictEqual(resolve(world, intent('north', 2, 3, 0, 44)).entryTile, { row: 99, col: 44 });
assert.deepStrictEqual(resolve(world, intent('south', 2, 3, 99, 44)).toRegion, { x: 2, y: 4 });
assert.deepStrictEqual(resolve(world, intent('south', 2, 3, 99, 44)).entryTile, { row: 0, col: 44 });
assert.deepStrictEqual(resolve(world, intent('east', 2, 3, 44, 99)).toRegion, { x: 3, y: 3 });
assert.deepStrictEqual(resolve(world, intent('east', 2, 3, 44, 99)).entryTile, { row: 44, col: 0 });
assert.deepStrictEqual(resolve(world, intent('west', 2, 3, 44, 0)).toRegion, { x: 1, y: 3 });
assert.deepStrictEqual(resolve(world, intent('west', 2, 3, 44, 0)).entryTile, { row: 44, col: 99 });

const before = JSON.stringify(world);
resolve(world, intent('east', 0, 0, 50, 99));
assert.strictEqual(JSON.stringify(world), before);
const malformed = intent('east', 0, 0, 50, 99);
malformed.regionDelta.x = 2;
assert.strictEqual(resolve(world, malformed), null);

console.log('WP-041/I02 adjacent region coordinate resolution: PASS');
