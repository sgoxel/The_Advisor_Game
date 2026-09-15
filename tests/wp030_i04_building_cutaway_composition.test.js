const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js', 'static_tile_compositor.js'), 'utf8');

const building = {
  id: 'home-1',
  type: 'home',
  passable: false,
  footprint: { row: 10, col: 20, height: 4, width: 4 },
  entrance: { row: 14, col: 21 }
};

const floorIndex = new Map([
  ['11,21', 'home-1'],
  ['11,22', 'home-1'],
  ['12,21', 'home-1'],
  ['12,22', 'home-1'],
  ['13,21', 'home-1'],
  ['13,22', 'home-1'],
]);

const context = {
  console,
  Map,
  Set,
  Object,
  Number,
  String,
  Math,
  Date,
  Promise,
  URL,
  globalThis: null,
  requestAnimationFrame: () => 0,
  setTimeout: () => 0,
  Game: {
    State: {
      world: {
        rows: 100,
        cols: 100,
        seed: 'TEST',
        regionX: 0,
        regionY: 0,
        player: { row: 11, col: 21 },
        npcs: [],
        originVillage: { buildings: [building], roadTiles: [] },
        buildingInteriors: { floorIndex }
      },
      render: {}
    }
  }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'static_tile_compositor.js' });

const compositor = context.Game.StaticTileCompositor;
assert(compositor, 'StaticTileCompositor must install.');
assert.strictEqual(compositor.authority, 'presentation-only');
assert.strictEqual(compositor.layerPolicy, 'static-background-plus-dynamic-npc-only');

const occupied = compositor.buildingPresentationSnapshot();
assert.deepStrictEqual(Array.from(occupied.occupiedBuildingIds), ['home-1']);
assert.strictEqual(occupied.cells.some(c => c.row === 10), false, 'Occupied building must suppress the roof row.');
assert.strictEqual(occupied.cells.some(c => c.row === 11 && c.col === 21), false, 'Occupied building must suppress inner facade tiles.');
assert.strictEqual(occupied.cells.some(c => c.row === 11 && c.col === 20 && c.type === 'wall_edge_w'), true, 'Cutaway must retain the left boundary.');
assert.strictEqual(occupied.cells.some(c => c.row === 11 && c.col === 23 && c.type === 'wall_edge_e'), true, 'Cutaway must retain the right boundary.');
assert.strictEqual(occupied.cells.some(c => c.row === 13 && c.col === 21 && c.type === 'entrance'), true, 'Cutaway must retain entrance semantics.');

let change = compositor.refreshBuildingOccupancy('test-enter');
assert.strictEqual(change.changedBuildings, 1);
assert.strictEqual(change.affectedTiles, 16);
change = compositor.refreshBuildingOccupancy('test-stay');
assert.strictEqual(change.changedBuildings, 0, 'Moving or staying inside the same building must not invalidate again.');
assert.strictEqual(change.affectedTiles, 0);

context.Game.State.world.player.row = 5;
context.Game.State.world.player.col = 5;
change = compositor.refreshBuildingOccupancy('test-exit');
assert.strictEqual(change.changedBuildings, 1);
assert.strictEqual(change.affectedTiles, 16);

const exterior = compositor.buildingPresentationSnapshot();
assert.deepStrictEqual(Array.from(exterior.occupiedBuildingIds), []);
assert.strictEqual(exterior.cells.some(c => c.row === 10 && String(c.type).startsWith('roof_')), true, 'Exterior building must restore roof semantics.');
assert.strictEqual(exterior.cells.length, 16, 'Exterior mapping must retain the full footprint semantics.');

const diagnostics = compositor.diagnostics();
assert.deepStrictEqual(Array.from(diagnostics.occupiedBuildingIds), []);
assert.strictEqual(diagnostics.lastOccupancyChange.changedBuildings, 1);
assert.strictEqual(diagnostics.lastOccupancyChange.affectedTiles, 16);

assert(!source.includes('starterVillageCutawayOverlay'), 'Cutaway must not create a separate static overlay.');
assert(!source.includes('roofOverlay'), 'Cutaway must not create a separate roof layer.');
assert(source.includes("authority:'presentation-only'"), 'Presentation authority boundary must remain explicit.');
assert(source.includes("layerPolicy:'static-background-plus-dynamic-npc-only'"), 'Static-layer policy must remain unchanged.');
assert(source.includes('syncBuildingOccupancyInvalidation(),sig=staticSignature()'), 'Occupancy must drive bounded invalidation before signature comparison.');

console.log('wp030_i04_building_cutaway_composition: PASS');
