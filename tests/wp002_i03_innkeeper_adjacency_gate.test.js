const assert = require('assert');

global.window = global;
global.Game = {
  State: {
    world: {
      protagonist: { id: 'protagonist:main' },
      player: { id: 'protagonist:main', regionX: 0, regionY: 0, row: 10, col: 10 },
      originVillage: {
        population: [{ id: 'npc:innkeeper', occupation: 'innkeeper' }]
      },
      npcs: [
        { id: 'npc:innkeeper', authority: 'simulation', regionX: 0, regionY: 0, row: 10, col: 11 },
        { id: 'npc:remote', authority: 'simulation', regionX: 1, regionY: 0, row: 10, col: 11 }
      ],
      resources: { coin: 7 },
      opportunities: [{ id: 'work:existing' }],
      dialogue: { active: false }
    }
  }
};

require('../js/innkeeper_identity_lookup.js');
require('../js/innkeeper_adjacency_gate.js');

const gate = global.Game.InnkeeperAdjacencyGate;
const world = global.Game.State.world;
const before = JSON.stringify(world);

const adjacent = gate.evaluateResolvedLocalInnkeeper();
assert.strictEqual(adjacent.status, 'eligible');
assert.strictEqual(adjacent.reason, 'adjacent');
assert.strictEqual(adjacent.distance, 1);
assert.strictEqual(adjacent.innkeeperId, 'npc:innkeeper');
assert.strictEqual(adjacent.regionRef, 'region:0,0');
assert.strictEqual(adjacent.authority, 'simulation');
assert.strictEqual(adjacent.readOnly, true);
assert.strictEqual(JSON.stringify(world), before, 'gate must not mutate authoritative world state');

world.npcs[0].row = 12;
let denied = gate.evaluate('npc:innkeeper');
assert.strictEqual(denied.status, 'ineligible');
assert.strictEqual(denied.reason, 'not-adjacent');
assert.strictEqual(denied.distance, 3);

world.npcs[0].row = 10;
world.npcs[0].col = 11;
world.npcs[0].regionX = 1;
denied = gate.evaluate('npc:innkeeper');
assert.strictEqual(denied.status, 'ineligible');
assert.strictEqual(denied.reason, 'different-region');

world.npcs[0].regionX = 0;
world.npcs[0].row = 10.5;
denied = gate.evaluate('npc:innkeeper');
assert.strictEqual(denied.status, 'ineligible');
assert.strictEqual(denied.reason, 'malformed-position');

world.npcs[0].row = 10;
denied = gate.evaluate('npc:missing');
assert.strictEqual(denied.status, 'ineligible');
assert.strictEqual(denied.reason, 'missing-authoritative-innkeeper');

const deterministicA = gate.evaluate('npc:innkeeper');
const deterministicB = gate.evaluate('npc:innkeeper');
assert.deepStrictEqual(deterministicA, deterministicB);

const finalSnapshot = JSON.stringify(world);
gate.evaluate('npc:innkeeper');
assert.strictEqual(JSON.stringify(world), finalSnapshot, 'repeated gate evaluation must remain read-only');

console.log('WP-002/I03 innkeeper adjacency gate regression: PASS');
