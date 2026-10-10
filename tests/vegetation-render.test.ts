import assert from "node:assert/strict";
import test from "node:test";
import { cities } from "../src/geography.ts";
import { buildVegetationGeometry } from "../src/vegetation-render.ts";
import { vegetationForTile } from "../src/vegetation.ts";
import type { Tile } from "../src/world.ts";

function tile(minX: number, minZ: number, size = 256): Tile {
  return {
    level: 0,
    x: 0,
    z: 0,
    key: `render/${minX}/${minZ}/${size}`,
    size,
    minX,
    minZ,
  };
}

function populatedTile() {
  for (let index = 0; index < Math.min(24, cities.length); index++) {
    const place = cities[index],
      inward = place.x > 0 ? -1 : 1,
      candidate = tile(
        place.x + inward * (500 + (index % 3) * 36),
        place.z + (index % 2 === 0 ? -180 : 180),
      );
    if (vegetationForTile(candidate).features.length) return candidate;
  }
  throw new Error("No populated seeded vegetation render probe found");
}

test("presentation silhouette geometry is deterministic and telemetry matches actual buffers", () => {
  const sample = populatedTile(),
    first = buildVegetationGeometry(sample),
    second = buildVegetationGeometry(sample),
    triangles = first.geometry.indices.length / 3;
  assert.deepEqual(first, second);
  assert.equal(first.telemetry.triangles, triangles);
  assert.ok(first.telemetry.visibleInstances > 0);
  assert.ok(triangles <= first.telemetry.maxTriangles);
  assert.equal(first.telemetry.drawCalls, 1);
  assert.equal(first.telemetry.materialCount, 1);
  assert.ok(first.geometry.positions.every(Number.isFinite));
});
