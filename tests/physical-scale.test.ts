import test from "node:test";
import assert from "node:assert/strict";
import { houseDimensionsFor, residentDimensionsFor, sourceUnitsPerMetreAt } from "../src/physical-scale.ts";
import { CANONICAL_METRES_PER_SOURCE_UNIT as K, lonLatToSource, sourceToLonLat, greatCircleDistance } from "../src/planet.ts";
import { cities, villages } from "../src/geography.ts";
import { featuresFor, tileForPosition } from "../src/world.ts";
import { buildTile } from "../src/geometry.ts";
import { convertTileGeometryToEnu } from "../src/render-frame.ts";

test("physical offsets preserve metre lengths at equatorial and high-latitude settlements", () => {
  for (const lat of [0, .2, 1.15]) {
    const p = lonLatToSource(.3, lat), scale = sourceUnitsPerMetreAt(p.z), a = sourceToLonLat(p.x, p.z);
    assert.ok(Math.abs(greatCircleDistance(a, sourceToLonLat(p.x + 8 * scale.x, p.z)) - 8) < .001);
    assert.ok(Math.abs(greatCircleDistance(a, sourceToLonLat(p.x, p.z + 8 * scale.z)) - 8) < .001);
  }
});

test("seeded exterior sizes allow usable rooms without generating interiors", () => {
  const types = new Set<string>();
  for (const city of [false, true]) for (let i = 0; i < 200; i++) {
    const house = houseDimensionsFor(`fixture/${i}`, city), usablePerFloor = (house.widthM - .4) * (house.depthM - .4);
    types.add(house.houseType);
    assert.ok(usablePerFloor >= 6 - 1e-9);
    if (house.houseType === "shack") { assert.equal(house.roomCount, 1); assert.ok(Math.abs(usablePerFloor - 6) < 1e-9); }
    else assert.ok(usablePerFloor * house.storeys >= house.roomCount * 9 + 6, "rooms need plausible usable area and circulation");
    assert.equal("rooms" in house, false);
    assert.equal("interior" in house, false);
    assert.deepEqual(house, houseDimensionsFor(`fixture/${i}`, city));
  }
  assert.equal(types.size, 4);
});

test("resident silhouettes have adult human dimensions in physical metres", () => {
  for (let silhouette = 0; silhouette < 5; silhouette++) {
    const size = residentDimensionsFor(silhouette);
    assert.ok(size.heightM >= 1.6 && size.heightM <= 1.9);
    assert.ok(size.widthM >= .5 && size.widthM <= .75);
  }
});

test("actual rendered house walls match their physical foundation after ENU conversion", () => {
  for (const place of [villages[0], cities[0]]) {
    const neighbourhood = featuresFor(tileForPosition(place.x, place.z, 9)), home = neighbourhood.find(f => f.kind === "residence");
    assert.ok(home?.house, "fixture needs a real residence");
    const tile = tileForPosition(home.x, home.z, 17), geometry = buildTile(tile);
    assert.equal(featuresFor(tile).filter(f => f.kind === "residence").length, 1, "measure one owned house");
    convertTileGeometryToEnu(tile, geometry);
    const g = geometry.structures, points: number[][] = [], wallColors = [[185,174,145],[167,160,139],[196,181,149]];
    for (let i = 0; i < g.positions.length / 3; i++) if (wallColors.some(c => c.every((v,j) => g.colors[i*4+j] === v))) points.push(Array.from(g.positions.slice(i*3,i*3+3), v => v*K));
    assert.ok(points.length > 0);
    const low = Math.min(...points.map(p => p[1])), high = Math.max(...points.map(p => p[1]));
    assert.ok(Math.abs(high-low-home.house.wallHeightM) < .01, "wall height must not retain source-unit inflation");
    const ground = points.filter(p => Math.abs(p[1]-low)<.001), lengths = new Set<string>();
    for (const p of ground) for (const q of ground) { const d = Math.hypot(p[0]-q[0],p[2]-q[2]); if (d>.01) lengths.add(d.toFixed(2)); }
    for (const expected of [home.widthM!,home.depthM!]) assert.ok([...lengths].some(v => Math.abs(Number(v)-expected)<.02), `wall side ${expected} m missing: ${[...lengths]}`);
  }
});
