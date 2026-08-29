import { test, expect } from '@playwright/test';

async function waitForProfile(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.CharacterProgressionProfile?.normalize &&
    window.Game?.State?.characterProfile?.authority === 'simulation'
  ));
}

test('new campaign exposes one authoritative Peasant-scale profile instead of legacy Ranger mission state', async ({ page }) => {
  await waitForProfile(page);

  const evidence = await page.evaluate(() => {
    const api = window.Game.CharacterProgressionProfile;
    const profile = window.Game.State.characterProfile;
    const deterministic = api.normalize(profile.seed, profile.characterId);
    return {
      profile,
      deterministic,
      localBotContext: api.toLocalBotContext(profile),
      panelName: document.querySelector('.character-name')?.textContent || '',
      panelMeta: document.querySelector('.character-meta')?.textContent || '',
      bodyText: document.body.textContent || ''
    };
  });

  expect(evidence.profile.authority).toBe('simulation');
  expect(evidence.profile.source).toBe('new-campaign-default');
  expect(evidence.profile.rank).toBe('Peasant');
  expect(evidence.profile.status).toBe('Idle');
  expect(evidence.profile.currentProfession).toBe(evidence.profile.baseProfession);
  expect(evidence.deterministic).toEqual(evidence.profile);
  expect(evidence.panelName).toBe(evidence.profile.name);
  expect(evidence.panelMeta).toContain('Rank: Peasant');
  expect(evidence.panelMeta).toContain(`Base profession: ${evidence.profile.baseProfession}`);
  expect(evidence.panelMeta).toContain(`Profession: ${evidence.profile.currentProfession}`);
  expect(evidence.panelMeta).toContain('Status: Idle');
  expect(evidence.bodyText).not.toContain('Level 7 Ranger');
  expect(evidence.bodyText).not.toContain('Ready for mission');
  expect(evidence.localBotContext).toMatchObject({
    authority: 'simulation',
    characterId: evidence.profile.characterId,
    rank: evidence.profile.rank,
    baseProfession: evidence.profile.baseProfession,
    currentProfession: evidence.profile.currentProfession,
    status: evidence.profile.status,
    activity: evidence.profile.activity
  });
});

test('explicit established campaign progression is preserved and drives the same panel/context projection', async ({ page }) => {
  await waitForProfile(page);

  const evidence = await page.evaluate(() => {
    const api = window.Game.CharacterProgressionProfile;
    const current = window.Game.State.characterProfile;
    const progressedInput = {
      ...current,
      source: 'campaign-state',
      rank: 'Knight',
      currentProfession: 'captain',
      status: 'On patrol',
      activity: 'patrol'
    };
    const progressed = api.normalize(current.seed, current.characterId, progressedInput);
    const installed = api.installCurrent(progressed, current.seed);
    return {
      progressed,
      installed,
      localBotContext: api.toLocalBotContext(installed),
      panelMeta: document.querySelector('.character-meta')?.textContent || ''
    };
  });

  expect(evidence.progressed.source).toBe('campaign-state');
  expect(evidence.installed.rank).toBe('Knight');
  expect(evidence.installed.currentProfession).toBe('captain');
  expect(evidence.installed.status).toBe('On patrol');
  expect(evidence.installed.baseProfession).toBe(evidence.progressed.baseProfession);
  expect(evidence.panelMeta).toContain('Rank: Knight');
  expect(evidence.panelMeta).toContain('Profession: captain');
  expect(evidence.panelMeta).toContain('Status: On patrol');
  expect(evidence.localBotContext.rank).toBe('Knight');
  expect(evidence.localBotContext.currentProfession).toBe('captain');
  expect(evidence.localBotContext.status).toBe('On patrol');
});

test('untrusted imported demo-shaped fields cannot become authoritative progression', async ({ page }) => {
  await waitForProfile(page);

  const evidence = await page.evaluate(() => {
    const api = window.Game.CharacterProgressionProfile;
    const seed = window.Game.State.characterProfile.seed;
    return api.normalize(seed, 'protagonist', {
      name: 'Arin Valen',
      level: 7,
      class: 'Ranger',
      status: 'Ready for mission'
    });
  });

  expect(evidence.authority).toBe('simulation');
  expect(evidence.source).toBe('new-campaign-default');
  expect(evidence.rank).toBe('Peasant');
  expect(evidence.status).toBe('Idle');
  expect(JSON.stringify(evidence)).not.toContain('Ranger');
  expect(JSON.stringify(evidence)).not.toContain('Ready for mission');
});
