const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

global.window = global;
global.document = { readyState: 'complete' };
global.setInterval = () => 1;
global.clearInterval = () => {};
global.Game = {
  State: {
    world: {
      originVillage: { population: [{ id: 'npc-a' }] },
      npcs: [{ id: 'npc-a', row: 10, col: 11, occupation: 'guard', activity: 'walking' }],
      gameTime: { totalGameMinutes: 12 }
    }
  }
};

vm.runInThisContext(fs.readFileSync(require.resolve('../js/npc_motion_presentation.js'), 'utf8'));
const api = Game.NPCMotionPresentation;

assert.strictEqual(api.authority, 'presentation-only');
assert.strictEqual(api.retentionMs, 250);

api.observe(1000);
assert.strictEqual(api.retainedForFrame(1000).length, 0, 'live NPC must not be duplicated');

Game.State.world.npcs = [];
assert.deepStrictEqual(
  api.retainedForFrame(1100).map((npc) => npc.id),
  ['npc-a'],
  'transient missing frame must retain the same stable NPC identity'
);
assert.strictEqual(api.retainedForFrame(1300).length, 0, 'retention must expire within the bounded grace window');

Game.State.world.originVillage.population = [];
assert.strictEqual(api.retainedForFrame(1101).length, 0, 'removed authoritative identity must never be retained');
assert.strictEqual(Game.State.world.npcs.length, 0, 'presentation retention must never repopulate Simulation NPC state');

console.log('PASS WP-111/I02 presentation retention');
