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
        seed: 'wp040-nearby-cadence',
        player: { id: 'player', row: 0, col: 0 },
        npcs: [
          { id: 'npc:critical', row: 2, col: 2, activity: 'idle' },
          { id: 'npc:nearby', row: 8, col: 2, activity: 'idle' }
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

function runQueued(queued, counts) {
  while (queued.length) {
    const item = queued.shift();
    const id = item.key.replace('npc-detail:', '');
    counts[id] = (counts[id] || 0) + 1;
    item.job();
  }
}

function run() {
  const { runtime, queued, setTime } = loadRuntime();
  const criticalNpc = global.Game.State.world.npcs[0];
  const nearbyNpc = global.Game.State.world.npcs[1];

  assert.equal(runtime.classify(criticalNpc), runtime.tiers.CRITICAL, 'critical-distance NPC must classify as critical');
  assert.equal(runtime.classify(nearbyNpc), runtime.tiers.NEARBY, 'non-critical nearby NPC must classify as nearby');
  assert.equal(runtime.cadenceMinutes.critical, 1, 'critical cadence must remain one authoritative game minute');
  assert.equal(runtime.cadenceMinutes.nearby, 2, 'nearby cadence must be a bounded two authoritative game minutes');
  assert(runtime.cadenceMinutes.nearby > runtime.cadenceMinutes.critical, 'nearby cadence must be lower-frequency than critical cadence');

  const nearbyBucketA = runtime.stableBucket(nearbyNpc, runtime.tiers.NEARBY);
  const nearbyBucketB = runtime.stableBucket({ ...nearbyNpc }, runtime.tiers.NEARBY);
  assert.equal(nearbyBucketA, nearbyBucketB, 'nearby bucket must be stable from authoritative-compatible identity inputs');
  assert(nearbyBucketA >= 0 && nearbyBucketA < runtime.cadenceMinutes.nearby, 'nearby bucket must remain bounded by cadence');

  const baseline = {
    critical: { row: criticalNpc.row, col: criticalNpc.col, activity: criticalNpc.activity },
    nearby: { row: nearbyNpc.row, col: nearbyNpc.col, activity: nearbyNpc.activity }
  };

  runtime.scheduleFrame();
  assert.equal(queued.length, 0, 'initial authoritative baseline must not enqueue a population burst');

  const counts = {};
  for (let minute = 0.25; minute <= 8; minute += 0.25) {
    setTime(minute);
    runtime.scheduleFrame();
    runQueued(queued, counts);
  }

  assert((counts['npc:critical'] || 0) > (counts['npc:nearby'] || 0), 'critical NPC must receive more detail updates than nearby NPC over the same authoritative interval');
  assert((counts['npc:nearby'] || 0) >= 3, 'nearby NPC must continue receiving bounded periodic detail updates');

  assert.deepEqual(
    { row: criticalNpc.row, col: criticalNpc.col, activity: criticalNpc.activity },
    baseline.critical,
    'detail scheduling must not bypass authoritative critical-NPC movement/activity state'
  );
  assert.deepEqual(
    { row: nearbyNpc.row, col: nearbyNpc.col, activity: nearbyNpc.activity },
    baseline.nearby,
    'deferred nearby detail must not bypass authoritative movement/activity state'
  );

  const countBeforeWallClockChange = { ...counts };
  const originalDateNow = Date.now;
  Date.now = () => 9999999999999;
  runtime.scheduleFrame();
  runQueued(queued, counts);
  Date.now = originalDateNow;
  assert.deepEqual(counts, countBeforeWallClockChange, 'wall-clock changes alone must not make NPC detail due');

  const snapshot = runtime.snapshot();
  const nearbyEntry = snapshot.entries.find((entry) => entry.id === 'npc:nearby');
  assert(nearbyEntry, 'nearby NPC must retain bounded scheduling metadata');
  assert.equal(nearbyEntry.tier, runtime.tiers.NEARBY);
  assert.equal(nearbyEntry.bucket, nearbyBucketA);

  console.log('WP-040/I04 nearby NPC reduced cadence: PASS');
}

run();
