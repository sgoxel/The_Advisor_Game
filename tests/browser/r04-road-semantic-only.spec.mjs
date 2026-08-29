import { test, expect } from '@playwright/test';

test('semantic asset failure never restores either legacy road renderer', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.route('**/textures/tiles/road/*.png', (route) => route.abort());
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.StarterVillageRoads?.drawPresentation &&
    window.Game?.StarterVillageRoads?.ensureSemanticAssets &&
    window.Game?.SpatialWorld?.generateOriginVillage &&
    window.Game?.SpatialWorld?.stampVillageOnRuntimeTerrain &&
    window.Game?.Renderer?.renderWorld
  ), null, { timeout: 20_000 });

  const evidence = await page.evaluate(async () => {
    const Game = window.Game;
    const world = Game.State.world;
    const generated = Game.SpatialWorld.generateOriginVillage('R04-SEMANTIC-ONLY-FAILURE');
    world.originVillage = generated.village;
    world.rows = 100;
    world.cols = 100;
    Game.SpatialWorld.stampVillageOnRuntimeTerrain(world, generated.village);

    const terrainRef = world.terrain;
    const roadBefore = JSON.stringify(generated.village.roadTiles);
    const buildingBefore = JSON.stringify(generated.village.buildings);
    const semanticReady = await Game.StarterVillageRoads.ensureSemanticAssets();

    Game.Renderer.renderWorld(true);
    Game.StarterVillageRoads.drawPresentation();

    const overlay = document.getElementById('starterVillageRoadOverlay');
    const rendererSource = await (await fetch('js/renderer.js')).text();
    const roadSource = await (await fetch('js/starter_village_roads.js')).text();

    return {
      semanticReady,
      terrainReferencePreserved: Game.State.world.terrain === terrainRef,
      roadUnchanged: JSON.stringify(Game.State.world.originVillage.roadTiles) === roadBefore,
      buildingsUnchanged: JSON.stringify(Game.State.world.originVillage.buildings) === buildingBefore,
      presentationMode: overlay?.dataset.presentationMode,
      semanticTileState: overlay?.dataset.semanticTileState,
      drawnRoadTileCount: Number(overlay?.dataset.drawnRoadTileCount || 0),
      semanticDrawnCount: Number(overlay?.dataset.semanticDrawnCount || 0),
      vectorFallbackCount: Number(overlay?.dataset.vectorFallbackCount || 0),
      legacyVectorRenderer: overlay?.dataset.legacyVectorRenderer,
      legacyTerrainRoadOverlay: overlay?.dataset.legacyTerrainRoadOverlay,
      legacyFallbackSourceRemoved: !roadSource.includes('function drawVectorFallback('),
      legacyFallbackMessageRemoved: !roadSource.includes('preserving vector road fallback'),
      legacyRendererIsNoOp:
        rendererSource.includes('function drawRoadOverlay() {') &&
        rendererSource.includes('the legacy procedural road layer is disabled') &&
        !rendererSource.includes('function drawRoadOverlay(ctx, cellWidth, cellHeight) {'),
      terrainAwareRoadBasePreserved:
        rendererSource.includes("if (effectiveType === 'road')") &&
        rendererSource.includes('return getRoadBaseAppearance(row, col);')
    };
  });

  expect(evidence.semanticReady).toBe(false);
  expect(evidence.terrainReferencePreserved).toBe(true);
  expect(evidence.roadUnchanged).toBe(true);
  expect(evidence.buildingsUnchanged).toBe(true);
  expect(evidence.presentationMode).toBe('semantic-road-assets-unavailable');
  expect(evidence.semanticTileState).toBe('failed');
  expect(evidence.drawnRoadTileCount).toBe(0);
  expect(evidence.semanticDrawnCount).toBe(0);
  expect(evidence.vectorFallbackCount).toBe(0);
  expect(evidence.legacyVectorRenderer).toBe('disabled');
  expect(evidence.legacyTerrainRoadOverlay).toBe('disabled');
  expect(evidence.legacyFallbackSourceRemoved).toBe(true);
  expect(evidence.legacyFallbackMessageRemoved).toBe(true);
  expect(evidence.legacyRendererIsNoOp).toBe(true);
  expect(evidence.terrainAwareRoadBasePreserved).toBe(true);
  expect(pageErrors).toEqual([]);
});
