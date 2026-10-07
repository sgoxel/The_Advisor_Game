import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_PLANET_CIRCUMFERENCE,
  CANONICAL_PLANET_DIAMETER,
  CANONICAL_PLANET_RADIUS,
  CANONICAL_POLE_DISTANCE,
  PLANET_AUTHORITY,
  SOURCE_PRESENTATION_WIDTH,
  canonicalCell,
  canonicalCellId,
  cartesianToPosition,
  cubeFaceToUnit,
  enuToPosition,
  greatCircleDistance,
  lonLatToCartesian,
  lonLatToMeters,
  metersToLonLat,
  normalizeLongitude,
  positionToEnu,
  sourceToLonLat,
  unitToCubeFace,
  wrapCanonicalX,
} from "../src/planet.ts";

const close = (actual: number, expected: number, tolerance: number, message?: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message ?? `${actual} should be within ${tolerance} of ${expected}`,
  );

test("canonical physical planet constants are the only authoritative scale", () => {
  assert.equal(CANONICAL_PLANET_RADIUS, 637_100);
  assert.equal(CANONICAL_PLANET_DIAMETER, 1_274_200);
  close(CANONICAL_PLANET_CIRCUMFERENCE, 4_003_017.359204114, 1e-6);
  close(CANONICAL_POLE_DISTANCE, 1_000_754.3398010285, 1e-6);
  assert.equal(PLANET_AUTHORITY.radiusM, CANONICAL_PLANET_RADIUS);
  assert.equal(PLANET_AUTHORITY.identity, "cube-sphere-quadtree");
  assert.equal(PLANET_AUTHORITY.authoritativeCoordinates, "lon-lat-elevation");
  assert.notEqual(SOURCE_PRESENTATION_WIDTH, CANONICAL_PLANET_CIRCUMFERENCE);
});

test("longitude and wrapped canonical metres repeat exactly after a full turn", () => {
  const samples = [-Math.PI, -2.3, -0.1, 0, 1.25, Math.PI - 1e-8];
  for (const lon of samples) {
    close(normalizeLongitude(lon + Math.PI * 2), normalizeLongitude(lon), 1e-12);
    close(normalizeLongitude(lon - Math.PI * 2), normalizeLongitude(lon), 1e-12);
    const metres = lonLatToMeters(lon, 0).wrappedX;
    close(wrapCanonicalX(metres + CANONICAL_PLANET_CIRCUMFERENCE), metres, 1e-7);
    close(wrapCanonicalX(metres - CANONICAL_PLANET_CIRCUMFERENCE), metres, 1e-7);
    assert.equal(canonicalCellId(lon, 0), canonicalCellId(lon + Math.PI * 2, 0));
    assert.equal(canonicalCellId(lon, 0), canonicalCellId(lon - Math.PI * 2, 0));
  }
});

test("canonical metres and planet-centred Cartesian positions round-trip", () => {
  const points = [
    { lon: 0, lat: 0, elevation: 0 },
    { lon: -2.8, lat: 1.1, elevation: 142.25 },
    { lon: Math.PI - 1e-7, lat: -0.74, elevation: -2.8 },
    { lon: -Math.PI + 1e-7, lat: 0.42, elevation: 1000 },
  ];
  for (const point of points) {
    const metres = lonLatToMeters(point.lon, point.lat, point.elevation),
      fromMetres = metersToLonLat(metres.wrappedX, metres.northM),
      fromCartesian = cartesianToPosition(
        lonLatToCartesian(point.lon, point.lat, point.elevation),
      );
    close(normalizeLongitude(fromMetres.lon - point.lon), 0, 1e-12);
    close(fromMetres.lat, point.lat, 1e-12);
    close(normalizeLongitude(fromCartesian.lon - point.lon), 0, 1e-12);
    close(fromCartesian.lat, point.lat, 1e-12);
    close(fromCartesian.elevation, point.elevation, 1e-8);
  }
});

test("both poles have stable single-face ownership", () => {
  for (const lat of [Math.PI / 2, -Math.PI / 2]) {
    const ids = [0, 0.7, -2.2, Math.PI - 0.01].map((lon) =>
      canonicalCell(lon, lat, 20),
    );
    assert.ok(ids.every((cell) => cell.id === ids[0].id));
    assert.equal(ids[0].face, lat > 0 ? 2 : 3);
  }
});

test("cube face edge and corner ties have deterministic ownership", () => {
  assert.equal(unitToCubeFace([1, 1, 0]).face, 0, "X wins an X/Y edge tie");
  assert.equal(unitToCubeFace([1, 1, 1]).face, 0, "X wins a three-way corner tie");
  assert.equal(unitToCubeFace([-1, 1, 1]).face, 1, "negative X owns its tied corner");
  assert.equal(unitToCubeFace([0, 1, 1]).face, 2, "Y wins a Y/Z edge tie");
  assert.equal(unitToCubeFace([0, -1, 1]).face, 3, "negative Y owns its tied edge");
  for (const face of [0, 1, 2, 3, 4, 5] as const) {
    const mapped = unitToCubeFace(cubeFaceToUnit(face, 0.25, -0.4));
    assert.equal(mapped.face, face);
    close(mapped.u, 0.25, 1e-12);
    close(mapped.v, -0.4, 1e-12);
  }
});

test("great-circle distance takes the short antimeridian path", () => {
  const deg = Math.PI / 180,
    distance = greatCircleDistance(
      { lon: 179.9 * deg, lat: 0 },
      { lon: -179.9 * deg, lat: 0 },
    ),
    expected = CANONICAL_PLANET_RADIUS * 0.2 * deg;
  close(distance, expected, 1e-7);
  assert.ok(distance < 2500);
});

test("ENU conversion is reversible at representative far-from-origin locations", () => {
  const origins = [
    { lon: 0, lat: 0, elevation: 12 },
    { lon: 2.8, lat: 1.2, elevation: 400 },
    { lon: -3.0, lat: -1.1, elevation: 4 },
  ];
  for (const origin of origins) {
    const target = enuToPosition({ east: 812.25, north: -407.5, up: 18 }, origin),
      local = positionToEnu(target, origin);
    close(local.east, 812.25, 1e-7);
    close(local.north, -407.5, 1e-7);
    close(local.up, 18, 1e-7);
  }
});

test("transitional source wrap maps to one canonical identity without becoming authority", () => {
  const samples = [
    [0, 0],
    [12_345.5, -20_000.25],
    [-131_071, 65_000],
  ] as const;
  for (const [x, z] of samples) {
    const a = sourceToLonLat(x, z),
      east = sourceToLonLat(x + SOURCE_PRESENTATION_WIDTH, z),
      west = sourceToLonLat(x - SOURCE_PRESENTATION_WIDTH, z);
    close(normalizeLongitude(a.lon - east.lon), 0, 1e-12);
    close(normalizeLongitude(a.lon - west.lon), 0, 1e-12);
    assert.equal(canonicalCellId(a.lon, a.lat), canonicalCellId(east.lon, east.lat));
    assert.equal(canonicalCellId(a.lon, a.lat), canonicalCellId(west.lon, west.lat));
  }
});

test("canonical IDs are query-order independent", () => {
  const points = [
    { lon: -3.1, lat: 0.1 },
    { lon: 1.7, lat: -0.6 },
    { lon: 0, lat: Math.PI / 2 },
    { lon: 2.2, lat: 1.2 },
    { lon: -0.7, lat: -1.4 },
  ];
  const first = new Map(points.map((point) => [JSON.stringify(point), canonicalCellId(point.lon, point.lat)]));
  for (const point of [...points].reverse())
    assert.equal(canonicalCellId(point.lon, point.lat), first.get(JSON.stringify(point)));
});
