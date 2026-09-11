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
        seed: 'wp040-promotion-reconcile',
        player: { id: 'player', row: 0, col: 0 },
        npcs: [{ id: 'npc:promote', row: 70, col: 70, activity: 'home' }]
      }
    },
    GameTime: { capture: () => ({ totalGameMinutes: gameTimeMinutes }) },
    FrameBudgetScheduler: {
      enqueue: (key, job, options) => { queued.push({ key, job, options }); return true; },
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
  const npc = global.Game.State.world.npcs[0];

  runtime.scheduleFrame();
  assert.equal(runtime.classify(npc), runtime.tiers.DISTANT);
  assert.equal(queued.length, 0, 'distant baseline must stay compact');

  setTime(30);
  npc.row = 5;
  npc.col = 5;
  assert.equal(runtime.classify(npc), runtime.tiers.NEARBY, 'authoritative location change must promote relevance');
  assert.equal(runtime.authoritativeDue(npc, 30), true, 'promotion must force authoritative reconciliation before detail resumes');

  runtime.scheduleFrame();
  assert.equal(queued.length, 1, 'promoted NPC must enqueue one bounded detail job');
  let snapshot = runtime.snapshot();
  let entry = snapshot.entries.find((candidate) => candidate.id === npc.id);
  assert.equal(entry.authoritativePromotionPending, true, 'promotion must remain pending until authoritative reconciliation is recorded');

  assert.equal(runtime.markAuthoritativeUpdated(npc, 30), true, 'Simulation reconciliation must be recordable');
  snapshot = runtime.snapshot();
  entry = snapshot.entries.find((candidate) => candidate.id === npc.id);
  assert.equal(entry.authoritativePromotionPending, false, 'authoritative reconciliation must clear the promotion gate');
  assert.equal(entry.lastAuthoritativeTime, 30);
  assert.equal(entry.lastRow, 5);
  assert.equal(entry.lastCol, 5);

  const originalDateNow = Date.now;
  Date.now = () => 9999999999999;
  assert.equal(runtime.authoritativeDue(npc, 30), false, 'wall clock alone must not reopen authoritative promotion reconciliation');
  Date.now = originalDateNow;

  global.Game.State.world.npcs[0] = { ...npc, activity: 'idle' };
  runtime.scheduleFrame();
  snapshot = runtime.snapshot();
  assert.equal(snapshot.entries.filter((candidate) => candidate.id === npc.id).length, 1, 'promotion must retain one stable-ID compact record after rematerialization');

  console.log('WP-040/I06 NPC promotion reconciliation: PASS');
}

run();
