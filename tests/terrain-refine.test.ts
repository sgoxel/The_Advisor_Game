import test from "node:test";
import assert from "node:assert/strict";
import { buildTile } from "../src/geometry.ts";
import { refineTerrainGeometry } from "../src/terrain-refine.ts";
import { places } from "../src/geography.ts";
import { tileForPosition } from "../src/world.ts";

test("local terrain refinement increases sampling without changing tile authority", () => {
  const village = places.find((place) => place.kind === "village");
  assert.ok(village);
  const tile = tileForPosition(village.x, village.z, 10);
  const base = buildTile(tile).terrain;
  const refined = refineTerrainGeometry(tile, base);
  assert.ok(refined.positions.length > base.positions.length);
  assert.equal(refined.positions.length, refined.normals.length);
  assert.equal((refined.positions.length / 3) * 4, refined.colors.length);
  assert.ok(refined.indices.length > 0);
});

test("refined local terrain keeps finite geometry and bounded triangle growth", () => {
  const village = places.find((place) => place.kind === "village");
  assert.ok(village);
  const tile = tileForPosition(village.x, village.z, 11);
  const refined = refineTerrainGeometry(tile, buildTile(tile).terrain);
  assert.ok(Array.from(refined.positions).every(Number.isFinite));
  assert.ok(Array.from(refined.normals).every(Number.isFinite));
  const triangles = refined.indices.length / 3;
  assert.ok(triangles > 100);
  assert.ok(triangles < 12_000, `refined terrain must remain bounded; got ${triangles}`);
});
