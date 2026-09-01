import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.StarterVillageExteriors?.safeFootprint &&
    window.Game?.StarterVillageExteriors?.drawPresentation &&
    window.Game?.ProjectionSafetyGuard?.classifyGridPoint &&
    window.Game?.BackgroundQuadGuard?.snapshot &&
    window.Game?.Renderer?.centerCameraOnTile &&
    window.Game?.Renderer?.gridToScreen &&
    window.Game?.Renderer?.renderWorld &&
    window.Game?.State?.world?.originVillage?.buildings?.length &&
    document.getElementById('starterVillageExteriorOverlay')
  ), null, { timeout: 20_000 });
}

function sampleAlphaCoverage(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  if (!ctx || width < 1 || height < 1) return 0;
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const stepX = Math.max(1, Math.floor(width / 64));
  const stepY = Math.max(1, Math.floor(height / 40));
  let sampled = 0;
  let occupied = 0;
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      sampled += 1;
      if (pixels[(y * width + x) * 4 + 3] > 24) occupied += 1;
    }
  }
  return sampled ? occupied / sampled : 0;
}

test('exterior renderer rejects finite viewport-spanning building footprints', async ({ page }) => {
  await ready(page);

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const exteriors = Game.StarterVillageExteriors;
    const canvas = document.getElementById('starterVillageExteriorOverlay');
    const world = Game.State.world;
    const originalBuildings = world.originVillage.buildings;
    const originalProject = Game.Renderer.gridToScreen;
    const target = originalBuildings.find((building) => building?.footprint?.width > 0 && building?.footprint?.height > 0);
    const width = Math.max(1, canvas.clientWidth || Game.State.dom.canvas.clientWidth || 1);
    const height = Math.max(1, canvas.clientHeight || Game.State.dom.canvas.clientHeight || 1);
    const f = target.footprint;

    const huge = [
      { x: -width * 0.18, y: height * 0.10 },
      { x: width * 1.18, y: height * 0.10 },
      { x: width * 1.18, y: height * 0.90 },
      { x: -width * 0.18, y: height * 0.90 }
    ];
    const normal = [
      { x: width * 0.40, y: height * 0.40 },
      { x: width * 0.56, y: height * 0.40 },
      { x: width * 0.56, y: height * 0.54 },
      { x: width * 0.40, y: height * 0.54 }
    ];

    function projector(points) {
      return (row, col) => {
        const bottom = Math.abs(Number(row) - (Number(f.row) + Number(f.height))) < 0.001;
        const right = Math.abs(Number(col) - (Number(f.col) + Number(f.width))) < 0.001;
        if (!bottom && !right) return { ...points[0] };
        if (!bottom && right) return { ...points[1] };
        if (bottom && right) return { ...points[2] };
        return { ...points[3] };
      };
    }

    try {
      world.originVillage.buildings = [target];
      Game.Renderer.gridToScreen = projector(huge);
      exteriors.drawPresentation();
      const hugeResult = {
        safe: exteriors.safeFootprint(huge, width, height),
        visible: Number(canvas.dataset.visibleBuildingCount || 0),
        rejected: Number(canvas.dataset.rejectedProjectionCount || 0),
        guard: canvas.dataset.projectionGuard
      };

      Game.Renderer.gridToScreen = projector(normal);
      exteriors.drawPresentation();
      const normalResult = {
        safe: exteriors.safeFootprint(normal, width, height),
        visible: Number(canvas.dataset.visibleBuildingCount || 0),
        rejected: Number(canvas.dataset.rejectedProjectionCount || 0)
      };
      return { hugeResult, normalResult };
    } finally {
      Game.Renderer.gridToScreen = originalProject;
      world.originVillage.buildings = originalBuildings;
      exteriors.drawPresentation();
    }
  });

  expect(evidence.hugeResult.safe).toBe(false);
  expect(evidence.hugeResult.visible).toBe(0);
  expect(evidence.hugeResult.rejected).toBeGreaterThan(0);
  expect(evidence.hugeResult.guard).toBe('bounded-footprint');
  expect(evidence.normalResult.safe).toBe(true);
  expect(evidence.normalResult.visible).toBe(1);
  expect(evidence.normalResult.rejected).toBe(0);
});

test('2.6x and neighboring zooms stay bounded at center and edge camera placements', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await ready(page);

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const world = Game.State.world;
    const buildings = world.originVillage.buildings;
    const cameraBefore = { x: Game.State.camera.x, y: Game.State.camera.y, zoom: Game.State.camera.zoom };
    const authoritativeBefore = JSON.stringify({
      seed: world.seed,
      rows: world.rows,
      cols: world.cols,
      terrain: world.terrain,
      buildings
    });
    const centerBuilding = buildings[Math.floor(buildings.length / 2)];
    const edgeBuilding = buildings.slice().sort((a, b) => (a.footprint.row + a.footprint.col) - (b.footprint.row + b.footprint.col))[0];
    const centers = [centerBuilding, edgeBuilding].map((building) => [
      Number(building.footprint.row) + Number(building.footprint.height) / 2,
      Number(building.footprint.col) + Number(building.footprint.width) / 2
    ]);
    const zooms = [2.4, 2.6, 2.8].filter((zoom) => zoom >= Game.State.camera.minZoom && zoom <= Game.State.camera.maxZoom);
    const snapshots = [];

    try {
      for (const [row, col] of centers) {
        Game.Renderer.centerCameraOnTile(row, col);
        for (const zoom of zooms) {
          Game.State.camera.zoom = zoom;
          Game.State.render.needsWorldRedraw = true;
          Game.Renderer.renderWorld(true);
          const canvas = document.getElementById('starterVillageExteriorOverlay');
          const background = Game.BackgroundQuadGuard.snapshot();
          snapshots.push({
            row,
            col,
            zoom,
            width: canvas.width,
            height: canvas.height,
            visible: Number(canvas.dataset.visibleBuildingCount || 0),
            rejected: Number(canvas.dataset.rejectedProjectionCount || 0),
            guard: canvas.dataset.projectionGuard,
            alphaCoverage: (() => {
              const ctx = canvas.getContext('2d');
              const width = canvas.width, height = canvas.height;
              const data = ctx.getImageData(0, 0, width, height).data;
              const stepX = Math.max(1, Math.floor(width / 64));
              const stepY = Math.max(1, Math.floor(height / 40));
              let sampled = 0, occupied = 0;
              for (let y = 0; y < height; y += stepY) for (let x = 0; x < width; x += stepX) {
                sampled += 1;
                if (data[(y * width + x) * 4 + 3] > 24) occupied += 1;
              }
              return sampled ? occupied / sampled : 0;
            })(),
            background: {
              authority: background.authority,
              active: background.active,
              nearPlaneCullActive: background.nearPlaneCullActive,
              sourceVertexCount: Number(background.sourceVertexCount || 0),
              vertexCount: Number(background.vertexCount || 0),
              rejectedTriangleCount: Number(background.rejectedTriangleCount || 0),
              safeNearDepth: Number(background.safeNearDepth || 0)
            }
          });
        }
      }
    } finally {
      Game.State.camera.x = cameraBefore.x;
      Game.State.camera.y = cameraBefore.y;
      Game.State.camera.zoom = cameraBefore.zoom;
      Game.State.render.needsWorldRedraw = true;
      Game.Renderer.renderWorld(true);
    }

    return {
      zooms,
      snapshots,
      buildingCount: buildings.length,
      authoritativeBefore,
      authoritativeAfter: JSON.stringify({ seed: world.seed, rows: world.rows, cols: world.cols, terrain: world.terrain, buildings })
    };
  });

  expect(pageErrors).toEqual([]);
  expect(evidence.zooms).toEqual([2.4, 2.6, 2.8]);
  expect(evidence.authoritativeAfter).toBe(evidence.authoritativeBefore);
  expect(evidence.snapshots).toHaveLength(6);
  for (const snapshot of evidence.snapshots) {
    expect(snapshot.guard).toBe('bounded-footprint');
    expect(snapshot.visible).toBeGreaterThanOrEqual(0);
    expect(snapshot.visible).toBeLessThanOrEqual(evidence.buildingCount);
    expect(snapshot.alphaCoverage).toBeLessThan(0.55);
    expect(snapshot.background.authority).toBe('presentation-only');
    expect(snapshot.background.active).toBe(true);
    expect(snapshot.background.nearPlaneCullActive).toBe(true);
    expect(snapshot.background.sourceVertexCount).toBeGreaterThan(6);
    expect(snapshot.background.vertexCount).toBeLessThanOrEqual(snapshot.background.sourceVertexCount);
    expect(snapshot.background.safeNearDepth).toBeGreaterThan(0);
  }
  expect(evidence.snapshots.some((snapshot) => snapshot.background.rejectedTriangleCount > 0)).toBe(true);
});

test('projection safety rejects near/behind-camera overlay points while preserving safe points and world truth', async ({ page }) => {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror:${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console:${message.text()}`); });
  await ready(page);

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const world = Game.State.world;
    const camera = Game.State.camera;
    const before = JSON.stringify({
      seed: world.seed,
      rows: world.rows,
      cols: world.cols,
      terrain: world.terrain,
      buildings: world.originVillage.buildings,
      player: world.player ? { row: world.player.row, col: world.player.col } : null
    });
    const cameraBefore = { x: camera.x, y: camera.y, zoom: camera.zoom };
    const placements = [
      [Math.floor(world.rows / 2), Math.floor(world.cols / 2)],
      [2, 2]
    ];
    const zooms = [2.4, 2.6, 2.8];
    const samples = [];

    try {
      for (const [centerRow, centerCol] of placements) {
        Game.Renderer.centerCameraOnTile(centerRow, centerCol);
        for (const zoom of zooms) {
          camera.zoom = zoom;
          Game.State.render.needsWorldRedraw = true;
          Game.Renderer.renderWorld(true);

          let unsafe = null;
          let safe = null;
          for (let row = 0; row < world.rows && (!unsafe || !safe); row += 2) {
            for (let col = 0; col < world.cols && (!unsafe || !safe); col += 2) {
              const classification = Game.ProjectionSafetyGuard.classifyGridPoint(row, col);
              if (!classification.safe && !unsafe) unsafe = { row, col, classification };
              if (classification.safe && !safe) safe = { row, col, classification };
            }
          }

          const unsafeProjection = unsafe ? Game.Renderer.gridToScreen(unsafe.row, unsafe.col) : null;
          const safeProjection = safe ? Game.Renderer.gridToScreen(safe.row, safe.col) : null;
          samples.push({
            centerRow,
            centerCol,
            zoom,
            unsafe: unsafe ? {
              reason: unsafe.classification.reason,
              depth: unsafe.classification.cameraDepth,
              safeNearDepth: unsafe.classification.safeNearDepth,
              visible: unsafeProjection?.visible,
              projectionRejected: unsafeProjection?.projectionRejected,
              finiteX: Number.isFinite(Number(unsafeProjection?.x)),
              finiteY: Number.isFinite(Number(unsafeProjection?.y))
            } : null,
            safe: safe ? {
              depth: safe.classification.cameraDepth,
              safeNearDepth: safe.classification.safeNearDepth,
              visible: safeProjection?.visible,
              projectionRejected: safeProjection?.projectionRejected,
              finiteX: Number.isFinite(Number(safeProjection?.x)),
              finiteY: Number.isFinite(Number(safeProjection?.y))
            } : null,
            stats: Game.ProjectionSafetyGuard.snapshot()
          });
        }
      }
    } finally {
      camera.x = cameraBefore.x;
      camera.y = cameraBefore.y;
      camera.zoom = cameraBefore.zoom;
      Game.State.render.needsWorldRedraw = true;
      Game.Renderer.renderWorld(true);
    }

    return {
      before,
      after: JSON.stringify({
        seed: world.seed,
        rows: world.rows,
        cols: world.cols,
        terrain: world.terrain,
        buildings: world.originVillage.buildings,
        player: world.player ? { row: world.player.row, col: world.player.col } : null
      }),
      samples
    };
  });

  expect(failures).toEqual([]);
  expect(evidence.after).toBe(evidence.before);
  expect(evidence.samples).toHaveLength(6);
  expect(evidence.samples.some((sample) => sample.unsafe)).toBe(true);
  for (const sample of evidence.samples) {
    expect(sample.safe).not.toBeNull();
    expect(sample.safe.finiteX).toBe(true);
    expect(sample.safe.finiteY).toBe(true);
    expect(sample.safe.projectionRejected).toBe(false);
    if (sample.unsafe) {
      expect(sample.unsafe.reason).toBe('near-or-behind-camera');
      expect(sample.unsafe.visible).toBe(false);
      expect(sample.unsafe.projectionRejected).toBe(true);
      expect(sample.unsafe.finiteX).toBe(false);
      expect(sample.unsafe.finiteY).toBe(false);
      expect(sample.unsafe.depth).toBeLessThanOrEqual(sample.unsafe.safeNearDepth);
    }
    expect(sample.stats.authority).toBe('presentation-only');
  }
});

test('2.6x presentation remains bounded on representative desktop tablet and phone viewports', async ({ page }) => {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror:${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console:${message.text()}`); });

  const viewports = [
    { width: 1280, height: 720 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 }
  ];
  const results = [];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await ready(page);
    const result = await page.evaluate(() => {
      const Game = window.Game;
      const camera = Game.State.camera;
      const world = Game.State.world;
      const before = JSON.stringify({ seed: world.seed, rows: world.rows, cols: world.cols, buildings: world.originVillage.buildings });
      const original = { x: camera.x, y: camera.y, zoom: camera.zoom };
      try {
        Game.Renderer.centerCameraOnTile(Math.floor(world.rows / 2), Math.floor(world.cols / 2));
        camera.zoom = 2.6;
        Game.State.render.needsWorldRedraw = true;
        Game.Renderer.renderWorld(true);
        const canvas = document.getElementById('starterVillageExteriorOverlay');
        const ctx = canvas.getContext('2d');
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const stepX = Math.max(1, Math.floor(canvas.width / 64));
        const stepY = Math.max(1, Math.floor(canvas.height / 40));
        let sampled = 0, occupied = 0;
        for (let y = 0; y < canvas.height; y += stepY) for (let x = 0; x < canvas.width; x += stepX) {
          sampled += 1;
          if (data[(y * canvas.width + x) * 4 + 3] > 24) occupied += 1;
        }
        return {
          coverage: sampled ? occupied / sampled : 0,
          exteriorGuard: canvas.dataset.projectionGuard,
          background: Game.BackgroundQuadGuard.snapshot(),
          projection: Game.ProjectionSafetyGuard.snapshot(),
          before,
          after: JSON.stringify({ seed: world.seed, rows: world.rows, cols: world.cols, buildings: world.originVillage.buildings })
        };
      } finally {
        camera.x = original.x;
        camera.y = original.y;
        camera.zoom = original.zoom;
        Game.State.render.needsWorldRedraw = true;
        Game.Renderer.renderWorld(true);
      }
    });
    results.push({ viewport, ...result });
  }

  expect(failures).toEqual([]);
  expect(results).toHaveLength(3);
  for (const result of results) {
    expect(result.after).toBe(result.before);
    expect(result.coverage).toBeLessThan(0.55);
    expect(result.exteriorGuard).toBe('bounded-footprint');
    expect(result.background.authority).toBe('presentation-only');
    expect(result.background.nearPlaneCullActive).toBe(true);
    expect(result.background.vertexCount).toBeLessThanOrEqual(result.background.sourceVertexCount);
    expect(result.projection.authority).toBe('presentation-only');
  }
});
