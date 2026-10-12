import test from "node:test";
import assert from "node:assert/strict";
import { buildTile } from "../src/geometry.ts";
import { places } from "../src/geography.ts";
import { polishRuntimeTerrain } from "../src/terrain-polish.ts";
import { tileForPosition } from "../src/world.ts";

test("runtime terrain refinement is finite, denser and bounded", () => {
  const village = places.find((place) => place.kind === "village");
  assert.ok(village);
  const tile = tileForPosition(village.x, village.z, 10),
    base = buildTile(tile).terrain,
    refined = polishRuntimeTerrain(tile, base);
  assert.ok(refined.positions.length > base.positions.length);
  assert.equal(refined.positions.length, refined.normals.length);
  assert.equal((refined.positions.length / 3) * 4, refined.colors.length);
  assert.ok(refined.uvs);
  assert.equal((refined.positions.length / 3) * 2, refined.uvs.length);
  assert.ok(Array.from(refined.positions).every(Number.isFinite));
  assert.ok(Array.from(refined.normals).every(Number.isFinite));
  assert.ok(Array.from(refined.uvs).every(Number.isFinite));
  const triangles = refined.indices.length / 3;
  assert.ok(triangles > 100);
  assert.ok(triangles < 20_000, `runtime refinement must remain bounded; got ${triangles}`);
});

test("Country-size patches retain the established coarse mesh budget", () => {
  const village = places.find((place) => place.kind === "village");
  assert.ok(village);
  const tile = tileForPosition(village.x, village.z, 8),
    base = buildTile(tile).terrain,
    refined = polishRuntimeTerrain(tile, base);
  if (tile.size >= 1024) assert.equal(refined, base);
});
