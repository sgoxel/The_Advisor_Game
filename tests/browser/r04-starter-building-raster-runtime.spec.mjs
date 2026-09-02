import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.StarterVillageExteriors?.drawPresentation &&
    Array.isArray(window.Game?.State?.world?.originVillage?.buildings) &&
    window.Game.State.world.originVillage.buildings.length >= 20
  ), null, { timeout: 20_000 });
  await page.waitForFunction(() => {
    const overlay = document.getElementById('starterVillageExteriorOverlay');
    window.Game?.StarterVillageExteriors?.drawPresentation?.();
    return overlay?.dataset.tileAssetState === 'ready' && Number(overlay.dataset.rasterBuildingCount || 0) > 0;
  }, null, { timeout: 20_000 });
}

test('starter village uses cached semantic building tiles without normal vector fallback', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const G = window.Game;
    const village = G.State.world.originVillage;
    const authoritativeBefore = JSON.stringify(village.buildings);
    G.StarterVillageExteriors.drawPresentation();
    const overlay = document.getElementById('starterVillageExteriorOverlay');
    const plan = G.StarterVillageExteriors.snapshotPresentationPlan();
    const cache = G.StarterVillageExteriors.snapshotTileCache();
    return {
      authoritativeBefore,
      authoritativeAfter: JSON.stringify(village.buildings),
      backend: overlay?.dataset.renderBackend,
      assetState: overlay?.dataset.tileAssetState,
      rasterBuildings: Number(overlay?.dataset.rasterBuildingCount || 0),
      fallbackBuildings: Number(overlay?.dataset.vectorFallbackBuildingCount || 0),
      rasterCells: Number(overlay?.dataset.rasterCellCount || 0),
      cacheReady: cache.ready,
      cacheError: cache.error,
      tileFamilies: String(overlay?.dataset.tileFamilies || '').split(',').filter(Boolean),
      plan
    };
  });

  expect(evidence.authoritativeAfter).toBe(evidence.authoritativeBefore);
  expect(evidence.backend).toBe('semantic-raster-building-tiles');
  expect(evidence.assetState).toBe('ready');
  expect(evidence.rasterBuildings).toBeGreaterThan(0);
  expect(evidence.fallbackBuildings).toBe(0);
  expect(evidence.rasterCells).toBeGreaterThan(evidence.rasterBuildings);
  expect(evidence.cacheError).toBe(0);
  expect(evidence.cacheReady).toBeGreaterThanOrEqual(120);
  expect(evidence.tileFamilies).toEqual(expect.arrayContaining(['home','inn','village_hall','smithy','farmstead']));

  for (const item of evidence.plan.filter((entry) => entry.tileFamily && entry.tileFamily !== 'well')) {
    expect(item.tileTypes.length, `missing semantic composition for ${item.id}`).toBeGreaterThan(0);
    expect(item.tileTypes, `missing authoritative entrance piece for ${item.id}`).toContain('entrance');
  }
});

test('semantic raster buildings stay bounded around the implicated zoom neighborhood', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(async () => {
    const G = window.Game;
    const before = JSON.stringify(G.State.world.originVillage.buildings);
    const samples = [];
    for (const zoom of [2.4, 2.6, 2.8]) {
      G.State.camera.zoom = zoom;
      G.Renderer.renderWorld(true);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const overlay = document.getElementById('starterVillageExteriorOverlay');
      samples.push({
        zoom,
        assetState: overlay?.dataset.tileAssetState,
        fallback: Number(overlay?.dataset.vectorFallbackBuildingCount || 0),
        rejected: Number(overlay?.dataset.rejectedProjectionCount || 0),
        rasterCells: Number(overlay?.dataset.rasterCellCount || 0),
        width: overlay?.width || 0,
        height: overlay?.height || 0
      });
    }
    return { before, after: JSON.stringify(G.State.world.originVillage.buildings), samples };
  });

  expect(evidence.after).toBe(evidence.before);
  for (const sample of evidence.samples) {
    expect(sample.assetState).toBe('ready');
    expect(sample.fallback).toBe(0);
    expect(sample.rasterCells).toBeGreaterThan(0);
    expect(sample.width).toBeGreaterThan(100);
    expect(sample.height).toBeGreaterThan(100);
  }
});
