import { test, expect } from '@playwright/test';

async function loadIdentity(page) {
  await page.goto('./');
  await page.addScriptTag({ url: './js/character_identity.js' });
  await page.waitForFunction(() => Boolean(window.Game?.CharacterIdentity?.generateBaseIdentity));
}

test('same SEED and stable character id reproduce identical base identity', async ({ page }) => {
  await loadIdentity(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.CharacterIdentity;
    const a = api.generateBaseIdentity('IDENTITY-SEED-A', 'npc:starter:guard:01');
    const b = api.generateBaseIdentity('IDENTITY-SEED-A', 'npc:starter:guard:01');
    return {
      authority: api.authority,
      a,
      b,
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
  expect(evidence.a.birthDate.year).toBeGreaterThan(900);
  expect(evidence.a.baseProfession.length).toBeGreaterThan(2);
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
