const assert = require('assert');

global.window = global;
global.Game = {
  State: {
    world: {
      originVillage: {
        opportunities: [
          {
            id: 'work:village:b',
            authority: 'simulation',
            type: 'work',
            innkeeperId: 'npc:innkeeper:1',
            status: 'available',
            reward: { coin: 99 }
          }
        ]
      },
      opportunities: [
        {
          id: 'work:world:z',
          authority: 'simulation',
          kind: 'job',
          employerId: 'npc:innkeeper:1',
          status: 'open',
          reward: { coin: 5 }
        },
        {
          id: 'work:world:a',
          authority: 'simulation',
          category: 'work',
          sourceNpcId: 'npc:innkeeper:1',
          available: true,
          requirements: ['existing-fact-only']
        },
        {
          id: 'work:other-employer',
          authority: 'simulation',
          type: 'work',
          innkeeperId: 'npc:innkeeper:2'
        },
        {
          id: 'work:closed',
          authority: 'simulation',
          type: 'work',
          innkeeperId: 'npc:innkeeper:1',
          status: 'closed'
        },
        {
          id: 'rumor:not-work',
          authority: 'simulation',
          type: 'rumor',
          innkeeperId: 'npc:innkeeper:1'
        },
        {
          id: 'work:not-simulation',
          authority: 'presentation',
          type: 'work',
          innkeeperId: 'npc:innkeeper:1'
        }
      ],
      resources: { coin: 7 },
      dialogue: { active: false },
      actor: { id: 'protagonist:main', row: 10, col: 10 }
    }
  }
};

require('../js/innkeeper_work_opportunity_lookup.js');

const lookup = global.Game.InnkeeperWorkOpportunityLookup;
assert(lookup, 'lookup API must install');
assert.strictEqual(lookup.authority, 'simulation');

const context = Object.freeze({
  authority: 'simulation',
  status: 'found',
  characterId: 'npc:innkeeper:1'
});

const before = JSON.stringify(global.Game.State.world);
const first = lookup.resolve(context);
const second = lookup.resolve(context);

assert.deepStrictEqual(first, second, 'equivalent authoritative state must resolve deterministically');
assert.strictEqual(first.status, 'found');
assert.strictEqual(first.innkeeperId, 'npc:innkeeper:1');
assert.strictEqual(first.opportunityId, 'work:village:b', 'stable identity ordering must choose the lexicographically first valid existing record');
assert.strictEqual(first.source, 'world.originVillage.opportunities');
assert.strictEqual(first.canStartDialogue, false);
assert.strictEqual(first.canAcceptWork, false);
assert.strictEqual(first.canMoveActor, false);
assert.strictEqual(first.canAwardResources, false);
assert.strictEqual(first.canMutateSimulation, false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(first, 'reward'), false, 'lookup must not fabricate or copy reward authority into its result');
assert.strictEqual(Object.prototype.hasOwnProperty.call(first, 'requirements'), false, 'lookup must expose only stable reference data');
assert.strictEqual(JSON.stringify(global.Game.State.world), before, 'lookup must not mutate authoritative state');
assert(Object.isFrozen(first), 'result must be immutable');

const invalidAuthority = lookup.resolve({ authority: 'presentation', status: 'found', characterId: 'npc:innkeeper:1' });
assert.strictEqual(invalidAuthority.status, 'invalid');
assert.strictEqual(invalidAuthority.opportunityId, null);

const staleContext = lookup.resolve({ authority: 'simulation', status: 'no-match', characterId: 'npc:innkeeper:1' });
assert.strictEqual(staleContext.status, 'invalid');

const otherInnkeeper = lookup.resolve({ authority: 'simulation', status: 'found', characterId: 'npc:innkeeper:2' });
assert.strictEqual(otherInnkeeper.status, 'found');
assert.strictEqual(otherInnkeeper.opportunityId, 'work:other-employer');

const absentInnkeeper = lookup.resolve({ authority: 'simulation', status: 'found', characterId: 'npc:innkeeper:missing' });
assert.strictEqual(absentInnkeeper.status, 'no-opportunity');
assert.strictEqual(absentInnkeeper.opportunityId, null);

const saved = global.Game.State.world.opportunities;
global.Game.State.world.opportunities = [
  { id: 'work:closed-only', authority: 'simulation', type: 'work', innkeeperId: 'npc:innkeeper:1', status: 'closed' },
  { id: 'work:wrong-owner', authority: 'simulation', type: 'work', innkeeperId: 'npc:other' },
  { authority: 'simulation', type: 'work', innkeeperId: 'npc:innkeeper:1' }
];
global.Game.State.world.originVillage.opportunities = [];
const none = lookup.resolve(context);
assert.strictEqual(none.status, 'no-opportunity');
assert.strictEqual(none.reason, 'no-authoritative-work-opportunity');
assert.strictEqual(none.opportunityId, null);

global.Game.State.world.opportunities = saved;
delete global.Game.State.world;
const missingWorld = lookup.resolve(context);
assert.strictEqual(missingWorld.status, 'invalid');
assert.strictEqual(missingWorld.reason, 'missing-authoritative-world');

console.log('WP-002/I05 innkeeper work opportunity lookup regression: PASS');
