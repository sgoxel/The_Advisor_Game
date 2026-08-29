import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.AdvisorConversationContract), null, { timeout: 20_000 });
}

function context(overrides = {}) {
  return {
    authority: 'simulation',
    actorId: 'protagonist:main',
    campaignRef: 'campaign:r04-chat',
    locationRef: 'location:starter-village',
    worldRef: 'world:r04',
    regionRef: 'region:0:0',
    contextRevision: 12,
    campaignMinute: 345,
    actorStateRef: 'actor-state:12',
    knownFactRefs: ['fact:inn-open', 'fact:smith-known'],
    ...overrides
  };
}

test('contract is production-loaded, immutable and exposes no world mutation authority', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.AdvisorConversationContract;
    return {
      frozen: Object.isFrozen(api),
      authority: api.authority,
      externalLlmRequired: api.normalize('Please consider the inn.', {
        authority: 'simulation', actorId: 'protagonist:main', campaignRef: 'c', locationRef: 'l', worldRef: 'w', regionRef: 'r'
      }).externalLlmRequired,
      forbiddenApis: ['execute', 'resolve', 'validate', 'mutate', 'move', 'commit'].filter((key) => typeof api[key] === 'function')
    };
  });
  expect(evidence).toEqual({ frozen: true, authority: 'character-advice', externalLlmRequired: false, forbiddenApis: [] });
});

test('normalizes one Advisor message into distinct Advisor and protagonist records without command authority', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate((ctx) => window.Game.AdvisorConversationContract.normalize('  I suggest   you consider the tavern.  ', ctx), context({ adviceDispositionBias: 'receptive' }));

  expect(result.status).toBe('ready');
  expect(result.reasonCode).toBe('OK');
  expect(result.advisorMessage).toBe('I suggest you consider the tavern.');
  expect(result.messageKind).toBe('recommendation');
  expect(result.disposition).toBe('accepted');
  expect(result.record.source).toBe('advisor');
  expect(result.record.advisor.message).toBe(result.advisorMessage);
  expect(result.record.character.actorId).toBe('protagonist:main');
  expect(result.record.character.interpretation).not.toBe(result.record.advisor.message);
  expect(result.record.character.response).toContain('decide');
  expect(result.record.influence.type).toBe('non-binding-advisory-context');
  expect(result.record.influence.directActionAuthority).toBe(false);
  expect(result.record.influence.directMovementAuthority).toBe(false);
  expect(result.record.influence.directLegalityAuthority).toBe(false);
  expect(result.record.influence.directResolutionAuthority).toBe(false);
  expect(result.canValidateAction).toBe(false);
  expect(result.canExecuteAction).toBe(false);
  expect(result.canResolveAction).toBe(false);
  expect(result.canMutateWorld).toBe(false);
});

test('supports accepted rejected delayed and reinterpreted deterministic Local BOT dispositions', async ({ page }) => {
  await ready(page);
  const results = await page.evaluate((base) => {
    const api = window.Game.AdvisorConversationContract;
    const run = (message, bias) => api.normalize(message, { ...base, adviceDispositionBias: bias }).disposition;
    return {
      accepted: run('I suggest you consider asking about work.', 'receptive'),
      rejected: run('I suggest you consider asking about work.', 'skeptical'),
      delayed: run('Perhaps consider the market later.', 'neutral'),
      reinterpreted: run('Go to the tavern and ask for work.', 'receptive')
    };
  }, context());

  expect(results).toEqual({
    accepted: 'accepted',
    rejected: 'rejected',
    delayed: 'delayed',
    reinterpreted: 'reinterpreted'
  });
});

test('equivalent canonical inputs are deterministic and direct-control wording is downgraded to advice', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate((ctx) => {
    const api = window.Game.AdvisorConversationContract;
    const a = api.canonicalStringify('Go to the tavern and ask for work.', ctx);
    const b = api.canonicalStringify('  Go   to the tavern and ask for work. ', { ...ctx, knownFactRefs: [...ctx.knownFactRefs].reverse() });
    const parsed = JSON.parse(a);
    return {
      equal: a === b,
      disposition: parsed.disposition,
      directControlReinterpreted: parsed.record.advisor.directControlLanguageReinterpreted,
      canInfluenceDecision: parsed.canInfluenceDecision,
      canMutateWorld: parsed.canMutateWorld
    };
  }, context());

  expect(evidence.equal).toBe(true);
  expect(evidence.disposition).toBe('reinterpreted');
  expect(evidence.directControlReinterpreted).toBe(true);
  expect(evidence.canInfluenceDecision).toBe(true);
  expect(evidence.canMutateWorld).toBe(false);
});

test('invalid authority or empty text is rejected and unknown facts are never manufactured', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate((ctx) => {
    const api = window.Game.AdvisorConversationContract;
    const invalid = api.normalize('Consider the inn.', { ...ctx, authority: 'presentation' });
    const empty = api.normalize('   ', ctx);
    const valid = api.normalize('What do you know about work?', { ...ctx, hiddenSecret: 'invent-me', knownFactRefs: ['fact:z', 'fact:a', 'fact:a'] });
    return { invalid, empty, knownFactRefs: valid.record.knownFactRefs, serialized: JSON.stringify(valid) };
  }, context());

  expect(evidence.invalid.status).toBe('rejected');
  expect(evidence.invalid.reasonCode).toBe('INVALID_SIMULATION_CONTEXT');
  expect(evidence.empty.status).toBe('rejected');
  expect(evidence.empty.reasonCode).toBe('EMPTY_ADVISOR_MESSAGE');
  expect(evidence.knownFactRefs).toEqual(['fact:a', 'fact:z']);
  expect(evidence.serialized).not.toContain('invent-me');
});

test('normalization is pure and does not mutate current authoritative state', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate((ctx) => {
    const snapshot = () => JSON.stringify({
      player: window.Game.State?.player ?? null,
      settings: window.Game.State?.settings ?? null,
      seed: window.Game.State?.seed ?? null
    });
    const before = snapshot();
    const result = window.Game.AdvisorConversationContract.normalize('Beware of danger near the road.', ctx);
    const after = snapshot();
    return { before, after, result };
  }, context({ adviceDispositionBias: 'cautious' }));

  expect(evidence.before).toBe(evidence.after);
  expect(evidence.result.disposition).toBe('accepted');
  expect(evidence.result.canMutateWorld).toBe(false);
  expect(evidence.result.record.character.actorId).toBe('protagonist:main');
});
