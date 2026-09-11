'use strict';

const assert = require('assert');
const path = require('path');

const schedulerPath = path.resolve(__dirname, '../js/frame_budget_scheduler.js');
const relevancePath = path.resolve(__dirname, '../js/npc_relevance_runtime.js');

function loadRuntime() {
  delete require.cache[schedulerPath];
  delete require.cache[relevancePath];

  let now = 0;
  let gameTimeMinutes = 0;
  global.window = global;
  global.performance = { now: () => now };
  global.addEventListener = () => {};
  global.requestAnimationFrame = () => {};
  global.setTimeout = (fn) => fn();

  const npcs = [
    { id: 'npc:critical', row: 1, col: 1, activity: 'idle', interactionCritical: true },
    { id: 'npc:nearby', row: 8, col: 0, activity: 'idle' },
    { id: 'npc:local', row: 20, col: 0, activity: 'idle' }
  ];

  global.Game = {
    State: {
      camera: {
        dragActive: false,
        inertiaVelocityX: 0,
        inertiaVelocityY: 0,
        inertiaMinVelocity: 0.0001
      },
      input: { keys: new Set() },
      world: {
        seed: 'wp040-i09-render-yield',
        player: { id: 'player', row: 0, col: 0 },
        npcs
      }
    },
    GameTime: {
      capture: () => ({ totalGameMinutes: gameTimeMinutes })
    },
    Renderer: {
      renderWorld: () => true
    }
  };

  require(schedulerPath);
  require(relevancePath);

  return {
    scheduler: global.Game.FrameBudgetScheduler,
    relevance: global.Game.NPCRelevanceRuntime,
    npcs,
    setNow: (value) => { now = value; },
    setGameTime: (value) => { gameTimeMinutes = value; }
  };
}

function run() {
  const { scheduler, relevance, npcs, setNow, setGameTime } = loadRuntime();

  relevance.scheduleFrame();
  assert.equal(scheduler.metrics().queueDepth, 0, 'initial authoritative baseline must not create a population burst');

  setGameTime(6);
  relevance.scheduleFrame();
  const queuedBeforeInteraction = scheduler.metrics().queuedKeys;
  assert(queuedBeforeInteraction.includes('npc-detail:npc:critical'), 'critical NPC detail must be queued when due');
  assert(queuedBeforeInteraction.includes('npc-detail:npc:nearby'), 'nearby NPC detail must be queued when due');
  assert(queuedBeforeInteraction.includes('npc-detail:npc:local'), 'local NPC detail must be queued when due');
  assert.equal(queuedBeforeInteraction[0], 'npc-detail:npc:critical', 'critical NPC work must outrank lower-priority NPC detail work');

  scheduler.noteInteraction('test-interaction', 100);
  const beforeDeferred = scheduler.metrics();
  const deferredSlice = scheduler.runBackgroundSlice(0);
  const afterDeferred = scheduler.metrics();
  assert.equal(deferredSlice.ran, 0, 'optional NPC background work must yield while interaction is active');
  assert.equal(afterDeferred.queueDepth, beforeDeferred.queueDepth, 'yielded jobs must remain queued for later execution');
  assert(afterDeferred.deferredJobs > beforeDeferred.deferredJobs, 'scheduler must record deferred background work');

  setNow(200);
  const resumedSlice = scheduler.runBackgroundSlice(200);
  const afterResume = scheduler.metrics();
  assert(resumedSlice.ran > 0, 'deferred NPC work must resume when presentation-critical interaction pressure clears');
  assert(afterResume.completedJobs > 0, 'resumed jobs must complete rather than starving indefinitely');

  const snapshot = relevance.snapshot();
  const critical = snapshot.entries.find((entry) => entry.id === npcs[0].id);
  assert(critical, 'critical NPC scheduling metadata must remain available after deferred/resumed work');
  assert.equal(critical.lastDetailedTime, 6, 'resumed detail work must use authoritative GameTime captured at scheduling time');
  assert.equal(snapshot.authority, 'scheduling-only', 'NPC relevance scheduler must remain non-authoritative');
  assert.equal(scheduler.metrics().authority, 'scheduling-only', 'frame budget scheduler must remain non-authoritative');

  console.log('WP-040/I09 render-first NPC background yielding: PASS');
}

run();
