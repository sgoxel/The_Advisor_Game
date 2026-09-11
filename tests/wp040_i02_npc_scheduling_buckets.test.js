'use strict';

const assert = require('assert');
const path = require('path');

const modulePath = path.resolve(__dirname, '../js/npc_relevance_runtime.js');

function loadRuntime(seed = 'wp040-bucket-seed') {
  delete require.cache[modulePath];
  global.window = global;
  global.Game = {
    State: {
      world: {
        seed,
        player: { id: 'player', row: 0, col: 0 },
        npcs: []
      }
    }
  };
  require(modulePath);
  return global.Game.NPCRelevanceRuntime;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function run() {
  const runtime = loadRuntime();
  const npcA = { id: 'npc:alpha', row: 20, col: 20, activity: 'work' };
  const npcB = { id: 'npc:beta', row: 21, col: 20, activity: 'idle' };
  const worldBefore = clone(global.Game.State.world);
  const npcABefore = clone(npcA);

  for (const tier of Object.values(runtime.tiers)) {
    const cadence = runtime.cadenceMinutes[tier];
    const first = runtime.stableBucket(npcA, tier);
    const repeated = runtime.stableBucket(npcA, tier);
    const clonedIdentity = runtime.stableBucket({ ...npcA }, tier);

    assert.equal(first, repeated, `${tier} bucket must be repeatable`);
    assert.equal(first, clonedIdentity, `${tier} bucket must depend on stable inputs, not object identity`);
    assert(Number.isInteger(first), `${tier} bucket must be an integer`);
    assert(first >= 0 && first < cadence, `${tier} bucket must stay inside cadence bounds`);
  }

  const forward = [npcA, npcB].map((npc) => runtime.stableBucket(npc, runtime.tiers.LOCAL));
  const reverse = [npcB, npcA].map((npc) => runtime.stableBucket(npc, runtime.tiers.LOCAL));
  assert.equal(forward[0], reverse[1], 'npc:alpha bucket must not depend on iteration order');
  assert.equal(forward[1], reverse[0], 'npc:beta bucket must not depend on iteration order');

  const beforeWallClock = Date.now;
  Date.now = () => 1;
  const early = runtime.stableBucket(npcA, runtime.tiers.DISTANT);
  Date.now = () => 9999999999999;
  const late = runtime.stableBucket(npcA, runtime.tiers.DISTANT);
  Date.now = beforeWallClock;
  assert.equal(early, late, 'bucket assignment must not depend on wall-clock time');

  assert.deepEqual(npcA, npcABefore, 'bucket assignment must not mutate NPC state');
  assert.deepEqual(global.Game.State.world, worldBefore, 'bucket assignment must not mutate world state');

  console.log('WP-040/I02 deterministic NPC scheduling buckets: PASS');
}

run();
