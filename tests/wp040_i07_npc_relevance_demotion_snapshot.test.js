'use strict';

const assert = require('assert');
const path = require('path');

const modulePath = path.resolve(__dirname, '../js/npc_relevance_runtime.js');

function loadRuntime() {
  delete require.cache[modulePath];
  global.window = global;
  let gameTimeMinutes = 5;
  const npc = {
    id: 'npc:demotion',
    regionX: 0,
    regionY: 0,
    row: 2,
    col: 2,
    activity: 'working',
    presentationRow: 2.5,
    interpolation: { alpha: 0.5 },
    debugScreenX: 123
  };
  global.Game = {
    State: {
      world: {
        seed: 'wp040-i07-demotion',
        currentRegion: { x: 0, y: 0 },
        player: { id: 'player', regionX: 0, regionY: 0, row: 0, col: 0 },
        npcs: [npc]
      }
    },
    GameTime: { capture: () => ({ totalGameMinutes: gameTimeMinutes }) }
  };
  require(modulePath);
  return {
    runtime: global.Game.NPCRelevanceRuntime,
    npc,
    setTime: (value) => { gameTimeMinutes = value; }
  };
}

function entryFor(runtime, id) {
  return runtime.snapshot().entries.find((entry) => entry.id === id);
}

function run() {
  const { runtime, npc, setTime } = loadRuntime();

  runtime.markAuthoritativeUpdated(npc, 5);
  let entry = entryFor(runtime, npc.id);
  assert.equal(entry.tier, 'critical', 'near NPC must begin non-distant');
  assert.equal(entry.demotionSnapshot, null, 'non-demotion must not create a snapshot');

  npc.regionX = 1;
  npc.regionY = -2;
  npc.row = 17;
  npc.col = 23;
  npc.activity = 'travelling';
  setTime(12.75);
  runtime.markAuthoritativeUpdated(npc, 12.75);

  entry = entryFor(runtime, npc.id);
  assert.equal(entry.tier, 'distant', 'cross-region NPC must demote to distant');
  assert.deepEqual(entry.demotionSnapshot, {
    id: 'npc:demotion',
    authoritativeTime: 12.75,
    regionX: 1,
    regionY: -2,
    row: 17,
    col: 23,
    activity: 'travelling'
  }, 'demotion snapshot must contain only authoritative continuity fields');
  assert(Object.isFrozen(entry.demotionSnapshot), 'authoritative demotion snapshot must be immutable');
  assert.equal('presentationRow' in entry.demotionSnapshot, false, 'presentation position must not enter authoritative snapshot');
  assert.equal('interpolation' in entry.demotionSnapshot, false, 'interpolation state must not enter authoritative snapshot');
  assert.equal('debugScreenX' in entry.demotionSnapshot, false, 'debug/render coordinates must not enter authoritative snapshot');

  const firstSnapshot = JSON.stringify(entry.demotionSnapshot);
  runtime.markAuthoritativeUpdated(npc, 20);
  entry = entryFor(runtime, npc.id);
  assert.equal(JSON.stringify(entry.demotionSnapshot), firstSnapshot, 'remaining distant must not recapture a demotion snapshot');
  assert.equal(runtime.snapshot().authority, 'scheduling-only', 'demotion metadata must not become Simulation authority');

  console.log('WP-040/I07 authoritative NPC demotion snapshot: PASS');
}

run();
