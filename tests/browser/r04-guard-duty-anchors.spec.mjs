import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.GuardDutyAnchors?.derive));
}

function fixture() {
  const size = 12;
  const terrain = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => ({
    type: 'grass', water: false, blocked: false, obstacle: false, solid: false, row, col
  })));
  const roadTiles = [];
  for (let col = 1; col <= 10; col += 1) roadTiles.push({ row: 6, col });
  for (let row = 1; row <= 10; row += 1) roadTiles.push({ row, col: 6 });
  const village = {
    regionSize: size,
    center: { row: 6, col: 6 },
    roadTiles,
    buildings: [
      { id: 'guard-post:1', type: 'guard_post', role: 'guard', footprint: { row: 3, col: 3, width: 2, height: 2 }, entrance: { row: 4, col: 5 } },
      { id: 'home:1', type: 'home', role: 'housing', footprint: { row: 8, col: 8, width: 2, height: 2 }, entrance: { row: 8, col: 7 } }
    ]
  };
  return { terrain, village };
}

test('guard anchors are deterministic, distinct and adjacent to settlement entrance roads', async ({ page }) => {
  await ready(page);
  const input = fixture();
  const result = await page.evaluate(({ terrain, village }) => {
    const first = Game.GuardDutyAnchors.derive('guard-seed', village, terrain);
    const second = Game.GuardDutyAnchors.derive('guard-seed', JSON.parse(JSON.stringify(village)), JSON.parse(JSON.stringify(terrain)));
    return { first, second };
  }, input);

  expect(result.second).toEqual(result.first);
  expect(result.first.authority).toBe('simulation');
  expect(result.first.workplaceBuildingId).toBe('guard-post:1');
  expect(result.first.anchors.length).toBeGreaterThanOrEqual(4);
  expect(new Set(result.first.anchors.map((anchor) => `${anchor.row},${anchor.col}`)).size).toBe(result.first.anchors.length);
  expect(new Set(result.first.anchors.map((anchor) => anchor.side))).toEqual(new Set(['north', 'east', 'south', 'west']));

  const roads = new Set(input.village.roadTiles.map((point) => `${point.row},${point.col}`));
  for (const anchor of result.first.anchors) {
    expect(anchor).toMatchObject({ authority: 'simulation', status: 'available', workplaceBuildingId: 'guard-post:1' });
    expect(roads.has(`${anchor.row},${anchor.col}`)).toBe(false);
    expect(roads.has(`${anchor.entranceRoadTile.row},${anchor.entranceRoadTile.col}`)).toBe(true);
    const distance = Math.abs(anchor.row - anchor.entranceRoadTile.row) + Math.abs(anchor.col - anchor.entranceRoadTile.col);
    expect(distance).toBe(1);
  }
});

test('guard anchors reject solid building cells and water while leaving the road passage open', async ({ page }) => {
  await ready(page);
  const input = fixture();
  input.terrain[5][1] = { type: 'lake', water: true, row: 5, col: 1 };
  const result = await page.evaluate(({ terrain, village }) => Game.GuardDutyAnchors.derive('guard-seed', village, terrain), input);
  const roadKeys = new Set(input.village.roadTiles.map((point) => `${point.row},${point.col}`));
  const buildingKeys = new Set(['3,3','3,4','4,3','4,4','8,8','8,9','9,8','9,9']);
  for (const anchor of result.anchors) {
    expect(roadKeys.has(`${anchor.row},${anchor.col}`)).toBe(false);
    expect(buildingKeys.has(`${anchor.row},${anchor.col}`)).toBe(false);
    expect(input.terrain[anchor.row][anchor.col].water).toBeFalsy();
  }
  expect(result.anchors.every((anchor) => roadKeys.has(`${anchor.entranceRoadTile.row},${anchor.entranceRoadTile.col}`))).toBe(true);
});

test('missing guard building does not invent disconnected workplace identity', async ({ page }) => {
  await ready(page);
  const input = fixture();
  input.village.buildings = input.village.buildings.filter((building) => building.role !== 'guard');
  const result = await page.evaluate(({ terrain, village }) => Game.GuardDutyAnchors.derive('guard-seed', village, terrain), input);
  expect(result.workplaceBuildingId).toBeNull();
  expect(result.anchors.length).toBeGreaterThan(0);
  expect(result.anchors.every((anchor) => anchor.workplaceBuildingId === null)).toBe(true);
});
