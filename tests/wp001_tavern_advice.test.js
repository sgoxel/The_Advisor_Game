'use strict';

const assert = require('assert');
const path = require('path');

const runtimePath = path.resolve(__dirname, '../js/autonomous_protagonist_runtime.js');
const localBotPath = path.resolve(__dirname, '../js/local_bot_driver.js');

function terrain(rows = 5, cols = 5) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ blocked: false, obstacle: false })));
}

function makeWorld() {
  return {
    seed: 'WP001-SEED', rows: 5, cols: 5, terrain: terrain(), regionRef: 'region:0,0', currentRegion: { x: 0, y: 0 },
    protagonist: { id: 'protagonist:main' },
    player: { id: 'protagonist:main', row: 0, col: 0, regionX: 0, regionY: 0 }, npcs: [],
    originVillage: { buildings: [
      { id: 'region:0,0:building:9:inn', type: 'inn', entrance: { row: 0, col: 3 } },
      { id: 'region:0,0:building:2:tavern', type: 'tavern', entrance: { row: 4, col: 4 } }
    ] }
  };
}

function advisorInfluence(context, disposition, message = 'Go to the tavern.') {
  const effect = disposition === 'accepted' ? 'consider-now' : disposition === 'reinterpreted' ? 'consider-reinterpreted' : 'no-positive-weight';
  return Object.freeze({
    authority: 'character-advice', status: 'ready', disposition, advisorMessage: message,
    canValidateAction: false, canExecuteAction: false, canResolveAction: false, canMutateWorld: false,
    context: Object.freeze({
      actorId: context.actorId, campaignRef: context.campaignRef, locationRef: context.locationRef,
      worldRef: context.worldRef, regionRef: context.regionRef,
      contextRevision: context.contextRevision, campaignMinute: context.campaignMinute
    }),
    record: Object.freeze({
      actorId: context.actorId, campaignRef: context.campaignRef, locationRef: context.locationRef,
      contextRevision: context.contextRevision, campaignMinute: context.campaignMinute,
      advisor: Object.freeze({ message }),
      influence: Object.freeze({
        type: 'non-binding-advisory-context', effect,
        directActionAuthority: false, directMovementAuthority: false,
        directLegalityAuthority: false, directResolutionAuthority: false
      })
    })
  });
}

function setup(options = {}) {
  delete require.cache[runtimePath];
  delete require.cache[localBotPath];
  global.window = global;
  delete global.document;
  global.Game = {};

  const world = makeWorld();
  let minute = 0, pendingInfluence = null, consumed = 0, checkpoint = options.checkpoint || null;
  let blockTavern = options.blockTavern === true;

  Game.State = { world, simulation: { contextRevision: 0 }, render: {} };
  Game.GameTime = { capture: () => ({ authority: 'simulation', totalGameMinutes: minute }) };
  Game.ProtagonistRoutine = {
    buildRoutineOpportunity(context) {
      return Object.freeze({
        id: 'routine:daily-home:house-1', source: 'protagonist-resident-routine', actorId: context.actorId,
        goalType: 'daily-home', actionType: 'move', targetRef: 'house-1', locationRef: context.locationRef,
        priority: -100, urgency: 5, distance: 0, expectedContextRevision: context.contextRevision,
        routine: { targetBuildingId: 'house-1', targetBuildingType: 'home', target: { row: 1, col: 0 } }
      });
    }
  };
  Game.TerrainRouting = {
    findPath(_terrain, start, goal) {
      if (blockTavern && goal.row === 0 && goal.col === 3) return [];
      const result = [{ row: start.row, col: start.col }];
      let row = start.row, col = start.col;
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
      world.player.row = rule.row; world.player.col = rule.col;
      return { status: 'resolved', reasonCode: 'OK', consequence: { type: 'protagonist_location', from, to: { row: rule.row, col: rule.col } } };
    }
  };
  Game.AdvisorChatUI = {
    peekPendingInfluenceForDecision() { return pendingInfluence; },
    markPendingInfluenceConsumed() { consumed += 1; pendingInfluence = null; }
  };

  require(localBotPath);
  Game.AutonomousDecisionLoop = {
    readCheckpoint() { return checkpoint; },
    prepare(context, opportunities) {
      if (context.authority !== 'simulation') return { status: 'rejected', reasonCode: 'NON_SIMULATION_CONTEXT' };
      return { status: 'ready', prepared: { authority: 'simulation', opportunities } };
    },
    resolvePrepared(prepared, context, execution, influence) {
      const selection = Game.LocalBotDriver.select(context, prepared.opportunities, influence);
      const selected = selection.selected;
      const route = execution.routes.find((item) => item.opportunityId === selected?.id);
      if (!selected || !route) {
        checkpoint = { lastStatus: 'rejected', selectedOpportunityId: selected?.id || null, worldRef: context.worldRef, regionRef: context.regionRef, campaignMinute: context.campaignMinute };
        return { status: 'rejected', reasonCode: 'ROUTE_NOT_FOUND', execution: { selectedOpportunityId: selected?.id || null } };
      }
      const resolved = Game.WorldActionResolution.resolveSpatial({}, route.validationContext, route.resolutionContext);
      const status = resolved.status === 'resolved' ? 'resolved' : 'rejected';
      checkpoint = { lastStatus: status, selectedOpportunityId: selected.id, worldRef: context.worldRef, regionRef: context.regionRef, campaignMinute: context.campaignMinute };
      return { status, reasonCode: resolved.reasonCode, execution: { selectedOpportunityId: selected.id, simulationStatus: resolved.status, consequence: resolved.consequence } };
    }
  };

  require(runtimePath);
  return {
    runtime: Game.AutonomousProtagonistRuntime, localBot: Game.LocalBotDriver, world,
    setMinute(value) { minute = value; }, setPending(value) { pendingInfluence = value; },
    getConsumed() { return consumed; }, getCheckpoint() { return checkpoint; }, setBlockTavern(value) { blockTavern = value; }
  };
}

function context(runtime) { return runtime.authoritativeContext(); }

function run() {
  let env = setup();
  let ctx = context(env.runtime);
  const tavern = env.runtime.resolveLocalTavern();
  assert.equal(tavern.buildingId, 'region:0,0:building:2:tavern');
  assert.deepEqual(tavern.point, { row: 4, col: 4 });
  const first = env.runtime.buildTavernOpportunity(ctx, null), second = env.runtime.buildTavernOpportunity(ctx, null);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.goalType, 'visit-tavern-inn');
  assert.equal(first.directMovementAuthority, false);

  env.world.originVillage.buildings = [{ id: 'bad-inn', type: 'inn', entrance: { row: 1.5, col: 2 } }];
  assert.equal(env.runtime.buildTavernOpportunity(ctx, null), null);

  env = setup();
  ctx = context(env.runtime);
  const opportunities = env.runtime.buildOpportunities(ctx, null);
  assert.equal(env.localBot.select(ctx, opportunities).selected.id, 'routine:daily-home:house-1', 'baseline routine must win');
  const advised = advisorInfluence(ctx, 'reinterpreted');
  const normalized = env.localBot.normalizeAdvisorInfluence(advised, ctx);
  assert.equal(normalized.status, 'ready');
  assert.equal(normalized.directActionAuthority, false);
  assert.equal(normalized.directMovementAuthority, false);
  assert.equal(normalized.directLegalityAuthority, false);
  assert.equal(normalized.directResolutionAuthority, false);
  assert.ok(env.localBot.select(ctx, opportunities, advised).selected.id.includes('visit-tavern-inn'), 'actual Local BOT weighting must allow tavern advice influence');
  const rejected = advisorInfluence(ctx, 'rejected', 'I suggest visiting the tavern.');
  assert.equal(env.localBot.select(ctx, opportunities, rejected).selected.id, 'routine:daily-home:house-1', 'rejected advice must not force tavern selection');

  const before = { row: env.world.player.row, col: env.world.player.col };
  env.setPending(advised);
  assert.deepEqual({ row: env.world.player.row, col: env.world.player.col }, before);

  env.world.originVillage.buildings = [{ id: 'region:0,0:building:1:inn', type: 'inn', entrance: { row: 0, col: 3 } }];
  const trace1 = env.runtime.tick();
  assert.equal(trace1.status, 'resolved');
  assert.ok(trace1.selectedOpportunityId.includes('visit-tavern-inn'));
  assert.deepEqual({ row: env.world.player.row, col: env.world.player.col }, { row: 0, col: 1 });
  assert.equal(env.getConsumed(), 1);
  assert.equal(env.getCheckpoint().lastStatus, 'resolved');

  env.setMinute(1);
  const trace2 = env.runtime.tick();
  assert.equal(trace2.status, 'resolved');
  assert.ok(trace2.selectedOpportunityId.includes('visit-tavern-inn'));
  assert.deepEqual({ row: env.world.player.row, col: env.world.player.col }, { row: 0, col: 2 });
  assert.equal(env.getConsumed(), 1, 'continuation must not reuse Advisor influence');

  env.setMinute(2);
  assert.equal(env.runtime.tick().status, 'resolved');
  assert.deepEqual({ row: env.world.player.row, col: env.world.player.col }, { row: 0, col: 3 });
  env.setMinute(3);
  assert.ok(!env.runtime.buildOpportunities(context(env.runtime), env.getCheckpoint()).some((item) => item.id.includes('visit-tavern-inn')));

  env = setup({ blockTavern: true });
  env.world.originVillage.buildings = [{ id: 'region:0,0:building:1:inn', type: 'inn', entrance: { row: 0, col: 3 } }];
  ctx = context(env.runtime);
  env.setPending(advisorInfluence(ctx, 'reinterpreted'));
  const unreachable = env.runtime.tick();
  assert.equal(unreachable.status, 'rejected');
  assert.equal(unreachable.reasonCode, 'ROUTE_NOT_FOUND');
  assert.deepEqual({ row: env.world.player.row, col: env.world.player.col }, { row: 0, col: 0 });
  assert.equal(env.getCheckpoint().lastStatus, 'rejected');
  assert.equal(env.runtime.buildTavernOpportunity(context(env.runtime), env.getCheckpoint()).continuation, false);

  env = setup();
  ctx = context(env.runtime);
  assert.equal(JSON.stringify(env.runtime.buildOpportunities(ctx, null)), JSON.stringify(env.runtime.buildOpportunities(ctx, null)));
  assert.equal(env.localBot.select({ ...ctx, authority: 'presentation' }, env.runtime.buildOpportunities(ctx, null)).status, 'rejected');
  assert.equal(typeof global.Game.ExternalLLM, 'undefined');
  console.log('WP-001 tavern advice regression: PASS');
}

run();
