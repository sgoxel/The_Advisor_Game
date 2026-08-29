import { test, expect } from '@playwright/test';

async function waitForDriverIntent(page) {
  await page.goto('./');
  await page.addScriptTag({ url: './js/action_legality.js' });
  await page.addScriptTag({ url: './js/protagonist_driver_intent.js' });
  await page.waitForFunction(() => Boolean(
    window.Game?.ActionLegality?.validate &&
    window.Game?.ProtagonistDriverIntent?.build &&
    window.Game?.ProtagonistDriverIntent?.canonicalStringify
  ));
}

function context(overrides = {}) {
  return {
    authority: 'simulation',
    actorId: 'protagonist:1',
    campaignRef: 'campaign:alpha',
    locationRef: 'region:0,0',
    worldRef: 'world:seed-alpha',
    regionRef: 'region:0,0',
    contextRevision: 7,
    campaignMinute: 8123,
    actorStateRef: 'actor-state:41',
    hierarchy: {
      realmRef: 'realm:north',
      regionRef: 'region:0,0',
      settlementRef: 'settlement:origin'
    },
    relevantTargetRefs: ['npc:innkeeper', 'site:well', 'npc:innkeeper'],
    ...overrides
  };
}

function candidate(overrides = {}) {
  return {
    actorId: 'protagonist:1',
    goalType: 'travel',
    actionType: 'move',
    targetRef: 'site:well',
    expectedContextRevision: 7,
    ...overrides
  };
}

test('driver contract creates a canonical character-owned candidate for R03 legality validation', async ({ page }) => {
  await waitForDriverIntent(page);

  const evidence = await page.evaluate(({ candidate, context }) => {
    const driver = window.Game.ProtagonistDriverIntent;
    const legality = window.Game.ActionLegality;
    const built = driver.build(candidate, context);
    const validation = legality.validate(built.actionIntent, {
      actorId: context.actorId,
      campaignRef: context.campaignRef,
      locationRef: context.locationRef,
      actions: { move: { enabled: true, requiresTarget: true, allowedTargetCategories: ['site'] } },
      targets: [{ ref: 'site:well', category: 'site' }]
    });
    return { built, validation };
  }, { candidate: candidate(), context: context() });

  expect(evidence.built).toMatchObject({
    authority: 'character-driver',
    status: 'ready',
    reasonCode: 'OK',
    canValidate: true
  });
  expect(evidence.built.actionIntent).toEqual({
    schemaVersion: 1,
    decisionSource: 'character',
    actorId: 'protagonist:1',
    actionType: 'move',
    campaignRef: 'campaign:alpha',
    locationRef: 'region:0,0',
    targetRef: 'site:well'
  });
  expect(evidence.validation).toMatchObject({ status: 'allowed', reasonCode: 'OK', authority: 'simulation' });
});

test('non-simulation, malformed, mismatched and stale contexts fail before legality validation', async ({ page }) => {
  await waitForDriverIntent(page);

  const evidence = await page.evaluate(({ baseCandidate, baseContext }) => {
    const api = window.Game.ProtagonistDriverIntent;
    return {
      nonSimulation: api.build(baseCandidate, { ...baseContext, authority: 'ui' }),
      malformedContext: api.build(baseCandidate, { ...baseContext, worldRef: '' }),
      malformedCandidate: api.build({ ...baseCandidate, goalType: '' }, baseContext),
      actorMismatch: api.build({ ...baseCandidate, actorId: 'npc:other' }, baseContext),
      stale: api.build({ ...baseCandidate, expectedContextRevision: 6 }, baseContext)
    };
  }, { baseCandidate: candidate(), baseContext: context() });

  expect(evidence.nonSimulation).toMatchObject({ status: 'rejected', reasonCode: 'NON_SIMULATION_CONTEXT', canValidate: false, actionIntent: null });
  expect(evidence.malformedContext.reasonCode).toBe('MALFORMED_CONTEXT');
  expect(evidence.malformedCandidate.reasonCode).toBe('MALFORMED_CANDIDATE');
  expect(evidence.actorMismatch.reasonCode).toBe('ACTOR_CONTEXT_MISMATCH');
  expect(evidence.stale.reasonCode).toBe('STALE_CONTEXT_REVISION');
});

test('contract is immutable, ignores presentation/direct-control injection, and canonicalizes equivalent inputs', async ({ page }) => {
  await waitForDriverIntent(page);

  const evidence = await page.evaluate(({ aCandidate, bCandidate, aContext, bContext }) => {
    const api = window.Game.ProtagonistDriverIntent;
    const runtimeBefore = window.Game.AuthoritativeState.canonicalStringify(window.Game.State);
    const built = api.build(aCandidate, aContext);
    const runtimeAfter = window.Game.AuthoritativeState.canonicalStringify(window.Game.State);
    return {
      canonicalA: api.canonicalStringify(aCandidate, aContext),
      canonicalB: api.canonicalStringify(bCandidate, bContext),
      built,
      frozen: Object.isFrozen(built) && Object.isFrozen(built.candidate) && Object.isFrozen(built.context) && Object.isFrozen(built.actionIntent),
      runtimeUnchanged: runtimeBefore === runtimeAfter,
      hasMutationApi: ['set', 'apply', 'commit', 'resolve', 'mutate', 'update', 'select', 'execute'].some((name) => typeof api[name] === 'function')
    };
  }, {
    aCandidate: candidate({ decisionSource: 'player', forceExecute: true, presentationResult: 'allowed' }),
    bCandidate: {
      expectedContextRevision: 7,
      targetRef: 'site:well',
      actionType: ' MOVE ',
      goalType: ' TRAVEL ',
      actorId: ' protagonist:1 '
    },
    aContext: context({ presentationAuthority: true }),
    bContext: {
      relevantTargetRefs: ['site:well', 'npc:innkeeper'],
      hierarchy: { settlementRef: 'settlement:origin', regionRef: 'region:0,0', realmRef: 'realm:north' },
      actorStateRef: 'actor-state:41',
      campaignMinute: 8123,
      contextRevision: 7,
      regionRef: 'region:0,0',
      worldRef: 'world:seed-alpha',
      locationRef: 'region:0,0',
      campaignRef: 'campaign:alpha',
      actorId: 'protagonist:1',
      authority: ' SIMULATION '
    }
  });

  expect(evidence.canonicalA).toBe(evidence.canonicalB);
  expect(evidence.built.actionIntent.decisionSource).toBe('character');
  expect(evidence.built.candidate).not.toHaveProperty('decisionSource');
  expect(evidence.built.candidate).not.toHaveProperty('forceExecute');
  expect(evidence.built.context).not.toHaveProperty('presentationAuthority');
  expect(evidence.frozen).toBe(true);
  expect(evidence.runtimeUnchanged).toBe(true);
  expect(evidence.hasMutationApi).toBe(false);
});
