import { test, expect } from '@playwright/test';

async function load(page) {
  await page.goto('./');
  await page.addScriptTag({ url: './js/action_legality.js' });
  await page.addScriptTag({ url: './js/protagonist_driver_intent.js' });
  await page.addScriptTag({ url: './js/local_bot_driver.js' });
  await page.waitForFunction(() => Boolean(window.Game?.LocalBotDriver?.select));
}

function context(overrides = {}) {
  return {
    authority: 'simulation',
    actorId: 'protagonist:1',
    campaignRef: 'campaign:alpha',
    locationRef: 'settlement:origin',
    worldRef: 'world:seed-alpha',
    regionRef: 'region:0,0',
    contextRevision: 9,
    campaignMinute: 480,
    actorStateRef: 'actor-state:50',
    needs: { hunger: 80, rest: 20 },
    ...overrides
  };
}

const opportunities = [
  { id: 'job', goalType: 'work', actionType: 'interact', targetRef: 'npc:blacksmith', locationRef: 'settlement:origin', priority: 2, urgency: 10, distance: 4, availableFromMinute: 400, availableUntilMinute: 900 },
  { id: 'meal', goalType: 'eat', actionType: 'interact', targetRef: 'site:tavern', locationRef: 'settlement:origin', priority: 2, urgency: 10, needKey: 'hunger', distance: 8, availableFromMinute: 300, availableUntilMinute: 1200 },
  { id: 'future', goalType: 'sleep', actionType: 'move', targetRef: 'home:1', locationRef: 'settlement:origin', priority: 99, urgency: 99, distance: 1, availableFromMinute: 1000 }
];

test('same authoritative inputs deterministically select the same Local BOT candidate', async ({ page }) => {
  await load(page);
  const result = await page.evaluate(({ ctx, a, b }) => {
    const api = window.Game.LocalBotDriver;
    return {
      first: api.canonicalStringify(ctx, a),
      second: api.canonicalStringify({ ...ctx, needs: { rest: 20, hunger: 80 } }, b),
      selected: api.select(ctx, a)
    };
  }, { ctx: context(), a: opportunities, b: [...opportunities].reverse() });

  expect(result.first).toBe(result.second);
  expect(result.selected).toMatchObject({ status: 'selected', authority: 'local-bot' });
  expect(result.selected.selected.id).toBe('meal');
  expect(result.selected.candidate).toEqual({
    actorId: 'protagonist:1',
    goalType: 'eat',
    actionType: 'interact',
    targetRef: 'site:tavern',
    expectedContextRevision: 9
  });
});

test('selection uses current time/location/needs but only proposes into the driver contract', async ({ page }) => {
  await load(page);
  const evidence = await page.evaluate(({ ctx, ops }) => {
    const api = window.Game.LocalBotDriver;
    const before = window.Game.AuthoritativeState.canonicalStringify(window.Game.State);
    const built = api.buildIntent(ctx, ops);
    const after = window.Game.AuthoritativeState.canonicalStringify(window.Game.State);
    return { built, unchanged: before === after, hasExecute: typeof api.execute === 'function', hasResolve: typeof api.resolve === 'function' };
  }, { ctx: context(), ops: opportunities });

  expect(evidence.built.selection.status).toBe('selected');
  expect(evidence.built.intent).toMatchObject({ status: 'ready', authority: 'character-driver', canValidate: true });
  expect(evidence.built.intent.actionIntent.decisionSource).toBe('character');
  expect(evidence.unchanged).toBe(true);
  expect(evidence.hasExecute).toBe(false);
  expect(evidence.hasResolve).toBe(false);
});

test('invalid/stale availability can be discarded without authoritative mutation', async ({ page }) => {
  await load(page);
  const evidence = await page.evaluate(({ invalidContext, validContext }) => {
    const api = window.Game.LocalBotDriver;
    return {
      invalid: api.select(invalidContext, []),
      idle: api.select(validContext, [
        { id: 'closed', goalType: 'work', actionType: 'interact', targetRef: 'npc:smith', availableUntilMinute: 100 }
      ])
    };
  }, { invalidContext: context({ authority: 'ui' }), validContext: context({ campaignMinute: 500 }) });

  expect(evidence.invalid).toMatchObject({ status: 'rejected', reasonCode: 'INVALID_SIMULATION_CONTEXT', candidate: null });
  expect(evidence.idle).toMatchObject({ status: 'idle', reasonCode: 'NO_ELIGIBLE_OPPORTUNITY', candidate: null });
});
