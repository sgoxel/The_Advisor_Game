'use strict';

const assert = require('assert');
const path = require('path');

const runtimePath = path.resolve(__dirname, '../js/autonomous_protagonist_runtime.js');

function terrain(rows = 5, cols = 5) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ blocked: false, obstacle: false })));
}

function makeWorld() {
  return {
    seed: 'WP001-SEED',
    rows: 5,
    cols: 5,
    terrain: terrain(),
    regionRef: 'region:0,0',
    currentRegion: { x: 0, y: 0 },
    protagonist: { id: 'protagonist:main' },
    player: { id: 'protagonist:main', row: 0, col: 0, regionX: 0, regionY: 0 },
    npcs: [],
    originVillage: {
      buildings: [
        { id: 'region:0,0:building:9:inn', type: 'inn', entrance: { row: 0, col: 3 } },
        { id: 'region:0,0:building:2:tavern', type: 'tavern', entrance: { row: 4, col: 4 } }
      ]
    }
  };
}

function messageTokens(value) {
  const stop = new Set(['a','an','and','at','be','can','consider','could','do','for','go','i','in','is','it','might','move','of','on','or','please','recommend','should','suggest','that','the','to','want','would','you','your']);
  return Array.from(new Set((String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [])))
    .filter((token) => token.length > 1 && !stop.has(token));
}

function opportunityTokens(opportunity) {
  return messageTokens([opportunity.id, opportunity.goalType, opportunity.actionType, opportunity.targetRef || '', opportunity.locationRef || ''].join(' '));
}

function selectOpportunity(opportunities, influence) {
  const tokens = influence && influence.disposition !== 'rejected' ? messageTokens(influence.message) : [];
  const boostUnit = influence?.disposition === 'accepted' ? 150000 : influence?.disposition === 'reinterpreted' ? 100000 : 0;
  function score(item) {
    const available = new Set(opportunityTokens(item));
    const matches = tokens.reduce((count, token) => count + (available.has(token) ? 1 : 0), 0);
    return item.priority * 1000000 + item.urgency * 10000 - item.distance + matches * boostUnit;
  }
  return [...opportunities].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0] || null;
}

function setup(options = {}) {
  delete require.cache[runtimePath];
  global.window = global;
  delete global.document;
  global.Game = {};

  const world = makeWorld();
  let minute = 0;
  let pendingInfluence = null;
  let consumed = 0;
  let checkpoint = options.checkpoint || null;
  let blockTavern = options.blockTavern === true;

  Game.State = { world, simulation: { contextRevision: 0 }, render: {} };
  Game.GameTime = { capture: () => ({ authority: 'simulation', totalGameMinutes: minute }) };
  Game.ProtagonistRoutine = {
    buildRoutineOpportunity(context) {
      return Object.freeze({
        id: 'routine:daily-home:house-1',
        source: 'protagonist-resident-routine',
        actorId: context.actorId,
        goalType: 'daily-home',
        actionType: 'move',
        targetRef: 'house-1',
        locationRef: context.locationRef,
        priority: -100,
        urgency: 5,
        distance: 0,
        expectedContextRevision: context.contextRevision,
        routine: { targetBuildingId: 'house-1', targetBuildingType: 'home', target: { row: 1, col: 0 } }
      });
    }
  };
  Game.TerrainRouting = {
    findPath(_terrain, start, goal) {
      if (blockTavern && goal.row === 0 && goal.col === 3) return [];
      const result = [{ row: start.row, col: start.col }];
      let row = start.row;
      let col = start.col;
      while (row !== goal.row) { row += Math.sign(goal.row - row); result.push({ row, col }); }
      while (col !== goal.col) { col += Math.sign(goal.col - col); result.push({ row, col }); }
      return result;
    }
  };
  Game.WorldActionResolution = {
    resolveSpatial(_request, _validation, resolution) {
      const rule = resolution?.spatialRules?.[0];
      if (!rule) return { status: 'rejected', reasonCode: 'RESOLUTION_RULE_NOT_FOUND' };
      const tile = world.terrain[rule.row]?.[rule.col];
      if (!tile || tile.blocked || tile.obstacle) return { status: 'rejected', reasonCode: 'DESTINATION_STATE_MISMATCH' };
      const from = { row: world.player.row, col: world.player.col };
      world.player.row = rule.row;
      world.player.col = rule.col;
      return { status: 'resolved', reasonCode: 'OK', consequence: { type: 'protagonist_location', from, to: { row: rule.row, col: rule.col } } };
    }
  };
  Game.AdvisorChatUI = {
    peekPendingInfluenceForDecision() { return pendingInfluence; },
    markPendingInfluenceConsumed() { consumed += 1; pendingInfluence = null; }
  };
  Game.AutonomousDecisionLoop = {
    readCheckpoint() { return checkpoint; },
    prepare(context, opportunities) {
      if (context.authority !== 'simulation') return { status: 'rejected', reasonCode: 'NON_SIMULATION_CONTEXT' };
      return { status: 'ready', prepared: { authority: 'simulation', opportunities } };
    },
    resolvePrepared(_prepared, context, execution, influence) {
      const selected = selectOpportunity(_prepared.opportunities, influence);
      const route = execution.routes.find((item) => item.opportunityId === selected?.id);
      if (!selected || !route) {
        checkpoint = {
          lastStatus: 'rejected', selectedOpportunityId: selected?.id || null,
          worldRef: context.worldRef, regionRef: context.regionRef, campaignMinute: context.campaignMinute
        };
        return { status: 'rejected', reasonCode: 'ROUTE_NOT_FOUND', execution: { selectedOpportunityId: selected?.id || null } };
      }
      const resolved = Game.WorldActionResolution.resolveSpatial({}, route.validationContext, route.resolutionContext);
      const status = resolved.status === 'resolved' ? 'resolved' : 'rejected';
      checkpoint = {
        lastStatus: status, selectedOpportunityId: selected.id,
        worldRef: context.worldRef, regionRef: context.regionRef, campaignMinute: context.campaignMinute
      };
      return { status, reasonCode: resolved.reasonCode, execution: { selectedOpportunityId: selected.id, simulationStatus: resolved.status, consequence: resolved.consequence } };
    }
  };

  require(runtimePath);
  const runtime = Game.AutonomousProtagonistRuntime;
  return {
    runtime,
    world,
    setMinute(value) { minute = value; },
    setPending(value) { pendingInfluence = value; },
    getConsumed() { return consumed; },
    getCheckpoint() { return checkpoint; },
    setBlockTavern(value) { blockTavern = value; }
  };
}

function context(runtime) { return runtime.authoritativeContext(); }

function run() {
  let env = setup();
  let ctx = context(env.runtime);
  const tavern = env.runtime.resolveLocalTavern();
  assert.equal(tavern.buildingId, 'region:0,0:building:2:tavern', 'stable ID sort must choose deterministically');
  assert.deepEqual(tavern.point, { row: 4, col: 4 });

  const first = env.runtime.buildTavernOpportunity(ctx, null);
  const second = env.runtime.buildTavernOpportunity(ctx, null);
  assert.equal(JSON.stringify(first), JSON.stringify(second), 'equivalent inputs must be deterministic');
  assert.equal(first.goalType, 'visit-tavern-inn');
  assert.equal(first.directMovementAuthority, false);

  env.world.originVillage.buildings = [{ id: 'bad-inn', type: 'inn', entrance: { row: 1.5, col: 2 } }];
  assert.equal(env.runtime.buildTavernOpportunity(ctx, null), null, 'invalid entrance must not fabricate a destination');

  env = setup();
  ctx = context(env.runtime);
  const opportunities = env.runtime.buildOpportunities(ctx, null);
  assert.equal(selectOpportunity(opportunities, null).id, 'routine:daily-home:house-1', 'routine must win baseline fixture');
  const advised = { disposition: 'reinterpreted', message: 'Go to the tavern.', directActionAuthority: false, directMovementAuthority: false, directLegalityAuthority: false, directResolutionAuthority: false };
  const selected = selectOpportunity(opportunities, advised);
  assert.ok(selected.id.includes('visit-tavern-inn'), 'reinterpreted direct-control wording may influence but not command');
  assert.equal(advised.directMovementAuthority, false);
  assert.equal(selectOpportunity(opportunities, { disposition: 'rejected', message: 'Go to the tavern.' }).id, 'routine:daily-home:house-1');

  const before = { row: env.world.player.row, col: env.world.player.col };
  env.setPending(advised);
  assert.deepEqual({ row: env.world.player.row, col: env.world.player.col }, before, 'queuing advice alone must not mutate world coordinates');

  env.world.originVillage.buildings = [{ id: 'region:0,0:building:1:inn', type: 'inn', entrance: { row: 0, col: 3 } }];
  const trace1 = env.runtime.tick();
  assert.equal(trace1.status, 'resolved');
  assert.ok(trace1.selectedOpportunityId.includes('visit-tavern-inn'));
  assert.deepEqual({ row: env.world.player.row, col: env.world.player.col }, { row: 0, col: 1 }, 'first decision moves one routed tile only');
  assert.equal(env.getConsumed(), 1, 'advisor influence is consumed after non-stale decision attempt');
  assert.equal(env.getCheckpoint().lastStatus, 'resolved');

  env.setMinute(1);
  const trace2 = env.runtime.tick();
  assert.equal(trace2.status, 'resolved');
  assert.ok(trace2.selectedOpportunityId.includes('visit-tavern-inn'), 'checkpoint must continue Character-owned tavern goal without repeated advice');
  assert.deepEqual({ row: env.world.player.row, col: env.world.player.col }, { row: 0, col: 2 });
  assert.equal(env.getConsumed(), 1, 'continuation must not reuse Advisor authority');

  env.setMinute(2);
  const trace3 = env.runtime.tick();
  assert.equal(trace3.status, 'resolved');
  assert.deepEqual({ row: env.world.player.row, col: env.world.player.col }, { row: 0, col: 3 });
  env.setMinute(3);
  const atArrival = env.runtime.buildOpportunities(context(env.runtime), env.getCheckpoint());
  assert.ok(!atArrival.some((item) => item.id.includes('visit-tavern-inn')), 'arrival must end tavern continuation');

  env = setup({ blockTavern: true });
  env.world.originVillage.buildings = [{ id: 'region:0,0:building:1:inn', type: 'inn', entrance: { row: 0, col: 3 } }];
  env.setPending(advised);
  const unreachable = env.runtime.tick();
  assert.equal(unreachable.status, 'rejected');
  assert.equal(unreachable.reasonCode, 'ROUTE_NOT_FOUND');
  assert.deepEqual({ row: env.world.player.row, col: env.world.player.col }, { row: 0, col: 0 }, 'unreachable tavern must not teleport');
  assert.equal(env.getCheckpoint().lastStatus, 'rejected');
  const afterReject = env.runtime.buildTavernOpportunity(context(env.runtime), env.getCheckpoint());
  assert.equal(afterReject.continuation, false, 'rejected selection must not activate continuation');

  env = setup();
  ctx = context(env.runtime);
  const canonicalA = JSON.stringify(env.runtime.buildOpportunities(ctx, null));
  const canonicalB = JSON.stringify(env.runtime.buildOpportunities(ctx, null));
  assert.equal(canonicalA, canonicalB, 'same authoritative inputs must produce equivalent candidate output');

  assert.equal(typeof global.Game.ExternalLLM, 'undefined', 'WP-001 runtime must not require an external LLM');
  console.log('WP-001 tavern advice regression: PASS');
}

run();
