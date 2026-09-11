'use strict';

const assert = require('assert');
const path = require('path');

const relevancePath = path.resolve(__dirname, '../js/npc_relevance_runtime.js');
const transitionPath = path.resolve(__dirname, '../js/region_protagonist_transition.js');

function loadRuntime() {
  delete require.cache[relevancePath];
  delete require.cache[transitionPath];
  global.window = global;

  const queued = [];
  const oldRegionNpc = { id: 'npc:old-region', regionX: 0, regionY: 0, row: 5, col: 5, activity: 'idle', history: { visits: 3 } };
  const newRegionNpc = { id: 'npc:new-region', regionX: 1, regionY: 0, row: 5, col: 5, activity: 'work', history: { visits: 7 } };
  const player = { id: 'protagonist:main', regionX: 0, regionY: 0, row: 5, col: 5, health: 91 };
  const world = {
    seed: 'wp041-i06-region-relevance',
    rows: 100,
    cols: 100,
    currentRegion: { x: 0, y: 0, authority: 'simulation' },
    player,
    npcs: [oldRegionNpc, newRegionNpc],
    gameTime: { totalGameMinutes: 30 }
  };

  global.Game = {
    State: { world },
    GameTime: { capture: () => ({ totalGameMinutes: 30 }) },
    RegionTerrain: { regionSize: 100 },
    FrameBudgetScheduler: {
      enqueue: (key, job, options) => { queued.push({ key, job, options }); return true; },
      interactionActive: () => false
    }
  };

  require(relevancePath);
  require(transitionPath);
  return { world, player, oldRegionNpc, newRegionNpc, queued };
}

function run() {
  const { world, player, oldRegionNpc, newRegionNpc, queued } = loadRuntime();
  const relevance = global.Game.NPCRelevanceRuntime;

  relevance.scheduleFrame();
  assert.equal(relevance.classify(oldRegionNpc), relevance.tiers.CRITICAL, 'same-region NPC should initially use local distance');
  assert.equal(relevance.classify(newRegionNpc), relevance.tiers.DISTANT, 'off-region NPC must remain distant regardless of matching local row/col');
  assert.equal(queued.length, 0, 'baseline relevance initialization must not eagerly materialize detail');

  const oldIdentity = oldRegionNpc;
  const newIdentity = newRegionNpc;
  const oldHistory = oldRegionNpc.history;
  const newHistory = newRegionNpc.history;

  const result = global.Game.RegionProtagonistTransition.commit(world, {
    type: 'adjacent-region-transition-resolution',
    authority: 'simulation-resolution',
    actorId: 'protagonist:main',
    toRegion: { x: 1, y: 0 },
    entryTile: { row: 5, col: 5 }
  });

  assert.ok(result, 'validated region transition must commit');
  assert.strictEqual(world.player, player, 'protagonist identity must remain unchanged');
  assert.equal(player.regionX, 1);
  assert.equal(player.regionY, 0);
  assert.equal(relevance.classify(oldRegionNpc), relevance.tiers.DISTANT, 'NPC left in prior region must demote to distant');
  assert.equal(relevance.classify(newRegionNpc), relevance.tiers.CRITICAL, 'NPC in destination region must promote from distant based on local distance');
  assert.strictEqual(world.npcs[0], oldIdentity, 'relevance recompute must not replace prior-region NPC object');
  assert.strictEqual(world.npcs[1], newIdentity, 'relevance recompute must not replace destination NPC object');
  assert.strictEqual(oldRegionNpc.history, oldHistory, 'prior-region NPC history must be preserved');
  assert.strictEqual(newRegionNpc.history, newHistory, 'destination NPC history must be preserved');
  assert.equal(oldRegionNpc.row, 5, 'relevance policy must not authoritatively move prior-region NPC');
  assert.equal(newRegionNpc.row, 5, 'relevance policy must not authoritatively move destination NPC');

  assert.deepEqual(result.npcRelevance, { authority: 'scheduling-only', evaluated: 2, scheduled: 1 });
  assert.equal(queued.length, 1, 'only promoted destination-region detail should enqueue immediately');
  assert.equal(queued[0].key, 'npc-detail:npc:new-region');

  const snapshot = relevance.snapshot();
  const oldEntry = snapshot.entries.find((entry) => entry.id === oldRegionNpc.id);
  const newEntry = snapshot.entries.find((entry) => entry.id === newRegionNpc.id);
  assert.equal(oldEntry.tier, relevance.tiers.DISTANT);
  assert.equal(oldEntry.detailLoaded, false);
  assert.equal(oldEntry.demotionSnapshot.regionX, 0);
  assert.equal(oldEntry.demotionSnapshot.regionY, 0);
  assert.equal(oldEntry.demotionSnapshot.row, 5);
  assert.equal(oldEntry.demotionSnapshot.col, 5);
  assert.equal(newEntry.authoritativePromotionPending, true, 'destination promotion must require authoritative reconciliation before resumed detail is trusted');
  assert.equal(snapshot.authority, 'scheduling-only', 'NPC relevance remains non-authoritative policy');

  console.log('WP-041/I06 region-transition NPC relevance: PASS');
}

run();
