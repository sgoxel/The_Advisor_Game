import { test, expect } from '@playwright/test';

function syntheticFixture() {
  const terrain = Array.from({ length: 12 }, (_, row) => Array.from({ length: 12 }, (_, col) => ({
    type: 'grass', water: false, blocked: false, obstacle: false, solid: false, row, col
  })));
  for (let row = 1; row <= 4; row += 1) {
    for (let col = 7; col <= 10; col += 1) terrain[row][col] = { type: 'forest', water: false, row, col };
  }
  for (let row = 7; row <= 10; row += 1) {
    terrain[row][10] = { type: 'lake', water: true, row, col: 10 };
  }
  terrain[5][5] = { type: 'mountain', water: false, row: 5, col: 5 };

  const village = {
    center: { row: 6, col: 6 },
    buildings: [
      { id: 'farmstead:1', type: 'farmstead', role: 'agriculture', row: 7, col: 2, width: 2, height: 2 },
      { id: 'home:1', type: 'home', role: 'housing', row: 5, col: 5, width: 1, height: 1 }
    ],
    population: [
      { id: 'farmer:a', occupation: 'farmer' },
      { id: 'hunter:a', occupation: 'hunter' },
      { id: 'fisher:a', occupation: 'fisher' },
      { id: 'smith:a', occupation: 'blacksmith' }
    ]
  };
  return { terrain, village };
}

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.OutdoorWorksites?.derive));
}

test('outdoor professions receive deterministic terrain-compatible worksite anchors', async ({ page }) => {
  await ready(page);
  const fixture = syntheticFixture();
  const result = await page.evaluate(({ terrain, village }) => {
    const one = Game.OutdoorWorksites.derive('worksite-seed', village, terrain, village.population);
    const two = Game.OutdoorWorksites.derive('worksite-seed', village, terrain, village.population);
    return { one, two };
  }, fixture);

  expect(result.one).toEqual(result.two);
  expect(result.one.authority).toBe('simulation');
  expect(result.one.persistenceModel).toContain('seed+stable-character');
  expect(result.one.assignments.map((entry) => entry.id).sort()).toEqual(['farmer:a', 'fisher:a', 'hunter:a']);

  const farmer = result.one.assignments.find((entry) => entry.id === 'farmer:a');
  const hunter = result.one.assignments.find((entry) => entry.id === 'hunter:a');
  const fisher = result.one.assignments.find((entry) => entry.id === 'fisher:a');

  expect(farmer).toMatchObject({ authority: 'simulation', profession: 'farmer', worksiteKind: 'field', status: 'assigned' });
  expect(['grass', 'dirt', 'field', 'road']).toContain(farmer.terrainType);
  expect(`${farmer.row},${farmer.col}`).not.toBe('5,5');

  expect(hunter).toMatchObject({ profession: 'hunter', worksiteKind: 'forest-edge', status: 'assigned' });
  expect(hunter.terrainType).not.toBe('forest');

  expect(fisher).toMatchObject({ profession: 'fisher', worksiteKind: 'shoreline', status: 'assigned' });
  expect(fisher.terrainType).not.toBe('lake');
  const waterNeighbors = [[fisher.row - 1, fisher.col], [fisher.row + 1, fisher.col], [fisher.row, fisher.col - 1], [fisher.row, fisher.col + 1]];
  expect(waterNeighbors.some(([row, col]) => fixture.terrain[row]?.[col]?.water)).toBe(true);
});

test('building footprints and impossible terrain are rejected without inventing indoor workplaces', async ({ page }) => {
  await ready(page);
  const fixture = syntheticFixture();
  const result = await page.evaluate(({ terrain, village }) =>
    Game.OutdoorWorksites.derive('worksite-seed', village, terrain, village.population), fixture);

  for (const entry of result.assignments) {
    expect(entry.workplaceBuildingId).toBeUndefined();
    expect(Number.isInteger(entry.row)).toBe(true);
    expect(Number.isInteger(entry.col)).toBe(true);
    const tile = fixture.terrain[entry.row][entry.col];
    expect(tile.water).toBeFalsy();
    expect(tile.type).not.toBe('mountain');
    expect(`${entry.row},${entry.col}`).not.toBe('5,5');
  }
});

test('same compatible seed/state reconstructs equivalent shared worksite identity', async ({ page }) => {
  await ready(page);
  const fixture = syntheticFixture();
  fixture.village.population = Array.from({ length: 4 }, (_, index) => ({ id: `farmer:${index}`, occupation: 'farmer' }));
  const result = await page.evaluate(({ terrain, village }) => {
    const first = Game.OutdoorWorksites.derive('shared-seed', village, terrain, village.population);
    const rebuilt = Game.OutdoorWorksites.derive('shared-seed', JSON.parse(JSON.stringify(village)), JSON.parse(JSON.stringify(terrain)), JSON.parse(JSON.stringify(village.population)));
    return { first, rebuilt };
  }, fixture);
  expect(result.rebuilt).toEqual(result.first);
  expect(result.first.assignments.every((entry) => entry.sharedCapacity === 3 && entry.capacitySlot >= 0)).toBe(true);
});

test('outdoor workers commute through authoritative worksite anchors instead of fake home workplaces', async ({ page }) => {
  test.setTimeout(60_000);
  await ready(page);
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCSpatial?.ensureSpatialNpcs &&
    window.Game?.NPCTerrainRouting?.refreshRoutes &&
    window.Game?.State?.world?.originVillage &&
    window.Game?.State?.world?.terrain?.length
  ));

  const result = await page.evaluate(() => {
    const world = Game.State.world;
    Game.NPCSpatial.ensureSpatialNpcs();
    Game.NPCTerrainRouting.refreshRoutes();
    const binding = world.npcRuntime?.originBinding || { rowOffset: 0, colOffset: 0 };
    const local = (point) => ({
      row: Number.isFinite(Number(point?.localRow)) ? Number(point.localRow) : Number(point?.row) - Number(binding.rowOffset || 0),
      col: Number.isFinite(Number(point?.localCol)) ? Number(point.localCol) : Number(point?.col) - Number(binding.colOffset || 0)
    });
    const contains = (building, point) => {
      const fp = building?.footprint || building;
      return point.row >= Number(fp?.row) && point.row < Number(fp?.row) + Number(fp?.height || building?.height || 1) &&
        point.col >= Number(fp?.col) && point.col < Number(fp?.col) + Number(fp?.width || building?.width || 1);
    };
    const routeInfo = (route) => (route || []).map(local);
    const records = world.npcOutdoorWorksiteRouting?.records || [];
    const samples = records.filter((entry) => entry.resolved).map((entry) => {
      const npc = world.npcs.find((candidate) => String(candidate.id) === String(entry.npcId));
      const work = local(npc?.anchors?.work);
      const home = local(npc?.anchors?.home);
      const homeToWork = routeInfo(npc?.spatialRoutes?.homeToWork);
      const workToSocial = routeInfo(npc?.spatialRoutes?.workToSocial);
      return {
        id: entry.npcId,
        occupation: npc?.occupation,
        worksiteId: npc?.anchors?.work?.worksiteId || null,
        worksiteKind: npc?.anchors?.work?.worksiteKind || null,
        buildingId: npc?.anchors?.work?.buildingId ?? null,
        outdoor: npc?.anchors?.work?.outdoor === true,
        work,
        home,
        insideBuilding: (world.originVillage.buildings || []).some((building) => contains(building, work)),
        homeToWork,
        workToSocial,
        homeToWorkWalkable: homeToWork.every((point, index) => {
          const tile = world.terrain?.[point.row]?.[point.col];
          const contiguous = index === 0 || Math.abs(point.row - homeToWork[index - 1].row) + Math.abs(point.col - homeToWork[index - 1].col) === 1;
          return Boolean(tile && Game.TerrainRouting.isWalkableTile(tile) && contiguous);
        }),
        workToSocialWalkable: workToSocial.every((point, index) => {
          const tile = world.terrain?.[point.row]?.[point.col];
          const contiguous = index === 0 || Math.abs(point.row - workToSocial[index - 1].row) + Math.abs(point.col - workToSocial[index - 1].col) === 1;
          return Boolean(tile && Game.TerrainRouting.isWalkableTile(tile) && contiguous);
        })
      };
    });
    return {
      routing: world.npcTerrainRouting,
      integration: world.npcOutdoorWorksiteRouting,
      samples
    };
  });

  expect(result.integration?.authority).toBe('simulation');
  expect(result.integration?.assignedCount).toBeGreaterThan(0);
  expect(result.routing?.outdoorWorksitesIntegrated).toBe(true);
  expect(result.routing?.outdoorWorksiteNpcCount).toBe(result.integration.assignedCount);
  expect(result.samples.length).toBeGreaterThan(0);

  for (const sample of result.samples) {
    expect(sample.worksiteId).toMatch(/^worksite:/);
    expect(sample.worksiteKind).toBeTruthy();
    expect(sample.buildingId).toBeNull();
    expect(sample.outdoor).toBe(true);
    expect(sample.insideBuilding).toBe(false);
    expect(sample.work).not.toEqual(sample.home);
    expect(sample.homeToWork.length).toBeGreaterThan(1);
    expect(sample.workToSocial.length).toBeGreaterThan(1);
    expect(sample.homeToWork[0]).toEqual(sample.home);
    expect(sample.homeToWork.at(-1)).toEqual(sample.work);
    expect(sample.workToSocial[0]).toEqual(sample.work);
    expect(sample.homeToWorkWalkable).toBe(true);
    expect(sample.workToSocialWalkable).toBe(true);
  }
});
