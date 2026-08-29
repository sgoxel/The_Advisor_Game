import { test, expect } from '@playwright/test';

async function loadPresentation(page) {
  await page.goto('./');
  await page.addStyleTag({ url: './css/autonomy-feedback.css' });
  await page.addScriptTag({ url: './js/autonomy_feedback_presentation.js' });
  await page.waitForFunction(() => Boolean(window.Game?.AutonomyFeedbackPresentation?.renderPreview));
}

const STATES = [
  ['intent', 'Intent chosen'],
  ['acting', 'Acting autonomously'],
  ['validating', 'Simulation checking'],
  ['reconsidering', 'Reconsidering'],
  ['resolved', 'World result'],
  ['idle', 'Waiting']
];

test('autonomous activity states are explicit, non-commanding and distinct from Advisor context', async ({ page }) => {
  await loadPresentation(page);

  const evidence = await page.evaluate((states) => {
    const api = window.Game.AutonomyFeedbackPresentation;
    return states.map(([state]) => {
      api.renderPreview({
        state,
        intentLabel: 'Visit the village inn',
        activityLabel: 'Walking toward the innkeeper',
        contextLabel: 'Origin Village · evening',
        destinationLabel: 'The Lantern Inn',
        reasonLabel: `Visible ${state} explanation`,
        reasonCode: state.toUpperCase(),
        authority: 'player',
        forceExecute: true,
        directControl: 'move-now'
      });
      const card = document.getElementById('autonomyFeedbackCard');
      return {
        state: card.dataset.state,
        stateLabel: card.querySelector('[data-autonomy-state-label]').textContent,
        icon: card.querySelector('[data-autonomy-icon]').textContent,
        title: card.querySelector('[data-autonomy-intent]').textContent,
        activity: card.querySelector('[data-autonomy-activity]').textContent,
        boundary: card.querySelector('[data-autonomy-boundary]').textContent.replace(/\s+/g, ' ').trim(),
        presentationOnly: card.dataset.presentationOnly,
        interactiveCount: card.querySelectorAll('button, a, input, select, textarea, [role="button"]').length,
        snapshotKeys: Object.keys(card.__autonomyPresentationSnapshot || {}).sort()
      };
    });
  }, STATES);

  expect(evidence.map((item) => item.state)).toEqual(STATES.map(([state]) => state));
  expect(evidence.map((item) => item.stateLabel)).toEqual(STATES.map(([, label]) => label));
  expect(new Set(evidence.map((item) => item.stateLabel)).size).toBe(STATES.length);
  expect(new Set(evidence.map((item) => item.icon)).size).toBe(STATES.length);

  for (const item of evidence) {
    expect(item.title).toBe('Visit the village inn');
    expect(item.activity).toBe('Walking toward the innkeeper');
    expect(item.boundary).toContain('Advisor context is separate.');
    expect(item.boundary).toContain('does not force this action');
    expect(item.presentationOnly).toBe('true');
    expect(item.interactiveCount).toBe(0);
    expect(item.snapshotKeys).not.toContain('authority');
    expect(item.snapshotKeys).not.toContain('forceExecute');
    expect(item.snapshotKeys).not.toContain('directControl');
  }
});

test('presentation preview cannot mutate authoritative state or expose action authority APIs', async ({ page }) => {
  await loadPresentation(page);

  const evidence = await page.evaluate(() => {
    const game = window.Game;
    const api = game.AutonomyFeedbackPresentation;
    const canonical = () => game.AuthoritativeState.canonicalStringify(game.State);
    const before = canonical();
    const snapshot = api.renderPreview({
      state: 'acting',
      intentLabel: 'Talk to the innkeeper',
      interactionLabel: 'Innkeeper',
      authority: 'simulation',
      result: { status: 'resolved' },
      execute: true,
      mutate: { protagonist: { row: 999, col: 999 } }
    });
    const after = canonical();
    return {
      before,
      after,
      snapshot,
      apiKeys: Object.keys(api),
      cardHtml: document.getElementById('autonomyFeedbackCard')?.innerHTML || ''
    };
  });

  expect(evidence.after).toBe(evidence.before);
  expect(evidence.snapshot.presentationOnly).toBe(true);
  expect(evidence.snapshot).not.toHaveProperty('authority');
  expect(evidence.snapshot).not.toHaveProperty('result');
  expect(evidence.snapshot).not.toHaveProperty('execute');
  expect(evidence.snapshot).not.toHaveProperty('mutate');
  for (const forbidden of ['set', 'apply', 'commit', 'resolve', 'execute', 'select', 'validate']) {
    expect(evidence.apiKeys).not.toContain(forbidden);
  }
  expect(evidence.cardHtml).not.toMatch(/>\s*(Go|Move|Attack|Interact|Execute|Confirm)\s*</i);
});

test('semantic status and text hierarchy do not rely on color or hover', async ({ page }) => {
  await loadPresentation(page);
  await page.evaluate(() => window.Game.AutonomyFeedbackPresentation.renderPreview({
    state: 'reconsidering',
    intentLabel: 'Find safer work',
    activityLabel: 'Re-evaluating local opportunities',
    contextLabel: 'Origin Village · night',
    targetLabel: 'Village market',
    reasonLabel: 'The previous route is no longer suitable.',
    reasonCode: 'CONTEXT_CHANGED'
  }));

  const card = page.locator('#autonomyFeedbackCard');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('aria-label', 'Autonomous protagonist activity');
  await expect(card.locator('[role="status"]')).toHaveAttribute('aria-live', 'polite');
  await expect(card.locator('[data-autonomy-state-label]')).toHaveText('Reconsidering');
  await expect(card.locator('[data-autonomy-intent]')).toHaveText('Find safer work');
  await expect(card.locator('[data-autonomy-activity]')).toContainText('Re-evaluating');
  await expect(card.locator('[data-autonomy-focus-kind]')).toHaveText('Interaction');
  await expect(card.locator('[data-autonomy-focus]')).toHaveText('Village market');
  await expect(card.locator('[data-autonomy-reason]')).toContainText('previous route');
  await expect(card.locator('[data-autonomy-meta]')).toContainText('CONTEXT_CHANGED');

  const visual = await card.evaluate((element) => ({
    titleFont: getComputedStyle(element.querySelector('.autonomy-feedback-title')).fontFamily,
    stateText: element.querySelector('[data-autonomy-state-label]').textContent,
    iconText: element.querySelector('[data-autonomy-icon]').textContent,
    reasonText: element.querySelector('[data-autonomy-reason]').textContent
  }));
  expect(visual.titleFont).toContain('Georgia');
  expect(visual.stateText.length).toBeGreaterThan(0);
  expect(visual.iconText.length).toBeGreaterThan(0);
  expect(visual.reasonText.length).toBeGreaterThan(0);
});

test('desktop, tablet and phone layouts preserve viewport and living-map primacy', async ({ page }) => {
  const viewports = [
    { name: 'desktop', width: 1280, height: 720 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'phone-portrait', width: 390, height: 844 },
    { name: 'phone-landscape', width: 844, height: 390 }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loadPresentation(page);
    await page.evaluate(() => window.Game.AutonomyFeedbackPresentation.renderPreview({
      state: 'validating',
      intentLabel: 'Visit the village inn and ask about work',
      activityLabel: 'Waiting for Simulation validation before the protagonist proceeds.',
      contextLabel: 'Origin Village · market road · evening',
      destinationLabel: 'The Lantern Inn',
      reasonLabel: 'The Simulation is checking current route and world context.',
      reasonCode: 'VALIDATING_AUTONOMOUS_INTENT'
    }));

    const layout = await page.locator('#autonomyFeedbackCard').evaluate((card) => {
      const rect = card.getBoundingClientRect();
      return {
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        viewport: { width: innerWidth, height: innerHeight },
        rootScrollWidth: document.documentElement.scrollWidth,
        rootScrollHeight: document.documentElement.scrollHeight,
        overflowY: getComputedStyle(card).overflowY
      };
    });

    expect(layout.rect.left, viewport.name).toBeGreaterThanOrEqual(0);
    expect(layout.rect.top, viewport.name).toBeGreaterThanOrEqual(48);
    expect(layout.rect.right, viewport.name).toBeLessThanOrEqual(layout.viewport.width + 0.5);
    expect(layout.rect.bottom, viewport.name).toBeLessThanOrEqual(layout.viewport.height + 0.5);
    expect(layout.rootScrollWidth, viewport.name).toBeLessThanOrEqual(layout.viewport.width);
    expect(layout.rect.width * layout.rect.height, viewport.name).toBeLessThan(layout.viewport.width * layout.viewport.height * 0.46);
    expect(['auto', 'scroll']).toContain(layout.overflowY);
  }
});
