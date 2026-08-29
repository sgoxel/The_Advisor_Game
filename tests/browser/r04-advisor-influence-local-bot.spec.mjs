import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.AdvisorConversationContract?.normalize &&
    window.Game?.LocalBotDriver?.select &&
    window.Game?.AutonomousActionExecution?.execute &&
    window.Game?.ProtagonistDriverIntent?.build &&
    window.Game?.AuthoritativeState?.canonicalStringify
  ), null, { timeout: 20_000 });
}

function context(overrides = {}) {
  return {
    authority: 'simulation',
    actorId: 'protagonist:main',
    campaignRef: 'campaign:r04-advisor',
    locationRef: 'location:starter-village',
    worldRef: 'world:r04',
    regionRef: 'region:0:0',
    contextRevision: 12,
    campaignMinute: 500,
    actorStateRef: 'actor-state:12',
    needs: {},
    ...overrides
  };
}

const opportunities = [
  {
    id: 'bakery', goalType: 'errand', actionType: 'interact', targetRef: 'site:bakery',
    locationRef: 'location:starter-village', priority: 2, urgency: 10, distance: 4
  },
  {
    id: 'market', goalType: 'errand', actionType: 'interact', targetRef: 'site:market',
    locationRef: 'location:starter-village', priority: 2, urgency: 10, distance: 4
  }
];

async function advisor(page, message, bias = 'neutral', overrides = {}) {
  return page.evaluate(({ message, bias, ctx }) => window.Game.AdvisorConversationContract.normalize(message, {
    ...ctx,
    adviceDispositionBias: bias,
    knownFactRefs: ['fact:market-known']
  }), { message, bias, ctx: context(overrides) });
}

test.beforeEach(async ({ page }) => ready(page));

test('accepted advice can deterministically influence candidate evaluation without direct selection authority', async ({ page }) => {
  const accepted = await advisor(page, 'I suggest you consider the market.', 'receptive');
  const out = await page.evaluate(({ ctx, ops, advice }) => {
    const api = window.Game.LocalBotDriver;
    return {
      baseline: api.select(ctx, ops),
      advised: api.select(ctx, ops, advice),
      advisedReversed: api.canonicalStringify(ctx, [...ops].reverse(), advice),
      advisedOriginal: api.canonicalStringify(ctx, ops, advice)
    };
  }, { ctx: context(), ops: opportunities, advice: accepted });

  expect(out.baseline.selected.id).toBe('bakery');
  expect(out.advised.selected.id).toBe('market');
  expect(out.advised.advisory).toMatchObject({
    status: 'ready',
    reasonCode: 'OK',
    disposition: 'accepted',
    applied: true,
    matchedOpportunityIds: ['market'],
    directActionAuthority: false,
    directMovementAuthority: false,
    directLegalityAuthority: false,
    directResolutionAuthority: false
  });
  expect(out.advisedOriginal).toBe(out.advisedReversed);
});

test('rejected and pending delayed advice leave the baseline choice unchanged', async ({ page }) => {
  const rejected = await advisor(page, 'I suggest you consider the market.', 'skeptical');
  const delayed = await advisor(page, 'Consider the market later.', 'neutral');
  const out = await page.evaluate(({ ctx, ops, rejectedAdvice, delayedAdvice }) => {
    const api = window.Game.LocalBotDriver;
    return {
      baseline: api.select(ctx, ops),
      rejected: api.select(ctx, ops, rejectedAdvice),
      delayedNow: api.select(ctx, ops, delayedAdvice),
      delayedLater: api.select({ ...ctx, campaignMinute: ctx.campaignMinute + 1 }, ops, delayedAdvice)
    };
  }, { ctx: context(), ops: opportunities, rejectedAdvice: rejected, delayedAdvice: delayed });

  expect(out.baseline.selected.id).toBe('bakery');
  expect(out.rejected.selected.id).toBe('bakery');
  expect(out.rejected.advisory).toMatchObject({
    status: 'ignored', reasonCode: 'REJECTED_BY_CHARACTER', disposition: 'rejected', applied: false
  });
  expect(out.delayedNow.selected.id).toBe('bakery');
  expect(out.delayedNow.advisory).toMatchObject({
    status: 'ignored', reasonCode: 'DELAY_PENDING', disposition: 'delayed', applied: false
  });
  expect(out.delayedLater.selected.id).toBe('market');
  expect(out.delayedLater.advisory).toMatchObject({
    status: 'ready', reasonCode: 'OK', disposition: 'delayed', applied: true
  });
});

test('direct-control wording is reinterpreted as bounded advice rather than execution authority', async ({ page }) => {
  const reinterpreted = await advisor(page, 'Go to the market.', 'receptive');
  const out = await page.evaluate(({ ctx, ops, advice }) => {
    const api = window.Game.LocalBotDriver;
    return api.select(ctx, ops, advice);
  }, { ctx: context(), ops: opportunities, advice: reinterpreted });

  expect(reinterpreted.disposition).toBe('reinterpreted');
  expect(reinterpreted.record.advisor.directControlLanguageReinterpreted).toBe(true);
  expect(out.selected.id).toBe('market');
  expect(out.advisory).toMatchObject({
    status: 'ready',
    disposition: 'reinterpreted',
    applied: true,
    directActionAuthority: false,
    directMovementAuthority: false,
    directLegalityAuthority: false,
    directResolutionAuthority: false
  });
});

test('stale, mismatched or authority-tampered Advisor records are ignored without synthetic success', async ({ page }) => {
  const stale = await advisor(page, 'I suggest you consider the market.', 'receptive', { contextRevision: 11 });
  const mismatch = await advisor(page, 'I suggest you consider the market.', 'receptive', { actorId: 'protagonist:other' });
  const accepted = await advisor(page, 'I suggest you consider the market.', 'receptive');
  const tampered = JSON.parse(JSON.stringify(accepted));
  tampered.canExecuteAction = true;

  const out = await page.evaluate(({ ctx, ops, staleAdvice, mismatchAdvice, tamperedAdvice }) => {
    const api = window.Game.LocalBotDriver;
    return {
      stale: api.select(ctx, ops, staleAdvice),
      mismatch: api.select(ctx, ops, mismatchAdvice),
      tampered: api.select(ctx, ops, tamperedAdvice)
    };
  }, {
    ctx: context(), ops: opportunities, staleAdvice: stale, mismatchAdvice: mismatch, tamperedAdvice: tampered
  });

  expect(out.stale.selected.id).toBe('bakery');
  expect(out.stale.advisory).toMatchObject({ status: 'ignored', reasonCode: 'STALE_ADVISOR_RECORD', applied: false });
  expect(out.mismatch.selected.id).toBe('bakery');
  expect(out.mismatch.advisory).toMatchObject({ status: 'ignored', reasonCode: 'CONTEXT_MISMATCH', applied: false });
  expect(out.tampered.selected.id).toBe('bakery');
  expect(out.tampered.advisory).toMatchObject({ status: 'ignored', reasonCode: 'INVALID_ADVISOR_RECORD', applied: false });
});

test('an advised candidate still cannot bypass character intent and Simulation execution gates', async ({ page }) => {
  const accepted = await advisor(page, 'I suggest you consider the market.', 'receptive');
  const out = await page.evaluate(({ ctx, ops, advice }) => {
    const game = window.Game;
    const before = game.AuthoritativeState.canonicalStringify(game.State);
    const result = game.AutonomousActionExecution.execute(
      ctx,
      ops,
      { authority: 'ui', revision: ctx.contextRevision, routes: [] },
      advice
    );
    return { result, before, after: game.AuthoritativeState.canonicalStringify(game.State) };
  }, { ctx: context(), ops: opportunities, advice: accepted });

  expect(out.result).toMatchObject({
    status: 'rejected',
    reasonCode: 'NON_SIMULATION_EXECUTION_CONTEXT',
    selectedOpportunityId: 'market',
    selectionStatus: 'selected',
    intentStatus: 'ready'
  });
  expect(out.after).toBe(out.before);
});

test('Local BOT remains fully deterministic and unchanged when no Advisor record is supplied', async ({ page }) => {
  const out = await page.evaluate(({ ctx, ops }) => {
    const api = window.Game.LocalBotDriver;
    const result = api.select(ctx, ops);
    return {
      result,
      first: api.canonicalStringify(ctx, ops),
      second: api.canonicalStringify(ctx, [...ops].reverse()),
      hasAdvisoryField: Object.prototype.hasOwnProperty.call(result, 'advisory')
    };
  }, { ctx: context(), ops: opportunities });

  expect(out.result.selected.id).toBe('bakery');
  expect(out.first).toBe(out.second);
  expect(out.hasAdvisoryField).toBe(false);
});
