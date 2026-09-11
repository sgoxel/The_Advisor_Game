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
        seed: 'wp040-visible-cadence',
        player: { id: 'player', row: 0, col: 0 },
        npcs: [{ id: 'npc:critical', row: 2, col: 2, activity: 'idle' }]
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
  const npc = global.Game.State.world.npcs[0];

  assert.equal(runtime.classify(npc), runtime.tiers.CRITICAL, 'nearby interaction-relevant NPC must classify as critical');
  assert.equal(runtime.cadenceMinutes.critical, 1, 'critical NPC cadence must remain bounded to one game minute');

  runtime.scheduleFrame();
  assert.equal(queued.length, 0, 'initial authoritative baseline must not burst immediately');

  setTime(2);
  runtime.scheduleFrame();
  assert.equal(queued.length, 1, 'critical NPC must enqueue once due by authoritative GameTime');
  assert.equal(queued[0].key, 'npc-detail:npc:critical');
  assert.equal(queued[0].options.priority, 30, 'critical NPC detail must receive highest scheduler priority');
  assert.match(queued[0].options.version, /^2:critical:/, 'job version must be derived from authoritative cadence cycle and tier');

  const before = { row: npc.row, col: npc.col, activity: npc.activity };
  queued[0].job();
  assert.deepEqual({ row: npc.row, col: npc.col, activity: npc.activity }, before, 'detail materialization must not directly mutate authoritative movement/activity state');

  const countAfterRun = queued.length;
  const originalDateNow = Date.now;
  Date.now = () => 9999999999999;
  runtime.scheduleFrame();
  Date.now = originalDateNow;
  assert.equal(queued.length, countAfterRun, 'wall-clock changes alone must not make an NPC due');

  const snapshot = runtime.snapshot();
  const entry = snapshot.entries.find((item) => item.id === 'npc:critical');
  assert(entry, 'scheduled NPC must have compact scheduling metadata');
  assert.equal(entry.tier, runtime.tiers.CRITICAL);
  assert.equal(entry.lastDetailedTime, 2, 'detail timestamp must use authoritative GameTime');

  console.log('WP-040/I03 visible NPC detail cadence: PASS');
}

run();
