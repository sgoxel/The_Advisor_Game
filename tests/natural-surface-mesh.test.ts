import assert from "node:assert/strict";
import test from "node:test";
import {
  rebuildNaturalSurface,
  NATURAL_MESH_LIMITS,
} from "../src/natural-surface-mesh.ts";
import { buildTile } from "../src/geometry.ts";
import { drainageRecipes } from "../src/hydrology.ts";
import { tileForPosition, finalSurfaceAt } from "../src/world.ts";
import { SOURCE_PRESENTATION_WIDTH } from "../src/planet.ts";

test("natural replacement is bounded and its visible vertices use composed water/ground", () => {
  const p =
    drainageRecipes[0].points[Math.floor(drainageRecipes[0].points.length * 0.55)];
  for (const level of [9, 11, 13, 15]) {
    const tile = tileForPosition(p.x, p.z, level),
      r = rebuildNaturalSurface(tile, buildTile(tile).terrain);
    assert.ok(r.replaced);
    assert.ok(r.leaves <= NATURAL_MESH_LIMITS.leaves);
    assert.ok(r.samples <= NATURAL_MESH_LIMITS.samples);
    assert.ok(
      r.cpuScratchBytesEstimated <= 32 * 1024 * 1024,
      `${tile.key} scratch ${r.cpuScratchBytesEstimated}`,
    );
    assert.ok(r.surfaceVertices > 0);
    assert.ok(
      r.surfaceVertices <= r.geometry.positions.length / 3,
      "visible surface range must precede skirt-only vertices",
    );
    assert.ok(
      r.geometry.indices.length > r.geometry.positions.length / 3,
      "adaptive triangles must reuse indexed vertices instead of duplicating every corner",
    );
    const originX = tile.minX + tile.size / 2,
      originZ = tile.minZ + tile.size / 2,
      surfaceKeys = new Set<string>();
    for (let v = 0; v < r.surfaceVertices; v++) {
      const i = v * 3,
        x = r.geometry.positions[i] + originX,
        y = r.geometry.positions[i + 1],
        z = r.geometry.positions[i + 2] + originZ,
        key = `${x}/${z}/${y}`,
        nx = r.geometry.normals[i],
        ny = r.geometry.normals[i + 1],
        nz = r.geometry.normals[i + 2];
      assert.ok(!surfaceKeys.has(key), `${tile.key} duplicated visible vertex ${key}`);
      surfaceKeys.add(key);
      assert.ok(
        Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-4,
        `${tile.key} visible normal is not normalized`,
      );
      if (v % 61 === 0) {
        const s = finalSurfaceAt(x, z),
          expected =
            s.water.kind === "none" ? s.groundHeight : s.water.level + 0.0025;
        assert.ok(
          Math.abs(y - expected) < 1e-3,
          `${tile.key} conceals composed surface`,
        );
      }
    }
  }
});

test("natural replacement repeats independently and closes the east-west source seam", () => {
  const p = drainageRecipes[0].points[8],
    tile = tileForPosition(p.x, p.z, 13),
    base = buildTile(tile).terrain,
    a = rebuildNaturalSurface(tile, base),
    b = rebuildNaturalSurface(
      { ...tile, minX: tile.minX + SOURCE_PRESENTATION_WIDTH },
      base,
    );
  assert.equal(a.leaves, b.leaves);
  assert.equal(a.samples, b.samples);
  assert.equal(a.surfaceVertices, b.surfaceVertices);
  for (let i = 0; i < a.geometry.positions.length; i += 97)
    assert.ok(Math.abs(a.geometry.positions[i] - b.geometry.positions[i]) < 1e-5);
  for (let i = 0; i < a.geometry.indices.length; i += 97)
    assert.equal(a.geometry.indices[i], b.geometry.indices[i]);
});