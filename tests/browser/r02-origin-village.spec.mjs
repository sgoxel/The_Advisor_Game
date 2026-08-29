import { test, expect } from '@playwright/test';

async function waitForOriginVillage(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.OriginVillage?.generate &&
    window.Game?.State?.world?.originVillage?.inhabited &&
    window.Game?.State?.world?.terrain?.length === 100 &&
    window.Game?.RegionTerrain?.regionSize === 100
  ));
}

function stable(value) { return JSON.stringify(value); }

test('same compatible seed reproduces equivalent inhabited origin base state', async ({ page }) => {
  await waitForOriginVillage(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.OriginVillage;
    const first = api.generate('R02-ORIGIN-ALPHA');
    const second = api.generate('R02-ORIGIN-ALPHA');
    const other = api.generate('R02-ORIGIN-BETA');
    return { first, second, other };
  });

  expect(stable(evidence.first)).toBe(stable(evidence.second));
  expect(stable(evidence.first)).not.toBe(stable(evidence.other));
  expect(evidence.first.authority).toBe('simulation');
  expect(evidence.first.region.x).toBe(0);
  expect(evidence.first.region.y).toBe(0);
  expect(evidence.first.protagonistOrigin).toMatchObject({ regionX: 0, regionY: 0, worldX: 0, worldY: 0 });
  expect(evidence.first.village.inhabited).toBe(true);
  expect(evidence.first.village.regionSize).toBe(100);
  expect(evidence.first.village.buildings.length).toBeGreaterThanOrEqual(10);
  expect(evidence.first.village.population.length).toBeGreaterThanOrEqual(12);
  expect(evidence.first.village.paths.length).toBe(evidence.first.village.buildings.length - 1);
  expect(evidence.first.surroundingTerrain.regionFingerprint.length).toBeGreaterThan(0);
});

test('origin village covers required settlement functions with stable simulation identities', async ({ page }) => {
  await waitForOriginVillage(page);
  const base = await page.evaluate(() => window.Game.OriginVillage.generate('R02-ORIGIN-ROLES'));
  const buildingRoles = new Set(base.village.buildings.map((building) => building.role));
  for (const role of ['landmark', 'lodging', 'food', 'trade', 'production', 'labor', 'guard', 'housing']) {
    expect(buildingRoles.has(role)).toBe(true);
  }

  const occupations = new Set(base.village.population.map((person) => person.occupation));
  for (const occupation of ['innkeeper', 'baker', 'trader', 'blacksmith', 'laborer', 'farmer', 'guard']) {
    expect(occupations.has(occupation)).toBe(true);
  }

  expect(new Set(base.village.buildings.map((building) => building.id)).size).toBe(base.village.buildings.length);
  expect(new Set(base.village.population.map((person) => person.id)).size).toBe(base.village.population.length);
  for (const person of base.village.population) {
    expect(person.authority).toBe('simulation');
    expect(person.regionX).toBe(0);
    expect(person.regionY).toBe(0);
    expect(base.village.buildings.some((building) => building.id === person.homeBuildingId)).toBe(true);
    expect(base.village.buildings.some((building) => building.id === person.workBuildingId)).toBe(true);
  }
});

test('R02-ORIGIN-RUNTIME deterministically avoids the housing placement dead-end', async ({ page }) => {
  await waitForOriginVillage(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.OriginVillage;
    const first = api.generate('R02-ORIGIN-RUNTIME');
    const repeated = api.generate('R02-ORIGIN-RUNTIME');
    const homes = first.village.buildings
      .filter((building) => building.type === 'home')
      .map((home) => ({
        id: home.id,
        footprint: home.footprint,
        entrance: home.entrance,
        roomCount: Array.isArray(home.rooms) ? home.rooms.length : 0
      }));
    return { first: first.village, repeated: repeated.village, homes };
  });

  expect(stable(evidence.first)).toBe(stable(evidence.repeated));
  expect(evidence.first.regionSize).toBe(100);
  expect(evidence.homes).toHaveLength(12);
  expect(evidence.homes.every((home) => home.footprint.width >= 10 && home.footprint.height >= 10)).toBe(true);
  expect(evidence.homes.every((home) => home.roomCount >= 2)).toBe(true);
  expect(evidence.homes.every((home) => (
    home.footprint.row >= 0 &&
    home.footprint.col >= 0 &&
    home.footprint.row + home.footprint.height <= 100 &&
    home.footprint.col + home.footprint.width <= 100 &&
    home.entrance.row >= 0 && home.entrance.row < 100 &&
    home.entrance.col >= 0 && home.entrance.col < 100
  ))).toBe(true);

  for (let i = 0; i < evidence.homes.length; i += 1) {
    const a = evidence.homes[i].footprint;
    for (let j = i + 1; j < evidence.homes.length; j += 1) {
      const b = evidence.homes[j].footprint;
      const separatedByTwoTiles = (
        a.row + a.height + 2 <= b.row ||
        b.row + b.height + 2 <= a.row ||
        a.col + a.width + 2 <= b.col ||
        b.col + b.width + 2 <= a.col
      );
      expect(separatedByTwoTiles, `home padding overlap between ${evidence.homes[i].id} and ${evidence.homes[j].id}`).toBe(true);
    }
  }
});

test('new campaign generation binds runtime to canonical 100x100 origin region without direct player control', async ({ page }) => {
  await waitForOriginVillage(page);
  await page.getByRole('button', { name: /Settings/i }).click();
  await page.locator('#seedInput').fill('R02-ORIGIN-RUNTIME');
  await expect(page.locator('#mapWidthInput')).toHaveValue('100');
  await expect(page.locator('#mapHeightInput')).toHaveValue('100');
  await expect(page.locator('#mapWidthInput')).toHaveAttribute('readonly', '');
  await expect(page.locator('#mapHeightInput')).toHaveAttribute('readonly', '');
  await page.locator('#applySettingsBtn').click();
  await page.waitForFunction(() => (
    window.Game.State.world.seed === 'R02-ORIGIN-RUNTIME' &&
    window.Game.State.world.originVillage?.inhabited &&
    window.Game.State.world.rows === 100 &&
    window.Game.State.world.cols === 100
  ));

  const runtime = await page.evaluate(() => ({
    region: window.Game.State.world.currentRegion,
    village: window.Game.State.world.originVillage,
    dimensions: { rows: window.Game.State.world.rows, cols: window.Game.State.world.cols },
    player: {
      row: window.Game.State.world.player.row,
      col: window.Game.State.world.player.col,
      moving: window.Game.State.world.player.moving,
      regionX: window.Game.State.world.player.regionX,
      regionY: window.Game.State.world.player.regionY,
      worldX: window.Game.State.world.player.worldX,
      worldY: window.Game.State.world.player.worldY
    },
    expected: window.Game.OriginVillage.generate('R02-ORIGIN-RUNTIME')
  }));

  expect(runtime.region.x).toBe(0);
  expect(runtime.region.y).toBe(0);
  expect(runtime.dimensions).toEqual({ rows: 100, cols: 100 });
  expect(runtime.player).toMatchObject({ moving: false, regionX: 0, regionY: 0, worldX: 0, worldY: 0, row: 50, col: 50 });
  expect(stable(runtime.village)).toBe(stable(runtime.expected.village));
});