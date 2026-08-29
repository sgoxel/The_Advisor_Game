import { test, expect } from '@playwright/test';

async function waitForProfile(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.CharacterProgressionProfile?.normalize &&
    window.Game?.CharacterProfilePersistence?.adapter &&
    window.Game?.CampaignPersistence === window.Game?.CharacterProfilePersistence?.adapter &&
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

test('progressed authoritative profile survives the real campaign save/load round trip', async ({ page }) => {
  await waitForProfile(page);
  await page.waitForFunction(() => Boolean(window.Game?.State?.world?.terrain?.length));

  const evidence = await page.evaluate(() => {
    const api = window.Game.CharacterProgressionProfile;
    const persistence = window.Game.CampaignPersistence;
    const current = window.Game.State.characterProfile;
    const progressed = api.normalize(current.seed, current.characterId, {
      ...current,
      rank: 'Knight',
      currentProfession: 'captain',
      status: 'On patrol',
      activity: 'patrol'
    });
    api.installCurrent(progressed, current.seed);
    const serialized = persistence.serializeSave();
    const envelope = JSON.parse(serialized);

    api.installCurrent(null, current.seed);
    const beforeLoad = window.Game.State.characterProfile;
    const loaded = persistence.loadSave(serialized);
    const afterLoad = window.Game.State.characterProfile;

    return {
      savedProfile: envelope.characterProfile,
      beforeLoad,
      loaded,
      afterLoad,
      panelMeta: document.querySelector('.character-meta')?.textContent || '',
      localBotContext: api.toLocalBotContext(afterLoad)
    };
  });

  expect(evidence.savedProfile.rank).toBe('Knight');
  expect(evidence.savedProfile.currentProfession).toBe('captain');
  expect(evidence.beforeLoad.rank).toBe('Peasant');
  expect(evidence.loaded.ok).toBe(true);
  expect(evidence.loaded.profileMigratedFromLegacy).toBe(false);
  expect(evidence.afterLoad.rank).toBe('Knight');
  expect(evidence.afterLoad.currentProfession).toBe('captain');
  expect(evidence.afterLoad.status).toBe('On patrol');
  expect(evidence.panelMeta).toContain('Rank: Knight');
  expect(evidence.localBotContext.rank).toBe('Knight');
  expect(evidence.localBotContext.status).toBe('On patrol');
});

test('legacy v1 save without authoritative profile migrates to deterministic Peasant default', async ({ page }) => {
  await waitForProfile(page);
  await page.waitForFunction(() => Boolean(window.Game?.State?.world?.terrain?.length));

  const evidence = await page.evaluate(() => {
    const api = window.Game.CharacterProgressionProfile;
    const extension = window.Game.CharacterProfilePersistence;
    const seed = window.Game.State.characterProfile.seed;
    const legacyText = extension.core.serializeSave();
    const legacyEnvelope = JSON.parse(legacyText);

    const progressed = api.normalize(seed, 'protagonist', {
      ...window.Game.State.characterProfile,
      rank: 'Knight',
      currentProfession: 'captain',
      status: 'On patrol',
      activity: 'patrol'
    });
    api.installCurrent(progressed, seed);
    const loaded = window.Game.CampaignPersistence.loadSave(legacyText);
    return {
      legacyHasProfile: Object.prototype.hasOwnProperty.call(legacyEnvelope, 'characterProfile'),
      loaded,
      profile: window.Game.State.characterProfile
    };
  });

  expect(evidence.legacyHasProfile).toBe(false);
  expect(evidence.loaded.ok).toBe(true);
  expect(evidence.loaded.profileMigratedFromLegacy).toBe(true);
  expect(evidence.profile.source).toBe('new-campaign-default');
  expect(evidence.profile.rank).toBe('Peasant');
  expect(evidence.profile.status).toBe('Idle');
});

test('tampered or mismatched persisted profile is rejected before campaign mutation', async ({ page }) => {
  await waitForProfile(page);
  await page.waitForFunction(() => Boolean(window.Game?.State?.world?.terrain?.length));

  const evidence = await page.evaluate(() => {
    const persistence = window.Game.CampaignPersistence;
    const beforeSeed = window.Game.State.world.seed;
    const beforeProfile = window.Game.State.characterProfile;
    const envelope = persistence.createSaveEnvelope();
    const tampered = JSON.stringify({
      ...envelope,
      characterProfile: { ...envelope.characterProfile, seed: `${envelope.seedIdentity}-tampered`, rank: 'Emperor' }
    });
    const checked = persistence.validateSave(tampered);
    const loaded = persistence.loadSave(tampered);
    return {
      checked,
      loaded,
      beforeSeed,
      afterSeed: window.Game.State.world.seed,
      beforeProfile,
      afterProfile: window.Game.State.characterProfile
    };
  });

  expect(evidence.checked.ok).toBe(false);
  expect(evidence.checked.code).toBe('INVALID_CHARACTER_PROFILE');
  expect(evidence.loaded.ok).toBe(false);
  expect(evidence.afterSeed).toBe(evidence.beforeSeed);
  expect(evidence.afterProfile).toEqual(evidence.beforeProfile);
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
