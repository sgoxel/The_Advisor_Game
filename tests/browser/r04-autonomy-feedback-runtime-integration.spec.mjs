import { test, expect } from '@playwright/test';

async function load(page) {
  await page.goto('./');
  await page.addStyleTag({ url: './css/autonomy-feedback.css' });
  await page.addScriptTag({ url: './js/autonomy_feedback_presentation.js' });
  await page.addScriptTag({ url: './js/autonomy_feedback_runtime.js' });
  await page.waitForFunction(() => Boolean(window.Game?.AutonomyFeedbackRuntime?.renderRuntime));
}

test('authoritative autonomy results render without becoming a command or mutation surface', async ({ page }) => {
  await load(page);
  const evidence = await page.evaluate(() => {
    const before = window.Game.AuthoritativeState.canonicalStringify(window.Game.State);
    const rendered = window.Game.AutonomyFeedbackRuntime.renderRuntime({
      authority: 'simulation',
      status: 'resolved',
      locationRef: 'origin-village',
      execution: {
        status: 'resolved',
        reasonCode: 'OK',
        selectedOpportunityId: 'visit-inn',
        routeKind: 'spatial',
        simulationStatus: 'resolved',
        destinationRef: 'lantern-inn'
      }
    });
    const after = window.Game.AuthoritativeState.canonicalStringify(window.Game.State);
    const card = document.getElementById('autonomyFeedbackCard');
    return {
      before,
      after,
      rendered,
      state: card?.dataset.state,
      interactiveCount: card?.querySelectorAll('button, a, input, select, textarea, [role="button"]').length,
      boundary: card?.querySelector('[data-autonomy-boundary]')?.textContent || '',
      apiKeys: Object.keys(window.Game.AutonomyFeedbackRuntime)
    };
  });

  expect(evidence.after).toBe(evidence.before);
  expect(evidence.state).toBe('resolved');
  expect(evidence.rendered.presentationOnly).toBe(true);
  expect(evidence.interactiveCount).toBe(0);
  expect(evidence.boundary).toContain('does not force this action');
  for (const forbidden of ['execute', 'validate', 'resolve', 'commit', 'mutate', 'select']) {
    expect(evidence.apiKeys).not.toContain(forbidden);
  }
});

test('rejected and stale runtime results become explicit reconsideration feedback', async ({ page }) => {
  await load(page);
  for (const status of ['rejected', 'stale']) {
    await page.evaluate((value) => window.Game.AutonomyFeedbackRuntime.renderRuntime({
      authority: 'simulation', status: value, reasonCode: 'STALE_EXECUTION_CONTEXT', locationRef: 'market-road'
    }), status);
    const card = page.locator('#autonomyFeedbackCard');
    await expect(card).toHaveAttribute('data-state', 'reconsidering');
    await expect(card.locator('[data-autonomy-state-label]')).toHaveText('Reconsidering');
    await expect(card.locator('[data-autonomy-reason]')).toContainText('STALE_EXECUTION_CONTEXT');
    await expect(card.locator('[role="status"]')).toHaveAttribute('aria-live', 'polite');
  }
});

test('responsive layouts preserve viewport bounds and no horizontal overflow', async ({ page }) => {
  const viewports = [
    { width: 1280, height: 720 }, { width: 768, height: 1024 },
    { width: 390, height: 844 }, { width: 844, height: 390 }
  ];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await load(page);
    await page.evaluate(() => window.Game.AutonomyFeedbackRuntime.renderRuntime({
      authority: 'simulation', status: 'ready', reasonCode: 'OK', locationRef: 'origin-village',
      selectedOpportunityId: 'visit-inn'
    }));
    const layout = await page.locator('#autonomyFeedbackCard').evaluate((card) => {
      const rect = card.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth };
    });
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.top).toBeGreaterThanOrEqual(48);
    expect(layout.right).toBeLessThanOrEqual(layout.width + 0.5);
    expect(layout.bottom).toBeLessThanOrEqual(layout.height + 0.5);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
  }
});
