import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.StarterVillageExteriors?.safeFootprint &&
    window.Game?.StarterVillageExteriors?.drawPresentation &&
    window.Game?.Renderer?.centerCameraOnTile &&
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
            })()
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
  }
});
