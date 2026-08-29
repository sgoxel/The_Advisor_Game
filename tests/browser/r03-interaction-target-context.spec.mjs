import { test, expect } from '@playwright/test';

async function waitForContract(page) {
  await page.goto('./');
  await page.addScriptTag({ url: './js/interaction_target.js' });
  await page.waitForFunction(() => Boolean(window.Game?.InteractionTarget?.resolve));
}

function context(overrides = {}) {
  return {
    authority: 'simulation',
    worldRef: 'world:seed-1',
    regionRef: 'region:0,0',
    revision: 7,
    targets: [
      {
        id: 'npc:innkeeper',
        category: 'npc',
        stateRef: 'npc:innkeeper@12',
        available: true,
        relevance: 'active',
        location: {
          worldRef: 'world:seed-1', regionRef: 'region:0,0', settlementRef: 'settlement:origin', row: 11, col: 13
        },
        presentation: { screenX: 999, selected: true }
      },
      {
        id: 'creature:wolf-1',
        category: 'creature',
        stateRef: 'creature:wolf-1@4',
        available: false,
        relevance: 'nearby',
        location: { worldRef: 'world:seed-1', regionRef: 'region:0,0', row: 22, col: 19 }
      }
    ],
    ...overrides
  };
}

test('stable target reference resolves compact Simulation-owned context without presentation authority', async ({ page }) => {
  await waitForContract(page);
  const evidence = await page.evaluate((ctx) => {
    const api = window.Game.InteractionTarget;
    const reference = api.makeReference(ctx.targets[0], ctx);
    const resolved = api.resolve(reference, ctx);
    return {
      reference,
      resolved,
      frozen: Object.isFrozen(reference) && Object.isFrozen(resolved) && Object.isFrozen(resolved.target) && Object.isFrozen(resolved.target.location),
      targetKeys: Object.keys(resolved.target).sort(),
      locationKeys: Object.keys(resolved.target.location).sort(),
      mutationApi: ['set','apply','commit','update','mutate'].some((name) => typeof api[name] === 'function')
    };
  }, context());

  expect(evidence.reference).toEqual({
    schemaVersion: 1,
    ref: 'npc:innkeeper',
    category: 'npc',
    worldRef: 'world:seed-1',
    regionRef: 'region:0,0',
    contextRevision: 7
  });
  expect(evidence.resolved).toMatchObject({ status: 'resolved', reasonCode: 'OK', authority: 'simulation' });
  expect(evidence.resolved.target).toMatchObject({
    ref: 'npc:innkeeper', category: 'npc', stateRef: 'npc:innkeeper@12', available: true, relevance: 'active'
  });
  expect(evidence.targetKeys).toEqual(['available','category','location','ref','relevance','stateRef']);
  expect(evidence.locationKeys).toEqual(['col','regionRef','row','settlementRef','siteRef','worldRef']);
  expect(evidence.resolved.target).not.toHaveProperty('presentation');
  expect(evidence.frozen).toBe(true);
  expect(evidence.mutationApi).toBe(false);
});

test('stale, mismatched, missing, and non-Simulation references fail safely and deterministically', async ({ page }) => {
  await waitForContract(page);
  const evidence = await page.evaluate((ctx) => {
    const api = window.Game.InteractionTarget;
    const base = api.makeReference(ctx.targets[0], ctx);
    return {
      stale: api.resolve({ ...base, contextRevision: 6 }, ctx),
      wrongWorld: api.resolve({ ...base, worldRef: 'world:other' }, ctx),
      wrongRegion: api.resolve({ ...base, regionRef: 'region:9,9' }, ctx),
      missing: api.resolve({ ...base, ref: 'npc:missing' }, ctx),
      wrongCategory: api.resolve({ ...base, category: 'creature' }, ctx),
      nonSimulation: api.resolve(base, { ...ctx, authority: 'presentation' }),
      malformed: api.resolve({ ref: 'npc:innkeeper' }, ctx)
    };
  }, context());

  expect(evidence.stale.reasonCode).toBe('STALE_CONTEXT_REFERENCE');
  expect(evidence.wrongWorld.reasonCode).toBe('WORLD_CONTEXT_MISMATCH');
  expect(evidence.wrongRegion.reasonCode).toBe('REGION_CONTEXT_MISMATCH');
  expect(evidence.missing.reasonCode).toBe('TARGET_NOT_FOUND');
  expect(evidence.wrongCategory.reasonCode).toBe('TARGET_CATEGORY_MISMATCH');
  expect(evidence.nonSimulation.reasonCode).toBe('NON_SIMULATION_CONTEXT');
  expect(evidence.malformed.reasonCode).toBe('MALFORMED_REFERENCE');
  for (const result of Object.values(evidence)) expect(result.status).toBe('rejected');
});

test('target context remains deterministic, compact, and relevance-bounded', async ({ page }) => {
  await waitForContract(page);
  const evidence = await page.evaluate((ctx) => {
    const api = window.Game.InteractionTarget;
    const a = api.makeReference(ctx.targets[1], ctx);
    const b = api.normalizeReference({
      contextRevision: '7',
      regionRef: ' region:0,0 ',
      worldRef: ' world:seed-1 ',
      category: ' CREATURE ',
      ref: ' creature:wolf-1 ',
      ignoredPresentationObject: { massive: true }
    });
    const resolved = api.resolve(a, ctx);
    const before = JSON.stringify(ctx);
    api.resolve(a, ctx);
    return {
      canonicalEqual: api.canonicalStringify(a) === api.canonicalStringify(b),
      resolved,
      contextUnchanged: JSON.stringify(ctx) === before,
      categories: api.categories,
      relevanceLevels: api.relevanceLevels
    };
  }, context());

  expect(evidence.canonicalEqual).toBe(true);
  expect(evidence.resolved.target).toMatchObject({ ref: 'creature:wolf-1', available: false, relevance: 'nearby' });
  expect(evidence.contextUnchanged).toBe(true);
  expect(evidence.categories).toEqual(['npc','location','animal','creature']);
  expect(evidence.relevanceLevels).toEqual(['active','nearby','inactive']);
});
