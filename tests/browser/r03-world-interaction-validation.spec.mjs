import { test, expect } from '@playwright/test';

async function waitForValidation(page) {
  await page.goto('./');
  await page.addScriptTag({ url: './js/interaction_target.js' });
  await page.addScriptTag({ url: './js/world_interaction_validation.js' });
  await page.waitForFunction(() => Boolean(window.Game?.WorldInteractionValidation?.validate));
}

function worldContext(overrides = {}) {
  return {
    authority: 'simulation',
    actorId: 'character:main',
    actorLocationRef: 'site:village-square',
    worldRef: 'world:seed-1',
    regionRef: 'region:0,0',
    revision: 9,
    actorTags: ['resident', 'advisor-influenced'],
    targets: [
      { id: 'npc:innkeeper', category: 'npc', stateRef: 'npc:innkeeper@4', available: true, relevance: 'active', location: { worldRef: 'world:seed-1', regionRef: 'region:0,0', siteRef: 'site:tavern' } },
      { id: 'location:tavern', category: 'location', stateRef: 'location:tavern@2', available: true, relevance: 'active', location: { worldRef: 'world:seed-1', regionRef: 'region:0,0', siteRef: 'site:tavern' } },
      { id: 'animal:horse-1', category: 'animal', stateRef: 'animal:horse-1@3', available: true, relevance: 'nearby', location: { worldRef: 'world:seed-1', regionRef: 'region:0,0', siteRef: 'site:stable' } },
      { id: 'creature:wolf-1', category: 'creature', stateRef: 'creature:wolf-1@8', available: false, relevance: 'nearby', location: { worldRef: 'world:seed-1', regionRef: 'region:0,0' } },
      { id: 'npc:distant', category: 'npc', stateRef: 'npc:distant@1', available: true, relevance: 'inactive', location: { worldRef: 'world:seed-1', regionRef: 'region:0,0' } }
    ],
    interactionRules: [
      { targetRef: 'npc:innkeeper', interactionType: 'talk', requiredLocationRef: 'site:village-square', startHour: 8, endHour: 22 },
      { targetRef: 'location:tavern', interactionType: 'enter', startHour: 6, endHour: 24 },
      { targetRef: 'animal:horse-1', interactionType: 'ride', requiredActorTags: ['rider'] },
      { targetRef: 'creature:wolf-1', interactionType: 'observe' }
    ],
    unrelatedDistantRegions: Array.from({ length: 1000 }, (_, index) => ({ regionRef: `region:${index + 10},${index + 10}`, decorative: true })),
    ...overrides
  };
}

function request(targetRef, targetCategory, interactionType, overrides = {}) {
  return {
    actorId: 'character:main',
    actorLocationRef: 'site:village-square',
    interactionType,
    targetRef,
    targetCategory,
    worldRef: 'world:seed-1',
    regionRef: 'region:0,0',
    contextRevision: 9,
    gameHour: 12,
    presentation: { selected: true, forcedAllowed: true },
    ...overrides
  };
}

test('validates representative NPC, location, animal and creature interactions without mutation', async ({ page }) => {
  await waitForValidation(page);
  const evidence = await page.evaluate(({ ctx, requests }) => {
    const api = window.Game.WorldInteractionValidation;
    const before = JSON.stringify(ctx);
    const results = requests.map((item) => api.validate(item, ctx));
    return {
      results,
      contextUnchanged: JSON.stringify(ctx) === before,
      mutationApi: ['set','apply','commit','update','mutate','resolve'].some((name) => typeof api[name] === 'function')
    };
  }, {
    ctx: worldContext(),
    requests: [
      request('npc:innkeeper', 'npc', 'talk'),
      request('location:tavern', 'location', 'enter'),
      request('animal:horse-1', 'animal', 'pet'),
      request('creature:wolf-1', 'creature', 'observe')
    ]
  });

  expect(evidence.results[0]).toMatchObject({ status: 'allowed', reasonCode: 'OK', authority: 'simulation', canResolve: true });
  expect(evidence.results[1]).toMatchObject({ status: 'allowed', reasonCode: 'OK' });
  expect(evidence.results[2]).toMatchObject({ status: 'allowed', reasonCode: 'OK' });
  expect(evidence.results[3]).toMatchObject({ status: 'impossible', reasonCode: 'TARGET_UNAVAILABLE', canResolve: false });
  expect(evidence.contextUnchanged).toBe(true);
  expect(evidence.mutationApi).toBe(false);
});

test('time, location, availability, target state and prerequisites reject deterministically', async ({ page }) => {
  await waitForValidation(page);
  const evidence = await page.evaluate(({ ctx, samples }) => {
    const api = window.Game.WorldInteractionValidation;
    return Object.fromEntries(Object.entries(samples).map(([key, value]) => [key, api.validate(value, ctx)]));
  }, {
    ctx: worldContext(),
    samples: {
      closed: request('npc:innkeeper', 'npc', 'talk', { gameHour: 2 }),
      wrongLocation: request('npc:innkeeper', 'npc', 'talk', { actorLocationRef: 'site:field' }),
      missingTag: request('animal:horse-1', 'animal', 'ride'),
      inactive: request('npc:distant', 'npc', 'talk'),
      wrongCategory: request('npc:innkeeper', 'creature', 'talk')
    }
  });

  expect(evidence.closed.reasonCode).toBe('TIME_WINDOW_CLOSED');
  expect(evidence.wrongLocation.reasonCode).toBe('ACTOR_LOCATION_MISMATCH');
  expect(evidence.missingTag.reasonCode).toBe('PREREQUISITE_NOT_MET');
  expect(evidence.inactive.reasonCode).toBe('TARGET_INACTIVE');
  expect(evidence.wrongCategory.reasonCode).toBe('TARGET_CATEGORY_MISMATCH');
  for (const value of Object.values(evidence)) expect(value.canResolve).toBe(false);
});

test('stale/non-Simulation contexts fail safely and unrelated distant data is not materialized into results', async ({ page }) => {
  await waitForValidation(page);
  const evidence = await page.evaluate(({ ctx, baseRequest }) => {
    const api = window.Game.WorldInteractionValidation;
    const allowed = api.validate(baseRequest, ctx);
    return {
      allowed,
      stale: api.validate({ ...baseRequest, contextRevision: 8 }, ctx),
      nonSimulation: api.validate(baseRequest, { ...ctx, authority: 'presentation' }),
      wrongWorld: api.validate({ ...baseRequest, worldRef: 'world:other' }, ctx),
      missing: api.validate({ ...baseRequest, targetRef: 'npc:missing' }, ctx),
      serializedResult: JSON.stringify(allowed)
    };
  }, { ctx: worldContext(), baseRequest: request('npc:innkeeper', 'npc', 'talk') });

  expect(evidence.allowed.status).toBe('allowed');
  expect(evidence.stale.reasonCode).toBe('STALE_INTERACTION_CONTEXT');
  expect(evidence.nonSimulation.reasonCode).toBe('NON_SIMULATION_CONTEXT');
  expect(evidence.wrongWorld.reasonCode).toBe('WORLD_CONTEXT_MISMATCH');
  expect(evidence.missing.reasonCode).toBe('TARGET_NOT_FOUND');
  expect(evidence.serializedResult).not.toContain('unrelatedDistantRegions');
});
