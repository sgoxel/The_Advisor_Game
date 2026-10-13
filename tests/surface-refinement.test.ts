import assert from "node:assert/strict";
import test from "node:test";
import { buildTile } from "../src/geometry.ts";
import { roads } from "../src/geography.ts";
import {
  REFINED_BRIDGE_HALF_WIDTH_SOURCE,
  REFINED_BRIDGE_RGB,
  refineTileSurfacePresentation,
  refinementResolutionForTileSize,
} from "../src/surface-refinement.ts";
import { tileForPosition } from "../src/world.ts";

const hasVertexColor = (colors: Uint8Array, rgb: readonly number[]) => {
  for (let i = 0; i < colors.length; i += 4)
    if (colors[i] === rgb[0] && colors[i + 1] === rgb[1] && colors[i + 2] === rgb[2])
      return true;
  return false;
};

test("surface refinement remains bounded by tile size", () => {
  assert.equal(refinementResolutionForTileSize(128, true, true), 0);
  assert.equal(refinementResolutionForTileSize(64, true, false), 32);
  assert.equal(refinementResolutionForTileSize(16, false, true), 16);
  assert.equal(refinementResolutionForTileSize(16, false, false), 0);
});

test("representative crossing replaces the legacy slab with a narrow authoritative deck", () => {
  const road = roads[0];
  assert.ok(road);
  const x = (road.fromX + road.toX) / 2,
    z = (road.fromZ + road.toZ) / 2,
    tile = tileForPosition(x, z, 14),
    base = buildTile(tile),
    terrainVertices = base.terrain.positions.length,
    refined = refineTileSurfacePresentation(tile, base);
  assert.ok(refined.terrain.positions.length > terrainVertices, "alias-prone bank must receive finer canonical samples");
  assert.ok(refined.terrain.uvs);
  assert.equal(refined.terrain.uvs!.length, (refined.terrain.positions.length / 3) * 2);
  assert.ok(hasVertexColor(refined.structures.colors, REFINED_BRIDGE_RGB), "refined deck must be rendered");
  assert.equal(hasVertexColor(refined.structures.colors, [115, 88, 56]), false, "legacy wide slab must be removed");

  const vx = road.toX - road.fromX,
    vz = road.toZ - road.fromZ,
    length = Math.hypot(vx, vz),
    ux = vx / length,
    uz = vz / length,
    originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2;
  let maxAcross = 0,
    matched = 0;
  for (let vertex = 0; vertex < refined.structures.positions.length / 3; vertex++) {
    const c = vertex * 4;
    if (
      refined.structures.colors[c] !== REFINED_BRIDGE_RGB[0] ||
      refined.structures.colors[c + 1] !== REFINED_BRIDGE_RGB[1] ||
      refined.structures.colors[c + 2] !== REFINED_BRIDGE_RGB[2]
    )
      continue;
    const p = vertex * 3,
      px = originX + refined.structures.positions[p],
      pz = originZ + refined.structures.positions[p + 2],
      dx = px - x,
      dz = pz - z,
      across = Math.abs(dx * -uz + dz * ux);
    maxAcross = Math.max(maxAcross, across);
    matched++;
  }
  assert.ok(matched > 0);
  assert.ok(
    maxAcross <= REFINED_BRIDGE_HALF_WIDTH_SOURCE + 0.05,
    `bridge half-width ${maxAcross} exceeded ${REFINED_BRIDGE_HALF_WIDTH_SOURCE}`,
  );
});
