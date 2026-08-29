import { test, expect } from '@playwright/test';

async function waitForResolution(page) {
  await page.goto('./');
  await page.addScriptTag({ url: './js/action_legality.js' });
  await page.addScriptTag({ url: './js/spatial_action_legality.js' });
  await page.addScriptTag({ url: './js/world_action_resolution.js' });
  await page.waitForFunction(() => Boolean(
    window.Game?.ActionLegality?.validate &&
    window.Game?.SpatialActionLegality?.validate &&
    window.Game?.WorldActionResolution?.resolveSpatial &&
    window.Game?.AuthoritativeState?.capture
  ));
}

function request(overrides = {}) {
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

function context(overrides = {}) {
  return {
    authority: 'simulation',
    actorId: 'protagonist:1',
    campaignRef: 'campaign:alpha',
    locationRef: 'location:start',
    worldRef: 'world:seed-42',
    regionRef: 'region:0,0',
    revision: 31,
    actorTags: ['walking'],
    actions: {
      move: { enabled: true, requiresDestination: true },
      wait: { enabled: true, requiresDestination: false }
    },
    destinations: [
      { ref: 'destination:1,1', worldRef: 'world:seed-42', regionRef: 'region:0,0', available: true, traversable: true },
      { ref: 'destination:2,2', worldRef: 'world:seed-42', regionRef: 'region:0,0', available: true, traversable: false }
    ],
    ...overrides
  };
}

function resolutionContext(overrides = {}) {
  return {
    authority: 'simulation',
    revision: 31,
    spatialRules: [
      { destinationRef: 'destination:1,1', row: 1, col: 1 },
      { destinationRef: 'destination:2,2', row: 2, col: 2 }
    ],
    ...overrides
  };
}

test.beforeEach(async ({ page }) => {
  await waitForResolution(page);
  await page.evaluate(() => {
    const game = window.Game;
    const tile = () => ({ type: 'grass', elevation: 0, tags: new Set(), blocked: false, obstacle: false });
    game.State.world.seed = 'seed-42';
    game.State.world.rows = 3;
    game.State.world.cols = 3;
    game.State.world.terrain = [
      [tile(), tile(), tile()],
      [tile(), tile(), tile()],
      [tile(), tile(), tile()]
    ];
    Object.assign(game.State.world.player, {
      row: 0,
      col: 0,
      moving: false,
      startRow: 0,
      startCol: 0,
      targetRow: 0,
      targetCol: 0,
      progress: 1,
      pathQueue: []
    });
  });
});

test('allowed spatial resolution changes only approved authoritative protagonist location', async ({ page }) => {
  const evidence = await page.evaluate(({ candidate, validationContext, resolution }) => {
    const game = window.Game;
    const before = game.AuthoritativeState.capture(game.State);
    const result = game.WorldActionResolution.resolveSpatial(candidate, validationContext, resolution);
    const after = game.AuthoritativeState.capture(game.State);
    return { before, after, result };
  }, { candidate: request({ success: true, result: 'forced' }), validationContext: context(), resolution: resolutionContext() });

  expect(evidence.result).toMatchObject({ authority: 'simulation', status: 'resolved', reasonCode: 'OK', kind: 'spatial' });
  expect(evidence.result.consequence).toMatchObject({
    type: 'protagonist_location',
    destinationRef: 'destination:1,1',
    from: { row: 0, col: 0 },
    to: { row: 1, col: 1 },
    persistence: 'authoritative_state'
  });
  expect(evidence.before.world.protagonist).toEqual({ row: 0, col: 0 });
  expect(evidence.after.world.protagonist).toEqual({ row: 1, col: 1 });
  expect({ ...evidence.after.world, protagonist: evidence.before.world.protagonist })
    .toEqual(evidence.before.world);
});

test('rejected, malformed and direct-control candidates cannot mutate authoritative state', async ({ page }) => {
  const evidence = await page.evaluate(({ baseRequest, validationContext, resolution }) => {
    const game = window.Game;
    const before = game.AuthoritativeState.canonicalStringify(game.State);
    const results = {
      direct: game.WorldActionResolution.resolveSpatial({ ...baseRequest, decisionSource: 'player', success: true }, validationContext, resolution),
      malformed: game.WorldActionResolution.resolveSpatial({ actionType: 'move', destinationRef: 'destination:1,1' }, validationContext, resolution),
      missingDestination: game.WorldActionResolution.resolveSpatial({ ...baseRequest, destinationRef: null }, validationContext, resolution),
      blockedByContract: game.WorldActionResolution.resolveSpatial({ ...baseRequest, destinationRef: 'destination:2,2' }, validationContext, resolution)
    };
    const after = game.AuthoritativeState.canonicalStringify(game.State);
    return { before, after, results };
  }, { baseRequest: request(), validationContext: context(), resolution: resolutionContext() });

  expect(evidence.after).toBe(evidence.before);
  expect(evidence.results.direct).toMatchObject({ status: 'rejected', reasonCode: 'VALIDATION_REJECTED', validationReasonCode: 'DIRECT_CONTROL_FORBIDDEN' });
  expect(evidence.results.malformed).toMatchObject({ status: 'rejected', reasonCode: 'VALIDATION_REJECTED' });
  expect(evidence.results.missingDestination).toMatchObject({ status: 'rejected', reasonCode: 'VALIDATION_REJECTED', validationReasonCode: 'DESTINATION_REQUIRED' });
  expect(evidence.results.blockedByContract).toMatchObject({ status: 'rejected', reasonCode: 'VALIDATION_REJECTED', validationReasonCode: 'DESTINATION_BLOCKED' });
});

test('stale validation and stale resolution revisions reject without mutation', async ({ page }) => {
  const evidence = await page.evaluate(({ baseRequest, validationContext, resolution }) => {
    const game = window.Game;
    const before = game.AuthoritativeState.canonicalStringify(game.State);
    const staleValidation = game.WorldActionResolution.resolveSpatial(
      { ...baseRequest, spatialRevision: 30 },
      validationContext,
      resolution
    );
    const staleResolution = game.WorldActionResolution.resolveSpatial(
      baseRequest,
      validationContext,
      { ...resolution, revision: 30 }
    );
    game.State.world.terrain[1][1].blocked = true;
    const beforeLiveBlock = game.AuthoritativeState.canonicalStringify(game.State);
    const liveBlocked = game.WorldActionResolution.resolveSpatial(baseRequest, validationContext, resolution);
    const afterLiveBlock = game.AuthoritativeState.canonicalStringify(game.State);
    return { before, staleValidation, staleResolution, beforeLiveBlock, liveBlocked, afterLiveBlock };
  }, { baseRequest: request(), validationContext: context(), resolution: resolutionContext() });

  expect(evidence.staleValidation).toMatchObject({ status: 'rejected', reasonCode: 'VALIDATION_REJECTED', validationReasonCode: 'STALE_SPATIAL_CONTEXT' });
  expect(evidence.staleResolution).toMatchObject({ status: 'rejected', reasonCode: 'STALE_RESOLUTION_CONTEXT' });
  expect(evidence.liveBlocked).toMatchObject({ status: 'rejected', reasonCode: 'DESTINATION_STATE_MISMATCH' });
  expect(evidence.afterLiveBlock).toBe(evidence.beforeLiveBlock);
  expect(JSON.parse(evidence.before).world.protagonist).toEqual({ row: 0, col: 0 });
});

test('equivalent successful inputs resolve deterministically across property and list order', async ({ page }) => {
  const evidence = await page.evaluate(({ baseRequest, validationContext, resolution }) => {
    const game = window.Game;
    const reset = () => Object.assign(game.State.world.player, {
      row: 0, col: 0, moving: false, startRow: 0, startCol: 0,
      targetRow: 0, targetCol: 0, progress: 1, pathQueue: []
    });

    reset();
    const first = game.WorldActionResolution.resolveSpatial(baseRequest, validationContext, resolution);

    reset();
    const reorderedRequest = {
      destinationRef: 'destination:1,1',
      spatialRevision: 31,
      regionRef: 'region:0,0',
      worldRef: 'world:seed-42',
      locationRef: 'location:start',
      campaignRef: 'campaign:alpha',
      actionType: 'move',
      actorId: 'protagonist:1',
      decisionSource: 'character'
    };
    const reorderedContext = {
      ...validationContext,
      actorTags: [...validationContext.actorTags].reverse(),
      destinations: [...validationContext.destinations].reverse(),
      actions: { wait: validationContext.actions.wait, move: validationContext.actions.move }
    };
    const reorderedResolution = {
      ...resolution,
      spatialRules: [...resolution.spatialRules].reverse()
    };
    const second = game.WorldActionResolution.resolveSpatial(reorderedRequest, reorderedContext, reorderedResolution);
    return { first, second };
  }, { baseRequest: request(), validationContext: context(), resolution: resolutionContext() });

  expect(evidence.first).toEqual(evidence.second);
  expect(evidence.first.status).toBe('resolved');
});

test('presentation-owned resolution context cannot synthesize success', async ({ page }) => {
  const evidence = await page.evaluate(({ candidate, validationContext, resolution }) => {
    const game = window.Game;
    const before = game.AuthoritativeState.canonicalStringify(game.State);
    const result = game.WorldActionResolution.resolveSpatial(
      { ...candidate, uiAllowed: true, result: { status: 'resolved' } },
      validationContext,
      { ...resolution, authority: 'presentation', result: 'resolved' }
    );
    const after = game.AuthoritativeState.canonicalStringify(game.State);
    return { before, after, result };
  }, { candidate: request(), validationContext: context(), resolution: resolutionContext() });

  expect(evidence.result).toMatchObject({ status: 'rejected', reasonCode: 'NON_SIMULATION_RESOLUTION_CONTEXT' });
  expect(evidence.after).toBe(evidence.before);
});