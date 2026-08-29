import { test, expect } from '@playwright/test';

async function waitForResolution(page) {
  await page.goto('./');
  await page.addScriptTag({ url: './js/action_legality.js' });
  await page.addScriptTag({ url: './js/interaction_target.js' });
  await page.addScriptTag({ url: './js/spatial_action_legality.js' });
  await page.addScriptTag({ url: './js/interaction_validation.js' });
  await page.addScriptTag({ url: './js/world_action_resolution.js' });
  await page.waitForFunction(() => Boolean(
    window.Game?.WorldActionResolution?.resolveSpatial &&
    window.Game?.WorldActionResolution?.resolveInteraction &&
    window.Game?.WorldDeltaPersistence?.recordEntityDelta &&
    window.Game?.CampaignPersistence?.serializeSave
  ));
}

function spatialRequest(overrides = {}) {
  return {
    decisionSource: 'character',
    actorId: 'protagonist:1',
    actionType: 'move',
    campaignRef: 'campaign:alpha',
    locationRef: 'location:start',
    worldRef: 'world:seed-42',
    regionRef: 'region:0,0',
    spatialRevision: 31,
    destinationRef: 'destination:1,1',
    ...overrides
  };
}

function spatialContext(overrides = {}) {
  return {
    authority: 'simulation',
    actorId: 'protagonist:1',
    campaignRef: 'campaign:alpha',
    locationRef: 'location:start',
    worldRef: 'world:seed-42',
    regionRef: 'region:0,0',
    revision: 31,
    actorTags: [],
    actions: { move: { enabled: true, requiresDestination: true } },
    destinations: [{ ref: 'destination:1,1', worldRef: 'world:seed-42', regionRef: 'region:0,0', available: true, traversable: true }],
    ...overrides
  };
}

function interactionRequest(overrides = {}) {
  return {
    decisionSource: 'character',
    actorId: 'protagonist:1',
    interactionType: 'talk',
    campaignRef: 'campaign:alpha',
    locationRef: 'site:tavern',
    worldRef: 'world:seed-42',
    regionRef: 'region:0,0',
    contextRevision: 12,
    targetReference: { ref: 'npc:innkeeper', category: 'npc', worldRef: 'world:seed-42', regionRef: 'region:0,0', contextRevision: 21 },
    expectedTargetStateRef: 'awake',
    ...overrides
  };
}

function interactionContext(overrides = {}) {
  return {
    authority: 'simulation',
    actorId: 'protagonist:1',
    campaignRef: 'campaign:alpha',
    locationRef: 'site:tavern',
    worldRef: 'world:seed-42',
    regionRef: 'region:0,0',
    revision: 12,
    gameMinute: 600,
    actorTags: ['speaks-common'],
    actorLocation: { settlementRef: 'village:0', siteRef: 'site:tavern' },
    interactions: {
      talk: {
        enabled: true,
        allowedTargetCategories: ['npc'],
        allowedRelevance: ['active'],
        requiredActorTags: ['speaks-common'],
        requiredTargetStates: ['awake'],
        requiresSameSettlement: true,
        requiresSameSite: true,
        timeWindows: [{ startMinute: 480, endMinute: 1320 }]
      }
    },
    targetContext: {
      authority: 'simulation',
      worldRef: 'world:seed-42',
      regionRef: 'region:0,0',
      revision: 21,
      targets: [{
        ref: 'npc:innkeeper',
        category: 'npc',
        stateRef: 'awake',
        available: true,
        relevance: 'active',
        location: { worldRef: 'world:seed-42', regionRef: 'region:0,0', settlementRef: 'village:0', siteRef: 'site:tavern', row: 1, col: 1 }
      }]
    },
    ...overrides
  };
}

test('validated spatial action performs explicit authoritative protagonist transition and save capture', async ({ page }) => {
  await waitForResolution(page);
  const evidence = await page.evaluate(({ request, validationContext }) => {
    const game = window.Game;
    const tile = () => ({ type: 'grass', elevation: 0, tags: new Set(), blocked: false, obstacle: false });
    game.State.world.rows = 2;
    game.State.world.cols = 2;
    game.State.world.terrain = [[tile(), tile()], [tile(), tile()]];
    Object.assign(game.State.world.player, { row: 0, col: 0, moving: false, startRow: 0, startCol: 0, targetRow: 0, targetCol: 0, progress: 1, pathQueue: [] });

    const result = game.WorldActionResolution.resolveSpatial(request, validationContext, {
      authority: 'simulation',
      revision: 31,
      spatialRules: [{ destinationRef: 'destination:1,1', row: 1, col: 1 }]
    });
    const saved = game.CampaignPersistence.createSaveEnvelope();
    return {
      result,
      player: { row: game.State.world.player.row, col: game.State.world.player.col },
      savedProtagonist: saved.authoritativeState.world.protagonist,
      worldRedraw: game.State.render.needsWorldRedraw,
      minimapRedraw: game.State.render.needsMinimapRedraw
    };
  }, { request: spatialRequest({ result: 'resolved', success: true }), validationContext: spatialContext() });

  expect(evidence.result).toMatchObject({ authority: 'simulation', status: 'resolved', reasonCode: 'OK', kind: 'spatial' });
  expect(evidence.result.consequence).toMatchObject({ type: 'protagonist_location', from: { row: 0, col: 0 }, to: { row: 1, col: 1 }, persistence: 'authoritative_state' });
  expect(evidence.player).toEqual({ row: 1, col: 1 });
  expect(evidence.savedProtagonist).toEqual({ row: 1, col: 1 });
  expect(evidence.worldRedraw).toBe(true);
  expect(evidence.minimapRedraw).toBe(true);
});

test('spatial resolution revalidates stale/direct-control and live blocked destination before mutation', async ({ page }) => {
  await waitForResolution(page);
  const evidence = await page.evaluate(({ request, context }) => {
    const game = window.Game;
    const tile = () => ({ type: 'grass', elevation: 0, tags: new Set(), blocked: false, obstacle: false });
    game.State.world.rows = 2;
    game.State.world.cols = 2;
    game.State.world.terrain = [[tile(), tile()], [tile(), tile()]];
    Object.assign(game.State.world.player, { row: 0, col: 0, moving: false, startRow: 0, startCol: 0, targetRow: 0, targetCol: 0, progress: 1, pathQueue: [] });
    const before = JSON.stringify({ row: game.State.world.player.row, col: game.State.world.player.col });
    const stale = game.WorldActionResolution.resolveSpatial(request, context, { authority: 'simulation', revision: 30, spatialRules: [{ destinationRef: 'destination:1,1', row: 1, col: 1 }] });
    const direct = game.WorldActionResolution.resolveSpatial({ ...request, decisionSource: 'player', result: 'resolved' }, context, { authority: 'simulation', revision: 31, spatialRules: [{ destinationRef: 'destination:1,1', row: 1, col: 1 }] });
    game.State.world.terrain[1][1].blocked = true;
    const blocked = game.WorldActionResolution.resolveSpatial(request, context, { authority: 'simulation', revision: 31, spatialRules: [{ destinationRef: 'destination:1,1', row: 1, col: 1 }] });
    return { stale, direct, blocked, unchanged: before === JSON.stringify({ row: game.State.world.player.row, col: game.State.world.player.col }) };
  }, { request: spatialRequest(), context: spatialContext() });

  expect(evidence.stale.reasonCode).toBe('STALE_RESOLUTION_CONTEXT');
  expect(evidence.direct).toMatchObject({ status: 'rejected', reasonCode: 'VALIDATION_REJECTED', validationReasonCode: 'DIRECT_CONTROL_FORBIDDEN' });
  expect(evidence.blocked.reasonCode).toBe('DESTINATION_STATE_MISMATCH');
  expect(evidence.unchanged).toBe(true);
});

test('validated interaction writes sparse authoritative world delta and survives campaign save/load', async ({ page }) => {
  await waitForResolution(page);
  const evidence = await page.evaluate(({ request, context }) => {
    const game = window.Game;
    const deltas = game.WorldDeltaPersistence;
    const seed = game.State.world.seed;
    deltas.clearAll();
    const result = game.WorldActionResolution.resolveInteraction(request, context, {
      authority: 'simulation',
      revision: 12,
      interactionRules: [{
        interactionType: 'talk',
        targetRef: 'npc:innkeeper',
        expectedTargetStateRef: 'awake',
        nextTargetStateRef: 'conversed',
        regionX: 0,
        regionY: 0,
        statePatch: { disposition: 'friendly' }
      }]
    });
    const captured = deltas.capture(seed);
    const saved = game.CampaignPersistence.serializeSave();
    deltas.clearAll();
    const load = game.CampaignPersistence.loadSave(saved);
    const restored = deltas.capture(seed);
    return { result, captured, loadOk: load.ok, restored };
  }, { request: interactionRequest({ success: true, authoritativeResult: 'forced' }), context: interactionContext() });

  expect(evidence.result).toMatchObject({ authority: 'simulation', status: 'resolved', reasonCode: 'OK', kind: 'interaction' });
  expect(evidence.result.consequence).toMatchObject({ type: 'world_entity_delta', targetRef: 'npc:innkeeper', targetCategory: 'npc', persistence: 'world_delta' });
  expect(evidence.captured.regions).toHaveLength(1);
  expect(evidence.captured.regions[0].entityChanges[0]).toMatchObject({
    id: 'npc:innkeeper', removed: false,
    state: { disposition: 'friendly', stateRef: 'conversed', lastInteraction: { type: 'talk', actorId: 'protagonist:1', campaignRef: 'campaign:alpha', contextRevision: 12 } }
  });
  expect(evidence.loadOk).toBe(true);
  expect(evidence.restored).toEqual(evidence.captured);
});

test('interaction revalidation prevents stale, invalid, presentation-owned or state-mismatched resolution without delta mutation', async ({ page }) => {
  await waitForResolution(page);
  const evidence = await page.evaluate(({ request, context }) => {
    const game = window.Game;
    const deltas = game.WorldDeltaPersistence;
    const seed = game.State.world.seed;
    deltas.clearAll();
    const rule = { interactionType: 'talk', targetRef: 'npc:innkeeper', expectedTargetStateRef: 'awake', nextTargetStateRef: 'conversed', regionX: 0, regionY: 0, statePatch: { disposition: 'friendly' } };
    const stale = game.WorldActionResolution.resolveInteraction(request, context, { authority: 'simulation', revision: 11, interactionRules: [rule] });
    const direct = game.WorldActionResolution.resolveInteraction({ ...request, decisionSource: 'player', status: 'resolved' }, context, { authority: 'simulation', revision: 12, interactionRules: [rule] });
    const presentation = game.WorldActionResolution.resolveInteraction(request, context, { authority: 'presentation', revision: 12, interactionRules: [rule] });
    const stateMismatch = game.WorldActionResolution.resolveInteraction(request, context, { authority: 'simulation', revision: 12, interactionRules: [{ ...rule, expectedTargetStateRef: 'sleeping' }] });
    return { stale, direct, presentation, stateMismatch, deltaRegionCount: deltas.capture(seed).regions.length };
  }, { request: interactionRequest(), context: interactionContext() });

  expect(evidence.stale.reasonCode).toBe('STALE_RESOLUTION_CONTEXT');
  expect(evidence.direct).toMatchObject({ status: 'rejected', reasonCode: 'VALIDATION_REJECTED', validationReasonCode: 'DIRECT_CONTROL_FORBIDDEN' });
  expect(evidence.presentation.reasonCode).toBe('NON_SIMULATION_RESOLUTION_CONTEXT');
  expect(evidence.stateMismatch.reasonCode).toBe('TARGET_STATE_MISMATCH');
  expect(evidence.deltaRegionCount).toBe(0);
});
