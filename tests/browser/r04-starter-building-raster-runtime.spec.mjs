import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.StarterVillageExteriors?.drawPresentation &&
    window.Game?.StarterVillageExteriors?.snapshotComposition &&
    Array.isArray(window.Game?.State?.world?.originVillage?.buildings) &&
    window.Game.State.world.originVillage.buildings.length >= 20
  ), null, { timeout: 20_000 });
  await page.waitForFunction(() => {
    const overlay = document.getElementById('starterVillageExteriorOverlay');
    window.Game?.StarterVillageExteriors?.drawPresentation?.();
    return overlay?.dataset.tileAssetState === 'ready' && Number(overlay.dataset.baseComposedBuildingCount || 0) > 0;
  }, null, { timeout: 20_000 });
}

function assertSemanticGrammar(item) {
  const h = Number(item.footprint?.height || 0);
  const w = Number(item.footprint?.width || 0);
  expect(item.compositionMode).toBe('world-background-static-composition');
  expect(item.cells.length, `cell count for ${item.id}`).toBe(h * w);

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

function assertScreenEnvelope(item) {
  expect(item.screenEnvelope, `screen envelope for ${item.id}`).toBeTruthy();
  expect(item.screenEnvelope.cellWidth, `cell width for ${item.id}`).toBeGreaterThan(0);
  expect(item.screenEnvelope.cellHeight, `cell height for ${item.id}`).toBeGreaterThan(0);
}

test('starter village composes fixed semantic building pixels into the cached world background', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const G = window.Game;
    const village = G.State.world.originVillage;
    const authoritativeBefore = JSON.stringify(village.buildings);
    G.StarterVillageExteriors.drawPresentation();
    const overlay = document.getElementById('starterVillageExteriorOverlay');
    const plan = G.StarterVillageExteriors.snapshotPresentationPlan();
    const cache = G.StarterVillageExteriors.snapshotTileCache();
    const composition = G.StarterVillageExteriors.snapshotComposition();
    return {
      authoritativeBefore,
      authoritativeAfter: JSON.stringify(village.buildings),
      backend: overlay?.dataset.renderBackend,
      compositionMode: overlay?.dataset.compositionMode,
      assetState: overlay?.dataset.tileAssetState,
      baseComposedBuildings: Number(overlay?.dataset.baseComposedBuildingCount || 0),
      baseComposedCells: Number(overlay?.dataset.baseComposedCellCount || 0),
      screenOverlayDraws: Number(overlay?.dataset.screenOverlayDrawCount || 0),
      fallbackBuildings: Number(overlay?.dataset.vectorFallbackBuildingCount || 0),
      overlayDisplay: overlay?.style.display,
      cacheReady: cache.ready,
      cacheError: cache.error,
      composition,
      plan
    };
  });

  expect(evidence.authoritativeAfter).toBe(evidence.authoritativeBefore);
  expect(evidence.backend).toBe('world-background-building-composition');
  expect(evidence.compositionMode).toBe('world-background-static-composition');
  expect(evidence.assetState).toBe('ready');
  expect(evidence.baseComposedBuildings).toBeGreaterThan(0);
  expect(evidence.baseComposedCells).toBeGreaterThan(evidence.baseComposedBuildings);
  expect(evidence.screenOverlayDraws).toBe(0);
  expect(evidence.fallbackBuildings).toBe(0);
  expect(evidence.overlayDisplay).toBe('none');
  expect(evidence.cacheError).toBe(0);
  expect(evidence.cacheReady).toBeGreaterThanOrEqual(120);
  expect(evidence.composition.backgroundWidth).toBeGreaterThan(0);
  expect(evidence.composition.backgroundHeight).toBeGreaterThan(0);
  expect(evidence.composition.cells).toBe(evidence.baseComposedCells);

  const semanticPlans = evidence.plan.filter((entry) => entry.tileFamily);
  for (const item of semanticPlans) assertSemanticGrammar(item);

  const projectedPlans = semanticPlans.filter((entry) => entry.screenEnvelope);
  expect(projectedPlans.length).toBeGreaterThan(0);
  for (const item of projectedPlans) assertScreenEnvelope(item);
});

test('representative roof wall and base semantics are baked into world-background pixels', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const G = window.Game;
    G.StarterVillageExteriors.drawPresentation();
    const plan = G.StarterVillageExteriors.snapshotPresentationPlan();
    const background = G.State.render.worldBackgroundCanvas;
    const rows = G.State.world.rows;
    const cols = G.State.world.cols;
    const item = plan.find((entry) => entry.tileFamily !== 'well' && Number(entry.footprint?.height) >= 3 && Number(entry.footprint?.width) >= 3);
    if (!background || !item) return null;
    const ctx = background.getContext('2d');
    const cw = background.width / cols;
    const ch = background.height / rows;
    const picks = [
      item.cells.find((cell) => cell.type.startsWith('roof_')),
      item.cells.find((cell) => cell.type.startsWith('wall_') || cell.type === 'family_feature'),
      item.cells.find((cell) => cell.type.startsWith('base_') || cell.type === 'entrance')
    ];
    const samples = picks.map((cell) => {
      if (!cell) return null;
      const x = Math.max(0, Math.min(background.width - 1, Math.floor((cell.col + 0.5) * cw)));
      const y = Math.max(0, Math.min(background.height - 1, Math.floor((cell.row + 0.5) * ch)));
      const pixel = [...ctx.getImageData(x, y, 1, 1).data];
      return { type: cell.type, row: cell.row, col: cell.col, pixel };
    });
    return { id:item.id, samples, background:{width:background.width,height:background.height} };
  });

  expect(evidence).toBeTruthy();
  expect(evidence.background.width).toBeGreaterThan(0);
  expect(evidence.background.height).toBeGreaterThan(0);
  expect(evidence.samples.every(Boolean)).toBe(true);
  for (const sample of evidence.samples) expect(sample.pixel[3], `${sample.type} alpha`).toBeGreaterThan(0);
  const rgb = evidence.samples.map((sample) => sample.pixel.slice(0, 3).join(':'));
  expect(new Set(rgb).size, `${evidence.id} baked semantic pixel diversity`).toBeGreaterThan(1);
});

test('repeated presentation calls reuse base composition and keep the screen overlay at zero draw cost', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const G = window.Game;
    const overlay = document.getElementById('starterVillageExteriorOverlay');
    const authoritativeBefore = JSON.stringify(G.State.world.originVillage.buildings);
    const compositionBefore = G.StarterVillageExteriors.snapshotComposition();
    const backgroundBefore = G.State.render.worldBackgroundCanvas;
    const started = performance.now();
    for (let i = 0; i < 25; i += 1) G.StarterVillageExteriors.drawPresentation();
    const elapsedMs = performance.now() - started;
    const compositionAfter = G.StarterVillageExteriors.snapshotComposition();
    return {
      authoritativeBefore,
      authoritativeAfter: JSON.stringify(G.State.world.originVillage.buildings),
      sameBackgroundObject: backgroundBefore === G.State.render.worldBackgroundCanvas,
      beforeSignature: compositionBefore.signature,
      afterSignature: compositionAfter.signature,
      cells: compositionAfter.cells,
      screenOverlayDraws: Number(overlay?.dataset.screenOverlayDrawCount || 0),
      overlayDisplay: overlay?.style.display,
      elapsedMs
    };
  });

  expect(evidence.authoritativeAfter).toBe(evidence.authoritativeBefore);
  expect(evidence.sameBackgroundObject).toBe(true);
  expect(evidence.beforeSignature).toBeTruthy();
  expect(evidence.afterSignature).toBe(evidence.beforeSignature);
  expect(evidence.cells).toBeGreaterThan(0);
  expect(evidence.screenOverlayDraws).toBe(0);
  expect(evidence.overlayDisplay).toBe('none');
  expect(evidence.elapsedMs).toBeLessThan(250);
});

test('base-composed buildings stay bounded around the implicated zoom neighborhood', async ({ page }) => {
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
      const composition = G.StarterVillageExteriors.snapshotComposition();
      samples.push({
        zoom,
        assetState: overlay?.dataset.tileAssetState,
        compositionMode: overlay?.dataset.compositionMode,
        fallback: Number(overlay?.dataset.vectorFallbackBuildingCount || 0),
        screenOverlayDraws: Number(overlay?.dataset.screenOverlayDrawCount || 0),
        baseComposedBuildings: Number(overlay?.dataset.baseComposedBuildingCount || 0),
        baseComposedCells: Number(overlay?.dataset.baseComposedCellCount || 0),
        overlayDisplay: overlay?.style.display,
        backgroundWidth: composition.backgroundWidth,
        backgroundHeight: composition.backgroundHeight,
        invalidEnvelope: plans.some((entry) => !Number.isFinite(entry.screenEnvelope.minX) || !Number.isFinite(entry.screenEnvelope.minY) || entry.screenEnvelope.maxX < entry.screenEnvelope.minX || entry.screenEnvelope.maxY < entry.screenEnvelope.minY)
      });
    }
    return { before, after: JSON.stringify(G.State.world.originVillage.buildings), samples };
  });

  expect(evidence.after).toBe(evidence.before);
  for (const sample of evidence.samples) {
    expect(sample.assetState).toBe('ready');
    expect(sample.compositionMode).toBe('world-background-static-composition');
    expect(sample.fallback).toBe(0);
    expect(sample.screenOverlayDraws).toBe(0);
    expect(sample.baseComposedBuildings).toBeGreaterThan(0);
    expect(sample.baseComposedCells).toBeGreaterThan(sample.baseComposedBuildings);
    expect(sample.overlayDisplay).toBe('none');
    expect(sample.backgroundWidth).toBeGreaterThan(100);
    expect(sample.backgroundHeight).toBeGreaterThan(100);
    expect(sample.invalidEnvelope).toBe(false);
  }
});