import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.ProjectionVisibilityGuard?.snapshot?.().installed &&
    window.Game?.Renderer?.gridToScreen &&
    window.Game?.Renderer?.screenToGridFloat &&
    window.Game?.StarterVillageExteriors?.drawPresentation &&
    window.Game?.State?.world?.originVillage?.buildings?.length &&
    document.getElementById('starterVillageExteriorOverlay')
  ), null, { timeout: 20_000 });
}

async function sampleZoom(page, zoom, targetRow, targetCol) {
  return page.evaluate(async ({ zoom, targetRow, targetCol }) => {
    const Game = window.Game;
    const State = Game.State;
    const Renderer = Game.Renderer;
    const world = State.world;
    const canvas = State.dom.canvas || document.getElementById('gameCanvas');
    const overlay = document.getElementById('starterVillageExteriorOverlay');
    const tileWidth = Number(world.tileWidth || 100);
    const worldWidth = Number(world.cols || 100) * tileWidth;
    const worldDepth = Number(world.rows || 100) * tileWidth;

    State.camera.zoom = zoom;
    State.camera.x = worldWidth / 2 - (targetCol + 0.5) * tileWidth;
    State.camera.y = worldDepth / 2 - (targetRow + 0.5) * tileWidth;
    State.render.needsWorldRedraw = true;
    Renderer.renderWorld(true);
    Game.StarterVillageExteriors.drawPresentation();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const samples = [];
    for (const building of world.originVillage.buildings) {
      const f = building.footprint;
      if (!f) continue;
      for (const [row, col] of [
        [f.row, f.col],
        [f.row, f.col + f.width],
        [f.row + f.height, f.col + f.width],
        [f.row + f.height, f.col]
      ]) {
        const projected = Renderer.gridToScreen(row, col, 0, 0);
        const finite = Boolean(projected && Number.isFinite(projected.x) && Number.isFinite(projected.y));
        let error = null;
        if (finite) {
          const rt = Renderer.screenToGridFloat(projected.x, projected.y);
          error = Math.max(Math.abs(Number(rt.row) - Number(row)), Math.abs(Number(rt.col) - Number(col)));
        }
        samples.push({ row, col, finite, error, projectionVisible: projected?.projectionVisible ?? null });
      }
    }

    const ctx = overlay.getContext('2d');
    const pixels = ctx.getImageData(0, 0, overlay.width, overlay.height).data;
    let alphaPixels = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 8) alphaPixels += 1;
    const alphaRatio = alphaPixels / Math.max(1, overlay.width * overlay.height);

    return {
      zoom,
      targetRow,
      targetCol,
      canvasWidth: canvas.clientWidth,
      canvasHeight: canvas.clientHeight,
      alphaRatio,
      validFinite: samples.filter((item) => item.finite).every((item) => Number.isFinite(item.error) && item.error <= 0.05),
      invalidAreRejected: samples.filter((item) => !item.finite).every((item) => item.projectionVisible === false),
      finiteCount: samples.filter((item) => item.finite).length,
      rejectedCount: samples.filter((item) => !item.finite).length,
      guard: Game.ProjectionVisibilityGuard.snapshot()
    };
  }, { zoom, targetRow, targetCol });
}

test('building overlays stay projection-safe across the 2.6x zoom threshold', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await ready(page);

  const before = await page.evaluate(() => JSON.stringify(window.Game.State.world.originVillage.buildings));
  const evidence = [];
  for (const zoom of [2.5, 2.6, 2.7]) {
    evidence.push(await sampleZoom(page, zoom, 50, 50));
    evidence.push(await sampleZoom(page, zoom, 14, 14));
  }
  const after = await page.evaluate(() => JSON.stringify(window.Game.State.world.originVillage.buildings));

  expect(evidence).toHaveLength(6);
  for (const sample of evidence) {
    expect(sample.guard.authority).toBe('presentation-only');
    expect(sample.guard.installed).toBe(true);
    expect(sample.validFinite).toBe(true);
    expect(sample.invalidAreRejected).toBe(true);
    expect(sample.finiteCount + sample.rejectedCount).toBeGreaterThan(0);
    // A starter-village building overlay should never become a viewport-filling
    // solid layer. This deliberately leaves generous room for normal silhouettes.
    expect(sample.alphaRatio).toBeLessThan(0.45);
  }

  expect(after).toBe(before);
  expect(pageErrors).toEqual([]);
});

test('guard rejects a behind-camera projection instead of exposing giant finite canvas coordinates', async ({ page }) => {
  await ready(page);

  const result = await page.evaluate(() => {
    const Game = window.Game;
    const State = Game.State;
    const Renderer = Game.Renderer;
    const tileWidth = Number(State.world.tileWidth || 100);
    const worldWidth = Number(State.world.cols || 100) * tileWidth;
    const worldDepth = Number(State.world.rows || 100) * tileWidth;

    State.camera.zoom = 2.7;
    State.camera.x = worldWidth / 2 - 10.5 * tileWidth;
    State.camera.y = worldDepth / 2 - 10.5 * tileWidth;
    State.render.needsWorldRedraw = true;
    Renderer.renderWorld(true);

    const probes = [[0,0], [0,99], [99,0], [99,99], [50,50]];
    const values = probes.map(([row,col]) => ({ row, col, projected: Renderer.gridToScreen(row,col,0,0) }));
    return {
      values,
      rejected: values.filter((entry) => !Number.isFinite(entry.projected?.x) || !Number.isFinite(entry.projected?.y)).length,
      snapshot: Game.ProjectionVisibilityGuard.snapshot()
    };
  });

  expect(result.snapshot.installed).toBe(true);
  expect(result.snapshot.authority).toBe('presentation-only');
  expect(result.rejected).toBeGreaterThan(0);
  expect(result.values.filter((entry) => !Number.isFinite(entry.projected?.x) || !Number.isFinite(entry.projected?.y))
    .every((entry) => entry.projected?.projectionVisible === false)).toBe(true);
});
