import { test, expect } from '@playwright/test';

async function waitForPoliticalGeography(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.PoliticalGeography?.baseRegion &&
    window.Game?.WorldComposition?.composeRegion &&
    window.Game?.RegionTerrain?.generateRegion
  ));
}

test('base political geography is deterministic, Simulation-owned and visit-order independent', async ({ page }) => {
  await waitForPoliticalGeography(page);
  const evidence = await page.evaluate(() => {
    const p = window.Game.PoliticalGeography;
    const seed = 'political-foundation-seed';
    const first = p.baseRegion(seed, 17, -9);
    p.baseRegion(seed, -300, 401);
    p.neighborhood(seed, 0, 0, 1);
    const second = p.baseRegion(seed, 17, -9);
    return { first, second };
  });

  expect(evidence.first).toEqual(evidence.second);
  expect(evidence.first.authority).toBe('simulation');
  expect(evidence.first.base).toBe(true);
  expect(evidence.first.realm.id).toMatch(/^realm:[0-9a-f]{8}$/);
  expect(evidence.first.province.id).toMatch(/^region-polity:[0-9a-f]{8}$/);
  expect(evidence.first.presentationAuthority).toBe(false);
  expect(evidence.first.geographyContext.compositionFingerprint).toBeTruthy();
});

test('adjacent regions expose reciprocal unchanged base-border relationships', async ({ page }) => {
  await waitForPoliticalGeography(page);
  const evidence = await page.evaluate(() => {
    const p = window.Game.PoliticalGeography;
    const seed = 'reciprocal-border-seed';
    const west = p.baseRegion(seed, 7, 4);
    const east = p.baseRegion(seed, 8, 4);
    return { west: west.borders.east, east: east.borders.west, westRealm: west.realm.id, eastRealm: east.realm.id };
  });

  expect(evidence.west.id).toBe(evidence.east.id);
  expect(evidence.west.edgeKey).toBe(evidence.east.edgeKey);
  expect(evidence.west.realmId).toBe(evidence.westRealm);
  expect(evidence.west.neighborRealmId).toBe(evidence.eastRealm);
  expect(evidence.east.realmId).toBe(evidence.eastRealm);
  expect(evidence.east.neighborRealmId).toBe(evidence.westRealm);
  expect(evidence.west.realmBoundary).toBe(evidence.east.realmBoundary);
  expect(evidence.west.physicalConstraint).toBe(evidence.east.physicalConstraint);
});

test('realm selection and borders carry physical geography context instead of disconnected presentation labels', async ({ page }) => {
  await waitForPoliticalGeography(page);
  const samples = await page.evaluate(() => {
    const p = window.Game.PoliticalGeography;
    return [[0, 0], [1, 0], [11, 3], [12, 3], [-9, 14]].map(([x, y]) => p.baseRegion('terrain-politics-seed', x, y));
  });

  for (const region of samples) {
    expect(region.realm.terrainIdentity).toMatch(/^[0-9a-f]{8}$/);
    expect(Array.isArray(region.geographyContext.environmentFeatures)).toBe(true);
    expect(region.geographyContext.connectionKey).toMatch(/^[01]{4}$/);
    for (const border of Object.values(region.borders)) {
      expect(['open-terrain', 'water-frontier', 'mountain-frontier', 'route-corridor']).toContain(border.physicalConstraint);
      expect(['low', 'medium', 'high']).toContain(border.permeability);
      expect(border.mutableCampaignOverrideAllowed).toBe(true);
    }
  }
});

test('settlement affiliation uses the same deterministic base hierarchy when a settlement exists', async ({ page }) => {
  await waitForPoliticalGeography(page);
  const evidence = await page.evaluate(() => {
    const p = window.Game.PoliticalGeography;
    const base = p.baseRegion('settlement-affiliation-seed', 0, 0);
    return base;
  });

  expect(evidence.settlementAffiliation).not.toBeNull();
  expect(evidence.settlementAffiliation.base).toBe(true);
  expect(evidence.settlementAffiliation.realmId).toBe(evidence.realm.id);
  expect(evidence.settlementAffiliation.provinceId).toBe(evidence.province.id);
});

test('campaign political overrides preserve immutable SEED base identity', async ({ page }) => {
  await waitForPoliticalGeography(page);
  const evidence = await page.evaluate(() => {
    const p = window.Game.PoliticalGeography;
    const base = p.baseRegion('mutable-history-seed', 0, 0);
    const before = JSON.stringify(base);
    const current = p.resolveCurrent(base, {
      realmId: 'realm:campaign-winner',
      provinceId: 'region-polity:campaign-admin',
      settlementRealmId: 'realm:campaign-winner',
      borderOverrides: { east: { status: 'contested' } }
    });
    return { base, before, after: JSON.stringify(base), current };
  });

  expect(evidence.before).toBe(evidence.after);
  expect(evidence.current.basePreserved).toBe(true);
  expect(evidence.current.sourceBase.realmId).toBe(evidence.base.realm.id);
  expect(evidence.current.current.realmId).toBe('realm:campaign-winner');
  expect(evidence.current.current.provinceId).toBe('region-polity:campaign-admin');
  expect(evidence.current.current.borderOverrides.east.status).toBe('contested');
  expect(evidence.current.presentationAuthority).toBe(false);
});

test('political-geography API exposes no protagonist or NPC control surface', async ({ page }) => {
  await waitForPoliticalGeography(page);
  const evidence = await page.evaluate(() => {
    const p = window.Game.PoliticalGeography;
    return {
      authority: p.authority,
      hasDirectControl: ['movePlayer', 'moveNpc', 'commandNpc', 'controlNpc', 'teleport', 'setPlayerPosition']
        .some((name) => typeof p[name] === 'function')
    };
  });
  expect(evidence.authority).toBe('simulation');
  expect(evidence.hasDirectControl).toBe(false);
});
