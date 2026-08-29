import { test, expect } from '@playwright/test';

async function waitForRoadWorld(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.StarterVillageRoads?.ensureSemanticAssets &&
    window.Game?.StarterVillageRoads?.drawPresentation &&
    window.Game?.SpatialWorld?.generateOriginVillage &&
    window.Game?.SpatialWorld?.stampVillageOnRuntimeTerrain &&
    window.Game?.Renderer?.renderWorld &&
    window.Game?.Renderer?.gridToScreen &&
    window.Game?.Renderer?.centerCameraOnTile &&
    window.Game?.State?.world?.terrain
  ), null, { timeout: 20_000 });

  await page.evaluate(() => {
    window.__r04InstallVisibleRoadVillage = () => {
      const Game = window.Game;
      const world = Game.State.world;
      const generated = Game.SpatialWorld.generateOriginVillage('R04-VISIBLE-ROAD-OVERLAY');
      world.originVillage = generated.village;
      world.rows = 100;
      world.cols = 100;
      Game.SpatialWorld.stampVillageOnRuntimeTerrain(world, generated.village);
      return generated.village;
    };

    const Game = window.Game;
    const village = window.__r04InstallVisibleRoadVillage();
    const roads = village.roadTiles || [];
    const focal = roads[Math.floor(roads.length / 2)] || village.center;
    Game.Renderer.centerCameraOnTile(focal.row, focal.col);
    Game.Renderer.markDirty?.(true, true);
  });
}

async function visibleRoadEvidence(page) {
  return page.evaluate(async () => {
    const Game = window.Game;
    const village = window.__r04InstallVisibleRoadVillage();
    const ready = await Game.StarterVillageRoads.ensureSemanticAssets();
    const roadBefore = JSON.stringify(village.roadTiles);
    const buildingsBefore = JSON.stringify(village.buildings);

    Game.Renderer.renderWorld(true);
    Game.StarterVillageRoads.drawPresentation();

    const overlay = document.getElementById('starterVillageRoadOverlay');
    const base = document.getElementById('gameCanvas');
    if (!overlay || !base) return { ready, missingCanvas: true };

    const context = overlay.getContext('2d', { willReadFrequently: true });
    const image = context.getImageData(0, 0, overlay.width, overlay.height);
    let visiblePixelCount = 0;
    let maxAlpha = 0;
    for (let i = 3; i < image.data.length; i += 16) {
      const alpha = image.data[i];
      if (alpha > 5) visiblePixelCount += 1;
      if (alpha > maxAlpha) maxAlpha = alpha;
    }

    const dprX = overlay.width / Math.max(1, overlay.clientWidth);
    const dprY = overlay.height / Math.max(1, overlay.clientHeight);
    let authoritativeRoadSamplesWithPixels = 0;
    let authoritativeRoadSamplesOnScreen = 0;
    const roadTiles = village.roadTiles || [];
    for (const road of roadTiles) {
      const p = Game.Renderer.gridToScreen(road.row + 0.5, road.col + 0.5, 0, 0);
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < 0 || p.y < 0 || p.x > overlay.clientWidth || p.y > overlay.clientHeight) continue;
      authoritativeRoadSamplesOnScreen += 1;
      const px = Math.round(p.x * dprX);
      const py = Math.round(p.y * dprY);
      let found = false;
      for (let dy = -12; dy <= 12 && !found; dy += 2) {
        for (let dx = -12; dx <= 12; dx += 2) {
          const x = px + dx;
          const y = py + dy;
          if (x < 0 || y < 0 || x >= overlay.width || y >= overlay.height) continue;
          const alpha = image.data[(y * overlay.width + x) * 4 + 3];
          if (alpha > 5) { found = true; break; }
        }
      }
      if (found) authoritativeRoadSamplesWithPixels += 1;
    }

    const overlayStyle = getComputedStyle(overlay);
    const baseStyle = getComputedStyle(base);
    const overlayZ = Number.parseInt(overlayStyle.zIndex, 10);
    const baseZ = Number.parseInt(baseStyle.zIndex, 10);

    return {
      ready,
      missingCanvas: false,
      semanticTileState: overlay.dataset.semanticTileState,
      semanticAssetCount: Number(overlay.dataset.semanticAssetCount || 0),
      semanticDrawnCount: Number(overlay.dataset.semanticDrawnCount || 0),
      drawnRoadTileCount: Number(overlay.dataset.drawnRoadTileCount || 0),
      vectorFallbackCount: Number(overlay.dataset.vectorFallbackCount || 0),
      legacyVectorRenderer: overlay.dataset.legacyVectorRenderer,
      legacyTerrainRoadOverlay: overlay.dataset.legacyTerrainRoadOverlay,
      visiblePixelCount,
      maxAlpha,
      authoritativeRoadSamplesOnScreen,
      authoritativeRoadSamplesWithPixels,
      overlayZ: Number.isFinite(overlayZ) ? overlayZ : 0,
      baseZ: Number.isFinite(baseZ) ? baseZ : 0,
      overlayPointerEvents: overlayStyle.pointerEvents,
      roadUnchanged: JSON.stringify(village.roadTiles) === roadBefore,
      buildingsUnchanged: JSON.stringify(village.buildings) === buildingsBefore
    };
  });
}

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 }
]) {
  test(`semantic road PNG overlay is visibly composited above terrain on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await waitForRoadWorld(page);
    const beforeZoom = await visibleRoadEvidence(page);

    expect(beforeZoom.ready).toBe(true);
    expect(beforeZoom.missingCanvas).toBe(false);
    expect(beforeZoom.semanticTileState).toBe('ready');
    expect(beforeZoom.semanticAssetCount).toBe(8);
    expect(beforeZoom.semanticDrawnCount).toBeGreaterThan(0);
    expect(beforeZoom.drawnRoadTileCount).toBeGreaterThan(0);
    expect(beforeZoom.visiblePixelCount).toBeGreaterThan(100);
    expect(beforeZoom.maxAlpha).toBeGreaterThan(32);
    expect(beforeZoom.authoritativeRoadSamplesOnScreen).toBeGreaterThan(0);
    expect(beforeZoom.authoritativeRoadSamplesWithPixels).toBeGreaterThan(0);
    expect(beforeZoom.overlayZ).toBeGreaterThan(beforeZoom.baseZ);
    expect(beforeZoom.overlayPointerEvents).toBe('none');
    expect(beforeZoom.vectorFallbackCount).toBe(0);
    expect(beforeZoom.legacyVectorRenderer).toBe('disabled');
    expect(beforeZoom.legacyTerrainRoadOverlay).toBe('disabled');
    expect(beforeZoom.roadUnchanged).toBe(true);
    expect(beforeZoom.buildingsUnchanged).toBe(true);

    const zoomState = await page.evaluate(() => ({
      zoom: Number(window.Game.State.camera.zoom),
      minZoom: Number(window.Game.State.camera.minZoom),
      maxZoom: Number(window.Game.State.camera.maxZoom)
    }));
    const wheelDelta = zoomState.zoom < zoomState.maxZoom ? -480 : 480;
    await page.locator('#gameCanvas').hover();
    await page.mouse.wheel(0, wheelDelta);
    await page.waitForFunction((value) => Number(window.Game.State.camera.zoom) !== value, zoomState.zoom, { timeout: 5_000 });
    const afterZoom = await visibleRoadEvidence(page);

    expect(afterZoom.ready).toBe(true);
    expect(afterZoom.semanticDrawnCount).toBeGreaterThan(0);
    expect(afterZoom.visiblePixelCount).toBeGreaterThan(100);
    expect(afterZoom.authoritativeRoadSamplesOnScreen).toBeGreaterThan(0);
    expect(afterZoom.authoritativeRoadSamplesWithPixels).toBeGreaterThan(0);
    expect(afterZoom.overlayZ).toBeGreaterThan(afterZoom.baseZ);
    expect(afterZoom.roadUnchanged).toBe(true);
    expect(afterZoom.buildingsUnchanged).toBe(true);
  });
}
