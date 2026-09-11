'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'region_protagonist_transition.js'), 'utf8');
const events = [];
const calls = [];
const world = {
  rows: 100,
  cols: 100,
  currentRegion: { x: 0, y: 0, authority: 'simulation' },
  player: { stableId: 'hero-1', row: 50, col: 99, health: 77 }
};
const Game = {
  State: { world, camera: {} },
  RegionTerrain: { regionSize: 100 },
  Renderer: {
    centerCamera() { calls.push(['center', world.currentRegion.x, world.currentRegion.y, world.player.row, world.player.col]); },
    markDirty(worldDirty, minimapDirty) { calls.push(['dirty', worldDirty, minimapDirty]); }
  },
  ActivityLog: {
    authority: 'presentation-only',
    add(event) {
      events.push(event);
      // Presentation receives no world mutation capability and must only observe committed state.
      assert.strictEqual(world.currentRegion.x, 1);
      assert.strictEqual(world.currentRegion.y, 0);
      assert.strictEqual(world.player.row, 50);
      assert.strictEqual(world.player.col, 0);
    }
  }
};
const context = vm.createContext({ Game, globalThis: { Game } });
vm.runInContext(source, context, { filename: 'region_protagonist_transition.js' });

const resolution = {
  type: 'adjacent-region-transition-resolution',
  authority: 'simulation-resolution',
  actorId: 'hero-1',
  toRegion: { x: 1, y: 0 },
  entryTile: { row: 50, col: 0 }
};
const result = Game.RegionProtagonistTransition.commit(world, resolution);
assert(result, 'valid Simulation resolution should commit');
assert.strictEqual(result.authority, 'simulation');
assert.strictEqual(world.currentRegion.x, 1);
assert.strictEqual(world.player.col, 0);
assert.strictEqual(world.player.health, 77);
assert.deepStrictEqual(calls[0], ['center', 1, 0, 50, 0], 'camera must observe post-commit authoritative location');
assert.deepStrictEqual(calls[1], ['dirty', true, true]);
assert.strictEqual(events.length, 1, 'one visible world reaction should be emitted after commit');
assert.strictEqual(events[0].authority, 'presentation-only');
assert.strictEqual(events[0].category, 'world');
assert.strictEqual(events[0].title, 'Entered adjacent region');
assert.strictEqual(events[0].location, 'region 1,0 · tile 50,0');
assert.strictEqual(events[0].outcome, 'Travel committed by Simulation');
assert.strictEqual(result.presentation.authority, 'presentation-only');
assert.strictEqual(result.presentation.worldReaction.location, events[0].location);

// Rejected/non-authoritative input must not mutate state or announce success.
const before = { x: world.currentRegion.x, y: world.currentRegion.y, row: world.player.row, col: world.player.col };
const rejected = Game.RegionProtagonistTransition.commit(world, {
  ...resolution,
  authority: 'presentation-only',
  toRegion: { x: 2, y: 0 }
});
assert.strictEqual(rejected, null);
assert.deepStrictEqual({ x: world.currentRegion.x, y: world.currentRegion.y, row: world.player.row, col: world.player.col }, before);
assert.strictEqual(events.length, 1, 'presentation-only request must not announce successful travel');

console.log('WP-041/I09 region world reaction regression: PASS');
