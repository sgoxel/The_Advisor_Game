import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.StarterVillageExteriors?.drawPresentation &&
    Array.isArray(window.Game?.State?.world?.originVillage?.buildings) &&
    window.Game.State.world.originVillage.buildings.length >= 20
  ), null, { timeout: 20_000 });
}

function entranceTouchesFootprint(building) {
  const f = building.footprint;
  const e = building.entrance;
  const rowInside = e.row >= f.row && e.row < f.row + f.height;
  const colInside = e.col >= f.col && e.col < f.col + f.width;
  const horizontalDoor = rowInside && (e.col === f.col - 1 || e.col === f.col + f.width);
  const verticalDoor = colInside && (e.row === f.row - 1 || e.row === f.row + f.height);
  return horizontalDoor || verticalDoor;
}

test('exterior layer derives from authoritative building descriptors without mutation', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const village = window.Game.State.world.originVillage;
    const authoritativeBefore = JSON.stringify(village.buildings);
    const descriptorBefore = JSON.stringify(window.Game.StarterVillageExteriors.snapshotDescriptors());
    window.Game.StarterVillageExteriors.drawPresentation();
    const authoritativeAfter = JSON.stringify(village.buildings);
    const descriptorAfter = JSON.stringify(window.Game.StarterVillageExteriors.snapshotDescriptors());
    const overlay = document.getElementById('starterVillageExteriorOverlay');
    return {
      authoritativeBefore,
      authoritativeAfter,
      descriptorBefore,
      descriptorAfter,
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
        visible: Number(overlay?.dataset.visibleBuildingCount || 0),
        types: overlay?.dataset.visibleBuildingTypes || '',
        authority: overlay?.dataset.presentationAuthority,
        source: overlay?.dataset.descriptorSource,
        regionSize: Number(overlay?.dataset.regionSize || 0),
        pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : null
      }
    };
  });

  expect(evidence.authoritativeAfter).toBe(evidence.authoritativeBefore);
  expect(evidence.descriptorAfter).toBe(evidence.descriptorBefore);
  expect(evidence.overlay.count).toBe(evidence.buildingCount);
  expect(evidence.overlay.visible).toBeGreaterThan(0);
  expect(evidence.overlay.authority).toBe('presentation-only');
  expect(evidence.overlay.source).toBe('originVillage.buildings');
  expect(evidence.overlay.regionSize).toBe(100);
  expect(evidence.overlay.pointerEvents).toBe('none');
  expect(evidence.types).toEqual(expect.arrayContaining(['home', 'inn', 'village_hall', 'smithy', 'guard_post', 'farmstead']));

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
  test(`starter-village exterior overlay stays bounded and passive on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await ready(page);
    const evidence = await page.evaluate(() => {
      window.Game.StarterVillageExteriors.drawPresentation();
      const overlay = document.getElementById('starterVillageExteriorOverlay');
      const rect = overlay?.getBoundingClientRect();
      return {
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        buildingCount: Number(overlay?.dataset.buildingCount || 0),
        visible: Number(overlay?.dataset.visibleBuildingCount || 0),
        pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : null,
        authority: overlay?.dataset.presentationAuthority
      };
    });

    expect(evidence.rect).not.toBeNull();
    expect(evidence.rect.width).toBeGreaterThan(100);
    expect(evidence.rect.height).toBeGreaterThan(100);
    expect(evidence.buildingCount).toBeGreaterThanOrEqual(20);
    expect(evidence.visible).toBeGreaterThan(0);
    expect(evidence.pointerEvents).toBe('none');
    expect(evidence.authority).toBe('presentation-only');
  });
}