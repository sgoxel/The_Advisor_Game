import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.BackgroundQuadGuard?.buildSubdividedMesh &&
    window.Game?.BackgroundQuadGuard?.snapshot &&
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

  expect(evidence.segments.x).toBeGreaterThan(1);
  expect(evidence.segments.z).toBeGreaterThan(1);
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

test('real renderer uses bounded background mesh while panning without mutating authoritative world data', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await ready(page);

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const world = Game.State.world;
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
    const snapshots = [];

    for (const [row, col] of centers) {
      Game.Renderer.centerCameraOnTile(row, col);
      Game.Renderer.renderWorld(true);
      const snapshot = Game.BackgroundQuadGuard.snapshot();
      snapshots.push({
        row,
        col,
        active: snapshot.active,
        interceptCount: snapshot.interceptCount,
        segmentsX: snapshot.segmentsX,
        segmentsZ: snapshot.segmentsZ,
        vertexCount: snapshot.vertexCount,
        legacyVertexCount: snapshot.legacyVertexCount,
        authority: snapshot.authority
      });
    }

    return {
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
  expect(evidence.authoritativeAfter).toBe(evidence.authoritativeBefore);
  expect(evidence.snapshots).toHaveLength(6);

  let previousIntercepts = -1;
  for (const snapshot of evidence.snapshots) {
    expect(snapshot.active).toBe(true);
    expect(snapshot.authority).toBe('presentation-only');
    expect(snapshot.legacyVertexCount).toBe(6);
    expect(snapshot.segmentsX).toBeGreaterThan(1);
    expect(snapshot.segmentsZ).toBeGreaterThan(1);
    expect(snapshot.vertexCount).toBeGreaterThan(6);
    expect(snapshot.interceptCount).toBeGreaterThan(previousIntercepts);
    previousIntercepts = snapshot.interceptCount;
  }
});
