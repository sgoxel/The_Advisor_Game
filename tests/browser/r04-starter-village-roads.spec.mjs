import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.StarterVillageRoads?.drawPresentation &&
    window.Game?.StarterVillageRoads?.snapshotTopology &&
    window.Game?.StarterVillageRoads?.ensureSemanticAssets &&
    window.Game?.SpatialWorld?.generateOriginVillage &&
    window.Game?.SpatialWorld?.stampVillageOnRuntimeTerrain &&
    window.Game?.Minimap?.renderMinimap &&
    window.Game?.Renderer?.centerCameraOnTile
  ), null, { timeout: 20_000 });

  // Keep the representative authoritative village creation in the browser realm and invoke it
  // immediately before each assertion block. This avoids racing the normal asynchronous startup
  // world replacement while still exercising only production Simulation APIs and road rendering.
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

function footprintContainsRoad(roadSet, footprint) {
  for (let row = footprint.row; row < footprint.row + footprint.height; row += 1) {
    for (let col = footprint.col; col < footprint.col + footprint.width; col += 1) {
      if (roadSet.has(`${row},${col}`)) return true;
    }
  }
  return false;
}

test('authoritative roads render as a continuous non-mutating cardinal surface', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await ready(page);

  const evidence = await page.evaluate(async () => {
    const Game = window.Game;
    const village = window.__r04RepresentativeRoadVillage();
    const roadBefore = JSON.stringify(village.roadTiles);
    const buildingBefore = JSON.stringify(village.buildings);
    const firstTopology = Game.StarterVillageRoads.snapshotTopology();
    const semanticReady = await Game.StarterVillageRoads.ensureSemanticAssets();
    Game.StarterVillageRoads.drawPresentation();
    const secondTopology = Game.StarterVillageRoads.snapshotTopology();
    const overlay = document.getElementById('starterVillageRoadOverlay');
    return {
      roadBefore,
      roadAfter: JSON.stringify(village.roadTiles),
      buildingBefore,
      buildingAfter: JSON.stringify(village.buildings),
      firstTopology,
      secondTopology,
      semanticReady,
      apiMode: Game.StarterVillageRoads.presentationMode,
      roadTiles: village.roadTiles.map((point) => ({ row: point.row, col: point.col })),
      buildings: village.buildings.map((building) => ({
        id: building.id,
        passable: building.passable === true,
        entrance: { row: building.entrance.row, col: building.entrance.col },
        footprint: {
          row: building.footprint.row,
          col: building.footprint.col,
          width: building.footprint.width,
          height: building.footprint.height
        }
      })),
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
        roadWidth: overlay?.dataset.roadWidthPx,
        semanticTileState: overlay?.dataset.semanticTileState,
        semanticAssetCount: Number(overlay?.dataset.semanticAssetCount || 0),
        semanticDrawnCount: Number(overlay?.dataset.semanticDrawnCount || 0),
        semanticUnsupportedCount: Number(overlay?.dataset.semanticUnsupportedCount || 0),
        vectorFallbackCount: Number(overlay?.dataset.vectorFallbackCount || 0),
        semanticRegistry: overlay?.dataset.semanticRegistry,
        pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : null,
        zIndex: overlay ? getComputedStyle(overlay).zIndex : null
      }
    };
  });

  expect(evidence.roadAfter).toBe(evidence.roadBefore);
  expect(evidence.buildingAfter).toBe(evidence.buildingBefore);
  expect(evidence.secondTopology).toEqual(evidence.firstTopology);
  expect(evidence.semanticReady).toBe(true);
  expect(evidence.overlay.authority).toBe('presentation-only');
  expect(evidence.overlay.source).toBe('originVillage.roadTiles');
  expect(evidence.apiMode).toBe('authoritative-semantic-transparent-png');
  expect(evidence.overlay.mode).toBe(evidence.apiMode);
  expect(evidence.overlay.connectivity).toBe('authoritative-cardinal-only');
  expect(evidence.overlay.legacyPattern).toBe('masked');
  expect(evidence.overlay.pointerEvents).toBe('none');
  expect(evidence.overlay.zIndex).toBe('1');
  expect(evidence.overlay.regionSize).toBe(100);
  expect(evidence.overlay.roadWidth).toBe('semantic-tile');
  expect(evidence.overlay.semanticTileState).toBe('ready');
  expect(evidence.overlay.semanticAssetCount).toBeGreaterThanOrEqual(8);
  expect(evidence.overlay.semanticDrawnCount).toBe(evidence.firstTopology.length);
  expect(evidence.overlay.semanticUnsupportedCount).toBe(0);
  expect(evidence.overlay.vectorFallbackCount).toBe(0);
  expect(evidence.overlay.semanticRegistry).toBe('canonical-road-registry');
  expect(evidence.overlay.roadTileCount).toBe(evidence.firstTopology.length);
  expect(evidence.overlay.drawnRoadTileCount).toBe(evidence.firstTopology.length);
  expect(evidence.overlay.intersectionCount).toBeGreaterThan(0);
  expect(evidence.overlay.invalidTopologyCount).toBe(0);
  expect(evidence.firstTopology.every((tile) => /^[NESW]*$/.test(tile.mask))).toBe(true);

  const roadSet = new Set(evidence.roadTiles.map(roadKey));
  let passableConnectionChecks = 0;
  for (const building of evidence.buildings) {
    const entranceOnRoad = roadSet.has(`${building.entrance.row},${building.entrance.col}`);
    if (!building.passable) {
      expect(entranceOnRoad, `entrance road missing for non-passable ${building.id}`).toBe(true);
      continue;
    }
    passableConnectionChecks += 1;
    const footprintOnRoad = footprintContainsRoad(roadSet, building.footprint);
    expect(
      entranceOnRoad || footprintOnRoad,
      `authoritative route does not connect passable structure ${building.id}`
    ).toBe(true);
  }
  // Exercise the passable-structure branch without prescribing which valid Simulation topology
  // must occur. A passable structure may connect at its nominal entrance or through its walkable
  // footprint; the per-structure assertion above enforces connectivity for either authoritative form.
  expect(passableConnectionChecks).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});

test('semantic roads share the minimap terrain source and remain aligned after real camera zoom', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);

  const before = await page.evaluate(async () => {
    const Game = window.Game;
    const village = window.__r04RepresentativeRoadVillage();
    const semanticReady = await Game.StarterVillageRoads.ensureSemanticAssets();
    const roads = village.roadTiles;
    const focal = roads[Math.floor(roads.length / 2)];
    Game.Renderer.centerCameraOnTile(focal.row, focal.col);
    Game.Renderer.markDirty(true, true);
    Game.Minimap.renderMinimap(true);
    Game.StarterVillageRoads.drawPresentation();

    const passableFootprints = village.buildings
      .filter((building) => building.passable === true)
      .map((building) => building.footprint);
    let terrainRoadMatches = 0;
    let passableSettlementOverrides = 0;
    let unexplainedTerrainMismatches = 0;
    for (const point of roads) {
      const tile = Game.State.world.terrain?.[point.row]?.[point.col];
      const taggedRoad = tile?.type === 'road' && (
        tile.tags?.has?.('road') || Array.isArray(tile.tags) && tile.tags.includes('road')
      );
      if (taggedRoad) {
        terrainRoadMatches += 1;
        continue;
      }
      const insidePassableFootprint = passableFootprints.some((footprint) => (
        point.row >= footprint.row && point.row < footprint.row + footprint.height &&
        point.col >= footprint.col && point.col < footprint.col + footprint.width
      ));
      if (insidePassableFootprint && tile?.type === 'settlement') {
        passableSettlementOverrides += 1;
      } else {
        unexplainedTerrainMismatches += 1;
      }
    }

    const center = Game.Renderer.gridToScreen(focal.row + 0.5, focal.col + 0.5);
    const east = Game.Renderer.gridToScreen(focal.row + 0.5, focal.col + 1.5);
    const minimap = Game.State.dom.minimap;
    const miniCtx = Game.State.dom.miniCtx;
    const miniPixels = miniCtx.getImageData(0, 0, minimap.width, minimap.height).data;
    let minimapHasPixels = false;
    for (let i = 3; i < miniPixels.length; i += 4) {
      if (miniPixels[i] !== 0) {
        minimapHasPixels = true;
        break;
      }
    }
    const overlay = document.getElementById('starterVillageRoadOverlay');
    return {
      semanticReady,
      roadBefore: JSON.stringify(roads),
      roadCount: roads.length,
      terrainRoadMatches,
      passableSettlementOverrides,
      unexplainedTerrainMismatches,
      focal,
      zoom: Game.State.camera.zoom,
      minZoom: Game.State.camera.minZoom,
      maxZoom: Game.State.camera.maxZoom,
      span: Math.hypot(east.x - center.x, east.y - center.y),
      minimapHasPixels,
      overlayRoadCount: Number(overlay?.dataset.roadTileCount || 0),
      overlaySemanticCount: Number(overlay?.dataset.semanticDrawnCount || 0)
    };
  });

  expect(before.semanticReady).toBe(true);
  expect(before.roadCount).toBeGreaterThan(0);
  expect(before.terrainRoadMatches).toBeGreaterThan(0);
  expect(before.unexplainedTerrainMismatches).toBe(0);
  expect(before.terrainRoadMatches + before.passableSettlementOverrides).toBe(before.roadCount);
  expect(before.minimapHasPixels).toBe(true);
  expect(before.overlayRoadCount).toBe(before.roadCount);
  expect(before.overlaySemanticCount).toBe(before.roadCount);

  const wheelDelta = before.zoom < before.maxZoom ? -320 : 320;
  await page.locator('#gameCanvas').hover();
  await page.mouse.wheel(0, wheelDelta);
  await page.waitForFunction((oldZoom) => window.Game.State.camera.zoom !== oldZoom, before.zoom);

  const after = await page.evaluate(({ roadBefore, focal }) => {
    const Game = window.Game;
    Game.StarterVillageRoads.drawPresentation();
    Game.Minimap.renderMinimap(true);
    const center = Game.Renderer.gridToScreen(focal.row + 0.5, focal.col + 0.5);
    const east = Game.Renderer.gridToScreen(focal.row + 0.5, focal.col + 1.5);
    const canvas = Game.State.dom.canvas;
    const overlay = document.getElementById('starterVillageRoadOverlay');
    return {
      roadUnchanged: JSON.stringify(Game.State.world.originVillage.roadTiles) === roadBefore,
      zoom: Game.State.camera.zoom,
      span: Math.hypot(east.x - center.x, east.y - center.y),
      focalOnScreen: center.x >= 0 && center.x <= canvas.clientWidth && center.y >= 0 && center.y <= canvas.clientHeight,
      roadTileCount: Number(overlay?.dataset.roadTileCount || 0),
      semanticDrawnCount: Number(overlay?.dataset.semanticDrawnCount || 0),
      invalidTopologyCount: Number(overlay?.dataset.invalidTopologyCount || 0),
      semanticUnsupportedCount: Number(overlay?.dataset.semanticUnsupportedCount || 0),
      vectorFallbackCount: Number(overlay?.dataset.vectorFallbackCount || 0)
    };
  }, { roadBefore: before.roadBefore, focal: before.focal });

  expect(after.zoom).not.toBe(before.zoom);
  expect(Math.abs(after.span - before.span)).toBeGreaterThan(0.5);
  expect(after.roadUnchanged).toBe(true);
  expect(after.focalOnScreen).toBe(true);
  expect(after.roadTileCount).toBe(before.roadCount);
  expect(after.semanticDrawnCount).toBe(before.roadCount);
  expect(after.invalidTopologyCount).toBe(0);
  expect(after.semanticUnsupportedCount).toBe(0);
  expect(after.vectorFallbackCount).toBe(0);
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
    const evidence = await page.evaluate(async () => {
      const Game = window.Game;
      window.__r04RepresentativeRoadVillage();
      const semanticReady = await Game.StarterVillageRoads.ensureSemanticAssets();
      Game.StarterVillageRoads.drawPresentation();
      const overlay = document.getElementById('starterVillageRoadOverlay');
      const rect = overlay?.getBoundingClientRect();
      return {
        semanticReady,
        apiMode: Game.StarterVillageRoads.presentationMode,
        rect: rect ? { width: rect.width, height: rect.height } : null,
        roadTileCount: Number(overlay?.dataset.roadTileCount || 0),
        drawnRoadTileCount: Number(overlay?.dataset.drawnRoadTileCount || 0),
        intersectionCount: Number(overlay?.dataset.intersectionCount || 0),
        invalidTopologyCount: Number(overlay?.dataset.invalidTopologyCount || 0),
        authority: overlay?.dataset.presentationAuthority,
        mode: overlay?.dataset.presentationMode,
        legacyPattern: overlay?.dataset.legacySquareHolePattern,
        roadWidth: overlay?.dataset.roadWidthPx,
        semanticTileState: overlay?.dataset.semanticTileState,
        semanticAssetCount: Number(overlay?.dataset.semanticAssetCount || 0),
        semanticUnsupportedCount: Number(overlay?.dataset.semanticUnsupportedCount || 0),
        pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : null
      };
    });

    expect(evidence.semanticReady).toBe(true);
    expect(evidence.rect).not.toBeNull();
    expect(evidence.rect.width).toBeGreaterThan(100);
    expect(evidence.rect.height).toBeGreaterThan(100);
    expect(evidence.roadTileCount).toBeGreaterThan(0);
    expect(evidence.drawnRoadTileCount).toBe(evidence.roadTileCount);
    expect(evidence.intersectionCount).toBeGreaterThan(0);
    expect(evidence.invalidTopologyCount).toBe(0);
    expect(evidence.authority).toBe('presentation-only');
    expect(evidence.apiMode).toBe('authoritative-semantic-transparent-png');
    expect(evidence.mode).toBe(evidence.apiMode);
    expect(evidence.legacyPattern).toBe('masked');
    expect(evidence.roadWidth).toBe('semantic-tile');
    expect(evidence.semanticTileState).toBe('ready');
    expect(evidence.semanticAssetCount).toBeGreaterThanOrEqual(8);
    expect(evidence.semanticUnsupportedCount).toBe(0);
    expect(evidence.pointerEvents).toBe('none');
  });
}
