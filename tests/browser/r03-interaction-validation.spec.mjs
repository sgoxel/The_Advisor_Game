import { test, expect } from '@playwright/test';

async function waitForInteractionValidation(page) {
  await page.goto('./');
  await page.addScriptTag({ url: './js/action_legality.js' });
  await page.addScriptTag({ url: './js/interaction_target.js' });
  await page.addScriptTag({ url: './js/interaction_validation.js' });
  await page.waitForFunction(() => Boolean(
    window.Game?.ActionLegality?.validate &&
    window.Game?.InteractionTarget?.resolve &&
    window.Game?.InteractionValidation?.validate
  ));
}

const TARGETS = {
  npc: { ref: 'npc:innkeeper', category: 'npc', stateRef: 'awake', available: true, relevance: 'active', location: { worldRef: 'world:seed-42', regionRef: 'region:0,0', settlementRef: 'village:0', siteRef: 'site:tavern', row: 1, col: 2 } },
  location: { ref: 'location:mill', category: 'location', stateRef: 'open', available: true, relevance: 'nearby', location: { worldRef: 'world:seed-42', regionRef: 'region:0,0', settlementRef: 'village:0', siteRef: 'site:mill', row: 4, col: 5 } },
  animal: { ref: 'animal:horse-1', category: 'animal', stateRef: 'calm', available: true, relevance: 'nearby', location: { worldRef: 'world:seed-42', regionRef: 'region:0,0', settlementRef: 'village:0', siteRef: 'site:stable', row: 3, col: 2 } },
  creature: { ref: 'creature:wisp-1', category: 'creature', stateRef: 'roaming', available: true, relevance: 'nearby', location: { worldRef: 'world:seed-42', regionRef: 'region:0,0', settlementRef: null, siteRef: 'wild:marsh', row: 9, col: 7 } }
};

function contextFor(target, interactionType, rule = {}, overrides = {}) {
  return {
    authority: 'simulation',
    actorId: 'protagonist:1',
    campaignRef: 'campaign:alpha',
    locationRef: 'site:tavern',
    worldRef: 'world:seed-42',
    regionRef: 'region:0,0',
    revision: 12,
    gameMinute: 600,
    actorTags: ['speaks-common', 'animal-handling'],
    actorLocation: { settlementRef: 'village:0', siteRef: target.category === 'npc' ? 'site:tavern' : target.location.siteRef },
    interactions: {
      [interactionType]: {
        enabled: true,
        allowedTargetCategories: [target.category],
        allowedRelevance: ['active', 'nearby'],
        requiredActorTags: [],
        requiredTargetStates: [target.stateRef],
        requiresSameSettlement: target.category !== 'creature',
        requiresSameSite: target.category === 'npc',
        timeWindows: target.category === 'npc' ? [{ startMinute: 480, endMinute: 1320 }] : [] ,
        ...rule
      }
    },
    targetContext: {
      authority: 'simulation',
      worldRef: 'world:seed-42',
      regionRef: 'region:0,0',
      revision: 21,
      targets: [target]
    },
    unrelatedDistantWorld: { regionCount: 1000000, shouldRemainIgnored: true },
    ...overrides
  };
}

function requestFor(target, interactionType, overrides = {}) {
  return {
    decisionSource: 'character',
    actorId: 'protagonist:1',
    interactionType,
    campaignRef: 'campaign:alpha',
    locationRef: 'site:tavern',
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

test('representative NPC, location, animal and creature interactions validate deterministically', async ({ page }) => {
  await waitForInteractionValidation(page);
  const cases = [
    [TARGETS.npc, 'talk'],
    [TARGETS.location, 'inspect_location'],
    [TARGETS.animal, 'tend_animal'],
    [TARGETS.creature, 'observe_creature']
  ];
  const evidence = await page.evaluate((items) => items.map(({ request, context }) => window.Game.InteractionValidation.validate(request, context)), cases.map(([target, type]) => ({ request: requestFor(target, type), context: contextFor(target, type) })));
  expect(evidence).toHaveLength(4);
  for (const result of evidence) {
    expect(result).toMatchObject({ authority: 'simulation', status: 'allowed', reasonCode: 'OK', canResolve: true });
    expect(['npc', 'location', 'animal', 'creature']).toContain(result.target.category);
  }
});

test('time, location, availability, relevance, target state and actor prerequisites reject safely', async ({ page }) => {
  await waitForInteractionValidation(page);
  const npc = TARGETS.npc;
  const animal = TARGETS.animal;
  const creature = TARGETS.creature;
  const evidence = await page.evaluate((payload) => {
    const api = window.Game.InteractionValidation;
    return {
      timeClosed: api.validate(payload.npcRequest, { ...payload.npcContext, gameMinute: 60 }),
      wrongSite: api.validate(payload.npcRequest, { ...payload.npcContext, actorLocation: { settlementRef: 'village:0', siteRef: 'site:market' } }),
      unavailable: api.validate(payload.animalRequest, { ...payload.animalContext, targetContext: { ...payload.animalContext.targetContext, targets: [{ ...payload.animalTarget, available: false }] } }),
      inactive: api.validate(payload.creatureRequest, { ...payload.creatureContext, targetContext: { ...payload.creatureContext.targetContext, targets: [{ ...payload.creatureTarget, relevance: 'inactive' }] } }),
      staleTargetState: api.validate({ ...payload.animalRequest, expectedTargetStateRef: 'resting' }, payload.animalContext),
      missingPrerequisite: api.validate(payload.animalRequest, { ...payload.animalContext, actorTags: [], interactions: { tend_animal: { ...payload.animalContext.interactions.tend_animal, requiredActorTags: ['animal-handling'] } } })
    };
  }, {
    npcRequest: requestFor(npc, 'talk'), npcContext: contextFor(npc, 'talk'),
    animalRequest: requestFor(animal, 'tend_animal'), animalContext: contextFor(animal, 'tend_animal'), animalTarget: animal,
    creatureRequest: requestFor(creature, 'observe_creature'), creatureContext: contextFor(creature, 'observe_creature'), creatureTarget: creature
  });
  expect(evidence.timeClosed.reasonCode).toBe('TIME_WINDOW_CLOSED');
  expect(evidence.wrongSite.reasonCode).toBe('LOCATION_MISMATCH');
  expect(evidence.unavailable.reasonCode).toBe('TARGET_UNAVAILABLE');
  expect(evidence.inactive.reasonCode).toBe('TARGET_IRRELEVANT');
  expect(evidence.staleTargetState.reasonCode).toBe('TARGET_STATE_MISMATCH');
  expect(evidence.missingPrerequisite.reasonCode).toBe('PREREQUISITE_NOT_MET');
  Object.values(evidence).forEach((result) => expect(result.canResolve).toBe(false));
});

test('stale, mismatched, presentation-owned and direct-control requests cannot become legal', async ({ page }) => {
  await waitForInteractionValidation(page);
  const target = TARGETS.npc;
  const request = requestFor(target, 'talk');
  const context = contextFor(target, 'talk');
  const evidence = await page.evaluate(({ request, context }) => {
    const api = window.Game.InteractionValidation;
    return {
      staleInteraction: api.validate({ ...request, contextRevision: 11 }, context),
      staleTarget: api.validate({ ...request, targetReference: { ...request.targetReference, contextRevision: 20 } }, context),
      wrongWorld: api.validate({ ...request, worldRef: 'world:other' }, context),
      wrongRegion: api.validate({ ...request, regionRef: 'region:9,9' }, context),
      presentationContext: api.validate(request, { ...context, authority: 'presentation' }),
      directControl: api.validate({ ...request, decisionSource: 'player', allowed: true, result: 'allowed' }, context),
      unsupported: api.validate({ ...request, interactionType: 'teleport_target' }, context)
    };
  }, { request, context });
  expect(evidence.staleInteraction.reasonCode).toBe('STALE_INTERACTION_CONTEXT');
  expect(evidence.staleTarget).toMatchObject({ status: 'rejected', reasonCode: 'TARGET_REFERENCE_REJECTED', targetReasonCode: 'STALE_CONTEXT_REFERENCE' });
  expect(evidence.wrongWorld.reasonCode).toBe('WORLD_CONTEXT_MISMATCH');
  expect(evidence.wrongRegion.reasonCode).toBe('REGION_CONTEXT_MISMATCH');
  expect(evidence.presentationContext.reasonCode).toBe('NON_SIMULATION_CONTEXT');
  expect(evidence.directControl.reasonCode).toBe('DIRECT_CONTROL_FORBIDDEN');
  expect(evidence.unsupported.reasonCode).toBe('INTERACTION_NOT_SUPPORTED');
});

test('validation is immutable, canonical and relevance-bounded without world materialization', async ({ page }) => {
  await waitForInteractionValidation(page);
  const target = TARGETS.location;
  const request = requestFor(target, 'inspect_location');
  const context = contextFor(target, 'inspect_location');
  const evidence = await page.evaluate(({ request, context, target }) => {
    const api = window.Game.InteractionValidation;
    let materializeCalls = 0;
    window.Game.WorldHierarchy = { materializeRegion: () => { materializeCalls += 1; throw new Error('must not materialize'); } };
    const candidate = { ...request, presentationAllowed: true, uiOverride: { allowed: true } };
    const beforeCandidate = JSON.stringify(candidate);
    const beforeContext = JSON.stringify(context);
    const beforeState = JSON.stringify(window.Game.State);
    const result = api.validate(candidate, context);
    const reordered = {
      expectedTargetStateRef: target.stateRef,
      targetReference: { contextRevision: 21, regionRef: ' region:0,0 ', worldRef: ' world:seed-42 ', category: ' LOCATION ', ref: ' location:mill ' },
      contextRevision: 12, regionRef: ' region:0,0 ', worldRef: ' world:seed-42 ', locationRef: ' site:tavern ', campaignRef: ' campaign:alpha ', interactionType: ' INSPECT_LOCATION ', actorId: ' protagonist:1 ', decisionSource: ' CHARACTER '
    };
    return {
      result,
      candidateUnchanged: JSON.stringify(candidate) === beforeCandidate,
      contextUnchanged: JSON.stringify(context) === beforeContext,
      runtimeUnchanged: JSON.stringify(window.Game.State) === beforeState,
      materializeCalls,
      canonicalA: api.canonicalStringify(request),
      canonicalB: api.canonicalStringify(reordered),
      frozen: Object.isFrozen(result) && Object.isFrozen(result.request) && Object.isFrozen(result.target),
      ignoredPresentation: !Object.prototype.hasOwnProperty.call(result.request, 'presentationAllowed') && !Object.prototype.hasOwnProperty.call(result.request, 'uiOverride'),
      hasMutationApi: ['set', 'apply', 'commit', 'resolve', 'mutate', 'update', 'materialize'].some((name) => typeof api[name] === 'function')
    };
  }, { request, context, target });
  expect(evidence.result).toMatchObject({ status: 'allowed', reasonCode: 'OK', canResolve: true });
  expect(evidence.candidateUnchanged).toBe(true);
  expect(evidence.contextUnchanged).toBe(true);
  expect(evidence.runtimeUnchanged).toBe(true);
  expect(evidence.materializeCalls).toBe(0);
  expect(evidence.canonicalA).toBe(evidence.canonicalB);
  expect(evidence.frozen).toBe(true);
  expect(evidence.ignoredPresentation).toBe(true);
  expect(evidence.hasMutationApi).toBe(false);
});
