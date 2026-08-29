import { test, expect } from '@playwright/test';

const EXPECTED_OPTIONAL_MAP_404S = [
  '/map/ISOMETRIC_MAP_30032026.js',
  '/map/ISOMETRIC_MAP_30032026/ISOMETRIC_MAP_30032026.js',
  '/map/map.js'
];

function collectRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const locationUrl = message.location().url || '';
    let expected = false;
    if (text.includes('Failed to load resource') && text.includes('404')) {
      try { expected = EXPECTED_OPTIONAL_MAP_404S.includes(new URL(locationUrl).pathname); } catch { expected = false; }
    }
    if (!expected) failures.push(`console.error: ${text}${locationUrl ? ` @ ${locationUrl}` : ''}`);
  });
  return failures;
}

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.LegalityFeedback?.render &&
    window.Game?.ActionLegality?.validate &&
    window.Game?.WorldActionResolution?.resolveSpatial &&
    window.Game?.CampaignPersistence?.serializeSave &&
    window.Game?.AuthoritativeState?.canonicalStringify
  ));
  await page.evaluate(() => window.Game.LegalityFeedback.clear());
}

function candidate() {
  return {
    source: 'advisor-context',
    label: 'travel',
    destinationLabel: 'Mill Yard',
    destinationRef: 'destination:mill-yard'
  };
}

test('cumulative legality feedback stays perceivable, keyboard/touch usable and viewport-safe', async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);

  const evidence = await page.evaluate((baseCandidate) => {
    const feedback = window.Game.LegalityFeedback;
    const card = document.getElementById('legalityFeedbackCard');

    const parseColor = (value) => {
      const match = String(value).match(/rgba?\(([^)]+)\)/i);
      if (!match) return null;
      const parts = match[1].split(',').map((part) => Number(part.trim()));
      return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 };
    };
    const compositeOnBlack = (color) => ({
      r: color.r * color.a,
      g: color.g * color.a,
      b: color.b * color.a
    });
    const luminance = (color) => {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const contrast = (foreground, background) => {
      const a = luminance(foreground);
      const b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };

    const states = [];
    for (const payload of [
      { phase: 'candidate', candidate: baseCandidate },
      { candidate: baseCandidate, validation: { authority: 'simulation', status: 'allowed', reasonCode: 'OK', canResolve: true } },
      { candidate: baseCandidate, validation: { authority: 'simulation', status: 'rejected', reasonCode: 'DESTINATION_BLOCKED', canResolve: false } },
      { phase: 'pending', authority: 'simulation', candidate: baseCandidate },
      { candidate: baseCandidate, resolution: { authority: 'simulation', status: 'resolved', reasonCode: 'OK', consequence: { type: 'protagonist_location', destinationRef: 'destination:mill-yard' } } }
    ]) {
      feedback.render(payload);
      states.push({
        state: card.dataset.state,
        label: card.querySelector('[data-feedback-label]').textContent.trim(),
        icon: card.querySelector('[data-feedback-icon]').textContent.trim(),
        summary: card.querySelector('[data-feedback-summary]').textContent.trim(),
        reason: card.querySelector('[data-feedback-reason]').textContent.trim()
      });
    }

    feedback.render({ candidate: baseCandidate, validation: { authority: 'simulation', status: 'allowed', reasonCode: 'OK', canResolve: true } });
    const cardStyle = getComputedStyle(card);
    const surface = compositeOnBlack(parseColor(cardStyle.backgroundColor));
    const selectors = {
      label: '[data-feedback-label]',
      summary: '[data-feedback-summary]',
      reason: '[data-feedback-reason]',
      authority: '[data-feedback-authority]',
      disclosure: '.legality-feedback-details summary'
    };
    const contrastRatios = Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
      const color = parseColor(getComputedStyle(card.querySelector(selector)).color);
      return [name, contrast(color, surface)];
    }));

    const button = card.querySelector('[data-advisor-action="suggest"]');
    const buttonStyle = getComputedStyle(button);
    const buttonBackground = compositeOnBlack(parseColor(buttonStyle.backgroundColor));
    const buttonForeground = parseColor(buttonStyle.color);
    const buttonContrast = contrast(buttonForeground, buttonBackground);

    const rect = card.getBoundingClientRect();
    const buttonRects = [...card.querySelectorAll('.legality-feedback-action')].map((node) => {
      const box = node.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });

    return {
      states,
      contrastRatios,
      buttonContrast,
      geometry: {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      },
      buttonRects,
      live: card.querySelector('[role="status"]').getAttribute('aria-live')
    };
  }, candidate());

  expect(['desktop', 'tablet', 'phone-portrait', 'phone-landscape']).toContain(testInfo.project.name);
  expect(evidence.states.map((item) => item.state)).toEqual(['candidate', 'allowed', 'rejected', 'pending', 'resolved']);
  expect(new Set(evidence.states.map((item) => item.label)).size).toBe(5);
  expect(new Set(evidence.states.map((item) => item.icon)).size).toBe(5);
  for (const state of evidence.states) {
    expect(state.summary.length).toBeGreaterThan(0);
    expect(state.reason.length).toBeGreaterThan(0);
  }
  for (const ratio of Object.values(evidence.contrastRatios)) expect(ratio).toBeGreaterThanOrEqual(4.5);
  expect(evidence.buttonContrast).toBeGreaterThanOrEqual(4.5);
  expect(evidence.geometry.left).toBeGreaterThanOrEqual(0);
  expect(evidence.geometry.right).toBeLessThanOrEqual(evidence.geometry.viewportWidth + 1);
  expect(evidence.geometry.top).toBeGreaterThanOrEqual(0);
  expect(evidence.geometry.bottom).toBeLessThanOrEqual(evidence.geometry.viewportHeight + 1);
  expect(evidence.geometry.horizontalOverflow).toBe(false);
  for (const button of evidence.buttonRects) {
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
  }
  expect(evidence.live).toBe('polite');

  const summary = page.locator('#legalityFeedbackCard summary');
  await summary.focus();
  await expect(summary).toBeFocused();
  await summary.press('Enter');
  await expect(page.locator('#legalityFeedbackCard [data-feedback-meta]')).toBeVisible();
  expect(failures).toEqual([]);
});

test('cumulative presentation seam cannot become legality or resolution authority', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);

  const evidence = await page.evaluate((baseCandidate) => {
    const game = window.Game;
    const feedback = game.LegalityFeedback;
    const card = document.getElementById('legalityFeedbackCard');
    const before = game.AuthoritativeState.canonicalStringify(game.State);

    const fakeValidation = feedback.render({
      candidate: baseCandidate,
      validation: { authority: 'presentation', status: 'allowed', reasonCode: 'OK', canResolve: true }
    });
    const afterFakeValidation = game.AuthoritativeState.canonicalStringify(game.State);
    const validationHidden = card.hidden;

    const fakeResolution = feedback.render({
      candidate: baseCandidate,
      resolution: { authority: 'presentation', status: 'resolved', reasonCode: 'OK', consequence: { type: 'protagonist_location' } }
    });
    const afterFakeResolution = game.AuthoritativeState.canonicalStringify(game.State);
    const resolutionHidden = card.hidden;

    feedback.render({
      candidate: baseCandidate,
      validation: { authority: 'simulation', status: 'allowed', reasonCode: 'OK', canResolve: true }
    });
    let eventDetail = null;
    card.addEventListener('advisor-suggestion', (event) => { eventDetail = event.detail; }, { once: true });
    card.querySelector('[data-advisor-action="suggest"]').click();
    const afterAdvice = game.AuthoritativeState.canonicalStringify(game.State);

    return {
      before,
      fakeValidation,
      afterFakeValidation,
      validationHidden,
      fakeResolution,
      afterFakeResolution,
      resolutionHidden,
      afterAdvice,
      eventDetail
    };
  }, candidate());

  expect(evidence.fakeValidation).toBeNull();
  expect(evidence.validationHidden).toBe(true);
  expect(evidence.afterFakeValidation).toBe(evidence.before);
  expect(evidence.fakeResolution).toBeNull();
  expect(evidence.resolutionHidden).toBe(true);
  expect(evidence.afterFakeResolution).toBe(evidence.before);
  expect(evidence.afterAdvice).toBe(evidence.before);
  expect(evidence.eventDetail).toMatchObject({ kind: 'suggest', presentationOnly: true });
  expect(failures).toEqual([]);
});
