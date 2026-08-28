import { test, expect } from '@playwright/test';

async function waitForWorld(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.terrain?.length &&
    window.Game?.AuthoritativeState?.capture &&
    window.Game?.CampaignPersistence?.loadSave
  ));
}

async function regenerate(page, seed) {
  await page.getByRole('button', { name: /Settings/i }).click();
  await page.locator('#seedInput').fill(seed);
  await page.locator('#mapWidthInput').fill('24');
  await page.locator('#mapHeightInput').fill('24');
  await page.locator('#applySettingsBtn').click();
  await page.waitForFunction((expectedSeed) => window.Game.State.world.seed === expectedSeed && window.Game.State.world.terrain?.length === 24, seed);
  return page.evaluate(() => window.Game.AuthoritativeState.canonicalStringify(window.Game.AuthoritativeState.capture(window.Game.State)));
}

for (const seed of ['SIMSOFT-001', 'R02-ROUNDTRIP-ALPHA', 'R02-ROUNDTRIP-OMEGA']) {
  test(`seed ${seed} is canonical across fresh regeneration and save-load round trip`, async ({ page }) => {
    await waitForWorld(page);
    const first = await regenerate(page, seed);
    const save = await page.evaluate(() => window.Game.CampaignPersistence.serializeSave());

    await regenerate(page, `${seed}-DISTURBANCE`);
    const loadResult = await page.evaluate((payload) => window.Game.CampaignPersistence.loadSave(payload), save);
    expect(loadResult.ok).toBe(true);
    const afterLoad = await page.evaluate(() => window.Game.AuthoritativeState.canonicalStringify(window.Game.AuthoritativeState.capture(window.Game.State)));
    expect(afterLoad).toBe(first);

    const secondFresh = await regenerate(page, seed);
    expect(secondFresh).toBe(first);
  });
}

test('malformed unsupported and tampered saves roll back without authoritative mutation', async ({ page }) => {
  await waitForWorld(page);
  await regenerate(page, 'R02-ROLLBACK-SEED');

  const results = await page.evaluate(() => {
    const persistence = window.Game.CampaignPersistence;
    const authority = window.Game.AuthoritativeState;
    const baseline = authority.canonicalStringify(authority.capture(window.Game.State));
    const valid = JSON.parse(persistence.serializeSave());
    const cases = [
      '{ definitely not json',
      { ...valid, version: valid.version + 100 },
      { ...valid, seedIdentity: 'TAMPERED-SEED' },
      { ...valid, authoritativeState: { ...valid.authoritativeState, world: { ...valid.authoritativeState.world, rows: valid.authoritativeState.world.rows + 1 } } }
    ];
    return cases.map((candidate) => {
      const result = persistence.loadSave(candidate);
      return {
        ok: result.ok,
        code: result.code,
        unchanged: authority.canonicalStringify(authority.capture(window.Game.State)) === baseline
      };
    });
  });

  for (const result of results) {
    expect(result.ok).toBe(false);
    expect(result.code).toBeTruthy();
    expect(result.unchanged).toBe(true);
  }
});

test('canonical output contains no unstable time or random authority fields', async ({ page }) => {
  await waitForWorld(page);
  await regenerate(page, 'R02-NONDETERMINISM-GUARD');
  const evidence = await page.evaluate(() => {
    const authority = window.Game.AuthoritativeState;
    const a = authority.canonicalStringify(authority.capture(window.Game.State));
    const b = authority.canonicalStringify(authority.capture(window.Game.State));
    return { a, b };
  });
  expect(evidence.a).toBe(evidence.b);
  expect(evidence.a).not.toMatch(/timestamp|Date\(|Math\.random|performance\.now/i);
});
