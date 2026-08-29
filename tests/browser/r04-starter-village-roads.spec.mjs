import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.StarterVillageRoads?.drawPresentation &&
    window.Game?.StarterVillageRoads?.snapshotTopology &&
    window.Game?.SpatialWorld?.generateOriginVillage &&
    window.Game?.SpatialWorld?.stampVillageOnRuntimeTerrain
  ), null, { timeout: 20_000 });

  // Keep the representative authoritative village creation in the browser realm and invoke it
  // immediately before each assertion block. This avoids racing the normal asynchronous startup
  // world replacement while still exercising only production Simulation APIs and #277 rendering.
  await page.evaluate(() => {
    window.__r04RepresentativeRoadVillage = () => {
      const Game = window.Game;
      const world = Game.State.world;
      const generated = Game.SpatialWorld.generateOriginVillage('R04-SEEDED-ROADS-A');
      world.originVillage = generated.village;
      world.rows = 100;
      world.cols = 100;
      Game.SpatialWorld.stampVillageOnRuntimeTerrain(world, generated.village);
      return generated.village;
    };
  });
}

function roadKey(point) {
  return `${point.row},${point.col}`;
}

test('authoritative roads render as a continuous non-mutating cardinal surface', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await ready(page);

  const evidence = await page.evaluate(() => {
    const village = window.__r04RepresentativeRoadVillage();
    const roadBefore = JSON.stringify(village.roadTiles);
    const buildingBefore = JSON.stringify(village.buildings);
    const firstTopology = window.Game.StarterVillageRoads.snapshotTopology();
    window.Game.StarterVillageRoads.drawPresentation();
    const secondTopology = window.Game.StarterVillageRoads.snapshotTopology();
    const overlay = document.getElementById('starterVillageRoadOverlay');
    return {
      roadBefore,
      roadAfter: JSON.stringify(village.roadTiles),
      buildingBefore,
      buildingAfter: JSON.stringify(village.buildings),
      firstTopology,
      secondTopology,
      roadTiles: village.roadTiles.map((point) => ({ row: point.row, col: point.col })),
      entrances: village.buildings.map((building) => ({ id: building.id, row: building.entrance.row, col: building.entrance.col })),
      overlay: {
        roadTileCount: Number(overlay?.dataset.roadTileCount || 0),
        drawnRoadTileCount: Number(overlay?.dataset.drawnRoadTileCount || 0),
        segmentCount: Number(overlay?.dataset.segmentCount || 0),
        intersectionCount: Number(overlay?.dataset.intersectionCount || 0),
        invalidTopologyCount: Number(overlay?.dataset.invalidTopologyCount || 0),
        authority: overlay?.dataset.presentationAuthority,
        source: overlay?.dataset.descriptorSource,
        mode: overlay?.dataset.presentationMode,
        connectivity: overlay?.dataset.connectivity,
        legacyPattern: overlay?.dataset.legacySquareHolePattern,
        regionSize: Number(overlay?.dataset.regionSize || 0),
        roadWidthPx: Number(overlay?.dataset.roadWidthPx || 0),
        pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : null,
        zIndex: overlay ? getComputedStyle(overlay).zIndex : null
      }
    };
  });

  expect(evidence.roadAfter).toBe(evidence.roadBefore);
  expect(evidence.buildingAfter).toBe(evidence.buildingBefore);
  expect(evidence.secondTopology).toEqual(evidence.firstTopology);
  expect(evidence.overlay.authority).toBe('presentation-only');
  expect(evidence.overlay.source).toBe('originVillage.roadTiles');
  expect(evidence.overlay.mode).toBe('authoritative-continuous-packed-earth');
  expect(evidence.overlay.connectivity).toBe('authoritative-cardinal-only');
  expect(evidence.overlay.legacyPattern).toBe('masked');
  expect(evidence.overlay.pointerEvents).toBe('none');
  expect(evidence.overlay.zIndex).toBe('0');
  expect(evidence.overlay.regionSize).toBe(100);
  expect(evidence.overlay.roadWidthPx).toBeGreaterThan(0);
  expect(evidence.overlay.roadTileCount).toBe(evidence.firstTopology.length);
  expect(evidence.overlay.drawnRoadTileCount).toBe(evidence.firstTopology.length);
  expect(evidence.overlay.segmentCount).toBeGreaterThan(0);
  expect(evidence.overlay.intersectionCount).toBeGreaterThan(0);
  expect(evidence.overlay.invalidTopologyCount).toBe(0);
  expect(evidence.firstTopology.every((tile) => /^[NESW]*$/.test(tile.mask))).toBe(true);

  const roadSet = new Set(evidence.roadTiles.map(roadKey));
  for (const entrance of evidence.entrances) {
    expect(roadSet.has(`${entrance.row},${entrance.col}`), `entrance road missing for ${entrance.id}`).toBe(true);
  }
  expect(pageErrors).toEqual([]);
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 }
]) {
  test(`road overlay remains bounded and passive on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await ready(page);
    const evidence = await page.evaluate(() => {
      window.__r04RepresentativeRoadVillage();
      window.Game.StarterVillageRoads.drawPresentation();
      const overlay = document.getElementById('starterVillageRoadOverlay');
      const rect = overlay?.getBoundingClientRect();
      return {
        rect: rect ? { width: rect.width, height: rect.height } : null,
        roadTileCount: Number(overlay?.dataset.roadTileCount || 0),
        drawnRoadTileCount: Number(overlay?.dataset.drawnRoadTileCount || 0),
        segmentCount: Number(overlay?.dataset.segmentCount || 0),
        invalidTopologyCount: Number(overlay?.dataset.invalidTopologyCount || 0),
        authority: overlay?.dataset.presentationAuthority,
        mode: overlay?.dataset.presentationMode,
        legacyPattern: overlay?.dataset.legacySquareHolePattern,
        roadWidthPx: Number(overlay?.dataset.roadWidthPx || 0),
        pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : null
      };
    });

    expect(evidence.rect).not.toBeNull();
    expect(evidence.rect.width).toBeGreaterThan(100);
    expect(evidence.rect.height).toBeGreaterThan(100);
    expect(evidence.roadTileCount).toBeGreaterThan(0);
    expect(evidence.drawnRoadTileCount).toBe(evidence.roadTileCount);
    expect(evidence.segmentCount).toBeGreaterThan(0);
    expect(evidence.invalidTopologyCount).toBe(0);
    expect(evidence.authority).toBe('presentation-only');
    expect(evidence.mode).toBe('authoritative-continuous-packed-earth');
    expect(evidence.legacyPattern).toBe('masked');
    expect(evidence.roadWidthPx).toBeGreaterThan(0);
    expect(evidence.pointerEvents).toBe('none');
  });
}
