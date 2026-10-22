import {CANONICAL_METRES_PER_SOURCE_UNIT, wrapSourceX} from "../src/planet.ts";
import {convertTileGeometryToEnu} from "../src/render-frame.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { buildTile } from "../src/geometry.ts";
import { roads, roadDistanceAt } from "../src/geography.ts";
import { siteAccessRoads } from "../src/sites.ts";
import {
  REFINED_BRIDGE_HALF_WIDTH_SOURCE,
  REFINED_BRIDGE_RGB,
  REFINED_ROAD_HALF_WIDTH_SOURCE,
  refineTileSurfacePresentation,
  refinementResolutionForTile,
} from "../src/surface-refinement.ts";
import {
  finalSurfaceAt,
  finalSurfaceEvidenceAnchors,
  tileAt,
  tileForPosition,
} from "../src/world.ts";

const hasVertexColor = (colors: Uint8Array, rgb: readonly number[]) => {
  for (let i = 0; i < colors.length; i += 4)
    if (
      colors[i] === rgb[0] &&
      colors[i + 1] === rgb[1] &&
      colors[i + 2] === rgb[2]
    )
      return true;
  return false;
};

test("surface refinement remains bounded by tile size", () => {
  assert.equal(refinementResolutionForTile(tileAt(11, 0, 0), true, true), 0);
  assert.equal(refinementResolutionForTile(tileAt(10, 0, 0), false, true), 0);
  assert.equal(refinementResolutionForTile(tileAt(9, 0, 0), false, true), 0);
  assert.equal(refinementResolutionForTile(tileAt(8, 0, 0), false, true), 0);
  assert.equal(refinementResolutionForTile(tileAt(7, 0, 0), false, true), 0);
  assert.equal(refinementResolutionForTile(tileAt(6, 0, 0), false, true), 0);
  assert.equal(refinementResolutionForTile(tileAt(12, 0, 0), true, false), 32);
  assert.equal(refinementResolutionForTile(tileAt(14, 0, 0), false, true), 16);
  assert.equal(refinementResolutionForTile(tileAt(14, 0, 0), false, false), 0);
});

test("S005 critical-site access uses fine ground refinement from its physical road", () => {
  const branch = siteAccessRoads[0];
  assert.ok(branch.centerline && branch.centerline.length > 2);
  const station = branch.centerline[Math.floor(branch.centerline.length / 2)];
  assert.equal(finalSurfaceAt(station.x, station.z).water.kind, "none",
    "canonical site access midpoint must stay on dry land");
  const tile = tileForPosition(station.x, station.z, 15),
    base = buildTile(tile),
    before = base.terrain.positions.length,
    refined = refineTileSurfacePresentation(tile, base);
  assert.ok(refined.terrain.positions.length > before,
    "critical-site access branch must enable close-range terrain refinement");
  assert.equal(refined.terrain.uvs?.length, refined.terrain.positions.length / 3 * 2,
    "refined access terrain must retain canonical projection UVs");
});

test("S005 close dry-road coverage follows the same canonical centerline as inspection", () => {
  const road = siteAccessRoads[0];
  assert.ok(road.centerline && road.centerline.length > 2);
  let middle: { x: number; z: number } | undefined;
  for (let i = 1; i < road.centerline.length; i++) {
    const a = road.centerline[i - 1], b = road.centerline[i],
      x = wrapSourceX(a.x + wrapSourceX(b.x - a.x) / 2),
      z = (a.z + b.z) / 2,
      surface = finalSurfaceAt(x, z);
    if (surface.water.kind === "none" && surface.walkable &&
        surface.groundMaterial === "Road" && surface.contributingModifierIds.includes(road.code)) {
      middle = { x, z };
      break;
    }
  }
  assert.ok(middle, "a real site access edge must retain dry canonical road support");
  const tile = tileForPosition(middle.x, middle.z, 15),
    base = buildTile(tile),
    originalVertices = base.terrain.positions.length / 3,
    refined = refineTileSurfacePresentation(tile, base, true);
  let added = 0;
  const ox = tile.minX + tile.size / 2, oz = tile.minZ + tile.size / 2;
  for (let vertex = originalVertices; vertex < refined.terrain.positions.length / 3; vertex++) {
    const p = vertex * 3, x = ox + refined.terrain.positions[p],
      z = oz + refined.terrain.positions[p + 2],
      surface = finalSurfaceAt(x, z);
    assert.equal(refined.terrain.colors[vertex * 4 + 3], 255,
      "only road-coverage triangles may be appended in preserve-ground mode");
    assert.equal(surface.water.kind, "none", "ground road coverage must never cover real water");
    assert.ok(surface.walkable, "ground road coverage must never invent blocked traversal");
    // Other canonically connected roads can share this tile; select only the
    // known site branch when certifying exact recorded-centerline alignment.
    if (roadDistanceAt(x, z, road) > REFINED_ROAD_HALF_WIDTH_SOURCE + 0.05) continue;
    assert.ok(surface.contributingModifierIds.includes(road.code),
      "site road strip must never invent an unowned physical connection");
    added++;
  }
  assert.ok(added >= 6, "close road must expose a visible bounded canonical strip");
  assert.equal(refined.terrain.uvs?.length, refined.terrain.positions.length / 3 * 2,
    "road coverage retains the same projection UVs as the final ground");
});

test("an actual natural-water road crossing refines to a narrow authoritative deck", () => {
  const evidence = finalSurfaceEvidenceAnchors(),
    road = roads.find((candidate) => candidate.code === evidence.roadCode);
  assert.ok(road, `missing evidence road ${evidence.roadCode}`);
  assert.ok(evidence.bridgeSpanM > 0 && evidence.bridgeSpanM <= 120);

  const x = evidence.bridge.x,
    z = evidence.bridge.z,
    tile = tileForPosition(x, z, 14),
    base = buildTile(tile),
    terrainVertices = base.terrain.positions.length,
    refined = refineTileSurfacePresentation(tile, base);
  assert.ok(
    refined.terrain.positions.length > terrainVertices,
    "natural bank must receive finer canonical samples",
  );
  assert.ok(refined.terrain.uvs);
  assert.equal(
    refined.terrain.uvs!.length,
    (refined.terrain.positions.length / 3) * 2,
  );
  assert.ok(
    hasVertexColor(refined.structures.colors, REFINED_BRIDGE_RGB),
    "refined deck must be rendered at the actual natural crossing",
  );
  assert.equal(
    hasVertexColor(refined.structures.colors, [115, 88, 56]),
    false,
    "legacy wide slab must be removed",
  );

  // Upright guardrails add real height, not a 6 cm floating line.
  const railColumns = new Map<string, { low: number; high: number }>();
  for (let vertex = 0; vertex < refined.structures.positions.length / 3; vertex++) {
    const c = vertex * 4;
    if (refined.structures.colors[c] !== 181 || refined.structures.colors[c + 1] !== 143 ||
        refined.structures.colors[c + 2] !== 92) continue;
    const p = vertex * 3,
      key = `${refined.structures.positions[p].toFixed(4)}/${refined.structures.positions[p + 2].toFixed(4)}`,
      y = refined.structures.positions[p + 1],
      column = railColumns.get(key);
    if (column) {
      column.low = Math.min(column.low, y);
      column.high = Math.max(column.high, y);
    } else railColumns.set(key, { low: y, high: y });
  }
  assert.ok([...railColumns.values()].some(({ low, high }) => high - low >= 1.1),
    "canonical bridge must visibly have >=1.1 m upright guardrail faces");

  // River-side rails need front-facing triangles, not only inward-facing
  // walls that get culled outside the road. Both sides must remain visible
  // without changing the traversed deck or its canonical dimensions.
  const tangent = evidence.bridgeTangent,
    tangentLength = Math.hypot(tangent.x, tangent.z),
    outerNormalX = -tangent.z / tangentLength,
    outerNormalZ = tangent.x / tangentLength;
  let outerLeft = 0, outerRight = 0;
  for (let vertex = 0; vertex < refined.structures.positions.length / 3; vertex++) {
    const c = vertex * 4;
    if (refined.structures.colors[c] !== 153 || refined.structures.colors[c + 1] !== 112 ||
        refined.structures.colors[c + 2] !== 65) continue;
    const p = vertex * 3,
      normalDot = refined.structures.normals[p] * outerNormalX +
        refined.structures.normals[p + 2] * outerNormalZ;
    if (normalDot > 0.7) outerLeft++;
    if (normalDot < -0.7) outerRight++;
  }
  assert.ok(outerLeft > 0 && outerRight > 0,
    "both river-facing guardrail sides must have outward-pointing visible normals");


  const vx = evidence.bridgeTangent.x,
    vz = evidence.bridgeTangent.z,
    length = Math.hypot(vx, vz),
    ux = vx / length,
    uz = vz / length,
    originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2;
  let maxAcross = 0,
    matched = 0;
  const physicalDeckChecks: {vertex:number;metres:number}[]=[];
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
    const expected=finalSurfaceAt(px,pz).deckHeight;
    if(expected!==null)physicalDeckChecks.push({vertex,metres:expected+.1});
    maxAcross = Math.max(maxAcross, across);
    matched++;
  }
  assert.ok(matched > 0);
  assert.ok(
    maxAcross <= REFINED_BRIDGE_HALF_WIDTH_SOURCE + 0.05,
    `bridge half-width ${maxAcross} exceeded ${REFINED_BRIDGE_HALF_WIDTH_SOURCE}`,
  );
  convertTileGeometryToEnu(tile,refined);
  assert.ok(physicalDeckChecks.length>1);
  for(const check of physicalDeckChecks) {
    assert.ok(Math.abs(refined.structures.positions[check.vertex*3+1]*CANONICAL_METRES_PER_SOURCE_UNIT-check.metres)<.015,"rendered deck must agree with canonical metre height");
  }
});
