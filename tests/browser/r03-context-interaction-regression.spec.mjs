import { test, expect } from '@playwright/test';

async function waitForInteractionResolution(page) {
  await page.goto('./');
  await page.addScriptTag({ url: './js/action_legality.js' });
  await page.addScriptTag({ url: './js/interaction_target.js' });
  await page.addScriptTag({ url: './js/interaction_validation.js' });
  await page.addScriptTag({ url: './js/world_action_resolution.js' });
  await page.waitForFunction(() => Boolean(
    window.Game?.InteractionValidation?.validate &&
    window.Game?.WorldActionResolution?.resolveInteraction &&
    window.Game?.WorldDeltaPersistence?.recordEntityDelta &&
    window.Game?.CampaignPersistence?.serializeSave
  ));
}

const TARGETS = Object.freeze({
  npc: { ref: 'npc:innkeeper', category: 'npc', stateRef: 'awake', available: true, relevance: 'active', location: { worldRef: 'world:seed-42', regionRef: 'region:0,0', settlementRef: 'village:0', siteRef: 'site:tavern', row: 1, col: 1 } },
  location: { ref: 'location:mill', category: 'location', stateRef: 'open', available: true, relevance: 'nearby', location: { worldRef: 'world:seed-42', regionRef: 'region:0,0', settlementRef: 'village:0', siteRef: 'site:mill', row: 2, col: 2 } },
  animal: { ref: 'animal:horse-1', category: 'animal', stateRef: 'calm', available: true, relevance: 'nearby', location: { worldRef: 'world:seed-42', regionRef: 'region:0,0', settlementRef: 'village:0', siteRef: 'site:stable', row: 3, col: 2 } },
  creature: { ref: 'creature:wisp-1', category: 'creature', stateRef: 'roaming', available: true, relevance: 'nearby', location: { worldRef: 'world:seed-42', regionRef: 'region:0,0', settlementRef: 'village:0', siteRef: 'wild:marsh', row: 5, col: 4 } }
});

function ruleFor(target, type) {
  return {
    enabled: true,
    allowedTargetCategories: [target.category],
    allowedRelevance: ['active', 'nearby'],
    requiredActorTags: target.category === 'animal' ? ['animal-handling'] : [],
    requiredTargetStates: [target.stateRef],
    requiresSameSettlement: target.category !== 'creature',
    requiresSameSite: target.category === 'npc',
    timeWindows: target.category === 'npc' ? [{ startMinute: 480, endMinute: 1320 }] : []
  };
}

function contextFor(target, type, overrides = {}) {
  return {
    authority: 'simulation',
    actorId: 'protagonist:1',
    campaignRef: 'campaign:alpha',
    locationRef: target.category === 'npc' ? 'site:tavern' : target.location.siteRef,
    worldRef: 'world:seed-42',
    regionRef: 'region:0,0',
    revision: 12,
    gameMinute: 600,
    actorTags: ['speaks-common', 'animal-handling'],
    actorLocation: { settlementRef: 'village:0', siteRef: target.category === 'npc' ? 'site:tavern' : target.location.siteRef },
    interactions: { [type]: ruleFor(target, type) },
    targetContext: {
      authority: 'simulation',
      worldRef: 'world:seed-42',
      regionRef: 'region:0,0',
      revision: 21,
      targets: [target]
    },
    unrelatedDistantWorld: { regionCount: 1000000, entityCount: 1000000000, materialize: false },
    ...overrides
  };
}

function requestFor(target, type, overrides = {}) {
  return {
    decisionSource: 'character',
    actorId: 'protagonist:1',
    interactionType: type,
    campaignRef: 'campaign:alpha',
    locationRef: target.category === 'npc' ? 'site:tavern' : target.location.siteRef,
    worldRef: 'world:seed-42',
    regionRef: 'region:0,0',
    contextRevision: 12,
    targetReference: {
      ref: target.ref,
      category: target.category,
      worldRef: 'world:seed-42',
      regionRef: 'region:0,0',
      contextRevision: 21
    },
    expectedTargetStateRef: target.stateRef,
    ...overrides
  };
}

function resolutionFor(target, type, overrides = {}) {
  return {
    authority: 'simulation',
    revision: 12,
    interactionRules: [{
      interactionType: type,
      targetRef: target.ref,
      expectedTargetStateRef: target.stateRef,
      nextTargetStateRef: `${target.stateRef}-resolved`,
      regionX: 0,
      regionY: 0,
      statePatch: { interactionCategory: target.category, resolved: true }
    }],
    ...overrides
  };
}

test.beforeEach(async ({ page }) => {
  await waitForInteractionResolution(page);
  await page.evaluate(() => window.Game.WorldDeltaPersistence.clearAll());
});

test('NPC, location, animal and creature interactions resolve deterministically by authoritative context', async ({ page }) => {
  const cases = [
    [TARGETS.npc, 'talk'],
    [TARGETS.location, 'inspect_location'],
    [TARGETS.animal, 'tend_animal'],
    [TARGETS.creature, 'observe_creature']
  ].map(([target, type]) => ({ target, request: requestFor(target, type), context: contextFor(target, type), resolution: resolutionFor(target, type) }));

  const evidence = await page.evaluate((items) => {
    const game = window.Game;
    return items.map((item) => {
      game.WorldDeltaPersistence.clearAll();
      const first = game.WorldActionResolution.resolveInteraction(item.request, item.context, item.resolution);
      const firstDelta = game.WorldDeltaPersistence.capture(game.State.world.seed);
      game.WorldDeltaPersistence.clearAll();
      const second = game.WorldActionResolution.resolveInteraction(item.request, item.context, item.resolution);
      const secondDelta = game.WorldDeltaPersistence.capture(game.State.world.seed);
      return { first, second, firstDelta, secondDelta };
    });
  }, cases);

  expect(evidence).toHaveLength(4);
  for (const item of evidence) {
    expect(item.first).toEqual(item.second);
    expect(item.first).toMatchObject({ authority: 'simulation', status: 'resolved', reasonCode: 'OK', kind: 'interaction' });
    expect(item.firstDelta).toEqual(item.secondDelta);
    expect(item.firstDelta.regions).toHaveLength(1);
  }
});

test('time, location, availability, target state and stale context reject without world-delta mutation', async ({ page }) => {
  const npc = TARGETS.npc;
  const animal = TARGETS.animal;
  const evidence = await page.evaluate((payload) => {
    const game = window.Game;
    const deltaCount = () => game.WorldDeltaPersistence.capture(game.State.world.seed).regions.length;
    const results = {};

    // The production autonomous driver may legitimately create a world delta between
    // beforeEach and this evaluation. Isolate this rejection-only contract at the
    // start of the synchronous batch, then keep the strict zero-mutation assertion.
    game.WorldDeltaPersistence.clearAll();

    results.time = game.WorldActionResolution.resolveInteraction(payload.npcRequest, { ...payload.npcContext, gameMinute: 60 }, payload.npcResolution);
    results.location = game.WorldActionResolution.resolveInteraction(payload.npcRequest, { ...payload.npcContext, actorLocation: { settlementRef: 'village:0', siteRef: 'site:market' } }, payload.npcResolution);
    results.unavailable = game.WorldActionResolution.resolveInteraction(payload.animalRequest, {
      ...payload.animalContext,
      targetContext: { ...payload.animalContext.targetContext, targets: [{ ...payload.animalTarget, available: false }] }
    }, payload.animalResolution);
    results.targetState = game.WorldActionResolution.resolveInteraction({ ...payload.animalRequest, expectedTargetStateRef: 'resting' }, payload.animalContext, payload.animalResolution);
    results.stale = game.WorldActionResolution.resolveInteraction({ ...payload.npcRequest, contextRevision: 11 }, payload.npcContext, payload.npcResolution);
    results.staleResolution = game.WorldActionResolution.resolveInteraction(payload.npcRequest, payload.npcContext, { ...payload.npcResolution, revision: 11 });

    return { results, deltaCount: deltaCount() };
  }, {
    npcRequest: requestFor(npc, 'talk'), npcContext: contextFor(npc, 'talk'), npcResolution: resolutionFor(npc, 'talk'),
    animalRequest: requestFor(animal, 'tend_animal'), animalContext: contextFor(animal, 'tend_animal'), animalResolution: resolutionFor(animal, 'tend_animal'), animalTarget: animal
  });

  expect(evidence.results.time.validationReasonCode).toBe('TIME_WINDOW_CLOSED');
  expect(evidence.results.location.validationReasonCode).toBe('LOCATION_MISMATCH');
  expect(evidence.results.unavailable.validationReasonCode).toBe('TARGET_UNAVAILABLE');
  expect(evidence.results.targetState.validationReasonCode).toBe('TARGET_STATE_MISMATCH');
  expect(evidence.results.stale.validationReasonCode).toBe('STALE_INTERACTION_CONTEXT');
  expect(evidence.results.staleResolution.reasonCode).toBe('STALE_RESOLUTION_CONTEXT');
  Object.values(evidence.results).forEach((result) => expect(result.status).toBe('rejected'));
  expect(evidence.deltaCount).toBe(0);
});

test('save/load preserves resolved world delta needed for consistent target-state revalidation', async ({ page }) => {
  const target = TARGETS.npc;
  const evidence = await page.evaluate(({ request, context, resolution, target }) => {
    const game = window.Game;
    const seed = game.State.world.seed;
    const resolved = game.WorldActionResolution.resolveInteraction(request, context, resolution);
    const beforeSave = game.WorldDeltaPersistence.capture(seed);
    const save = game.CampaignPersistence.serializeSave();
    game.WorldDeltaPersistence.clearAll();
    const load = game.CampaignPersistence.loadSave(save);
    const restored = game.WorldDeltaPersistence.capture(seed);
    const restoredState = restored.regions[0].entityChanges.find((entry) => entry.id === target.ref).state;
    const updatedTarget = { ...target, stateRef: restoredState.stateRef };
    const updatedContext = {
      ...context,
      targetContext: { ...context.targetContext, targets: [updatedTarget] },
      interactions: { talk: { ...context.interactions.talk, requiredTargetStates: [restoredState.stateRef] } }
    };
    const updatedRequest = { ...request, expectedTargetStateRef: restoredState.stateRef };
    const validation = game.InteractionValidation.validate(updatedRequest, updatedContext);
    return { resolved, beforeSave, restored, loadOk: load.ok, restoredState, validation };
  }, { request: requestFor(target, 'talk'), context: contextFor(target, 'talk'), resolution: resolutionFor(target, 'talk'), target });

  expect(evidence.resolved.status).toBe('resolved');
  expect(evidence.loadOk).toBe(true);
  expect(evidence.restored).toEqual(evidence.beforeSave);
  expect(evidence.restoredState).toMatchObject({ stateRef: 'awake-resolved', interactionCategory: 'npc', resolved: true });
  expect(evidence.validation).toMatchObject({ authority: 'simulation', status: 'allowed', reasonCode: 'OK', canResolve: true });
});

test('irrelevant distant world data is not materialized and stale results cannot overwrite newer delta state', async ({ page }) => {
  const target = TARGETS.npc;
  const evidence = await page.evaluate(({ request, context, resolution }) => {
    const game = window.Game;
    const seed = game.State.world.seed;
    const current = game.WorldActionResolution.resolveInteraction(request, context, resolution);
    const afterCurrent = game.WorldDeltaPersistence.capture(seed);
    const stale = game.WorldActionResolution.resolveInteraction({ ...request, contextRevision: 11 }, context, {
      ...resolution,
      interactionRules: [{ ...resolution.interactionRules[0], nextTargetStateRef: 'stale-overwrite', statePatch: { stale: true } }]
    });
    const afterStale = game.WorldDeltaPersistence.capture(seed);
    return {
      current,
      stale,
      afterCurrent,
      afterStale,
      currentResultText: JSON.stringify(current),
      deltaText: JSON.stringify(afterStale)
    };
  }, { request: requestFor(target, 'talk'), context: contextFor(target, 'talk'), resolution: resolutionFor(target, 'talk') });

  expect(evidence.current.status).toBe('resolved');
  expect(evidence.stale).toMatchObject({ status: 'rejected', reasonCode: 'VALIDATION_REJECTED', validationReasonCode: 'STALE_INTERACTION_CONTEXT' });
  expect(evidence.afterStale).toEqual(evidence.afterCurrent);
  expect(evidence.currentResultText).not.toContain('unrelatedDistantWorld');
  expect(evidence.deltaText).not.toContain('unrelatedDistantWorld');
  expect(evidence.deltaText).not.toContain('stale-overwrite');
});