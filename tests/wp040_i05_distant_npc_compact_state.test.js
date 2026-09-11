'use strict';

const assert = require('assert');
const path = require('path');

const modulePath = path.resolve(__dirname, '../js/npc_relevance_runtime.js');

function loadRuntime() {
  delete require.cache[modulePath];
  global.window = global;
  let gameTimeMinutes = 0;
  const queued = [];
  global.Game = {
    State: {
      world: {
        seed: 'wp040-distant-compact-state',
        player: { id: 'player', row: 0, col: 0 },
        npcs: [
          {
            id: 'npc:distant',
            row: 70,
            col: 70,
            localRow: 70,
            localCol: 70,
            activity: 'returning-home',
            occupation: 'woodcutter',
            movementDecision: 'hold',
            movementWaitStreak: 0
          }
        ]
      }
    },
    GameTime: {
      capture: () => ({ totalGameMinutes: gameTimeMinutes })
    },
    FrameBudgetScheduler: {
      enqueue: (key, job, options) => {
        queued.push({ key, job, options });
        return true;
      },
      interactionActive: () => false
    }
  };
  require(modulePath);
  return {
    runtime: global.Game.NPCRelevanceRuntime,
    queued,
    setTime: (value) => { gameTimeMinutes = value; }
  };
}

function run() {
  const { runtime, queued, setTime } = loadRuntime();
  const world = global.Game.State.world;
  const npc = world.npcs[0];

  assert.equal(runtime.classify(npc), runtime.tiers.DISTANT, 'far NPC must classify as distant');

  runtime.scheduleFrame();
  assert.equal(queued.length, 0, 'initial distant compact baseline must not enqueue detail work');

  setTime(60);
  runtime.scheduleFrame();
  assert.equal(queued.length, 0, 'distant NPC must remain compact instead of receiving periodic full-detail work');

  let snapshot = runtime.snapshot();
  let entry = snapshot.entries.find((candidate) => candidate.id === npc.id);
  assert(entry, 'distant NPC must retain compact state');
  assert.equal(entry.tier, runtime.tiers.DISTANT);
  assert.equal(entry.detailLoaded, false, 'distant compact state must not claim detail is loaded');
  assert.equal(entry.lastRow, 70, 'compact state must retain authoritative position anchor');
  assert.equal(entry.lastCol, 70, 'compact state must retain authoritative position anchor');
  assert.equal(entry.lastActivity, 'returning-home', 'compact state must retain current authoritative activity anchor');
  assert.equal(entry.lastObservedTime, 60, 'compact state must retain authoritative game-time observation');

  // Coarse authoritative world progression remains allowed while detailed relevance work
  // stays unloaded. A separate Simulation path may commit a distant-NPC delta and record it.
  npc.row = 71;
  npc.col = 70;
  npc.activity = 'home';
  setTime(75);
  assert.equal(runtime.markAuthoritativeUpdated(npc, 75), true, 'authoritative distant-NPC deltas must be recordable in compact state');

  snapshot = runtime.snapshot();
  entry = snapshot.entries.find((candidate) => candidate.id === npc.id);
  assert.equal(entry.lastAuthoritativeTime, 75, 'compact state must retain authoritative update time');
  assert.equal(entry.lastRow, 71, 'compact state must retain latest authoritative row');
  assert.equal(entry.lastCol, 70, 'compact state must retain latest authoritative column');
  assert.equal(entry.lastActivity, 'home', 'compact state must retain latest authoritative activity');
  assert.equal(entry.detailLoaded, false, 'authoritative delta capture must not promote a distant NPC to detailed state');

  const originalDateNow = Date.now;
  Date.now = () => 9999999999999;
  runtime.scheduleFrame();
  Date.now = originalDateNow;
  assert.equal(queued.length, 0, 'wall-clock changes must not cause distant detail work');

  // Stable identity, rather than object identity, owns the compact record.
  world.npcs[0] = { ...npc, row: 72, activity: 'idle' };
  setTime(90);
  runtime.scheduleFrame();
  snapshot = runtime.snapshot();
  const matchingEntries = snapshot.entries.filter((candidate) => candidate.id === npc.id);
  assert.equal(matchingEntries.length, 1, 'rematerialized object with the same stable NPC ID must reuse one compact record');
  assert.equal(matchingEntries[0].lastRow, 72, 'compact record must refresh current authoritative anchors after rematerialization');
  assert.equal(matchingEntries[0].lastActivity, 'idle');
  assert.equal(matchingEntries[0].detailLoaded, false);

  console.log('WP-040/I05 distant NPC compact state: PASS');
}

run();
