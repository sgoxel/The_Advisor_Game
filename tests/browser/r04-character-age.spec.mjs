import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.CharacterIdentity?.generateBaseIdentity &&
    window.Game?.CharacterAge?.derive &&
    window.Game?.CampaignCalendar?.initializeOrigin &&
    window.Game?.GameTime?.setForTest
  ));
}

async function resetToFantasyDate(page, civilTimestampMs) {
  return page.evaluate((timestamp) => {
    const time = window.Game.GameTime;
    const calendar = window.Game.CampaignCalendar;
    time.stop();
    delete window.Game.State.world.campaignCalendar;
    time.setForTest(0);
    return calendar.initializeOrigin(timestamp, 0);
  }, civilTimestampMs);
}

test('normal product startup exposes Simulation-owned derived character age', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => ({
    available: Boolean(window.Game.CharacterAge?.derive),
    authority: window.Game.CharacterAge?.authority,
    version: window.Game.CharacterAge?.version,
    calendarBasis: window.Game.CharacterAge?.birthDateCalendar,
    scriptLoaded: Array.from(document.scripts).some((script) => script.src.endsWith('/js/character_age.js'))
  }));

  expect(evidence.available).toBe(true);
  expect(evidence.authority).toBe('simulation');
  expect(evidence.version).toBe('r04-character-age-v1');
  expect(evidence.calendarBasis).toBe('campaign-calendar-civil-year-minus-2000');
  expect(evidence.scriptLoaded).toBe(true);
});

test('age is derived mechanically from stable birth date and authoritative fantasy date', async ({ page }) => {
  await ready(page);
  await resetToFantasyDate(page, Date.UTC(2026, 7, 28, 14, 30));

  const evidence = await page.evaluate(() => {
    const identity = window.Game.CharacterIdentity;
    const age = window.Game.CharacterAge;
    const calendar = window.Game.CampaignCalendar;
    const base = identity.generateBaseIdentity('AGE-SEED-A', 'npc:age:01');
    const beforeFingerprint = identity.fingerprint(base);
    const result = age.derive(base, calendar.capture());
    const expected = 26 - base.birthDate.year - (
      8 < base.birthDate.month || (8 === base.birthDate.month && 28 < base.birthDate.day) ? 1 : 0
    );
    return {
      base,
      beforeFingerprint,
      afterFingerprint: identity.fingerprint(base),
      result,
      frozen: Object.isFrozen(result) && Object.isFrozen(result.lifeStage)
    };
  });

  expect(evidence.result.ok).toBe(true);
  expect(evidence.result.ageYears).toBeGreaterThanOrEqual(18);
  expect(evidence.result.ageYears).toBeLessThanOrEqual(70);
  expect(evidence.result.ageYears).toBe(26 - evidence.base.birthDate.year - (
    8 < evidence.base.birthDate.month || (8 === evidence.base.birthDate.month && 28 < evidence.base.birthDate.day) ? 1 : 0
  ));
  expect(evidence.result.birthDate).toEqual(evidence.base.birthDate);
  expect(evidence.result.derivation).toBe('authoritative-birth-date-plus-campaign-calendar');
  expect(evidence.result.stereotypePolicy).toBe('life-stage-is-context-not-personality-authority');
  expect(evidence.afterFingerprint).toBe(evidence.beforeFingerprint);
  expect(evidence.frozen).toBe(true);
});

test('campaign chronology crossing a birthday advances derived age exactly once', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const identity = window.Game.CharacterIdentity;
    const age = window.Game.CharacterAge;
    const time = window.Game.GameTime;
    const calendar = window.Game.CampaignCalendar;
    time.stop();
    const base = identity.generateBaseIdentity('AGE-SEED-BIRTHDAY', 'npc:age:birthday');

    const birthdayCivilYear = base.birthDate.year + 2000 + 40;
    const birthday = Date.UTC(birthdayCivilYear, base.birthDate.month - 1, base.birthDate.day, 12, 0);
    const dayBefore = birthday - 86_400_000;
    delete window.Game.State.world.campaignCalendar;
    time.setForTest(0);
    calendar.initializeOrigin(dayBefore, 0);
    const before = age.derive(base, calendar.capture());
    const accepted = calendar.capture().acceptedRealTimestampMs;
    const resumed = calendar.reconcileResume(accepted + 3_600_000, 0);
    const after = age.derive(base, calendar.capture());

    return { baseAge: before.ageYears, afterAge: after.ageYears, before, after, resumed };
  });

  expect(evidence.before.ok).toBe(true);
  expect(evidence.after.ok).toBe(true);
  expect(evidence.resumed.ok).toBe(true);
  expect(evidence.resumed.advancedGameMinutes).toBe(1440);
  expect(evidence.afterAge).toBe(evidence.baseAge + 1);
});

test('bounded long catch-up derives final age without per-day replay or personality rewrite', async ({ page }) => {
  await ready(page);
  await resetToFantasyDate(page, Date.UTC(2026, 0, 15, 9, 0));

  const evidence = await page.evaluate(() => {
    const identity = window.Game.CharacterIdentity;
    const age = window.Game.CharacterAge;
    const calendar = window.Game.CampaignCalendar;
    const base = identity.generateBaseIdentity('AGE-SEED-CATCHUP', 'npc:age:catchup');
    const personalityBefore = JSON.stringify(base.baselinePersonality);
    const accepted = calendar.capture().acceptedRealTimestampMs;
    const resumed = calendar.reconcileResume(accepted + (400 * 3_600_000), 0);
    const result = age.derive(base, calendar.capture());
    const personalityAfter = JSON.stringify(base.baselinePersonality);
    const expected = age.calculateAge(base.birthDate, calendar.capture());
    return { resumed, result, expected, personalityBefore, personalityAfter };
  });

  expect(evidence.resumed.ok).toBe(true);
  expect(evidence.resumed.elapsedGameDays).toBe(400);
  expect(evidence.resumed.operations).toBe(1);
  expect(evidence.resumed.fullDetailReplayTicks).toBe(0);
  expect(evidence.resumed.materializedOffscreenRegions).toBe(0);
  expect(evidence.result.ok).toBe(true);
  expect(evidence.result.ageYears).toBe(evidence.expected.ageYears);
  expect(evidence.personalityAfter).toBe(evidence.personalityBefore);
  expect(evidence.result.baselinePersonalityFingerprint).toBe(evidence.personalityBefore);
});

test('save/load round trip plus resume catch-up recomputes age from restored chronology without drift', async ({ page }) => {
  await ready(page);
  await resetToFantasyDate(page, Date.UTC(2026, 2, 10, 10, 0));

  const evidence = await page.evaluate(() => {
    const identity = window.Game.CharacterIdentity;
    const age = window.Game.CharacterAge;
    const calendar = window.Game.CampaignCalendar;
    const time = window.Game.GameTime;
    const base = identity.generateBaseIdentity('AGE-SEED-SAVE', 'npc:age:save');
    const fingerprint = identity.fingerprint(base);
    const anchor = 1_900_000_000_000;
    const before = age.derive(base, calendar.capture());
    const serialized = calendar.serializeSaveAt(anchor);

    time.setForTest(999999);
    const loaded = calendar.loadSaveAt(serialized, anchor + (400 * 3_600_000), 0);
    const after = age.derive(base, calendar.capture());
    const expected = age.calculateAge(base.birthDate, calendar.capture());
    return {
      before,
      after,
      expected,
      loadedOk: loaded.ok,
      catchUp: loaded.resumeCatchUp,
      identityStable: identity.fingerprint(base) === fingerprint
    };
  });

  expect(evidence.loadedOk).toBe(true);
  expect(evidence.catchUp.ok).toBe(true);
  expect(evidence.catchUp.elapsedGameDays).toBe(400);
  expect(evidence.catchUp.operations).toBe(1);
  expect(evidence.after.ok).toBe(true);
  expect(evidence.after.ageYears).toBe(evidence.expected.ageYears);
  expect(evidence.after.ageYears).toBeGreaterThanOrEqual(evidence.before.ageYears);
  expect(evidence.identityStable).toBe(true);
});

test('backward or invalid real clock cannot make an established character younger', async ({ page }) => {
  await ready(page);
  await resetToFantasyDate(page, Date.UTC(2026, 5, 20, 12, 0));

  const evidence = await page.evaluate(() => {
    const identity = window.Game.CharacterIdentity;
    const age = window.Game.CharacterAge;
    const calendar = window.Game.CampaignCalendar;
    const base = identity.generateBaseIdentity('AGE-SEED-BACKWARD', 'npc:age:backward');
    const anchor = 1_920_000_000_000;
    calendar.checkpointRealTime(anchor, 0);
    const beforeCalendar = calendar.capture();
    const before = age.derive(base, beforeCalendar);
    const backward = calendar.reconcileResume(anchor - 60_000, 0);
    const invalid = calendar.reconcileResume(-1, 0);
    const afterCalendar = calendar.capture();
    const after = age.derive(base, afterCalendar);
    return { beforeCalendar, afterCalendar, before, after, backward, invalid };
  });

  expect(evidence.backward.ok).toBe(false);
  expect(evidence.backward.code).toBe('BACKWARD_REAL_CLOCK');
  expect(evidence.invalid.ok).toBe(false);
  expect(evidence.invalid.code).toBe('INVALID_REAL_TIMESTAMP');
  expect(evidence.afterCalendar.totalGameMinutes).toBe(evidence.beforeCalendar.totalGameMinutes);
  expect(evidence.after.ageYears).toBe(evidence.before.ageYears);
});

test('lazy/off-screen derivation is deterministic across presentation state and rejects pre-birth chronology', async ({ page }) => {
  await ready(page);
  const first = await page.evaluate(() => {
    const identity = window.Game.CharacterIdentity;
    const age = window.Game.CharacterAge;
    const base = identity.generateBaseIdentity('AGE-SEED-LAZY', 'npc:age:lazy');
    const snapshot = { authority: 'simulation', calendar: { year: 26, month: 8, dayOfMonth: 28, hour: 14, minute: 30 } };
    return {
      result: age.derive(base, snapshot),
      preBirth: age.calculateAge({ year: 30, month: 1, day: 1 }, snapshot),
      baseFingerprint: identity.fingerprint(base)
    };
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    window.Game.State.camera.zoom = 2.75;
    window.Game.State.i18n.current = 'tr';
  });

  const second = await page.evaluate(() => {
    const identity = window.Game.CharacterIdentity;
    const age = window.Game.CharacterAge;
    const base = identity.generateBaseIdentity('AGE-SEED-LAZY', 'npc:age:lazy');
    const snapshot = { authority: 'simulation', calendar: { year: 26, month: 8, dayOfMonth: 28, hour: 14, minute: 30 } };
    return { result: age.derive(base, snapshot), baseFingerprint: identity.fingerprint(base) };
  });

  expect(first.result.ok).toBe(true);
  expect(second.result).toEqual(first.result);
  expect(second.baseFingerprint).toBe(first.baseFingerprint);
  expect(first.preBirth.ok).toBe(false);
  expect(first.preBirth.code).toBe('CAMPAIGN_DATE_BEFORE_BIRTH');
});
