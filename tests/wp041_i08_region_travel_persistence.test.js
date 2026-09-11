const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const context = { window: { Game: { State: { world: {} } } } };
vm.createContext(context);
vm.runInContext(fs.readFileSync('js/region_travel_persistence.js', 'utf8'), context);
const api = context.window.Game.RegionTravelPersistence;

const player = {
  id: 'protagonist-1', row: 37, col: 0, moving: false,
  startRow: 37, startCol: 0, targetRow: 37, targetCol: 0,
  progress: 1, pathQueue: [], health: 86, history: [{ id: 'kept' }]
};
const world = { currentRegion: { x: 1, y: -2 }, player };
const saved = api.capture(world);
assert.deepStrictEqual(JSON.parse(JSON.stringify(saved)), {
  schemaVersion: 1, authority: 'simulation', regionX: 1, regionY: -2, localRow: 37, localCol: 0
});
assert.strictEqual(saved.camera, undefined);
assert.strictEqual(saved.render, undefined);

world.currentRegion.x = 99;
world.currentRegion.y = 99;
player.row = 88;
player.col = 88;
player.moving = true;
player.pathQueue = [{ row: 1, col: 1 }];
const history = player.history;
const restored = api.install(world, saved);
assert.strictEqual(restored.ok, true);
assert.strictEqual(world.currentRegion.x, 1);
assert.strictEqual(world.currentRegion.y, -2);
assert.strictEqual(player.row, 37);
assert.strictEqual(player.col, 0);
assert.strictEqual(player.moving, false);
assert.deepStrictEqual(player.pathQueue, []);
assert.strictEqual(player.health, 86);
assert.strictEqual(player.history, history);

// Installing the same authoritative snapshot again is idempotent: no transition is replayed.
const second = api.install(world, saved);
assert.strictEqual(second.ok, true);
assert.strictEqual(world.currentRegion.x, 1);
assert.strictEqual(world.currentRegion.y, -2);
assert.strictEqual(player.row, 37);
assert.strictEqual(player.col, 0);
assert.strictEqual(player.history.length, 1);

assert.strictEqual(api.validate({ ...saved, authority: 'presentation' }).ok, false);
assert.strictEqual(api.validate({ ...saved, localRow: 100 }).ok, false);
console.log('WP-041/I08 region travel persistence regression: PASS');
