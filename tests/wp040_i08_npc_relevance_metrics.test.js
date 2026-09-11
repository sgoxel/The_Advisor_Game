'use strict';

const assert = require('assert');
const path = require('path');

const modulePath = path.resolve(__dirname, '../js/npc_relevance_runtime.js');

function loadRuntime() {
  delete require.cache[modulePath];
  global.window = global;
  let gameTimeMinutes = 0;
  const queued = [];
  const npcs = [
    { id: 'npc:critical', row: 1, col: 1, activity: 'idle', interactionCritical: true },
    { id: 'npc:nearby', row: 8, col: 0, activity: 'idle' },
    { id: 'npc:local', row: 20, col: 0, activity: 'idle' },
    { id: 'npc:distant', row: 80, col: 80, activity: 'idle' }
  ];

  global.Game = {
    State: {
      world: {
        seed: 'wp040-i08-metrics',
        player: { id: 'player', row: 0, col: 0 },
        npcs
      }
    },
    GameTime: {
      capture: () => ({ totalGameMinutes: gameTimeMinutes })
    },
    FrameBudgetScheduler: {
      enqueue: (key, job, options) => {
        queued.push({ key, job, options });
        return key;
      },
      interactionActive: () => false
    }
  };

  require(modulePath);
  return {
    runtime: global.Game.NPCRelevanceRuntime,
    npcs,
    queued,
    setTime: (value) => { gameTimeMinutes = value; }
  };
}

function run() {
  const { runtime, npcs, queued, setTime } = loadRuntime();
  const before = JSON.stringify(global.Game.State.world);

  runtime.scheduleFrame();
  let snapshot = runtime.snapshot();
  assert.deepEqual(snapshot.counts, { critical: 1, nearby: 1, local: 1, distant: 1 }, 'snapshot must expose bounded per-tier counts');
  assert.equal(snapshot.authority, 'scheduling-only', 'metrics must remain non-authoritative');
  assert.equal(snapshot.compactStatePersisted, false, 'diagnostic compact state must not silently become persistent authority');
  assert.equal(snapshot.entries.length, 4, 'metrics must expose one compact diagnostic entry per observed NPC');

  for (const entry of snapshot.entries) {
    assert(Number.isFinite(entry.bucket), 'each entry must expose a finite deterministic bucket');
    assert(Number.isFinite(entry.phaseOffsetMinutes), 'each entry must expose a finite deterministic phase');
  }

  setTime(20);
  runtime.scheduleFrame();
  assert(queued.length > 0, 'due detail work should be observable through the scheduler queue');
  for (const item of queued) item.job();

  snapshot = runtime.snapshot();
  assert(snapshot.completedJobs > 0, 'completed work count must be exposed');
  assert(Number.isFinite(snapshot.jobsPerSecond), 'jobs-per-second diagnostic must be finite');
  assert(Number.isFinite(snapshot.deferredJobs), 'deferred work count must be finite');
  assert(Number.isFinite(snapshot.promotedReconciliations), 'promotion/reconciliation count must be finite');
  assert(Number.isFinite(snapshot.npcJobP95Ms), 'bounded job p95 diagnostic must be finite');
  assert(Number.isFinite(snapshot.npcJobWorstMs), 'bounded worst-job diagnostic must be finite');
  assert(snapshot.dispatchSamples.length <= 512, 'dispatch sample retention must remain bounded');

  const after = JSON.stringify(global.Game.State.world);
  assert.equal(after, before, 'reading/collecting scheduling metrics must not mutate authoritative world state');

  console.log('WP-040/I08 bounded NPC relevance metrics: PASS');
}

run();
