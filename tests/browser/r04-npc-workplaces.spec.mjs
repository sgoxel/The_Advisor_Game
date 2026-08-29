import { test, expect } from '@playwright/test';

async function loadWorkplaces(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.NPCWorkplaces?.assign && window.Game?.CharacterIdentity?.generateBaseIdentity));
}

function fixtureVillage() {
  return {
    regionSize: 100,
    buildings: [
      { id: 'home-a', type: 'home', role: 'housing', width: 10, height: 10, rooms: [{}, {}] },
      { id: 'smithy-a', type: 'smithy', role: 'workshop', workerCapacity: 2, width: 8, height: 8 },
      { id: 'market-a', type: 'market', role: 'trade', workerCapacity: 3, width: 10, height: 8 },
      { id: 'barracks-a', type: 'barracks', role: 'guard-post', workerCapacity: 3, width: 10, height: 8 }
    ],
    population: [
      { id: 'npc:smith:1', occupation: 'blacksmith', baseProfession: 'blacksmith', homeBuildingId: 'home-a' },
      { id: 'npc:smith:2', occupation: 'blacksmith', baseProfession: 'blacksmith', homeBuildingId: 'home-a' },
      { id: 'npc:merchant:1', occupation: 'merchant', baseProfession: 'merchant', homeBuildingId: 'home-a' },
      { id: 'npc:guard:1', occupation: 'guard', baseProfession: 'guard', homeBuildingId: 'home-a' },
      { id: 'npc:farmer:1', occupation: 'farmer', baseProfession: 'farmer', homeBuildingId: 'home-a' },
      { id: 'npc:child:1', occupation: 'child', baseProfession: 'villager', homeBuildingId: 'home-a' },
      { id: 'npc:scribe:1', occupation: 'scribe', baseProfession: 'scribe', homeBuildingId: 'home-a' }
    ]
  };
}

test('normal product startup exposes Simulation-owned workplace assignment', async ({ page }) => {
  await loadWorkplaces(page);
  const startup = await page.evaluate(() => ({
    authority: window.Game.NPCWorkplaces.authority,
    scriptLoaded: Array.from(document.scripts).some((script) => script.src.endsWith('/js/npc_workplaces.js'))
  }));
  expect(startup.authority).toBe('simulation');
  expect(startup.scriptLoaded).toBe(true);
});

test('profession compatibility and shared workplace capacity are deterministic', async ({ page }) => {
  await loadWorkplaces(page);
  const village = fixtureVillage();
  const evidence = await page.evaluate((input) => {
    const api = window.Game.NPCWorkplaces;
    const first = api.assign('WORKPLACE-SEED-A', input);
    const second = api.assign('WORKPLACE-SEED-A', input);
    return { first, second };
  }, village);

  expect(evidence.second).toEqual(evidence.first);
  expect(evidence.first.authority).toBe('simulation');
  expect(evidence.first.persistenceModel).toBe('seed+stable-character+authoritative-building-derived');

  const byId = Object.fromEntries(evidence.first.assignments.map((entry) => [entry.id, entry]));
  expect(byId['npc:smith:1'].workplaceBuildingId).toBe('smithy-a');
  expect(byId['npc:smith:2'].workplaceBuildingId).toBe('smithy-a');
  expect(new Set([byId['npc:smith:1'].capacitySlot, byId['npc:smith:2'].capacitySlot]).size).toBe(2);
  expect(evidence.first.buildingOccupancy['smithy-a']).toBe(2);
  expect(byId['npc:merchant:1'].workplaceBuildingId).toBe('market-a');
  expect(byId['npc:guard:1'].workplaceBuildingId).toBe('barracks-a');
  expect(byId['npc:smith:1'].homeBuildingId).toBe('home-a');
  expect(byId['npc:smith:1'].workplaceBuildingId).not.toBe(byId['npc:smith:1'].homeBuildingId);
});

test('outdoor and non-working roles stay explicit while incompatible indoor roles are rejected', async ({ page }) => {
  await loadWorkplaces(page);
  const village = fixtureVillage();
  const assignments = await page.evaluate((input) => window.Game.NPCWorkplaces.assign('WORKPLACE-SEED-A', input).assignments, village);
  const byId = Object.fromEntries(assignments.map((entry) => [entry.id, entry]));

  expect(byId['npc:farmer:1'].workplaceKind).toBe('outdoor-worksite-required');
  expect(byId['npc:farmer:1'].workplaceBuildingId).toBeNull();
  expect(byId['npc:child:1'].workplaceKind).toBe('non-working');
  expect(byId['npc:child:1'].workplaceBuildingId).toBeNull();
  expect(byId['npc:scribe:1'].workplaceKind).toBe('unassigned-incompatible-or-full');
  expect(byId['npc:scribe:1'].workplaceBuildingId).toBeNull();
});

test('current profession can change without rewriting deterministic base profession', async ({ page }) => {
  await loadWorkplaces(page);
  const village = fixtureVillage();
  village.population = [{
    id: 'npc:career:1',
    occupation: 'farmer',
    baseProfession: 'farmer',
    currentProfession: 'guard',
    homeBuildingId: 'home-a'
  }];
  const assignment = await page.evaluate((input) => window.Game.NPCWorkplaces.assign('WORKPLACE-SEED-B', input).assignments[0], village);
  expect(assignment.profession).toBe('guard');
  expect(assignment.baseProfession).toBe('farmer');
  expect(assignment.workplaceBuildingId).toBe('barracks-a');
});

test('capacity exhaustion never forces an incompatible or over-capacity assignment', async ({ page }) => {
  await loadWorkplaces(page);
  const village = fixtureVillage();
  village.buildings.find((building) => building.id === 'smithy-a').workerCapacity = 1;
  village.population = [
    { id: 'npc:smith:a', occupation: 'blacksmith', homeBuildingId: 'home-a' },
    { id: 'npc:smith:b', occupation: 'blacksmith', homeBuildingId: 'home-a' }
  ];
  const snapshot = await page.evaluate((input) => window.Game.NPCWorkplaces.assign('WORKPLACE-SEED-C', input), village);
  expect(snapshot.buildingOccupancy['smithy-a']).toBe(1);
  expect(snapshot.assignments.filter((entry) => entry.workplaceBuildingId === 'smithy-a')).toHaveLength(1);
  expect(snapshot.assignments.filter((entry) => entry.workplaceKind === 'unassigned-incompatible-or-full')).toHaveLength(1);
});