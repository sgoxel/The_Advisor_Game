import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.BackgroundQuadGuard?.buildSubdividedMesh &&
    window.Game?.BackgroundQuadGuard?.filterMeshForNearPlane &&
    window.Game?.BackgroundQuadGuard?.snapshot &&
    window.Game?.ProjectionSafetyGuard?.classifyGridPoint &&
    window.Game?.Renderer?.centerCameraOnTile &&
    window.Game?.Renderer?.renderWorld &&
    window.Game?.State?.dom?.gl &&
    Number(window.Game?.State?.world?.cols) >= 100 &&
    Number(window.Game?.State?.world?.rows) >= 100
  ), null, { timeout: 20_000 });
}

test('background guard subdivides the legacy full-map two-triangle mesh with continuous UVs', async ({ page }) => {
  await ready(page);

  const evidence = await page.evaluate(() => {
    const guard = window.Game.BackgroundQuadGuard;
    const segments = guard.recommendedSegments(100, 100);
    const positions = new Float32Array([
      0, 0, 0,
      100, 0, 0,
      0, 0, 100,
      0, 0, 100,
      100, 0, 0,
      100, 0, 100
    ]);
    const texCoords = new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      0, 0,
      1, 1,
      1, 0
    ]);
    const mesh = guard.buildSubdividedMesh(positions, texCoords, segments.x, segments.z);
    const uv = Array.from(mesh.texCoords);
    const xyz = Array.from(mesh.positions);
    return {
      segments,
      vertexCount: mesh.vertexCount,
      expectedVertexCount: segments.x * segments.z * 6,
      positionLength: xyz.length,
      uvLength: uv.length,
      finitePositions: xyz.every(Number.isFinite),
      finiteUvs: uv.every(Number.isFinite),
      minU: Math.min(...uv.filter((_, index) => index % 2 === 0)),
      maxU: Math.max(...uv.filter((_, index) => index % 2 === 0)),
      minV: Math.min(...uv.filter((_, index) => index % 2 === 1)),
      maxV: Math.max(...uv.filter((_, index) => index % 2 === 1))
    };
  });

  expect(evidence.segments.x).toBe(100);
  expect(evidence.segments.z).toBe(100);
  expect(evidence.vertexCount).toBe(evidence.expectedVertexCount);
  expect(evidence.vertexCount).toBeGreaterThan(6);
  expect(evidence.positionLength).toBe(evidence.vertexCount * 3);
  expect(evidence.uvLength).toBe(evidence.vertexCount * 2);
  expect(evidence.finitePositions).toBe(true);
  expect(evidence.finiteUvs).toBe(true);
  expect(evidence.minU).toBeCloseTo(0, 6);
  expect(evidence.maxU).toBeCloseTo(1, 6);
  expect(evidence.minV).toBeCloseTo(0, 6);
  expect(evidence.maxV).toBeCloseTo(1, 6);
});

test('near-plane filter removes triangles that touch the unsafe camera band instead of letting WebGL stretch them', async ({ page }) => {
  await ready(page);

  const evidence = await page.evaluate(() => {
    const guard = window.Game.BackgroundQuadGuard;
    const positions = new Float32Array([
      0, 0, 0,
      4, 0, 0,
      0, 0, 4,
      0, 0, 4,
      4, 0, 0,
      4, 0, 4
    ]);
    const texCoords = new Float32Array([
      0, 1,
      1, 1,
      0, 0,
      0, 0,
      1, 1,
      1, 0
    ]);
    const source = guard.buildSubdividedMesh(positions, texCoords, 4, 4);
    const filtered = guard.filterMeshForNearPlane(source, {
      eye: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
      safeNearDepth: 1.1
    });
    return {
      sourceVertexCount: source.vertexCount,
      filteredVertexCount: filtered.vertexCount,
      rejectedTriangleCount: filtered.rejectedTriangleCount,
      keptTriangleCount: filtered.keptTriangleCount,
      safeNearDepth: filtered.safeNearDepth,
      finitePositions: Array.from(filtered.positions).every(Number.isFinite),
      finiteUvs: Array.from(filtered.texCoords).every(Number.isFinite)
    };
  });

  expect(evidence.sourceVertexCount).toBe(4 * 4 * 6);
  expect(evidence.filteredVertexCount).toBeGreaterThan(0);
  expect(evidence.filteredVertexCount).toBeLessThan(evidence.sourceVertexCount);
  expect(evidence.rejectedTriangleCount).toBeGreaterThan(0);
  expect(evidence.keptTriangleCount).toBeGreaterThan(0);
  expect(evidence.safeNearDepth).toBeCloseTo(1.1, 6);
  expect(evidence.finitePositions).toBe(true);
  expect(evidence.finiteUvs).toBe(true);
});

test('real renderer keeps the guarded background bounded through the 2.6x zoom neighborhood without mutating world data', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await ready(page);

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const world = Game.State.world;
    const camera = Game.State.camera;
    const cameraBefore = { x: camera.x, y: camera.y, zoom: camera.zoom };
    const authoritativeBefore = JSON.stringify({
      seed: world.seed,
      rows: world.rows,
      cols: world.cols,
      terrain: world.terrain,
      buildings: world.originVillage?.buildings || []
    });

    const centers = [
      [50, 50],
      [18, 18],
      [18, 82],
      [82, 18],
      [82, 82],
      [50, 50]
    ];
    const zooms = [2.4, 2.6, 2.8].filter((zoom) => zoom >= camera.minZoom && zoom <= camera.maxZoom);
    const snapshots = [];

    try {
      for (const [row, col] of centers) {
        Game.Renderer.centerCameraOnTile(row, col);
        for (const zoom of zooms) {
          camera.zoom = zoom;
          Game.State.render.needsWorldRedraw = true;
          Game.Renderer.renderWorld(true);
          const snapshot = Game.BackgroundQuadGuard.snapshot();
          const projection = Game.ProjectionSafetyGuard.classifyGridPoint(row, col);
          snapshots.push({
            row,
            col,
            zoom,
            active: snapshot.active,
            interceptCount: snapshot.interceptCount,
            segmentsX: snapshot.segmentsX,
            segmentsZ: snapshot.segmentsZ,
            vertexCount: snapshot.vertexCount,
            sourceVertexCount: snapshot.sourceVertexCount,
            legacyVertexCount: snapshot.legacyVertexCount,
            rejectedTriangleCount: snapshot.rejectedTriangleCount,
            nearPlaneCullActive: snapshot.nearPlaneCullActive,
            authority: snapshot.authority,
            centerProjectionSafe: projection.safe,
            centerCameraDepth: projection.cameraDepth,
            safeNearDepth: projection.safeNearDepth
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
      zooms,
      snapshots,
      authoritativeBefore,
      authoritativeAfter: JSON.stringify({
        seed: world.seed,
        rows: world.rows,
        cols: world.cols,
        terrain: world.terrain,
        buildings: world.originVillage?.buildings || []
      })
    };
  });

  expect(pageErrors).toEqual([]);
  expect(evidence.zooms).toEqual([2.4, 2.6, 2.8]);
  expect(evidence.authoritativeAfter).toBe(evidence.authoritativeBefore);
  expect(evidence.snapshots).toHaveLength(18);

  let previousIntercepts = -1;
  for (const snapshot of evidence.snapshots) {
    expect(snapshot.active).toBe(true);
    expect(snapshot.authority).toBe('presentation-only');
    expect(snapshot.legacyVertexCount).toBe(6);
    expect(snapshot.segmentsX).toBeGreaterThan(1);
    expect(snapshot.segmentsZ).toBeGreaterThan(1);
    expect(snapshot.sourceVertexCount).toBeGreaterThan(6);
    expect(snapshot.vertexCount).toBeGreaterThanOrEqual(0);
    expect(snapshot.vertexCount).toBeLessThanOrEqual(snapshot.sourceVertexCount);
    expect(snapshot.rejectedTriangleCount).toBeGreaterThanOrEqual(0);
    expect(snapshot.nearPlaneCullActive).toBe(true);
    expect(snapshot.interceptCount).toBeGreaterThan(previousIntercepts);
    expect(snapshot.centerProjectionSafe).toBe(true);
    expect(snapshot.centerCameraDepth).toBeGreaterThan(snapshot.safeNearDepth);
    previousIntercepts = snapshot.interceptCount;
  }
});
