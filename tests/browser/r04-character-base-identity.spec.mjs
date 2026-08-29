import { test, expect } from '@playwright/test';

async function loadIdentity(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.CharacterIdentity?.generateBaseIdentity));
}

test('normal product startup exposes the Simulation-owned character identity module', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.CharacterIdentity?.generateBaseIdentity));
  const startup = await page.evaluate(() => ({
    available: Boolean(window.Game?.CharacterIdentity?.generateBaseIdentity),
    authority: window.Game?.CharacterIdentity?.authority,
    generatorVersion: window.Game?.CharacterIdentity?.generatorVersion,
    birthDateCalendar: window.Game?.CharacterIdentity?.birthDateCalendar,
    scriptLoaded: Array.from(document.scripts).some((script) => script.src.endsWith('/js/character_identity.js'))
  }));
  expect(startup.available).toBe(true);
  expect(startup.authority).toBe('simulation');
  expect(startup.generatorVersion).toBe('r04-character-base-identity-v2');
  expect(startup.birthDateCalendar).toBe('campaign-calendar-civil-year-minus-2000');
  expect(startup.scriptLoaded).toBe(true);
});

test('same SEED and stable character id reproduce identical base identity in canonical campaign-year domain', async ({ page }) => {
  await loadIdentity(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.CharacterIdentity;
    const a = api.generateBaseIdentity('IDENTITY-SEED-A', 'npc:starter:guard:01');
    const b = api.generateBaseIdentity('IDENTITY-SEED-A', 'npc:starter:guard:01');
    return {
      authority: api.authority,
      a,
      b,
      range: api.canonicalBirthYearRange,
      fingerprintA: api.fingerprint(a),
      fingerprintB: api.fingerprint(b),
      frozen: Object.isFrozen(a) && Object.isFrozen(a.baselinePersonality) && Object.isFrozen(a.birthplace)
    };
  });

  expect(evidence.authority).toBe('simulation');
  expect(evidence.b).toEqual(evidence.a);
  expect(evidence.fingerprintB).toBe(evidence.fingerprintA);
  expect(evidence.frozen).toBe(true);
  expect(evidence.a.name.length).toBeGreaterThan(3);
  expect(['female', 'male']).toContain(evidence.a.gender);
  expect(evidence.range).toEqual({ min: -44, max: 8 });
  expect(evidence.a.birthDate.year).toBeGreaterThanOrEqual(evidence.range.min);
  expect(evidence.a.birthDate.year).toBeLessThanOrEqual(evidence.range.max);
  expect(evidence.a.birthDateCalendar).toBe('campaign-calendar-civil-year-minus-2000');
  expect(26 - evidence.a.birthDate.year).toBeGreaterThanOrEqual(18);
  expect(26 - evidence.a.birthDate.year).toBeLessThanOrEqual(70);
  expect(evidence.a.baseProfession.length).toBeGreaterThan(2);
});

test('v1 identity migration translates only the birth-year epoch and preserves the deterministic person', async ({ page }) => {
  await loadIdentity(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.CharacterIdentity;
    const current = api.generateBaseIdentity('IDENTITY-SEED-MIGRATE', 'npc:legacy:01', { baseProfession: 'farmer' });
    const legacy = {
      ...current,
      schemaVersion: 1,
      generatorVersion: api.legacyGeneratorVersion,
      birthDate: {
        year: current.birthDate.year + api.legacyBirthYearOffset,
        month: current.birthDate.month,
        day: current.birthDate.day
      }
    };
    delete legacy.birthDateCalendar;

    const migrated = api.migrateBaseIdentity(legacy);
    return {
      current,
      legacy,
      migrated,
      currentFingerprint: api.fingerprint(current),
      migratedFingerprint: api.fingerprint(migrated),
      frozen: Object.isFrozen(migrated) && Object.isFrozen(migrated.birthDate)
    };
  });

  expect(evidence.legacy.generatorVersion).toBe('r04-character-base-identity-v1');
  expect(evidence.legacy.birthDate.year).toBeGreaterThanOrEqual(930);
  expect(evidence.legacy.birthDate.year).toBeLessThanOrEqual(982);
  expect(evidence.migrated.generatorVersion).toBe('r04-character-base-identity-v2');
  expect(evidence.migrated.birthDate.year).toBe(evidence.legacy.birthDate.year - 974);
  expect(evidence.migrated.birthDate.month).toBe(evidence.legacy.birthDate.month);
  expect(evidence.migrated.birthDate.day).toBe(evidence.legacy.birthDate.day);
  expect(evidence.migrated.name).toBe(evidence.legacy.name);
  expect(evidence.migrated.gender).toBe(evidence.legacy.gender);
  expect(evidence.migrated.birthplace).toEqual(evidence.legacy.birthplace);
  expect(evidence.migrated.baselinePersonality).toEqual(evidence.legacy.baselinePersonality);
  expect(evidence.migrated.baseProfession).toBe(evidence.legacy.baseProfession);
  expect(evidence.migratedFingerprint).toBe(evidence.currentFingerprint);
  expect(evidence.frozen).toBe(true);
});

test('different stable character identities remain distinct under the same SEED', async ({ page }) => {
  await loadIdentity(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.CharacterIdentity;
    const a = api.generateBaseIdentity('IDENTITY-SEED-A', 'npc:starter:01');
    const b = api.generateBaseIdentity('IDENTITY-SEED-A', 'npc:starter:02');
    return {
      worldIdentityA: a.worldIdentity,
      worldIdentityB: b.worldIdentity,
      fingerprintA: api.fingerprint(a),
      fingerprintB: api.fingerprint(b)
    };
  });

  expect(evidence.worldIdentityB).not.toBe(evidence.worldIdentityA);
  expect(evidence.fingerprintB).not.toBe(evidence.fingerprintA);
});

test('current region travel cannot reroll the deterministic base person', async ({ page }) => {
  await loadIdentity(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.CharacterIdentity;
    const base = api.generateBaseIdentity('IDENTITY-SEED-B', 'protagonist', {
      birthplace: { worldX: 0, worldY: 0, regionX: 0, regionY: 0, settlementId: 'starter-village:IDENTITY-SEED-B' },
      baseProfession: 'farmer'
    });
    const before = api.fingerprint(base);
    const travelled = api.applyCampaignDeltas(base, {
      currentLocation: { regionX: 8, regionY: -3, worldX: 844, worldY: -244 },
      currentResidence: { settlementId: 'town:8:-3' }
    });
    return {
      before,
      after: api.fingerprint(travelled.base),
      birthplace: travelled.base.birthplace,
      currentLocation: travelled.current.location,
      baseProfession: travelled.base.baseProfession,
      currentProfession: travelled.current.profession
    };
  });

  expect(evidence.after).toBe(evidence.before);
  expect(evidence.birthplace.regionX).toBe(0);
  expect(evidence.birthplace.regionY).toBe(0);
  expect(evidence.currentLocation.regionX).toBe(8);
  expect(evidence.currentLocation.regionY).toBe(-3);
  expect(evidence.currentProfession).toBe(evidence.baseProfession);
});

test('campaign resume catch-up cannot remap the deterministic birth date', async ({ page }) => {
  await loadIdentity(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.CharacterIdentity;
    const calendar = window.Game.CampaignCalendar;
    const before = api.generateBaseIdentity('IDENTITY-SEED-TIME', 'npc:stable-time:01');
    const calendarBefore = calendar.capture();
    const accepted = calendarBefore.acceptedRealTimestampMs;
    if (!Number.isFinite(accepted)) throw new Error('CampaignCalendar startup origin is required.');
    const resumed = calendar.reconcileResume(accepted + 3600000, calendarBefore.originTimezoneOffsetMinutes || 0);
    const after = api.generateBaseIdentity('IDENTITY-SEED-TIME', 'npc:stable-time:01');
    return {
      beforeFingerprint: api.fingerprint(before),
      afterFingerprint: api.fingerprint(after),
      beforeBirthDate: before.birthDate,
      afterBirthDate: after.birthDate,
      resumeOk: resumed.ok,
      advancedGameMinutes: resumed.advancedGameMinutes
    };
  });

  expect(evidence.resumeOk).toBe(true);
  expect(evidence.advancedGameMinutes).toBe(1440);
  expect(evidence.afterBirthDate).toEqual(evidence.beforeBirthDate);
  expect(evidence.afterFingerprint).toBe(evidence.beforeFingerprint);
});

test('campaign profession change stays a delta and does not rewrite base profession', async ({ page }) => {
  await loadIdentity(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.CharacterIdentity;
    const base = api.generateBaseIdentity('IDENTITY-SEED-C', 'npc:career:01', { baseProfession: 'farmer' });
    const advanced = api.applyCampaignDeltas(base, { currentProfession: 'guard' });
    const rematerialized = api.generateBaseIdentity('IDENTITY-SEED-C', 'npc:career:01', { baseProfession: 'farmer' });
    return {
      baseProfession: base.baseProfession,
      currentProfession: advanced.current.profession,
      sameBaseAfterRematerialize: api.fingerprint(rematerialized) === api.fingerprint(base),
      deltaHasBaseCopy: Object.prototype.hasOwnProperty.call(advanced.current, 'baseProfession')
    };
  });

  expect(evidence.baseProfession).toBe('farmer');
  expect(evidence.currentProfession).toBe('guard');
  expect(evidence.sameBaseAfterRematerialize).toBe(true);
  expect(evidence.deltaHasBaseCopy).toBe(false);
});

test('identity generation ignores presentation and device state', async ({ page }) => {
  await loadIdentity(page);
  const first = await page.evaluate(() => {
    const api = window.Game.CharacterIdentity;
    return api.fingerprint(api.generateBaseIdentity('IDENTITY-SEED-D', 'npc:stable:01'));
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    window.Game.State.camera.zoom = 2.75;
    window.Game.State.i18n.current = 'tr';
  });

  const second = await page.evaluate(() => {
    const api = window.Game.CharacterIdentity;
    return api.fingerprint(api.generateBaseIdentity('IDENTITY-SEED-D', 'npc:stable:01'));
  });

  expect(second).toBe(first);
});
