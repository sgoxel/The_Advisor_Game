import { test, expect } from '@playwright/test';

const opportunities = [
  {
    id: 'bakery', goalType: 'errand', actionType: 'interact', targetRef: 'site:bakery',
    priority: 2, urgency: 10, distance: 4
  },
  {
    id: 'market', goalType: 'errand', actionType: 'interact', targetRef: 'site:market',
    priority: 2, urgency: 10, distance: 4
  }
];

async function ready(page, viewport = { width: 1280, height: 800 }) {
  await page.setViewportSize(viewport);
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.AdvisorConversationContract?.normalize &&
    window.Game?.LocalBotDriver?.select &&
    window.Game?.LocalBotDriver?.advisorChatBridge === true &&
    window.Game?.AdvisorChatUI?.authoritativeContext
  ), null, { timeout: 20_000 });
  await page.evaluate(() => {
    const world = window.Game.State.world;
    const player = world.player || {};
    world.protagonist = {
      ...(world.protagonist || {}),
      id: 'protagonist:main',
      row: Number.isFinite(Number(player.row)) ? Math.trunc(Number(player.row)) : 0,
      col: Number.isFinite(Number(player.col)) ? Math.trunc(Number(player.col)) : 0,
      adviceDispositionBias: 'receptive'
    };
    window.Game.State.advisor = {};
  });
}

async function send(page, message) {
  const input = page.locator('#advisorMessageInput');
  await input.fill(message);
  await page.locator('#advisorSendBtn').click();
}

async function snapshot(page) {
  return page.evaluate(() => window.Game.AuthoritativeState.canonicalStringify(window.Game.State));
}

test('free-text send queues non-binding advice into the next Local BOT decision exactly once', async ({ page }) => {
  await ready(page);
  const before = await snapshot(page);
  const baseline = await page.evaluate((ops) => {
    const context = window.Game.AdvisorChatUI.authoritativeContext();
    const localized = ops.map((item) => ({ ...item, locationRef: context.locationRef }));
    return window.Game.LocalBotDriver.select(context, localized).selected.id;
  }, opportunities);
  expect(baseline).toBe('bakery');

  await send(page, 'Go to the market.');

  await expect(page.locator('#advisorTranscript .advisor-turn.advisor')).toContainText('Go to the market.');
  await expect(page.locator('#advisorTranscript .advisor-turn.protagonist')).toHaveCount(1);
  await expect(page.locator('#advisorTranscript .advisor-turn.influence')).toContainText('Reinterpreted');
  await expect(page.locator('#advisorStatus')).toContainText('queued for the next autonomous Local BOT decision');

  const queued = await page.evaluate(() => ({
    pending: window.Game.State.advisor?.pending,
    disposition: window.Game.State.advisor?.latestInfluence?.disposition,
    evaluation: window.Game.State.advisor?.localBotEvaluation,
    bridge: window.Game.LocalBotDriver?.advisorChatBridge
  }));
  expect(queued.bridge).toBe(true);
  expect(queued.pending).toBe(true);
  expect(queued.disposition).toBe('reinterpreted');
  expect(queued.evaluation).toMatchObject({
    status: 'ready',
    reasonCode: 'OK',
    directActionAuthority: false,
    directMovementAuthority: false,
    directLegalityAuthority: false,
    directResolutionAuthority: false
  });

  const decision = await page.evaluate((ops) => {
    const context = window.Game.AdvisorChatUI.authoritativeContext();
    const localized = ops.map((item) => ({ ...item, locationRef: context.locationRef }));
    const influenced = window.Game.LocalBotDriver.select(context, localized);
    const afterFirst = {
      selected: influenced.selected?.id,
      advisory: influenced.advisory,
      pending: window.Game.State.advisor?.pending,
      consumed: window.Game.State.advisor?.consumedTranscriptRevision
    };
    const next = window.Game.LocalBotDriver.select(context, localized);
    return { afterFirst, nextSelected: next.selected?.id, nextHasAdvisory: Object.hasOwn(next, 'advisory') };
  }, opportunities);

  expect(decision.afterFirst.selected).toBe('market');
  expect(decision.afterFirst.advisory).toMatchObject({
    status: 'ready', disposition: 'reinterpreted', applied: true,
    directActionAuthority: false, directMovementAuthority: false,
    directLegalityAuthority: false, directResolutionAuthority: false
  });
  expect(decision.afterFirst.pending).toBe(false);
  expect(decision.afterFirst.consumed).toBeGreaterThan(0);
  expect(decision.nextSelected).toBe('bakery');
  expect(decision.nextHasAdvisory).toBe(false);
  expect(await snapshot(page)).toBe(before);
});

test('rejected advice is not queued and delayed advice waits for later campaign time', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => { window.Game.State.world.protagonist.adviceDispositionBias = 'skeptical'; });
  await send(page, 'I suggest you consider the market.');
  const rejected = await page.evaluate(() => ({
    disposition: window.Game.State.advisor?.latestInfluence?.disposition,
    pending: window.Game.State.advisor?.pending,
    reasonCode: window.Game.State.advisor?.localBotEvaluation?.reasonCode
  }));
  expect(rejected).toEqual({ disposition: 'rejected', pending: false, reasonCode: 'REJECTED_BY_CHARACTER' });

  await page.evaluate(() => { window.Game.State.world.protagonist.adviceDispositionBias = 'neutral'; });
  await send(page, 'Perhaps consider the market later.');
  const delayed = await page.evaluate((ops) => {
    const base = window.Game.AdvisorChatUI.authoritativeContext();
    const localized = ops.map((item) => ({ ...item, locationRef: base.locationRef }));
    const now = window.Game.LocalBotDriver.select(base, localized);
    const stillPending = window.Game.State.advisor?.pending;
    const laterContext = { ...base, campaignMinute: base.campaignMinute + 1 };
    const later = window.Game.LocalBotDriver.select(laterContext, localized);
    return {
      disposition: window.Game.State.advisor?.latestInfluence?.disposition,
      now: now.selected?.id,
      stillPending,
      later: later.selected?.id,
      finalPending: window.Game.State.advisor?.pending
    };
  }, opportunities);
  expect(delayed.disposition).toBe('delayed');
  expect(delayed.now).toBe('bakery');
  expect(delayed.stillPending).toBe(true);
  expect(delayed.later).toBe('market');
  expect(delayed.finalPending).toBe(false);
});

test('empty input, Enter send, Shift+Enter newline and unavailable contract fail safely', async ({ page }) => {
  await ready(page);
  const before = await snapshot(page);
  const input = page.locator('#advisorMessageInput');

  await input.fill('');
  await input.press('Enter');
  await expect(page.locator('#advisorStatus')).toContainText('Write a message before sending.');
  expect(await snapshot(page)).toBe(before);

  await input.fill('First line');
  await input.press('Shift+Enter');
  await input.type('Second line');
  await expect(input).toHaveValue('First line\nSecond line');

  await input.fill('Go to the market.');
  await input.press('Enter');
  await expect(page.locator('#advisorTranscript .advisor-turn.advisor')).toContainText('Go to the market.');

  await page.evaluate(() => {
    window.__advisorContract = window.Game.AdvisorConversationContract;
    window.Game.AdvisorConversationContract = null;
  });
  await input.fill('This must not mutate anything.');
  const unavailableBefore = await snapshot(page);
  await page.locator('#advisorSendBtn').click();
  await expect(page.locator('#advisorStatus')).toContainText('conversation contract is unavailable');
  expect(await snapshot(page)).toBe(unavailableBefore);
  await page.evaluate(() => { window.Game.AdvisorConversationContract = window.__advisorContract; delete window.__advisorContract; });
});

for (const viewport of [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'phone', width: 390, height: 844 }
]) {
  test(`Advisor chat remains readable and accessible on ${viewport.name}`, async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await ready(page, viewport);

    const evidence = await page.evaluate(() => {
      const transcript = document.querySelector('#advisorTranscript');
      const input = document.querySelector('#advisorMessageInput');
      const button = document.querySelector('#advisorSendBtn');
      const status = document.querySelector('#advisorStatus');
      const box = transcript.getBoundingClientRect();
      const inputBox = input.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      return {
        transcriptRole: transcript.getAttribute('role'),
        transcriptLive: transcript.getAttribute('aria-live'),
        statusRole: status.getAttribute('role'),
        describedBy: input.getAttribute('aria-describedby'),
        transcriptOverflow: transcript.scrollWidth - transcript.clientWidth,
        transcriptVisible: box.width > 0 && box.height > 0,
        inputVisible: inputBox.width > 0 && inputBox.height > 0,
        buttonVisible: buttonBox.width > 0 && buttonBox.height > 0,
        buttonWidth: buttonBox.width,
        buttonHeight: buttonBox.height,
        bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });

    expect(evidence.transcriptRole).toBe('log');
    expect(evidence.transcriptLive).toBe('polite');
    expect(evidence.statusRole).toBe('status');
    expect(evidence.describedBy).toContain('advisorChatHint');
    expect(evidence.describedBy).toContain('advisorStatus');
    expect(evidence.transcriptOverflow).toBeLessThanOrEqual(1);
    expect(evidence.bodyOverflow).toBeLessThanOrEqual(1);
    expect(evidence.transcriptVisible).toBe(true);
    expect(evidence.inputVisible).toBe(true);
    expect(evidence.buttonVisible).toBe(true);
    expect(evidence.buttonWidth).toBeGreaterThanOrEqual(44);
    expect(evidence.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}
