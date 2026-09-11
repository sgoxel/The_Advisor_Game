const assert = require('assert');
require('../js/region_transition_resolution.js');
require('../js/region_protagonist_transition.js');

const Game = globalThis.Game;
Game.RegionTerrain = { regionSize: 100 };

function makeWorld() {
  const player = {
    stableId: 'protagonist:main',
    row: 50,
    col: 50,
    regionX: 0,
    regionY: 0,
    worldX: 50,
    worldY: 50,
    health: 73,
    gold: 41,
    memories: [{ id: 'memory:kept' }],
    history: [{ id: 'history:kept' }],
    inventory: [{ id: 'item:kept', qty: 2 }],
    moving: true
  };
  return {
    rows: 100,
    cols: 100,
    currentRegion: { x: 0, y: 0, regionSize: 100, authority: 'simulation' },
    player
  };
}

function resolve(world, direction, fromRegion, fromTile) {
  const delta = {
    north: { x: 0, y: -1, edge: 'south' },
    east: { x: 1, y: 0, edge: 'west' },
    south: { x: 0, y: 1, edge: 'north' },
    west: { x: -1, y: 0, edge: 'east' }
  }[direction];
  return Game.RegionTransitionResolution.resolve(world, {
    type: 'adjacent-region-crossing-intent',
    authority: 'simulation-request',
    actorId: 'protagonist:main',
    direction,
    fromRegion,
    fromTile,
    regionDelta: { x: delta.x, y: delta.y },
    requestedEntryEdge: delta.edge
  });
}

for (const testCase of [
  ['east', { x: 0, y: 0 }, { row: 37, col: 99 }, { x: 1, y: 0, row: 37, col: 0 }],
  ['west', { x: 0, y: 0 }, { row: 62, col: 0 }, { x: -1, y: 0, row: 62, col: 99 }],
  ['north', { x: 0, y: 0 }, { row: 0, col: 44 }, { x: 0, y: -1, row: 99, col: 44 }],
  ['south', { x: 0, y: 0 }, { row: 99, col: 71 }, { x: 0, y: 1, row: 0, col: 71 }]
]) {
  const [direction, fromRegion, fromTile, expected] = testCase;
  const world = makeWorld();
  const originalPlayer = world.player;
  const originalMemories = world.player.memories;
  const originalHistory = world.player.history;
  const originalInventory = world.player.inventory;
  const resolution = resolve(world, direction, fromRegion, fromTile);
  assert(resolution, `${direction} resolution must be valid`);

  const result = Game.RegionProtagonistTransition.commit(world, resolution);
  assert(result, `${direction} transition must commit`);
  assert.strictEqual(world.player, originalPlayer, `${direction} must preserve the exact protagonist object`);
  assert.strictEqual(world.player.stableId, 'protagonist:main');
  assert.strictEqual(world.player.health, 73, 'current health must not reset');
  assert.strictEqual(world.player.gold, 41, 'current resources must not reset');
  assert.strictEqual(world.player.memories, originalMemories, 'memory state must remain attached');
  assert.strictEqual(world.player.history, originalHistory, 'history state must remain attached');
  assert.strictEqual(world.player.inventory, originalInventory, 'inventory state must remain attached');
  assert.strictEqual(world.player.regionX, expected.x);
  assert.strictEqual(world.player.regionY, expected.y);
  assert.strictEqual(world.player.row, expected.row);
  assert.strictEqual(world.player.col, expected.col);
  assert.strictEqual(world.currentRegion.x, expected.x);
  assert.strictEqual(world.currentRegion.y, expected.y);
  assert.strictEqual(world.player.moving, false);
}

const wrongActorWorld = makeWorld();
const wrongActorResolution = { ...resolve(wrongActorWorld, 'east', { x: 0, y: 0 }, { row: 25, col: 99 }), actorId: 'npc:other' };
const beforeWrongActor = wrongActorWorld.player;
assert.strictEqual(Game.RegionProtagonistTransition.commit(wrongActorWorld, wrongActorResolution), null, 'wrong actor must not commit protagonist movement');
assert.strictEqual(wrongActorWorld.player, beforeWrongActor, 'rejected transition must not replace protagonist');
assert.strictEqual(wrongActorWorld.player.regionX, 0, 'rejected transition must not change region');

console.log('WP-041/I05 protagonist transition continuity regression: PASS');
