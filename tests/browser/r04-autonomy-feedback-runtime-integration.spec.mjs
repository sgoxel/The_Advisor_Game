import { test, expect } from '@playwright/test';

async function missingProductionApis(page) {
  return page.evaluate(() => {
    const checks = [
      ['AutonomyFeedbackRuntime.renderRuntime', Boolean(window.Game?.AutonomyFeedbackRuntime?.renderRuntime)],
      ['AutonomyFeedbackPresentation.renderPreview', Boolean(window.Game?.AutonomyFeedbackPresentation?.renderPreview)],
      ['AutonomousDecisionLoop.resolvePrepared', Boolean(window.Game?.AutonomousDecisionLoop?.resolvePrepared)],
      ['AutonomousActionExecution.execute', Boolean(window.Game?.AutonomousActionExecution?.execute)],
      ['GameTime.setForTest', Boolean(window.Game?.GameTime?.setForTest)],
      ['WorldDeltaPersistence.clearAll', Boolean(window.Game?.WorldDeltaPersistence?.clearAll)],
      ['AuthoritativeState.canonicalStringify', Boolean(window.Game?.AuthoritativeState?.canonicalStringify)]
    ];
    return checks.filter(([, ready]) => !ready).map(([name]) => name);
  });
}

async function waitForProductionApis(page) {
  await expect.poll(
    () => missingProductionApis(page),
    { timeout: 10_000, intervals: [100, 250, 500, 1000], message: 'Normal application shell must expose all R04 integration dependencies.' }
  ).toEqual([]);
}

async function load(page) {
  await page.goto('./');
  await waitForProductionApis(page);
  await page.waitForSelector('#autonomyFeedbackCard');
}

async function resetSimulation(page) {
  await page.evaluate(() => {
    const game = window.Game;
    const tile = () => ({ type: 'grass', elevation: 0, tags: new Set(), blocked: false, obstacle: false });
    game.GameTime.stop();
    game.GameTime.setForTest(600);
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
      targetRow: 0, targetCol: 0, progress: 1, pathQueue: [], regionX: 0, regionY: 0
    });
    game.WorldDeltaPersistence.clearAll();
    game.AutonomyFeedbackRuntime.clear();
  });
}

function context() {
  return {
    authority: 'simulation', actorId: 'protagonist:1', campaignRef: 'campaign:alpha',
    locationRef: 'site:village-square', worldRef: 'world:seed-42', regionRef: 'region:0,0',
    contextRevision: 31, campaignMinute: 600, actorStateRef: 'state:ready', needs: { work: 70 },
    relevance: 'active', regionX: 0, regionY: 0, intervalMinutes: 5
  };
}

function opportunity() {
  return {
    id: 'opportunity:move-east', goalType: 'travel', actionType: 'move',
    locationRef: 'site:village-square', priority: 10, urgency: 20, distance: 2
  };
}

function execution(traversable = true) {
  return {
    authority: 'simulation', revision: 31, routes: [{
      opportunityId: 'opportunity:move-east', kind: 'spatial', destinationRef: 'destination:1,1',
      validationContext: {
        authority: 'simulation', actorId: 'protagonist:1', campaignRef: 'campaign:alpha',
        locationRef: 'site:village-square', worldRef: 'world:seed-42', regionRef: 'region:0,0',
        revision: 31, actorTags: ['walking'], actions: { move: { enabled: true, requiresDestination: true } },
        destinations: [{ ref: 'destination:1,1', worldRef: 'world:seed-42', regionRef: 'region:0,0', available: true, traversable }]
      },
      resolutionContext: {
        authority: 'simulation', revision: 31,
        spatialRules: [{ destinationRef: 'destination:1,1', row: 1, col: 1 }]
      }
    }]
  };
}

test.beforeEach(async ({ page }) => {
  await load(page);
  await resetSimulation(page);
});

test('normal application shell loads autonomy feedback and real decision results reach it automatically', async ({ page }) => {
  const resources = await page.evaluate(() => ({
    styleLoaded: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((node) => node.getAttribute('href') === 'css/autonomy-feedback.css'),
    presentationLoaded: Array.from(document.scripts).some((node) => node.getAttribute('src') === 'js/autonomy_feedback_presentation.js'),
    runtimeLoaded: Array.from(document.scripts).some((node) => node.getAttribute('src') === 'js/autonomy_feedback_runtime.js'),
    loopLoaded: Array.from(document.scripts).some((node) => node.getAttribute('src') === 'js/autonomous_decision_loop.js')
  }));
  expect(resources).toEqual({ styleLoaded: true, presentationLoaded: true, runtimeLoaded: true, loopLoaded: true });

  const runtime = await page.evaluate(({ c, op, route }) => {
    const game = window.Game;
    const prepared = game.AutonomousDecisionLoop.prepare(c, [op]);
    const resolved = game.AutonomousDecisionLoop.resolvePrepared(prepared.prepared, c, route);
    return {
      resolved,
      afterRuntime: game.AuthoritativeState.canonicalStringify(game.State),
      apiKeys: Object.keys(game.AutonomyFeedbackRuntime)
    };
  }, { c: context(), op: opportunity(), route: execution(true) });

  expect(runtime.resolved).toMatchObject({ status: 'resolved', reasonCode: 'OK' });
  const card = page.locator('#autonomyFeedbackCard');
  await expect(card).toHaveAttribute('data-state', 'resolved');
  await expect(card.locator('[data-autonomy-intent]')).toContainText('opportunity:move-east');
  await expect(card.locator('[data-autonomy-reason]')).toContainText('OK');
  await expect(card.locator('[data-autonomy-boundary]')).toContainText('does not force this action');
  expect(await card.locator('button, a, input, select, textarea, [role="button"]').count()).toBe(0);
  expect(await page.evaluate(() => window.Game.AuthoritativeState.canonicalStringify(window.Game.State))).toBe(runtime.afterRuntime);
  for (const forbidden of ['execute', 'validate', 'resolve', 'commit', 'mutate', 'select']) {
    expect(runtime.apiKeys).not.toContain(forbidden);
  }
});

test('real rejected decision checkpoint becomes reconsideration feedback without presentation mutation', async ({ page }) => {
  const runtime = await page.evaluate(({ c, op, route }) => {
    const game = window.Game;
    const prepared = game.AutonomousDecisionLoop.prepare(c, [op]);
    const result = game.AutonomousDecisionLoop.resolvePrepared(prepared.prepared, c, route);
    return { result, afterRuntime: game.AuthoritativeState.canonicalStringify(game.State) };
  }, { c: context(), op: opportunity(), route: execution(false) });

  expect(runtime.result.status).toBe('rejected');
  const card = page.locator('#autonomyFeedbackCard');
  await expect(card).toHaveAttribute('data-state', 'reconsidering');
  await expect(card.locator('[data-autonomy-state-label]')).toHaveText('Reconsidering');
  await expect(card.locator('[role="status"]')).toHaveAttribute('aria-live', 'polite');
  expect(await page.evaluate(() => window.Game.AuthoritativeState.canonicalStringify(window.Game.State))).toBe(runtime.afterRuntime);
});

test('presentation-owned runtime snapshots are ignored and cannot overwrite authoritative feedback', async ({ page }) => {
  await page.evaluate(() => window.Game.AutonomyFeedbackRuntime.renderRuntime({
    authority: 'simulation', status: 'resolved', reasonCode: 'OK', selectedOpportunityId: 'authoritative-intent'
  }));
  const before = await page.locator('#autonomyFeedbackCard').evaluate((card) => ({ state: card.dataset.state, text: card.textContent }));
  const ignored = await page.evaluate(() => window.Game.AutonomyFeedbackRuntime.renderRuntime({
    authority: 'presentation', status: 'resolved', reasonCode: 'FORCED', selectedOpportunityId: 'forced-intent'
  }));
  const after = await page.locator('#autonomyFeedbackCard').evaluate((card) => ({ state: card.dataset.state, text: card.textContent }));
  expect(ignored).toEqual({ ignored: true, reasonCode: 'NON_SIMULATION_RUNTIME' });
  expect(after).toEqual(before);
  expect(after.text).not.toContain('forced-intent');
});

test('authoritative ready, validating, acting and stale snapshots retain explicit non-command state semantics', async ({ page }) => {
  const cases = [
    ['ready', 'intent', 'Intent chosen'],
    ['validating', 'validating', 'Simulation checking'],
    ['acting', 'acting', 'Acting autonomously'],
    ['stale', 'reconsidering', 'Reconsidering']
  ];
  for (const [status, state, label] of cases) {
    await page.evaluate((value) => window.Game.AutonomyFeedbackRuntime.renderRuntime({
      authority: 'simulation', status: value, reasonCode: value === 'stale' ? 'STALE_EXECUTION_CONTEXT' : 'OK',
      locationRef: 'origin-village', selectedOpportunityId: 'visit-inn'
    }), status);
    const card = page.locator('#autonomyFeedbackCard');
    await expect(card).toHaveAttribute('data-state', state);
    await expect(card.locator('[data-autonomy-state-label]')).toHaveText(label);
  }
});

test('responsive layouts preserve viewport bounds and no horizontal overflow on production-loaded feature', async ({ page }) => {
  const viewports = [
    { width: 1280, height: 720 }, { width: 768, height: 1024 },
    { width: 390, height: 844 }, { width: 844, height: 390 }
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.reload();
    await waitForProductionApis(page);
    await page.evaluate(() => window.Game.AutonomyFeedbackRuntime.renderRuntime({
      authority: 'simulation', status: 'ready', reasonCode: 'OK', locationRef: 'origin-village',
      selectedOpportunityId: 'visit-inn'
    }));
    const layout = await page.locator('#autonomyFeedbackCard').evaluate((card) => {
      const rect = card.getBoundingClientRect();
      return {
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth
      };
    });
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.top).toBeGreaterThanOrEqual(48);
    expect(layout.right).toBeLessThanOrEqual(layout.width + 0.5);
    expect(layout.bottom).toBeLessThanOrEqual(layout.height + 0.5);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  }
});
