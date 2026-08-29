import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.StarterVillageExteriors?.drawPresentation &&
    window.Game?.StarterVillageExteriors?.snapshotPresentationPlan &&
    Array.isArray(window.Game?.State?.world?.originVillage?.buildings) &&
    window.Game.State.world.originVillage.buildings.length >= 20
  ), null, { timeout: 20_000 });
}

function entranceTouchesFootprint(building) {
  const f = building.footprint;
  const e = building.entrance;
  const rowInside = e.row >= f.row && e.row < f.row + f.height;
  const colInside = e.col >= f.col && e.col < f.col + f.width;
  return (rowInside && (e.col === f.col - 1 || e.col === f.col + f.width)) ||
    (colInside && (e.row === f.row - 1 || e.row === f.row + f.height));
}

test('authoritative starter village renders readable non-mutating building silhouettes', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const village = window.Game.State.world.originVillage;
    const authoritativeBefore = JSON.stringify(village.buildings);
    const descriptorBefore = JSON.stringify(window.Game.StarterVillageExteriors.snapshotDescriptors());
    window.Game.StarterVillageExteriors.drawPresentation();
    const authoritativeAfter = JSON.stringify(village.buildings);
    const descriptorAfter = JSON.stringify(window.Game.StarterVillageExteriors.snapshotDescriptors());
    const plan = window.Game.StarterVillageExteriors.snapshotPresentationPlan();
    const coverage = window.Game.StarterVillageExteriors.snapshotPlaceholderCoverage();
    const overlay = document.getElementById('starterVillageExteriorOverlay');
    return {
      authoritativeBefore,
      authoritativeAfter,
      descriptorBefore,
      descriptorAfter,
      plan,
      coverage,
      buildingCount: village.buildings.length,
      types: [...new Set(village.buildings.map((b) => b.type))],
      roads: village.roadTiles.map((p) => `${p.row},${p.col}`),
      buildings: village.buildings.map((b) => ({
        id: b.id,
        type: b.type,
        footprint: { ...b.footprint },
        entrance: { ...b.entrance }
      })),
      overlay: {
        count: Number(overlay?.dataset.buildingCount || 0),
        drawnBuildings: Number(overlay?.dataset.visibleBuildingCount || 0),
        families: String(overlay?.dataset.visualFamilies || '').split(',').filter(Boolean),
        authority: overlay?.dataset.presentationAuthority,
        source: overlay?.dataset.descriptorSource,
        regionSize: Number(overlay?.dataset.regionSize || 0),
        pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : null,
        presentationMode: overlay?.dataset.presentationMode,
        placeholderMode: overlay?.dataset.placeholderMode,
        rectangleOverlay: overlay?.dataset.rectangleOverlay,
        fullyStoneCoveredBuildings: Number(overlay?.dataset.fullyStoneCoveredBuildings || 0),
        stoneCoveredTiles: Number(overlay?.dataset.stoneCoveredTiles || 0),
        footprintTiles: Number(overlay?.dataset.footprintTiles || 0)
      }
    };
  });

  expect(evidence.authoritativeAfter).toBe(evidence.authoritativeBefore);
  expect(evidence.descriptorAfter).toBe(evidence.descriptorBefore);
  expect(evidence.overlay.count).toBe(evidence.buildingCount);
  expect(evidence.overlay.drawnBuildings).toBeGreaterThan(0);
  expect(evidence.overlay.authority).toBe('presentation-only');
  expect(evidence.overlay.source).toBe('originVillage.buildings');
  expect(evidence.overlay.regionSize).toBe(100);
  expect(evidence.overlay.pointerEvents).toBe('none');
  expect(evidence.overlay.presentationMode).toBe('authoritative-building-silhouettes');
  expect(evidence.overlay.placeholderMode).toBe('none');
  expect(evidence.overlay.rectangleOverlay).toBe('disabled');

  expect(evidence.plan).toHaveLength(evidence.buildingCount);
  expect(evidence.overlay.families).toEqual(expect.arrayContaining([
    'home', 'lodging', 'landmark', 'production', 'service', 'agricultural'
  ]));
  expect(evidence.types).toEqual(expect.arrayContaining([
    'home', 'inn', 'village_hall', 'smithy', 'guard_post', 'farmstead'
  ]));

  const cueByType = new Map(evidence.plan.map((item) => [item.type, item.cue]));
  expect(cueByType.get('home')).toBe('chimney');
  expect(cueByType.get('inn')).toBe('sign');
  expect(cueByType.get('village_hall')).toBe('banner');
  expect(cueByType.get('smithy')).toBe('forge');
  expect(cueByType.get('guard_post')).toBe('banner');
  expect(cueByType.get('farmstead')).toBe('farm');

  expect(evidence.overlay.footprintTiles).toBeGreaterThan(0);
  expect(evidence.overlay.stoneCoveredTiles).toBe(evidence.overlay.footprintTiles);
  expect(evidence.overlay.fullyStoneCoveredBuildings).toBe(evidence.buildingCount);
  expect(evidence.coverage.every((item) => item.total > 0 && item.settlement === item.total)).toBe(true);

  const roadSet = new Set(evidence.roads);
  for (const building of evidence.buildings) {
    expect(entranceTouchesFootprint(building), `entrance not adjacent to footprint for ${building.id}`).toBe(true);
    expect(roadSet.has(`${building.entrance.row},${building.entrance.col}`), `entrance not connected to road for ${building.id}`).toBe(true);
  }
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 }
]) {
  test(`starter-village building layer stays readable, bounded and passive on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await ready(page);
    const evidence = await page.evaluate(() => {
      window.Game.StarterVillageExteriors.drawPresentation();
      const overlay = document.getElementById('starterVillageExteriorOverlay');
      const rect = overlay?.getBoundingClientRect();
      return {
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        buildingCount: Number(overlay?.dataset.buildingCount || 0),
        drawnBuildings: Number(overlay?.dataset.visibleBuildingCount || 0),
        families: String(overlay?.dataset.visualFamilies || '').split(',').filter(Boolean),
        pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : null,
        authority: overlay?.dataset.presentationAuthority,
        presentationMode: overlay?.dataset.presentationMode,
        rectangleOverlay: overlay?.dataset.rectangleOverlay,
        stoneCoveredTiles: Number(overlay?.dataset.stoneCoveredTiles || 0),
        footprintTiles: Number(overlay?.dataset.footprintTiles || 0)
      };
    });

    expect(evidence.rect).not.toBeNull();
    expect(evidence.rect.width).toBeGreaterThan(100);
    expect(evidence.rect.height).toBeGreaterThan(100);
    expect(evidence.buildingCount).toBeGreaterThanOrEqual(20);
    expect(evidence.drawnBuildings).toBeGreaterThan(0);
    expect(evidence.families.length).toBeGreaterThanOrEqual(5);
    expect(evidence.pointerEvents).toBe('none');
    expect(evidence.authority).toBe('presentation-only');
    expect(evidence.presentationMode).toBe('authoritative-building-silhouettes');
    expect(evidence.rectangleOverlay).toBe('disabled');
    expect(evidence.stoneCoveredTiles).toBe(evidence.footprintTiles);
  });
}
