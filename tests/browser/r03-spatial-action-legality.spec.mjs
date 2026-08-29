import { test, expect } from '@playwright/test';

async function waitForSpatialLegality(page) {
  await page.goto('./');
  await page.addScriptTag({ url: './js/action_legality.js' });
  await page.addScriptTag({ url: './js/spatial_action_legality.js' });
  await page.waitForFunction(() => Boolean(
    window.Game?.ActionLegality?.validate &&
    window.Game?.SpatialActionLegality?.validate
  ));
}

function baseContext() {
  return {
    authority: 'simulation',
    actorId: 'protagonist:1',
    campaignRef: 'campaign:alpha',
    locationRef: 'tile:0,0',
    worldRef: 'world:seed-42',
    regionRef: 'region:0,0',
    revision: 7,
    actorTags: ['walking', 'village-access'],
    actions: {
      move: { enabled: true, requiresDestination: true },
      wait: { enabled: true, requiresDestination: false },
      sprint: { enabled: false, requiresDestination: true }
    },
    destinations: [
      { ref: 'tile:0,1', worldRef: 'world:seed-42', regionRef: 'region:0,0', available: true, traversable: true },
      { ref: 'tile:0,2', worldRef: 'world:seed-42', regionRef: 'region:0,0', traversable: false, blockedReason: 'river' },
      { ref: 'gate:keep', worldRef: 'world:seed-42', regionRef: 'region:0,0', requiredActorTags: ['noble-access'] }
    ]
  };
}

function baseRequest(overrides = {}) {
  return {
    decisionSource: 'character',
    actorId: 'protagonist:1',
    actionType: 'move',
    campaignRef: 'campaign:alpha',
    locationRef: 'tile:0,0',
    worldRef: 'world:seed-42',
    regionRef: 'region:0,0',
    spatialRevision: 7,
    destinationRef: 'tile:0,1',
    ...overrides
  };
}

test('spatial validator deterministically allows valid movement and rejects direct player control', async ({ page }) => {
  await waitForSpatialLegality(page);
  const evidence = await page.evaluate(({ request, context }) => {
    const api = window.Game.SpatialActionLegality;
    return {
      allowed: api.validate(request, context),
      directControl: api.validate({ ...request, decisionSource: 'player', allowed: true, result: 'allowed' }, context),
      disabled: api.validate({ ...request, actionType: 'sprint' }, context),
      unsupported: api.validate({ ...request, actionType: 'teleport' }, context)
    };
  }, { request: baseRequest(), context: baseContext() });

  expect(evidence.allowed).toMatchObject({ authority: 'simulation', status: 'allowed', reasonCode: 'OK', canResolve: true });
  expect(evidence.allowed.destination.ref).toBe('tile:0,1');
  expect(evidence.directControl).toMatchObject({ status: 'rejected', reasonCode: 'DIRECT_CONTROL_FORBIDDEN', canResolve: false });
  expect(evidence.disabled).toMatchObject({ status: 'impossible', reasonCode: 'ACTION_CURRENTLY_IMPOSSIBLE', canResolve: false });
  expect(evidence.unsupported).toMatchObject({ status: 'not_applicable', reasonCode: 'ACTION_NOT_SUPPORTED', canResolve: false });
});

test('stale and mismatched authoritative spatial references fail safely', async ({ page }) => {
  await waitForSpatialLegality(page);
  const evidence = await page.evaluate(({ request, context }) => {
    const api = window.Game.SpatialActionLegality;
    return {
      stale: api.validate({ ...request, spatialRevision: 6 }, context),
      wrongWorld: api.validate({ ...request, worldRef: 'world:other' }, context),
      wrongRegion: api.validate({ ...request, regionRef: 'region:9,9' }, context),
      missingDestination: api.validate({ ...request, destinationRef: 'tile:missing' }, context),
      noDestination: api.validate({ ...request, destinationRef: null }, context),
      malformed: api.validate({ actionType: 'move' }, context),
      nonSimulation: api.validate(request, { ...context, authority: 'presentation' })
    };
  }, { request: baseRequest(), context: baseContext() });

  expect(evidence.stale.reasonCode).toBe('STALE_SPATIAL_CONTEXT');
  expect(evidence.wrongWorld.reasonCode).toBe('WORLD_CONTEXT_MISMATCH');
  expect(evidence.wrongRegion.reasonCode).toBe('REGION_CONTEXT_MISMATCH');
  expect(evidence.missingDestination.reasonCode).toBe('DESTINATION_NOT_FOUND');
  expect(evidence.noDestination.reasonCode).toBe('DESTINATION_REQUIRED');
  expect(evidence.malformed.reasonCode).toBe('MALFORMED_SPATIAL_REQUEST');
  expect(evidence.nonSimulation.reasonCode).toBe('NON_SIMULATION_CONTEXT');
});

test('destination availability, traversal and actor prerequisites remain Simulation-owned', async ({ page }) => {
  await waitForSpatialLegality(page);
  const evidence = await page.evaluate(({ request, context }) => {
    const api = window.Game.SpatialActionLegality;
    return {
      blocked: api.validate({ ...request, destinationRef: 'tile:0,2', presentationAllowed: true }, context),
      missingPrerequisite: api.validate({ ...request, destinationRef: 'gate:keep', uiOverride: { allowed: true } }, context),
      prerequisiteMet: api.validate(
        { ...request, destinationRef: 'gate:keep' },
        { ...context, actorTags: [...context.actorTags, 'noble-access'] }
      ),
      noDestinationAction: api.validate({ ...request, actionType: 'wait', destinationRef: null }, context)
    };
  }, { request: baseRequest(), context: baseContext() });

  expect(evidence.blocked).toMatchObject({ status: 'impossible', reasonCode: 'DESTINATION_BLOCKED', canResolve: false });
  expect(evidence.missingPrerequisite).toMatchObject({ status: 'impossible', reasonCode: 'PREREQUISITE_NOT_MET', canResolve: false });
  expect(evidence.prerequisiteMet).toMatchObject({ status: 'allowed', reasonCode: 'OK', canResolve: true });
  expect(evidence.noDestinationAction).toMatchObject({ status: 'allowed', reasonCode: 'OK', canResolve: true, destination: null });
});

test('validation is canonical, immutable and does not mutate authoritative runtime state', async ({ page }) => {
  await waitForSpatialLegality(page);
  const evidence = await page.evaluate(({ request, context }) => {
    const api = window.Game.SpatialActionLegality;
    const candidate = { ...request, presentationAllowed: true, result: { status: 'allowed' } };
    const candidateBefore = JSON.stringify(candidate);
    const contextBefore = JSON.stringify(context);
    const runtimeBefore = window.Game.AuthoritativeState?.canonicalStringify
      ? window.Game.AuthoritativeState.canonicalStringify(window.Game.State)
      : JSON.stringify(window.Game.State);
    const result = api.validate(candidate, context);
    const runtimeAfter = window.Game.AuthoritativeState?.canonicalStringify
      ? window.Game.AuthoritativeState.canonicalStringify(window.Game.State)
      : JSON.stringify(window.Game.State);
    const reordered = {
      destinationRef: 'tile:0,1', spatialRevision: 7, regionRef: ' region:0,0 ', worldRef: ' world:seed-42 ',
      locationRef: ' tile:0,0 ', campaignRef: ' campaign:alpha ', actionType: ' MOVE ', actorId: ' protagonist:1 ', decisionSource: ' CHARACTER '
    };
    return {
      result,
      candidateUnchanged: JSON.stringify(candidate) === candidateBefore,
      contextUnchanged: JSON.stringify(context) === contextBefore,
      runtimeUnchanged: runtimeBefore === runtimeAfter,
      frozen: Object.isFrozen(result) && Object.isFrozen(result.request) && Object.isFrozen(result.destination),
      canonicalA: api.canonicalStringify(request),
      canonicalB: api.canonicalStringify(reordered),
      ignoredPresentation: !Object.prototype.hasOwnProperty.call(result.request, 'presentationAllowed') && !Object.prototype.hasOwnProperty.call(result.request, 'result'),
      hasMutationApi: ['set', 'apply', 'commit', 'resolve', 'mutate', 'update'].some((name) => typeof api[name] === 'function')
    };
  }, { request: baseRequest(), context: baseContext() });

  expect(evidence.candidateUnchanged).toBe(true);
  expect(evidence.contextUnchanged).toBe(true);
  expect(evidence.runtimeUnchanged).toBe(true);
  expect(evidence.frozen).toBe(true);
  expect(evidence.canonicalA).toBe(evidence.canonicalB);
  expect(evidence.ignoredPresentation).toBe(true);
  expect(evidence.hasMutationApi).toBe(false);
  expect(evidence.result.authority).toBe('simulation');
});
