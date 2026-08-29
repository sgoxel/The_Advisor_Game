import { test, expect } from '@playwright/test';

async function waitForExecution(page) {
  await page.goto('./');
  await page.addScriptTag({ url: './js/action_legality.js' });
  await page.addScriptTag({ url: './js/spatial_action_legality.js' });
  await page.addScriptTag({ url: './js/interaction_target.js' });
  await page.addScriptTag({ url: './js/interaction_validation.js' });
  await page.addScriptTag({ url: './js/world_action_resolution.js' });
  await page.addScriptTag({ url: './js/protagonist_driver_intent.js' });
  await page.addScriptTag({ url: './js/local_bot_driver.js' });
  await page.addScriptTag({ url: './js/autonomous_action_execution.js' });
  await page.waitForFunction(() => Boolean(
    window.Game?.AutonomousActionExecution?.execute &&
    window.Game?.LocalBotDriver?.buildIntent &&
    window.Game?.WorldActionResolution?.resolveSpatial &&
    window.Game?.WorldActionResolution?.resolveInteraction &&
    window.Game?.AuthoritativeState?.capture
  ));
}

function driverContext(overrides = {}) {
  return {
    authority: 'simulation',
    actorId: 'protagonist:1',
    campaignRef: 'campaign:alpha',
    locationRef: 'site:village-square',
    worldRef: 'world:seed-42',
    regionRef: 'region:0,0',
    contextRevision: 31,
    campaignMinute: 600,
    actorStateRef: 'state:ready',
    needs: { safety: 20, work: 70 },
    ...overrides
  };
}

function moveOpportunity(overrides = {}) {
  return {
    id: 'opportunity:move-east',
    goalType: 'travel',
    actionType: 'move',
    locationRef: 'destination:1,1',
    priority: 10,
    urgency: 20,
    distance: 2,
    ...overrides
  };
}

function spatialValidation(overrides = {}) {
  return {
    authority: 'simulation',
    actorId: 'protagonist:1',
    campaignRef: 'campaign:alpha',
    locationRef: 'site:village-square',
    worldRef: 'world:seed-42',
    regionRef: 'region:0,0',
    revision: 31,
    actorTags: ['walking'],
    actions: { move: { enabled: true, requiresDestination: true } },
    destinations: [{
      ref: 'destination:1,1', worldRef: 'world:seed-42', regionRef: 'region:0,0',
      available: true, traversable: true
    }],
    ...overrides
  };
}

function spatialResolution(overrides = {}) {
  return {
    authority: 'simulation',
    revision: 31,
    spatialRules: [{ destinationRef: 'destination:1,1', row: 1, col: 1 }],
    ...overrides
  };
}

function spatialExecution(overrides = {}) {
  return {
    authority: 'simulation',
    revision: 31,
    routes: [{
      opportunityId: 'opportunity:move-east',
      kind: 'spatial',
      destinationRef: 'destination:1,1',
      validationContext: spatialValidation(),
      resolutionContext: spatialResolution()
    }],
    ...overrides
  };
}

const TARGETS = Object.freeze({
  npc: { ref: 'npc:innkeeper', category: 'npc', stateRef: 'awake', available: true, relevance: 'active', location: { worldRef: 'world:seed-42', regionRef: 'region:0,0', settlementRef: 'village:0', siteRef: 'site:tavern', row: 1, col: 1 } },
  location: { ref: 'location:mill', category: 'location', stateRef: 'open', available: true, relevance: 'nearby', location: { worldRef: 'world:seed-42', regionRef: 'region:0,0', settlementRef: 'village:0', siteRef: 'site:mill', row: 2, col: 2 } },
  animal: { ref: 'animal:horse-1', category: 'animal', stateRef: 'calm', available: true, relevance: 'nearby', location: { worldRef: 'world:seed-42', regionRef: 'region:0,0', settlementRef: 'village:0', siteRef: 'site:stable', row: 2, col: 1 } },
  creature: { ref: 'creature:wisp-1', category: 'creature', stateRef: 'roaming', available: true, relevance: 'nearby', location: { worldRef: 'world:seed-42', regionRef: 'region:0,0', settlementRef: null, siteRef: 'wild:marsh', row: 2, col: 2 } }
});

function interactionCase(target, type) {
  const locationRef = target.location.siteRef;
  return {
    driver: driverContext({ locationRef }),
    opportunities: [{
      id: `opportunity:${type}`,
      goalType: 'interact',
      actionType: type,
      targetRef: target.ref,
      locationRef,
      priority: 20,
      urgency: 30,
      distance: 0
    }],
    execution: {
      authority: 'simulation',
      revision: 31,
      routes: [{
        opportunityId: `opportunity:${type}`,
        kind: 'interaction',
        interactionType: type,
        targetRef: target.ref,
        targetReference: {
          ref: target.ref,
          category: target.category,
          worldRef: 'world:seed-42',
          regionRef: 'region:0,0',
          contextRevision: 21
        },
        expectedTargetStateRef: target.stateRef,
        validationContext: {
          authority: 'simulation',
          actorId: 'protagonist:1',
          campaignRef: 'campaign:alpha',
          locationRef,
          worldRef: 'world:seed-42',
          regionRef: 'region:0,0',
          revision: 31,
          gameMinute: 600,
          actorTags: ['animal-handling'],
          actorLocation: { settlementRef: 'village:0', siteRef: locationRef },
          interactions: {
            [type]: {
              enabled: true,
              allowedTargetCategories: [target.category],
              allowedRelevance: ['active', 'nearby'],
              requiredActorTags: target.category === 'animal' ? ['animal-handling'] : [],
              requiredTargetStates: [target.stateRef],
              requiresSameSettlement: target.category !== 'creature',
              requiresSameSite: target.category === 'npc',
              timeWindows: target.category === 'npc' ? [{ startMinute: 480, endMinute: 1320 }] : []
            }
          },
          targetContext: {
            authority: 'simulation',
            worldRef: 'world:seed-42',
            regionRef: 'region:0,0',
            revision: 21,
            targets: [target]
          }
        },
        resolutionContext: {
          authority: 'simulation',
          revision: 31,
          interactionRules: [{
            interactionType: type,
            targetRef: target.ref,
            expectedTargetStateRef: target.stateRef,
            nextTargetStateRef: `${target.stateRef}-resolved`,
            regionX: 0,
            regionY: 0,
            statePatch: { autonomous: true, interactionCategory: target.category }
          }]
        }
      }]
    }
  };
}

test.beforeEach(async ({ page }) => {
  await waitForExecution(page);
  await page.evaluate(() => {
    const game = window.Game;
    const tile = () => ({ type: 'grass', elevation: 0, tags: new Set(), blocked: false, obstacle: false });
    game.State.world.seed = 'seed-42';
    game.State.world.rows = 3;
    game.State.world.cols = 3;
    game.State.world.terrain = [
      [tile(), tile(), tile()],
      [tile(), tile(), tile()],
      [tile(), tile(), tile()]
    ];
    Object.assign(game.State.world.player, {
      row: 0, col: 0, moving: false, startRow: 0, startCol: 0,
      targetRow: 0, targetCol: 0, progress: 1, pathQueue: []
    });
    game.WorldDeltaPersistence?.clearAll?.();
  });
});

test('Local BOT-selected travel resolves only through Simulation and updates authoritative protagonist location', async ({ page }) => {
  const evidence = await page.evaluate(({ driver, opportunity, execution }) => {
    const game = window.Game;
    const before = game.AuthoritativeState.capture(game.State);
    const result = game.AutonomousActionExecution.execute(driver, [opportunity], execution);
    const after = game.AuthoritativeState.capture(game.State);
    return { before, after, result };
  }, { driver: driverContext(), opportunity: moveOpportunity(), execution: spatialExecution() });

  expect(evidence.result).toMatchObject({
    authority: 'simulation', driver: 'local-bot', status: 'resolved', reasonCode: 'OK',
    selectionStatus: 'selected', intentStatus: 'ready', routeKind: 'spatial',
    simulationStatus: 'resolved', simulationReasonCode: 'OK'
  });
  expect(evidence.result.consequence).toMatchObject({ type: 'protagonist_location', to: { row: 1, col: 1 } });
  expect(evidence.before.world.protagonist).toEqual({ row: 0, col: 0 });
  expect(evidence.after.world.protagonist).toEqual({ row: 1, col: 1 });
});

test('stale, presentation-owned and impossible routes reject without authoritative mutation', async ({ page }) => {
  const evidence = await page.evaluate(({ driver, opportunity, normal, stale, presentation, blocked }) => {
    const game = window.Game;
    const canonical = () => game.AuthoritativeState.canonicalStringify(game.State);
    const before = canonical();
    const results = {
      stale: game.AutonomousActionExecution.execute(driver, [opportunity], stale),
      presentation: game.AutonomousActionExecution.execute(driver, [opportunity], presentation),
      blocked: game.AutonomousActionExecution.execute(driver, [opportunity], blocked)
    };
    const after = canonical();
    return { before, after, results };
  }, {
    driver: driverContext(), opportunity: moveOpportunity(), normal: spatialExecution(),
    stale: spatialExecution({ revision: 30 }),
    presentation: spatialExecution({ authority: 'presentation', directControl: true }),
    blocked: spatialExecution({ routes: [{
      ...spatialExecution().routes[0],
      validationContext: spatialValidation({ destinations: [{ ref: 'destination:1,1', worldRef: 'world:seed-42', regionRef: 'region:0,0', available: true, traversable: false }] })
    }] })
  });

  expect(evidence.results.stale).toMatchObject({ status: 'rejected', reasonCode: 'STALE_EXECUTION_CONTEXT' });
  expect(evidence.results.presentation).toMatchObject({ status: 'rejected', reasonCode: 'NON_SIMULATION_EXECUTION_CONTEXT' });
  expect(evidence.results.blocked).toMatchObject({ status: 'rejected', reasonCode: 'SIMULATION_REJECTED', validationReasonCode: 'DESTINATION_BLOCKED' });
  expect(evidence.after).toBe(evidence.before);
});

test('NPC, location, animal and creature selections resolve through Simulation-owned interaction paths', async ({ page }) => {
  const cases = [
    interactionCase(TARGETS.npc, 'talk'),
    interactionCase(TARGETS.location, 'inspect_location'),
    interactionCase(TARGETS.animal, 'tend_animal'),
    interactionCase(TARGETS.creature, 'observe_creature')
  ];
  const evidence = await page.evaluate((items) => {
    const game = window.Game;
    return items.map((item) => {
      game.WorldDeltaPersistence.clearAll();
      const result = game.AutonomousActionExecution.execute(item.driver, item.opportunities, item.execution);
      const delta = game.WorldDeltaPersistence.capture(game.State.world.seed);
      return { result, delta };
    });
  }, cases);

  expect(evidence).toHaveLength(4);
  for (const item of evidence) {
    expect(item.result).toMatchObject({ status: 'resolved', reasonCode: 'OK', routeKind: 'interaction', simulationStatus: 'resolved' });
    expect(item.result.consequence).toMatchObject({ type: 'world_entity_delta' });
    expect(item.delta.regions).toHaveLength(1);
  }
});

test('target mismatch and stale interaction feedback cannot mutate world delta', async ({ page }) => {
  const item = interactionCase(TARGETS.npc, 'talk');
  const evidence = await page.evaluate((payload) => {
    const game = window.Game;
    game.WorldDeltaPersistence.clearAll();
    const mismatch = game.AutonomousActionExecution.execute(payload.driver, payload.opportunities, {
      ...payload.execution,
      routes: [{ ...payload.execution.routes[0], targetRef: 'npc:other', targetReference: { ...payload.execution.routes[0].targetReference, ref: 'npc:other' } }]
    });
    const stale = game.AutonomousActionExecution.execute(payload.driver, payload.opportunities, {
      ...payload.execution,
      routes: [{
        ...payload.execution.routes[0],
        validationContext: { ...payload.execution.routes[0].validationContext, revision: 32 }
      }]
    });
    return { mismatch, stale, delta: game.WorldDeltaPersistence.capture(game.State.world.seed) };
  }, item);

  expect(evidence.mismatch).toMatchObject({ status: 'rejected', reasonCode: 'ROUTE_TARGET_MISMATCH' });
  expect(evidence.stale).toMatchObject({ status: 'rejected', reasonCode: 'SIMULATION_REJECTED', validationReasonCode: 'STALE_INTERACTION_CONTEXT' });
  expect(evidence.delta.regions).toHaveLength(0);
});

test('successful travel remains save/load compatible without changing campaign chronology', async ({ page }) => {
  const evidence = await page.evaluate(({ driver, opportunity, execution }) => {
    const game = window.Game;
    const beforeTime = JSON.stringify(game.State.gameTime || null);
    const result = game.AutonomousActionExecution.execute(driver, [opportunity], execution);
    const saved = game.CampaignPersistence.serializeSave();
    Object.assign(game.State.world.player, { row: 0, col: 0 });
    const load = game.CampaignPersistence.loadSave(saved);
    const afterTime = JSON.stringify(game.State.gameTime || null);
    return { result, loadOk: load.ok, row: game.State.world.player.row, col: game.State.world.player.col, beforeTime, afterTime };
  }, { driver: driverContext(), opportunity: moveOpportunity(), execution: spatialExecution() });

  expect(evidence.result.status).toBe('resolved');
  expect(evidence.loadOk).toBe(true);
  expect({ row: evidence.row, col: evidence.col }).toEqual({ row: 1, col: 1 });
  expect(evidence.afterTime).toBe(evidence.beforeTime);
});

test('region navigation is invoked only after successful Simulation spatial resolution', async ({ page }) => {
  const evidence = await page.evaluate(({ driver, opportunity, execution }) => {
    const game = window.Game;
    const calls = [];
    game.RegionNavigation = {
      authority: 'simulation',
      activate(regionX, regionY) {
        calls.push([regionX, regionY]);
        return { authority: 'simulation', currentRegion: { x: regionX, y: regionY } };
      }
    };
    const success = game.AutonomousActionExecution.execute(driver, [opportunity], {
      ...execution,
      routes: [{ ...execution.routes[0], regionTransition: { regionX: 1, regionY: 0 } }]
    });
    Object.assign(game.State.world.player, { row: 0, col: 0, startRow: 0, startCol: 0, targetRow: 0, targetCol: 0, pathQueue: [] });
    const blocked = game.AutonomousActionExecution.execute(driver, [opportunity], {
      ...execution,
      routes: [{
        ...execution.routes[0],
        regionTransition: { regionX: 2, regionY: 0 },
        validationContext: { ...execution.routes[0].validationContext, destinations: [{ ref: 'destination:1,1', worldRef: 'world:seed-42', regionRef: 'region:0,0', available: false, traversable: true }] }
      }]
    });
    return { success, blocked, calls };
  }, { driver: driverContext(), opportunity: moveOpportunity(), execution: spatialExecution() });

  expect(evidence.success).toMatchObject({ status: 'resolved', navigation: { currentRegion: { x: 1, y: 0 } } });
  expect(evidence.blocked).toMatchObject({ status: 'rejected', reasonCode: 'SIMULATION_REJECTED' });
  expect(evidence.calls).toEqual([[1, 0]]);
});
