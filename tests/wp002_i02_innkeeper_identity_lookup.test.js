const assert = require('assert');
global.window = global;
global.Game = {
  State: {
    world: {
      seed: 'test-seed',
      originVillage: {
        population: [
          { id: 'npc:zeta', profession: 'farmer', x: 4, y: 5 },
          { id: 'npc:beta', profession: 'tavern keeper', x: 8, y: 9 },
          { id: 'npc:alpha', currentProfession: 'innkeeper', x: 10, y: 11 }
        ]
      },
      resources: { currency: 12 },
      opportunities: []
    }
  }
};

require('../js/innkeeper_identity_lookup.js');

const lookup = global.Game.InnkeeperIdentityLookup;
const before = JSON.stringify(global.Game.State.world);
const first = lookup.resolveLocal();
const second = lookup.resolveLocal();

assert.strictEqual(first.authority, 'simulation');
assert.strictEqual(first.status, 'found');
assert.strictEqual(first.characterId, 'npc:alpha', 'Stable-id sort must deterministically choose the same valid local candidate.');
assert.strictEqual(first.profession, 'innkeeper');
assert.deepStrictEqual(first, second, 'Repeated lookup against unchanged authoritative state must be deterministic.');
assert.strictEqual(JSON.stringify(global.Game.State.world), before, 'Identity lookup must not mutate authoritative world state.');
assert(Object.isFrozen(first), 'Lookup result must be immutable.');

global.Game.State.world.originVillage.population = [
  { id: 'npc:farmer', profession: 'farmer' }
];
const noMatch = lookup.resolveLocal();
assert.strictEqual(noMatch.status, 'no-match');
assert.strictEqual(noMatch.reason, 'no-local-innkeeper');
assert.strictEqual(noMatch.characterId, null);
assert.strictEqual(noMatch.profession, null);

const savedWorld = global.Game.State.world;
global.Game.State.world = null;
const missingWorld = lookup.resolveLocal();
assert.strictEqual(missingWorld.status, 'no-match');
assert.strictEqual(missingWorld.reason, 'missing-authoritative-world');
global.Game.State.world = savedWorld;

console.log('WP-002/I02 innkeeper identity lookup regression: PASS');
