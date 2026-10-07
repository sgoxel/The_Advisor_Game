import { test } from "node:test";
import assert from "node:assert/strict";
import { cellAt, WORLD_SIZE } from "../src/world.ts";
import { villages, cities } from "../src/geography.ts";
import {
  PLANET_CIRCUMFERENCE,
  PLANET_RADIUS,
  POLE_DISTANCE,
  CANONICAL_PLANET_RADIUS,
  CANONICAL_PLANET_CIRCUMFERENCE,
  flatToLonLat,
  lonLatToFlat,
  lonLatToUnit,
  unitToLonLat,
  wrapX,
} from "../src/planet.ts";

test("the transitional source domain wraps exactly while canonical physical scale is explicit", () => {
  assert.equal(CANONICAL_PLANET_RADIUS, 637100);
  assert.ok(Math.abs(CANONICAL_PLANET_CIRCUMFERENCE - 4003017.36) < 0.01);
  assert.equal(PLANET_CIRCUMFERENCE, WORLD_SIZE);
  assert.ok(Math.abs(2 * Math.PI * PLANET_RADIUS - WORLD_SIZE) < 1e-6);
  assert.equal(POLE_DISTANCE, WORLD_SIZE / 4);
  assert.equal(wrapX(WORLD_SIZE / 2), -WORLD_SIZE / 2);
  assert.equal(wrapX(-WORLD_SIZE / 2 - 3), WORLD_SIZE / 2 - 3);
  assert.equal(wrapX(5 + 3 * WORLD_SIZE), 5);
});
test("a flat position mapped to the globe and back returns to the same cell", () => {
  const points: [number, number][] = [
    [1, 1],
    [-0.5, -0.5],
    [125, 14],
    [-80000, 6500],
    [80000.5, -31000.25],
    [-131071, 65000],
    [131071, -65000],
    ...[...villages, ...cities].map((p) => [p.x, p.z] as [number, number]),
  ];
  for (const [px, pz] of points) {
    // Cell centres: a position exactly on a cell edge has no single owner to return to.
    const x = Math.floor(px / 2) * 2 + 1,
      z = Math.floor(pz / 2) * 2 + 1;
    const { lon, lat } = flatToLonLat(x, z);
    assert.ok(lon >= -Math.PI && lon < Math.PI);
    assert.ok(Math.abs(lat) <= Math.PI / 2);
    const globe = unitToLonLat(lonLatToUnit(lon, lat));
    const back = lonLatToFlat(globe.lon, globe.lat);
    assert.ok(Math.abs(back.x - x) < 1e-6 && Math.abs(back.z - z) < 1e-6);
    assert.equal(cellAt(back.x, back.z).code, cellAt(x, z).code);
  }
});
test("globe axes: north pole up, east to the right of longitude zero", () => {
  const close = (a: number[], b: number[]) =>
    a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-12));
  close(lonLatToUnit(0, 0), [0, 0, 1]);
  close(lonLatToUnit(Math.PI / 2, 0), [1, 0, 0]);
  close(lonLatToUnit(0, Math.PI / 2), [0, 1, 0]);
  // North is -Z on the flat map, so travelling north raises latitude.
  assert.ok(flatToLonLat(0, -1000).lat > 0);
  assert.ok(flatToLonLat(1000, 0).lon > 0);
  // Positions beyond a pole stay on the pole.
  assert.equal(flatToLonLat(0, -POLE_DISTANCE * 2).lat, Math.PI / 2);
});
