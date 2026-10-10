import { strict as assert } from "node:assert";
import { test } from "node:test";
import { places } from "../src/geography.ts";
import { buildSettlementGeometry } from "../src/settlement-render.ts";
import { featuresFor, type Tile } from "../src/world.ts";

const settlementKinds = new Set(["house", "keep", "field", "well", "wall", "gate", "guard-post", "street"]);

function village() {
  const place = places.find((candidate) => candidate.kind === "village");
  assert.ok(place, "generated registry must contain a village");
  return place;
}

function tileAround(size: number): Tile {
  const place = village();
  return {
    level: 0,
    x: Math.floor(place.x / size),
    z: Math.floor(place.z / size),
    size,
    minX: Math.floor(place.x / size) * size,
    minZ: Math.floor(place.z / size) * size,
  };
}

function hashGeometry(geometry: ReturnType<typeof buildSettlementGeometry>) {
  assert.ok(geometry);
  let hash = 2166136261;
  for (const group of [geometry.structures, geometry.detail]) {
    for (const value of group.positions) {
      const quantized = Math.round(value * 1000);
      hash = Math.imul(hash ^ quantized, 16777619) >>> 0;
    }
    for (const value of group.indices) hash = Math.imul(hash ^ value, 16777619) >>> 0;
  }
  return hash >>> 0;
}

test("coarse tiles do not materialize detailed settlement features or meshes", () => {
  const tile = tileAround(1024),
    detailed = featuresFor(tile).filter((feature) => settlementKinds.has(feature.kind));
  assert.equal(detailed.length, 0, "coarse world coverage must not instantiate building/street/border detail");
  assert.equal(buildSettlementGeometry(tile), null, "coarse presentation must not allocate a settlement mesh");
});

test("focused local tile exposes canonical settlement features", () => {
  const tile = tileAround(128),
    features = featuresFor(tile),
    buildings = features.filter((feature) => feature.kind === "house" || feature.kind === "keep"),
    streets = features.filter((feature) => feature.kind === "street");
  assert.ok(buildings.length > 0, "focused tile should contain canonical structures");
  assert.ok(streets.length > 0, "focused tile should contain canonical street segments");
  assert.ok(buildings.some((feature) => feature.role && feature.width && feature.depth), "building render records must retain functional form metadata");
});

test("focused settlement mesh is deterministic and bounded", () => {
  const tile = tileAround(128),
    first = buildSettlementGeometry(tile),
    second = buildSettlementGeometry(tile);
  assert.ok(first && second);
  assert.equal(hashGeometry(first), hashGeometry(second));
  const triangles = (first.structures.indices.length + first.detail.indices.length) / 3;
  assert.ok(triangles > 0);
  assert.ok(triangles < 120_000, `focused settlement mesh unexpectedly large: ${triangles} triangles`);
});
