import { test, expect } from '@playwright/test';

async function waitForActionLegality(page) {
  await page.goto('./');
  await page.addScriptTag({ url: './js/action_legality.js' });
  await page.waitForFunction(() => Boolean(
    window.Game?.ActionLegality?.validate &&
    window.Game?.ActionLegality?.normalizeIntent &&
    window.Game?.ActionLegality?.canonicalStringify
  ));
}

function baseContext() {
  return {
    actorId: 'protagonist:1',
    campaignRef: 'campaign:alpha',
    locationRef: 'region:0,0',
    actions: {
      move: { enabled: true },
      rest: { enabled: false },
      talk: { enabled: true, requiresTarget: true, allowedTargetCategories: ['npc'] }
    },
    targets: [
      { ref: 'npc:innkeeper', category: 'npc' },
      { ref: 'creature:wolf', category: 'creature' }
    ]
  };
}

test('action-intent contract derives deterministic allowed/rejected/impossible/not-applicable outcomes', async ({ page }) => {
  await waitForActionLegality(page);

  const evidence = await page.evaluate((context) => {
    const api = window.Game.ActionLegality;
    const makeIntent = (overrides = {}) => ({
      decisionSource: 'character',
      actorId: 'protagonist:1',
      actionType: 'move',
      campaignRef: 'campaign:alpha',
      locationRef: 'region:0,0',
      ...overrides
    });
    return {
      allowed: api.validate(makeIntent({ allowed: false, result: 'rejected' }), context),
      directControl: api.validate(makeIntent({ decisionSource: 'player' }), context),
      impossible: api.validate(makeIntent({ actionType: 'rest' }), context),
      unsupported: api.validate(makeIntent({ actionType: 'dance' }), context),
      missingTarget: api.validate(makeIntent({ actionType: 'talk' }), context),
      wrongTargetCategory: api.validate(makeIntent({ actionType: 'talk', targetRef: 'creature:wolf' }), context),
      validTarget: api.validate(makeIntent({ actionType: 'talk', targetRef: 'npc:innkeeper' }), context)
    };
  }, baseContext());

  expect(evidence.allowed).toMatchObject({ status: 'allowed', reasonCode: 'OK', canResolve: true, authority: 'simulation' });
  expect(evidence.directControl).toMatchObject({ status: 'rejected', reasonCode: 'DIRECT_CONTROL_FORBIDDEN', canResolve: false });
  expect(evidence.impossible).toMatchObject({ status: 'impossible', reasonCode: 'ACTION_CURRENTLY_IMPOSSIBLE', canResolve: false });
  expect(evidence.unsupported).toMatchObject({ status: 'not_applicable', reasonCode: 'ACTION_NOT_SUPPORTED', canResolve: false });
  expect(evidence.missingTarget).toMatchObject({ status: 'rejected', reasonCode: 'TARGET_REQUIRED', canResolve: false });
  expect(evidence.wrongTargetCategory).toMatchObject({ status: 'not_applicable', reasonCode: 'TARGET_CATEGORY_NOT_APPLICABLE', canResolve: false });
  expect(evidence.validTarget).toMatchObject({ status: 'allowed', reasonCode: 'OK', canResolve: true });
});

test('malformed and stale references fail safely without mutating candidate, context, or runtime authority', async ({ page }) => {
  await waitForActionLegality(page);

  const evidence = await page.evaluate((context) => {
    const api = window.Game.ActionLegality;
    const candidate = {
      decisionSource: 'character',
      actorId: 'protagonist:1',
      actionType: 'move',
      campaignRef: 'campaign:alpha',
      locationRef: 'region:0,0',
      presentationAllowed: true,
      result: { status: 'allowed' }
    };
    const candidateBefore = JSON.stringify(candidate);
    const contextBefore = JSON.stringify(context);
    const runtimeBefore = window.Game.AuthoritativeState.canonicalStringify(window.Game.State);
    const staleCampaign = api.validate({ ...candidate, campaignRef: 'campaign:old' }, context);
    const staleLocation = api.validate({ ...candidate, locationRef: 'region:9,9' }, context);
    const actorMismatch = api.validate({ ...candidate, actorId: 'npc:other' }, context);
    const malformed = api.validate({ decisionSource: 'character', actionType: 'move' }, context);
    const allowed = api.validate(candidate, context);
    const runtimeAfter = window.Game.AuthoritativeState.canonicalStringify(window.Game.State);
    return {
      staleCampaign,
      staleLocation,
      actorMismatch,
      malformed,
      allowed,
      candidateUnchanged: JSON.stringify(candidate) === candidateBefore,
      contextUnchanged: JSON.stringify(context) === contextBefore,
      runtimeUnchanged: runtimeBefore === runtimeAfter,
      resultFrozen: Object.isFrozen(allowed) && Object.isFrozen(allowed.intent),
      normalizedKeys: Object.keys(allowed.intent).sort()
    };
  }, baseContext());

  expect(evidence.staleCampaign.reasonCode).toBe('STALE_CAMPAIGN_REFERENCE');
  expect(evidence.staleLocation.reasonCode).toBe('STALE_LOCATION_REFERENCE');
  expect(evidence.actorMismatch.reasonCode).toBe('ACTOR_CONTEXT_MISMATCH');
  expect(evidence.malformed.reasonCode).toBe('MALFORMED_INTENT');
  expect(evidence.candidateUnchanged).toBe(true);
  expect(evidence.contextUnchanged).toBe(true);
  expect(evidence.runtimeUnchanged).toBe(true);
  expect(evidence.resultFrozen).toBe(true);
  expect(evidence.normalizedKeys).toEqual([
    'actionType', 'actorId', 'campaignRef', 'decisionSource', 'locationRef', 'schemaVersion', 'targetRef'
  ]);
  expect(evidence.allowed.intent).not.toHaveProperty('presentationAllowed');
  expect(evidence.allowed.intent).not.toHaveProperty('result');
});

test('equivalent action intents canonicalize identically regardless of property order and whitespace', async ({ page }) => {
  await waitForActionLegality(page);

  const evidence = await page.evaluate(() => {
    const api = window.Game.ActionLegality;
    const a = {
      decisionSource: ' CHARACTER ',
      actorId: ' protagonist:1 ',
      actionType: ' MOVE ',
      campaignRef: ' campaign:alpha ',
      locationRef: ' region:0,0 ',
      targetRef: null,
      uiHint: 'ignored'
    };
    const b = {
      locationRef: 'region:0,0',
      campaignRef: 'campaign:alpha',
      actionType: 'move',
      actorId: 'protagonist:1',
      decisionSource: 'character'
    };
    return {
      canonicalA: api.canonicalStringify(a),
      canonicalB: api.canonicalStringify(b),
      statuses: api.statuses,
      reasonCodes: api.reasonCodes,
      hasMutationApi: ['set', 'apply', 'commit', 'resolve', 'mutate', 'update'].some((name) => typeof api[name] === 'function')
    };
  });

  expect(evidence.canonicalA).toBe(evidence.canonicalB);
  expect(evidence.statuses).toEqual({
    ALLOWED: 'allowed',
    REJECTED: 'rejected',
    IMPOSSIBLE: 'impossible',
    NOT_APPLICABLE: 'not_applicable'
  });
  expect(evidence.reasonCodes.OK).toBe('OK');
  expect(evidence.reasonCodes.DIRECT_CONTROL_FORBIDDEN).toBe('DIRECT_CONTROL_FORBIDDEN');
  expect(evidence.hasMutationApi).toBe(false);
});
