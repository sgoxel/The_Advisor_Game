import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTile } from "../src/geometry.ts";
import { roads, villages } from "../src/geography.ts";
import { residentAt } from "../src/simulation.ts";
import {
  GPU_LOCAL_LIMIT_M,
  REBASE_THRESHOLD_M,
  LocalRenderFrame,
  convertTileGeometryToEnu,
} from "../src/render-frame.ts";
import {
  CANONICAL_METRES_PER_SOURCE_UNIT,
  canonicalCellId,
  lonLatToSource,
  normalizeLongitude,
  sourceToLonLat,
} from "../src/planet.ts";
import { tileAt } from "../src/world.ts";

const close = (actual: number, expected: number, tolerance: number, message?: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message ?? `${actual} should be within ${tolerance} of ${expected}`,
  );

test("local render frame round-trips canonical surface points at far, wrap and high latitude", () => {
  const origins = [
    [0, 14],
    [131_060, -40_000],
    [-131_060, 62_000],
  ] as const;
  for (const [ox, oz] of origins) {
    const frame = new LocalRenderFrame(ox, oz);
    for (const [dx, dz] of [
      [0, 0],
      [20, -15],
      [-90, 80],
    ] as const) {
      const sourceX = ox + dx,
        sourceZ = oz + dz,
        render = frame.sourceToRender(sourceX, sourceZ),
        restored = frame.renderToSource(render.x, render.z),
        original = sourceToLonLat(sourceX, sourceZ),
        roundTrip = sourceToLonLat(restored.x, restored.z);
      close(normalizeLongitude(roundTrip.lon - original.lon), 0, 2e-10);
      close(roundTrip.lat, original.lat, 2e-10);
      assert.equal(
        canonicalCellId(roundTrip.lon, roundTrip.lat),
        canonicalCellId(original.lon, original.lat),
      );
    }
  }
});

test("render frame stays canonical at cube edges, cube corners and both pole limits", () => {
  const cubeCornerLat = Math.asin(1 / Math.sqrt(3)),
    cases = [
      { name: "east/front edge", lon: Math.PI / 4, lat: 0 },
      { name: "positive cube corner", lon: Math.PI / 4, lat: cubeCornerLat },
      { name: "negative cube corner", lon: -3 * Math.PI / 4, lat: -cubeCornerLat },
      { name: "north pole", lon: 0, lat: Math.PI / 2 },
      { name: "south pole", lon: 0, lat: -Math.PI / 2 },
    ];
  for (const sample of cases) {
    const source = lonLatToSource(sample.lon, sample.lat),
      frame = new LocalRenderFrame(source.x, source.z),
      expectedId = canonicalCellId(sample.lon, sample.lat),
      initial = frame.sourceToRender(source.x, source.z),
      initialRoundTrip = frame.renderToLonLat(initial.x, initial.z);
    assert.equal(
      canonicalCellId(initialRoundTrip.lon, initialRoundTrip.lat),
      expectedId,
      `${sample.name} changed identity at its initial render origin`,
    );

    // Move the presentation origin without moving the canonical point under test.
    // At the poles move toward the equator because longitude itself is undefined.
    const rebaseX = Math.abs(sample.lat) === Math.PI / 2 ? source.x : source.x + 180,
      rebaseZ =
        sample.lat === Math.PI / 2
          ? source.z + 180
          : sample.lat === -Math.PI / 2
            ? source.z - 180
            : source.z + 70;
    assert.equal(frame.rebase(rebaseX, rebaseZ), true, `${sample.name} should rebase`);
    const moved = frame.sourceToRender(source.x, source.z),
      movedRoundTrip = frame.renderToLonLat(moved.x, moved.z);
    assert.equal(
      canonicalCellId(movedRoundTrip.lon, movedRoundTrip.lat),
      expectedId,
      `${sample.name} changed identity after rebase`,
    );
  }
});

test("rebasing is thresholded and cannot change canonical identity", () => {
  const frame = new LocalRenderFrame(0, 0),
    nearSource = REBASE_THRESHOLD_M / CANONICAL_METRES_PER_SOURCE_UNIT / 2,
    farSource = REBASE_THRESHOLD_M / CANONICAL_METRES_PER_SOURCE_UNIT * 1.2,
    target = sourceToLonLat(farSource + 8, 12),
    id = canonicalCellId(target.lon, target.lat);
  assert.equal(frame.maybeRebase(nearSource, 0), false);
  assert.equal(frame.stats.rebases, 0);
  assert.equal(frame.maybeRebase(farSource, 0), true);
  assert.equal(frame.stats.rebases, 1);
  const render = frame.sourceToRender(farSource + 8, 12),
    restored = frame.renderToLonLat(render.x, render.z);
  assert.equal(canonicalCellId(restored.lon, restored.lat), id);
  assert.equal(frame.stats.resourceRebuildsOnRebase, 0);
});

test("tile builder removes large source anchors before Float32 conversion", () => {
  const tile = tileAt(17, 131_068, 65_536),
    data = buildTile(tile),
    coordinates = Object.values(data).flatMap((geometry) =>
      Array.from(geometry.positions.filter((_, index) => index % 3 !== 1)),
    );
  assert.ok(coordinates.length > 0);
  assert.ok(
    Math.max(...coordinates.map(Math.abs)) <= tile.size,
    "patch vertices must be relative rather than planet-scale source positions",
  );
});

test("detailed tile ENU conversion stays inside the GPU envelope with sub-centimetre Float32 error", () => {
  // L9 is a 512-source-unit patch: its half-diagonal remains below the
  // canonical ±8192 m detailed-coordinate contract at the equator.
  const tile = tileAt(9, 511, 256),
    data = buildTile(tile),
    stats = convertTileGeometryToEnu(tile, data);
  assert.ok(stats.maxHorizontalM < GPU_LOCAL_LIMIT_M);
  assert.ok(stats.maxFloat32ErrorM < 0.01, `${stats.maxFloat32ErrorM} m Float32 error`);
  for (const geometry of Object.values(data)) {
    for (const value of geometry.positions) assert.ok(Number.isFinite(value));
    for (const value of geometry.normals) assert.ok(Number.isFinite(value));
  }
});

test("repeated reverse rebases preserve tile/cache identity and picking result", () => {
  const frame = new LocalRenderFrame(0, 0),
    tile = tileAt(17, 65_536, 65_536),
    key = tile.key,
    pickSource = { x: 24, z: -18 },
    canonical = sourceToLonLat(pickSource.x, pickSource.z),
    id = canonicalCellId(canonical.lon, canonical.lat);
  for (const sourceX of [400, -400, 400, 0]) {
    frame.rebase(sourceX, 0);
    const point = frame.sourceToRender(pickSource.x, pickSource.z),
      restored = frame.renderToLonLat(point.x, point.z);
    assert.equal(canonicalCellId(restored.lon, restored.lat), id);
    assert.equal(tile.key, key);
  }
  assert.equal(frame.stats.resourceRebuildsOnRebase, 0);
});

test("presentation-only rebases cannot mutate simulation positions or route costs", () => {
  const frame = new LocalRenderFrame(villages[0].x, villages[0].z),
    residentBefore = residentAt(villages[0], 17, 12_345),
    routeBefore = {
      code: roads[0].code,
      surfaceLengthM: roads[0].surfaceLengthM,
      walkSeconds: roads[0].walkSeconds,
      fantasyWalkSeconds: roads[0].fantasyWalkSeconds,
    };
  for (const [x, z] of [
    [villages.at(-1)!.x, villages.at(-1)!.z],
    [131_060, -62_000],
    [-131_060, 62_000],
    [villages[0].x, villages[0].z],
  ] as const)
    frame.rebase(x, z);
  assert.deepEqual(residentAt(villages[0], 17, 12_345), residentBefore);
  assert.deepEqual(
    {
      code: roads[0].code,
      surfaceLengthM: roads[0].surfaceLengthM,
      walkSeconds: roads[0].walkSeconds,
      fantasyWalkSeconds: roads[0].fantasyWalkSeconds,
    },
    routeBefore,
  );
  assert.equal(frame.stats.resourceRebuildsOnRebase, 0);
});
