import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.SpatialWorld?.generateOriginVillage &&
    window.Game?.State?.world?.originVillage
  ), null, { timeout: 20_000 });
}

function tileKey(tile) {
  return `${tile.row},${tile.col}`;
}

test('seeded NPC social destinations use the distributed 100x100 village instead of the center', async ({ page }) => {
  await ready(page);

  const evidence = await page.evaluate(async () => {
    const Game = window.Game;
    const seed = 'R04-NPC-DISTRIBUTION-REGRESSION';
    const first = Game.SpatialWorld.generateOriginVillage(seed).village;
    const second = Game.SpatialWorld.generateOriginVillage(seed).village;
    const center = first.center || { row: 50, col: 50 };
    const roads = new Set(first.roadTiles.map((tile) => `${tile.row},${tile.col}`));
    const social = first.population.map((npc) => ({ ...npc.socialTile }));
    const work = first.population.map((npc) => ({ ...npc.workTile }));
    const homes = first.population.map((npc) => ({ ...npc.homeTile }));
    const zoneKeys = new Set(social.map((tile) => `${Math.floor(tile.row / 20)},${Math.floor(tile.col / 20)}`));
    const distances = social.map((tile) => Math.abs(tile.row - center.row) + Math.abs(tile.col - center.col));
    const source = await (await fetch('js/spatial_world.js')).text();
    const runtimeSource = await (await fetch('js/npc_spatial_runtime.js')).text();

    return {
      populationCount: first.population.length,
      deterministicSocial: JSON.stringify(first.population.map((npc) => npc.socialTile)) === JSON.stringify(second.population.map((npc) => npc.socialTile)),
      socialUniqueCount: new Set(social.map((tile) => `${tile.row},${tile.col}`)).size,
      socialZoneCount: zoneKeys.size,
      socialRowSpan: Math.max(...social.map((tile) => tile.row)) - Math.min(...social.map((tile) => tile.row)),
      socialColSpan: Math.max(...social.map((tile) => tile.col)) - Math.min(...social.map((tile) => tile.col)),
      farSocialCount: distances.filter((distance) => distance >= 14).length,
      maxSocialDistance: Math.max(...distances),
      allSocialOnRoads: social.every((tile) => roads.has(`${tile.row},${tile.col}`)),
      allHomeInBounds: homes.every((tile) => tile.row >= 0 && tile.row < 100 && tile.col >= 0 && tile.col < 100),
      allWorkInBounds: work.every((tile) => tile.row >= 0 && tile.row < 100 && tile.col >= 0 && tile.col < 100),
      centerBiasedSourceRemoved: !source.includes('nearestAvailableRoadTile(roads, CENTER, usedSocialTiles)'),
      seededStructuralDestinationsPresent: source.includes('social-destination-offset') && source.includes('socialDestinations'),
      dialogueCenterSortRemoved: !runtimeSource.includes('distance(a, center) - distance(b, center)'),
      dialogueParticipantContextPresent: runtimeSource.includes('preferredDialogueContext')
    };
  });

  expect(evidence.populationCount).toBeGreaterThanOrEqual(20);
  expect(evidence.deterministicSocial).toBe(true);
  expect(evidence.socialUniqueCount).toBe(evidence.populationCount);
  expect(evidence.socialZoneCount).toBeGreaterThanOrEqual(4);
  expect(evidence.socialRowSpan).toBeGreaterThanOrEqual(20);
  expect(evidence.socialColSpan).toBeGreaterThanOrEqual(20);
  expect(evidence.farSocialCount).toBeGreaterThanOrEqual(4);
  expect(evidence.maxSocialDistance).toBeGreaterThanOrEqual(20);
  expect(evidence.allSocialOnRoads).toBe(true);
  expect(evidence.allHomeInBounds).toBe(true);
  expect(evidence.allWorkInBounds).toBe(true);
  expect(evidence.centerBiasedSourceRemoved).toBe(true);
  expect(evidence.seededStructuralDestinationsPresent).toBe(true);
  expect(evidence.dialogueCenterSortRemoved).toBe(true);
  expect(evidence.dialogueParticipantContextPresent).toBe(true);
});
