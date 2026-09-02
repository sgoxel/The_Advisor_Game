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

function assertSemanticGrammar(item) {
  const h = Number(item.footprint?.height || 0);
  const w = Number(item.footprint?.width || 0);
  expect(item.compositionMode).toBe('screen-space-semantic-mosaic');
  expect(item.cells.length, `cell count for ${item.id}`).toBe(h * w);
  expect(item.screenEnvelope, `screen envelope for ${item.id}`).toBeTruthy();
  expect(item.screenEnvelope.cellWidth, `cell width for ${item.id}`).toBeGreaterThan(0);
  expect(item.screenEnvelope.cellHeight, `cell height for ${item.id}`).toBeGreaterThan(0);

  if (item.tileFamily === 'well') return;
  const entranceCells = item.cells.filter((cell) => cell.type === 'entrance');
  expect(entranceCells.length, `authoritative entrance semantic for ${item.id}`).toBe(1);
  expect(item.door, `door mapping for ${item.id}`).toBeTruthy();
  expect(entranceCells[0].localRow).toBe(item.door.row);
  expect(entranceCells[0].localCol).toBe(item.door.col);

  if (h >= 3 && w >= 3) {
    const roofTypes = new Set(item.cells.filter((cell) => cell.localRow === 0).map((cell) => cell.type));
    const interiorTypes = new Set(item.cells.filter((cell) => cell.localRow > 0 && cell.localRow < h - 1).map((cell) => cell.type));
    const baseTypes = new Set(item.cells.filter((cell) => cell.localRow === h - 1).map((cell) => cell.type));
    expect([...roofTypes].some((type) => type.startsWith('roof_')), `roof grammar for ${item.id}`).toBe(true);
    expect([...interiorTypes].some((type) => type.startsWith('wall_') || type === 'family_feature' || type === 'entrance'), `wall grammar for ${item.id}`).toBe(true);
    expect([...baseTypes].some((type) => type.startsWith('base_') || type === 'entrance' || type.startsWith('wall_')), `base grammar for ${item.id}`).toBe(true);
    expect(new Set(item.cells.map((cell) => cell.type)).size, `semantic diversity for ${item.id}`).toBeGreaterThanOrEqual(4);
  }
}

test('starter village uses cached semantic building mosaics without normal vector fallback', async ({ page }) => {
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
      compositionMode: overlay?.dataset.compositionMode,
      assetState: overlay?.dataset.tileAssetState,
      rasterBuildings: Number(overlay?.dataset.rasterBuildingCount || 0),
      fallbackBuildings: Number(overlay?.dataset.vectorFallbackBuildingCount || 0),
      rasterCells: Number(overlay?.dataset.rasterCellCount || 0),
      cacheReady: cache.ready,
      cacheError: cache.error,
      renderedTileFamilies: String(overlay?.dataset.tileFamilies || '').split(',').filter(Boolean),
      authoritativeTileFamilies: [...new Set(plan.map((entry) => entry.tileFamily).filter(Boolean))],
      plan
    };
  });

  expect(evidence.authoritativeAfter).toBe(evidence.authoritativeBefore);
  expect(evidence.backend).toBe('semantic-raster-building-tiles');
  expect(evidence.compositionMode).toBe('screen-space-semantic-mosaic');
  expect(evidence.assetState).toBe('ready');
  expect(evidence.rasterBuildings).toBeGreaterThan(0);
  expect(evidence.fallbackBuildings).toBe(0);
  expect(evidence.rasterCells).toBeGreaterThan(evidence.rasterBuildings);
  expect(evidence.cacheError).toBe(0);
  expect(evidence.cacheReady).toBeGreaterThanOrEqual(120);
  expect(evidence.authoritativeTileFamilies).toEqual(expect.arrayContaining(['home','inn','village_hall','smithy','farmstead']));
  expect(evidence.renderedTileFamilies.length).toBeGreaterThan(0);
  for (const family of evidence.renderedTileFamilies) expect(evidence.authoritativeTileFamilies).toContain(family);
  for (const item of evidence.plan.filter((entry) => entry.tileFamily)) assertSemanticGrammar(item);
});

test('representative semantic mosaic has visible roof wall and base pixel bands', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const G = window.Game;
    G.StarterVillageExteriors.drawPresentation();
    const overlay = document.getElementById('starterVillageExteriorOverlay');
    const plan = G.StarterVillageExteriors.snapshotPresentationPlan();
    const width = overlay?.clientWidth || 0;
    const height = overlay?.clientHeight || 0;
    const item = plan.find((entry) => entry.tileFamily !== 'well' && Number(entry.footprint?.height) >= 3 && Number(entry.footprint?.width) >= 3 && entry.screenEnvelope && entry.screenEnvelope.maxX > 0 && entry.screenEnvelope.maxY > 0 && entry.screenEnvelope.minX < width && entry.screenEnvelope.minY < height);
    if (!overlay || !item) return null;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const env = item.screenEnvelope;
    const x0 = Math.max(0, Math.floor(env.minX * dpr));
    const y0 = Math.max(0, Math.floor(env.minY * dpr));
    const x1 = Math.min(overlay.width, Math.ceil(env.maxX * dpr));
    const y1 = Math.min(overlay.height, Math.ceil(env.maxY * dpr));
    const ctx = overlay.getContext('2d');
    const data = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    const bands = [new Set(), new Set(), new Set()];
    const alpha = [0, 0, 0];
    for (let y = 0; y < data.height; y += 1) {
      const band = Math.min(2, Math.floor((y / Math.max(1, data.height)) * 3));
      for (let x = 0; x < data.width; x += 1) {
        const i = (y * data.width + x) * 4;
        if (data.data[i + 3] < 24) continue;
        alpha[band] += 1;
        bands[band].add(`${data.data[i] >> 4}:${data.data[i + 1] >> 4}:${data.data[i + 2] >> 4}`);
      }
    }
    return { id:item.id, type:item.type, alpha, colors:bands.map((band) => band.size), cells:item.cells, envelope:env };
  });

  expect(evidence).toBeTruthy();
  expect(evidence.alpha[0], `${evidence.id} roof-band pixels`).toBeGreaterThan(0);
  expect(evidence.alpha[1], `${evidence.id} wall-band pixels`).toBeGreaterThan(0);
  expect(evidence.alpha[2], `${evidence.id} base-band pixels`).toBeGreaterThan(0);
  expect(evidence.colors[0], `${evidence.id} roof-band color diversity`).toBeGreaterThan(1);
  expect(evidence.colors[1], `${evidence.id} wall-band color diversity`).toBeGreaterThan(1);
  expect(evidence.colors[2], `${evidence.id} base-band color diversity`).toBeGreaterThan(1);
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
      const plans = G.StarterVillageExteriors.snapshotPresentationPlan().filter((entry) => entry.screenEnvelope);
      samples.push({
        zoom,
        assetState: overlay?.dataset.tileAssetState,
        compositionMode: overlay?.dataset.compositionMode,
        fallback: Number(overlay?.dataset.vectorFallbackBuildingCount || 0),
        rejected: Number(overlay?.dataset.rejectedProjectionCount || 0),
        rasterCells: Number(overlay?.dataset.rasterCellCount || 0),
        width: overlay?.width || 0,
        height: overlay?.height || 0,
        invalidEnvelope: plans.some((entry) => !Number.isFinite(entry.screenEnvelope.minX) || !Number.isFinite(entry.screenEnvelope.minY) || entry.screenEnvelope.maxX < entry.screenEnvelope.minX || entry.screenEnvelope.maxY < entry.screenEnvelope.minY)
      });
    }
    return { before, after: JSON.stringify(G.State.world.originVillage.buildings), samples };
  });

  expect(evidence.after).toBe(evidence.before);
  for (const sample of evidence.samples) {
    expect(sample.assetState).toBe('ready');
    expect(sample.compositionMode).toBe('screen-space-semantic-mosaic');
    expect(sample.fallback).toBe(0);
    expect(sample.rasterCells).toBeGreaterThan(0);
    expect(sample.width).toBeGreaterThan(100);
    expect(sample.height).toBeGreaterThan(100);
    expect(sample.invalidEnvelope).toBe(false);
  }
});