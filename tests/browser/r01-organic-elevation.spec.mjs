import { test, expect } from '@playwright/test';

const EXPECTED_OPTIONAL_MAP_404S = [
  '/map/ISOMETRIC_MAP_30032026.js',
  '/map/ISOMETRIC_MAP_30032026/ISOMETRIC_MAP_30032026.js',
  '/map/map.js'
];

function isExpectedOptionalMap404(message) {
  if (message.type() !== 'error') return false;
  const text = message.text();
  const locationUrl = message.location().url || '';
  if (!text.includes('Failed to load resource') || !text.includes('404')) return false;
  try {
    return EXPECTED_OPTIONAL_MAP_404S.includes(new URL(locationUrl).pathname);
  } catch {
    return false;
  }
}

function collectRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !isExpectedOptionalMap404(message)) {
      const locationUrl = message.location().url;
      failures.push(`console.error: ${message.text()}${locationUrl ? ` @ ${locationUrl}` : ''}`);
    }
  });
  return failures;
}

async function waitForOrganicMap(page, navigate = true) {
  if (navigate) await page.goto('./');
  await page.waitForFunction(() => {
    const game = window.Game;
    const state = game?.State;
    const canvas = state?.dom?.canvas;
    const background = state?.render?.worldBackgroundCanvas;
    return Boolean(
      state?.world?.terrain?.length &&
      state?.world?.player &&
      canvas?.isConnected &&
      canvas.clientWidth > 0 &&
      canvas.clientHeight > 0 &&
      background?.width > 0 &&
      background?.height > 0 &&
      state.render.organicSurfacePending === false &&
      state.render.organicSurfaceSignature &&
      game?.Renderer?.renderWorld &&
      game?.Input?.buildPathToTarget
    );
  });
  await expect(page.locator('#gameCanvas')).toBeVisible();
}

async function readOrganicEvidence(page) {
  return page.evaluate(() => {
    const { State, Config } = window.Game;
    const world = State.world;
    const render = State.render;
    const background = render.worldBackgroundCanvas;
    const backgroundCtx = background.getContext('2d', { alpha: false });
    const blendable = new Set(['grass', 'dirt', 'forest', 'mountain']);

    const effectiveElevation = (tile) => {
      if (!tile) return 1;
      const type = String(tile.type || 'grass');
      const numeric = Number(tile.elevation);
      let fallback = 1;
      if (type === 'lake' || type === 'river') fallback = 0;
      else if (type === 'forest') fallback = 2;
      else if (type === 'mountain') fallback = 3;
      return Number.isFinite(numeric) ? Math.max(fallback, numeric) : fallback;
    };

    let transitionCount = 0;
    let elevationBoundaryCount = 0;
    let blendBoundaryCount = 0;
    let raisedNeighborCount = 0;
    const boundaryKeys = new Set();
    const boundarySignatureParts = [];

    const inspectPair = (a, b, key) => {
      if (!a || !b) return;
      const typeA = String(a.type || 'grass');
      const typeB = String(b.type || 'grass');
      const elevationA = effectiveElevation(a);
      const elevationB = effectiveElevation(b);
      const elevationDelta = Math.abs(elevationA - elevationB);
      const needsBlend = typeA !== typeB && blendable.has(typeA) && blendable.has(typeB);
      if (elevationA > 1 && elevationB > 1) raisedNeighborCount += 1;
      if (!needsBlend && elevationDelta <= 0.001) return;
      transitionCount += 1;
      if (elevationDelta > 0.001) elevationBoundaryCount += 1;
      if (needsBlend) blendBoundaryCount += 1;
      boundaryKeys.add(key);
      boundarySignatureParts.push(`${key}:${typeA}:${typeB}:${elevationA.toFixed(3)}:${elevationB.toFixed(3)}`);
    };

    for (let row = 0; row < world.rows; row += 1) {
      for (let col = 0; col < world.cols; col += 1) {
        const tile = world.terrain[row]?.[col];
        if (col + 1 < world.cols) inspectPair(tile, world.terrain[row]?.[col + 1], `v:${row}:${col + 1}`);
        if (row + 1 < world.rows) inspectPair(tile, world.terrain[row + 1]?.[col], `h:${row + 1}:${col}`);
      }
    }

    let boundaryHash = 2166136261 >>> 0;
    for (const text of boundarySignatureParts) {
      for (let index = 0; index < text.length; index += 1) {
        boundaryHash ^= text.charCodeAt(index);
        boundaryHash = Math.imul(boundaryHash, 16777619) >>> 0;
      }
    }

    let surfaceHash = 2166136261 >>> 0;
    const sampleColumns = 16;
    const sampleRows = 16;
    for (let sy = 0; sy < sampleRows; sy += 1) {
      const y = Math.min(background.height - 1, Math.floor((sy + 0.5) * background.height / sampleRows));
      for (let sx = 0; sx < sampleColumns; sx += 1) {
        const x = Math.min(background.width - 1, Math.floor((sx + 0.5) * background.width / sampleColumns));
        const pixel = backgroundCtx.getImageData(x, y, 1, 1).data;
        for (const value of pixel) {
          surfaceHash ^= value;
          surfaceHash = Math.imul(surfaceHash, 16777619) >>> 0;
        }
      }
    }

    const overlay = State.dom.terrainShapeOverlay;
    const overlayCtx = State.dom.terrainShapeOverlayCtx;
    let overlayOpaquePixels = 0;
    if (overlay && overlayCtx && overlay.width && overlay.height) {
      const pixels = overlayCtx.getImageData(0, 0, overlay.width, overlay.height).data;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] !== 0) overlayOpaquePixels += 1;
      }
    }

    return {
      seed: String(world.seed || ''),
      organicSurfaceSeed: String(world.organicSurfaceSeed || ''),
      organicSurfaceSignature: String(render.organicSurfaceSignature || ''),
      boundaryHash: boundaryHash >>> 0,
      surfaceHash: surfaceHash >>> 0,
      transitionCount,
      uniqueBoundaryCount: boundaryKeys.size,
      elevationBoundaryCount,
      blendBoundaryCount,
      raisedNeighborCount,
      generatedShapeCount: Array.isArray(world.generatedTerrainShapes) ? world.generatedTerrainShapes.length : -1,
      configuredLegacyShapeCount: Array.isArray(Config.TERRAIN_SHAPES) ? Config.TERRAIN_SHAPES.length : -1,
      overlayOpaquePixels,
      backgroundSize: [background.width, background.height]
    };
  });
}

async function findPreviewPath(page) {
  return page.evaluate(() => {
    const { State, Input } = window.Game;
    const player = State.world.player;
    for (let row = 0; row < State.world.rows; row += 1) {
      for (let col = 0; col < State.world.cols; col += 1) {
        if (Math.abs(row - player.row) + Math.abs(col - player.col) < 3) continue;
        const path = Input.buildPathToTarget(row, col);
        if (Array.isArray(path) && path.length >= 3) return path;
      }
    }
    return null;
  });
}

test('organic elevation is deterministic and terrain-attached with no legacy generated plates', async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page);
  await waitForOrganicMap(page);

  const first = await readOrganicEvidence(page);
  expect(first.generatedShapeCount).toBe(0);
  expect(first.configuredLegacyShapeCount).toBe(0);
  expect(first.transitionCount).toBeGreaterThan(0);
  expect(first.uniqueBoundaryCount).toBe(first.transitionCount);
  expect(first.elevationBoundaryCount).toBeGreaterThan(0);
  expect(first.blendBoundaryCount).toBeGreaterThan(0);
  expect(first.raisedNeighborCount).toBeGreaterThan(0);
  expect(first.overlayOpaquePixels).toBe(0);
  expect(first.organicSurfaceSeed).toBe(first.seed);

  await page.screenshot({ path: testInfo.outputPath('organic-elevation-initial.png'), fullPage: true });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForOrganicMap(page, false);
  const second = await readOrganicEvidence(page);

  expect(second.seed).toBe(first.seed);
  expect(second.organicSurfaceSeed).toBe(first.organicSurfaceSeed);
  expect(second.organicSurfaceSignature).toBe(first.organicSurfaceSignature);
  expect(second.boundaryHash).toBe(first.boundaryHash);
  expect(second.surfaceHash).toBe(first.surfaceHash);
  expect(second.transitionCount).toBe(first.transitionCount);
  expect(second.generatedShapeCount).toBe(0);
  expect(second.configuredLegacyShapeCount).toBe(0);
  expect(second.overlayOpaquePixels).toBe(0);
  expect(failures).toEqual([]);
});

test('pan, zoom, terrain-wall toggle and floating route keep the organic surface stable and non-authoritative', async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page);
  await waitForOrganicMap(page);

  const initial = await readOrganicEvidence(page);
  const beforeCamera = await page.evaluate(() => {
    const camera = window.Game.State.camera;
    camera.followPlayer = false;
    camera.inertiaVelocityX = 0;
    camera.inertiaVelocityY = 0;
    return { x: camera.x, y: camera.y, zoom: camera.zoom, minZoom: camera.minZoom, maxZoom: camera.maxZoom };
  });

  const canvasBox = await page.locator('#gameCanvas').boundingBox();
  expect(canvasBox).not.toBeNull();
  const centerX = canvasBox.x + canvasBox.width * 0.5;
  const centerY = canvasBox.y + canvasBox.height * 0.5;
  const wheelDelta = beforeCamera.zoom < beforeCamera.maxZoom ? -240 : 240;
  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, wheelDelta);
  await page.waitForTimeout(120);

  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + Math.min(70, canvasBox.width * 0.12), centerY + Math.min(45, canvasBox.height * 0.10), { steps: 5 });
  await page.mouse.up();
  await page.evaluate(() => {
    window.Game.State.camera.inertiaVelocityX = 0;
    window.Game.State.camera.inertiaVelocityY = 0;
    window.Game.Renderer.renderWorld(true);
  });
  await page.waitForTimeout(100);

  const afterCamera = await page.evaluate(() => {
    const camera = window.Game.State.camera;
    return { x: camera.x, y: camera.y, zoom: camera.zoom };
  });
  expect(afterCamera.zoom).not.toBe(beforeCamera.zoom);
  expect(Math.abs(afterCamera.x - beforeCamera.x) + Math.abs(afterCamera.y - beforeCamera.y)).toBeGreaterThan(0.001);

  const afterNavigation = await readOrganicEvidence(page);
  expect(afterNavigation.organicSurfaceSignature).toBe(initial.organicSurfaceSignature);
  expect(afterNavigation.surfaceHash).toBe(initial.surfaceHash);
  expect(afterNavigation.generatedShapeCount).toBe(0);
  expect(afterNavigation.overlayOpaquePixels).toBe(0);

  const toggleEvidence = await page.evaluate(() => {
    const { State, Renderer } = window.Game;
    const original = State.camera.showTerrainWalls;
    const snapshot = () => ({
      generatedShapeCount: Array.isArray(State.world.generatedTerrainShapes) ? State.world.generatedTerrainShapes.length : -1,
      signature: String(State.render.organicSurfaceSignature || '')
    });
    State.camera.showTerrainWalls = false;
    Renderer.renderWorld(true);
    const off = snapshot();
    State.camera.showTerrainWalls = true;
    Renderer.renderWorld(true);
    const on = snapshot();
    State.camera.showTerrainWalls = original;
    Renderer.renderWorld(true);
    return { off, on };
  });
  expect(toggleEvidence.off.generatedShapeCount).toBe(0);
  expect(toggleEvidence.on.generatedShapeCount).toBe(0);
  expect(toggleEvidence.off.signature).toBe(initial.organicSurfaceSignature);
  expect(toggleEvidence.on.signature).toBe(initial.organicSurfaceSignature);

  const previewPath = await findPreviewPath(page);
  expect(previewPath).not.toBeNull();
  const routeEvidence = await page.evaluate((path) => {
    const { State, Renderer } = window.Game;
    const player = State.world.player;
    const background = State.render.worldBackgroundCanvas;
    const ctx = background.getContext('2d', { alpha: false });
    const sampleHash = () => {
      let hash = 2166136261 >>> 0;
      for (let sy = 0; sy < 12; sy += 1) {
        const y = Math.min(background.height - 1, Math.floor((sy + 0.5) * background.height / 12));
        for (let sx = 0; sx < 12; sx += 1) {
          const x = Math.min(background.width - 1, Math.floor((sx + 0.5) * background.width / 12));
          const pixel = ctx.getImageData(x, y, 1, 1).data;
          for (const value of pixel) {
            hash ^= value;
            hash = Math.imul(hash, 16777619) >>> 0;
          }
        }
      }
      return hash >>> 0;
    };
    const before = {
      row: player.row,
      col: player.col,
      moving: player.moving,
      queueLength: player.pathQueue?.length || 0,
      surfaceHash: sampleHash()
    };
    State.world.previewPath = path;
    Renderer.renderWorld(true);
    const overlay = State.dom.terrainShapeOverlay;
    const overlayCtx = State.dom.terrainShapeOverlayCtx;
    let opaquePixels = 0;
    if (overlay && overlayCtx) {
      const pixels = overlayCtx.getImageData(0, 0, overlay.width, overlay.height).data;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] !== 0) opaquePixels += 1;
      }
    }
    return {
      before,
      after: {
        row: player.row,
        col: player.col,
        moving: player.moving,
        queueLength: player.pathQueue?.length || 0,
        previewLength: State.world.previewPath?.length || 0,
        surfaceHash: sampleHash()
      },
      opaquePixels
    };
  }, previewPath);

  expect(routeEvidence.opaquePixels).toBeGreaterThan(0);
  expect(routeEvidence.after.previewLength).toBeGreaterThanOrEqual(3);
  expect(routeEvidence.after.row).toBe(routeEvidence.before.row);
  expect(routeEvidence.after.col).toBe(routeEvidence.before.col);
  expect(routeEvidence.after.moving).toBe(false);
  expect(routeEvidence.after.queueLength).toBe(routeEvidence.before.queueLength);
  expect(routeEvidence.after.surfaceHash).toBe(routeEvidence.before.surfaceHash);

  await page.screenshot({ path: testInfo.outputPath('organic-elevation-pan-zoom-route.png'), fullPage: true });
  expect(failures).toEqual([]);
});
