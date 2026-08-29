import { test, expect } from '@playwright/test';

test('untouched production startup visibly renders semantic road tiles without debug intervention', async ({ page }) => {
  await page.goto('./');

  // This test intentionally does NOT call StarterVillageRoads.drawPresentation(),
  // does NOT replace originVillage, and does NOT move the camera. It observes the
  // same startup path used by the public Pages build.
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.originVillage?.roadTiles?.length &&
    window.Game?.RoadRuntimeBridge?.installed &&
    document.getElementById('starterVillageRoadOverlay')
  ), null, { timeout: 25_000 });

  await page.waitForFunction(() => {
    const overlay = document.getElementById('starterVillageRoadOverlay');
    return overlay?.dataset?.semanticTileState === 'ready' && Number(overlay.dataset.semanticDrawnCount || 0) > 0;
  }, null, { timeout: 25_000 });

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const overlay = document.getElementById('starterVillageRoadOverlay');
    const base = document.getElementById('gameCanvas');
    const beforeRoads = JSON.stringify(Game.State.world.originVillage.roadTiles);
    const beforeBuildings = JSON.stringify(Game.State.world.originVillage.buildings);
    const ctx = overlay.getContext('2d', { willReadFrequently: true });
    const pixels = ctx.getImageData(0, 0, overlay.width, overlay.height).data;
    let visiblePixels = 0;
    let maxAlpha = 0;
    for (let index = 3; index < pixels.length; index += 16) {
      const alpha = pixels[index];
      if (alpha > 5) visiblePixels += 1;
      if (alpha > maxAlpha) maxAlpha = alpha;
    }
    const overlayStyle = getComputedStyle(overlay);
    const baseStyle = getComputedStyle(base);
    return {
      bridgeInstalled: Game.RoadRuntimeBridge.installed,
      semanticState: overlay.dataset.semanticTileState,
      semanticAssets: Number(overlay.dataset.semanticAssetCount || 0),
      semanticDrawn: Number(overlay.dataset.semanticDrawnCount || 0),
      visiblePixels,
      maxAlpha,
      overlayZ: Number.parseInt(overlayStyle.zIndex || '0', 10) || 0,
      baseZ: Number.parseInt(baseStyle.zIndex || '0', 10) || 0,
      pointerEvents: overlayStyle.pointerEvents,
      roadsUnchanged: JSON.stringify(Game.State.world.originVillage.roadTiles) === beforeRoads,
      buildingsUnchanged: JSON.stringify(Game.State.world.originVillage.buildings) === beforeBuildings,
      legacyVectorRenderer: overlay.dataset.legacyVectorRenderer,
      legacyTerrainRoadOverlay: overlay.dataset.legacyTerrainRoadOverlay
    };
  });

  expect(evidence.bridgeInstalled).toBe(true);
  expect(evidence.semanticState).toBe('ready');
  expect(evidence.semanticAssets).toBe(8);
  expect(evidence.semanticDrawn).toBeGreaterThan(0);
  expect(evidence.visiblePixels).toBeGreaterThan(100);
  expect(evidence.maxAlpha).toBeGreaterThan(32);
  expect(evidence.overlayZ).toBeGreaterThan(evidence.baseZ);
  expect(evidence.pointerEvents).toBe('none');
  expect(evidence.roadsUnchanged).toBe(true);
  expect(evidence.buildingsUnchanged).toBe(true);
  expect(evidence.legacyVectorRenderer).toBe('disabled');
  expect(evidence.legacyTerrainRoadOverlay).toBe('disabled');
});
