import { test, expect } from '@playwright/test';

async function waitForFeedback(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.LegalityFeedback?.render &&
    window.Game?.ActionLegality?.validate &&
    window.Game?.AuthoritativeState?.canonicalStringify
  ));
}

function candidate(overrides = {}) {
  return {
    source: 'advisor-context',
    label: 'travel',
    destinationLabel: 'Mill Yard',
    destinationRef: 'destination:mill-yard',
    ...overrides
  };
}

test.beforeEach(async ({ page }) => {
  await waitForFeedback(page);
  await page.evaluate(() => window.Game.LegalityFeedback.clear());
});

test('renders candidate, possible, rejected, pending and resolved with redundant visible semantics', async ({ page }) => {
  const evidence = await page.evaluate((baseCandidate) => {
    const feedback = window.Game.LegalityFeedback;
    const card = document.getElementById('legalityFeedbackCard');
    const snapshot = () => ({
      state: card.dataset.state,
      authority: card.querySelector('[data-feedback-authority]').textContent,
      label: card.querySelector('[data-feedback-label]').textContent,
      summary: card.querySelector('[data-feedback-summary]').textContent,
      reason: card.querySelector('[data-feedback-reason]').textContent,
      icon: card.querySelector('[data-feedback-icon]').textContent,
      hidden: card.hidden
    });

    const states = [];
    feedback.render({ phase: 'candidate', candidate: baseCandidate });
    states.push(snapshot());
    feedback.render({ candidate: baseCandidate, validation: { authority: 'simulation', status: 'allowed', reasonCode: 'OK', canResolve: true } });
    states.push(snapshot());
    feedback.render({ candidate: baseCandidate, validation: { authority: 'simulation', status: 'rejected', reasonCode: 'DESTINATION_BLOCKED', canResolve: false } });
    states.push(snapshot());
    feedback.render({ phase: 'pending', authority: 'simulation', candidate: baseCandidate });
    states.push(snapshot());
    feedback.render({ candidate: baseCandidate, resolution: { authority: 'simulation', status: 'resolved', reasonCode: 'OK', consequence: { type: 'protagonist_location', destinationRef: 'destination:mill-yard' } } });
    states.push(snapshot());
    return states;
  }, candidate());

  expect(evidence.map((item) => item.state)).toEqual(['candidate', 'allowed', 'rejected', 'pending', 'resolved']);
  expect(evidence.map((item) => item.label)).toEqual(['Considering', 'Possible', 'Not possible', 'Resolving…', 'Result']);
  expect(new Set(evidence.map((item) => item.icon)).size).toBe(5);
  for (const item of evidence) {
    expect(item.hidden).toBe(false);
    expect(item.summary.length).toBeGreaterThan(0);
    expect(item.reason.length).toBeGreaterThan(0);
  }
  expect(evidence[1].authority).toBe('Simulation');
  expect(evidence[2].reason).toContain('Destination blocked');
  expect(evidence[4].summary).toContain('World updated');
});

test('non-Simulation validation or result cannot synthesize visible success', async ({ page }) => {
  const evidence = await page.evaluate((baseCandidate) => {
    const feedback = window.Game.LegalityFeedback;
    const card = document.getElementById('legalityFeedbackCard');
    const validationResult = feedback.render({ candidate: baseCandidate, validation: { authority: 'presentation', status: 'allowed', reasonCode: 'OK', canResolve: true } });
    const validationHidden = card.hidden;
    const resolutionResult = feedback.render({ candidate: baseCandidate, resolution: { authority: 'presentation', status: 'resolved', reasonCode: 'OK', consequence: { type: 'protagonist_location' } } });
    return { validationResult, validationHidden, resolutionResult, resolutionHidden: card.hidden };
  }, candidate());

  expect(evidence.validationResult).toBeNull();
  expect(evidence.validationHidden).toBe(true);
  expect(evidence.resolutionResult).toBeNull();
  expect(evidence.resolutionHidden).toBe(true);
});

test('Advisor affordances emit presentation-only influence events and never mutate authoritative state', async ({ page }) => {
  const evidence = await page.evaluate((baseCandidate) => {
    const game = window.Game;
    const feedback = game.LegalityFeedback;
    const card = document.getElementById('legalityFeedbackCard');
    feedback.render({ candidate: baseCandidate, validation: { authority: 'simulation', status: 'allowed', reasonCode: 'OK', canResolve: true } });
    const before = game.AuthoritativeState.canonicalStringify(game.State);
    let eventDetail = null;
    card.addEventListener('advisor-suggestion', (event) => { eventDetail = event.detail; }, { once: true });
    card.querySelector('[data-advisor-action="suggest"]').click();
    const after = game.AuthoritativeState.canonicalStringify(game.State);
    return { before, after, eventDetail, suggestText: card.querySelector('[data-advisor-action="suggest"]').textContent };
  }, candidate());

  expect(evidence.after).toBe(evidence.before);
  expect(evidence.suggestText).toBe('Suggest this');
  expect(evidence.eventDetail).toMatchObject({ kind: 'suggest', presentationOnly: true });
  expect(evidence.eventDetail.candidate.destinationRef).toBe('destination:mill-yard');
});

test('rejected reason is visible to keyboard/touch users and advice controls disable without hover dependency', async ({ page }) => {
  await page.evaluate((baseCandidate) => {
    window.Game.LegalityFeedback.render({
      candidate: baseCandidate,
      validation: { authority: 'simulation', status: 'rejected', reasonCode: 'TARGET_UNAVAILABLE', canResolve: false }
    });
  }, candidate({ targetLabel: 'Innkeeper', targetRef: 'npc:innkeeper', destinationLabel: null }));

  const card = page.locator('#legalityFeedbackCard');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-feedback-reason]')).toContainText('Target unavailable');
  await expect(card.locator('[data-advisor-action="suggest"]')).toBeDisabled();
  await expect(card.locator('[data-advisor-action="discuss"]')).toBeDisabled();
  await card.locator('summary').focus();
  await expect(card.locator('summary')).toBeFocused();
  await card.locator('summary').press('Enter');
  await expect(card.locator('[data-feedback-meta]')).toContainText('TARGET_UNAVAILABLE');
});

test('feedback remains within viewport with touch-sized controls and no horizontal page overflow', async ({ page }) => {
  await page.evaluate((baseCandidate) => {
    window.Game.LegalityFeedback.render({ candidate: baseCandidate, validation: { authority: 'simulation', status: 'allowed', reasonCode: 'OK', canResolve: true } });
  }, candidate());

  const layout = await page.evaluate(() => {
    const card = document.getElementById('legalityFeedbackCard');
    const rect = card.getBoundingClientRect();
    const buttons = Array.from(card.querySelectorAll('.legality-feedback-action')).map((button) => {
      const box = button.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      card: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
      buttons,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      role: card.querySelector('[role="status"]').getAttribute('role'),
      live: card.querySelector('[role="status"]').getAttribute('aria-live')
    };
  });

  expect(layout.card.left).toBeGreaterThanOrEqual(0);
  expect(layout.card.right).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.card.top).toBeGreaterThanOrEqual(0);
  expect(layout.card.bottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.horizontalOverflow).toBe(false);
  for (const button of layout.buttons) {
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
  }
  expect(layout.role).toBe('status');
  expect(layout.live).toBe('polite');
});
