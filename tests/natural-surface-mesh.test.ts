import assert from "node:assert/strict";
import test from "node:test";
import {
  rebuildNaturalSurface,
  NATURAL_MESH_LIMITS,
  naturalSurfaceRoadCandidates,
} from "../src/natural-surface-mesh.ts";
import { buildTile } from "../src/geometry.ts";
import { drainageRecipes } from "../src/hydrology.ts";
import { tileForPosition, finalSurfaceAt, finalSurfaceEvidenceAnchors } from "../src/world.ts";
import { SOURCE_PRESENTATION_WIDTH, wrapSourceX } from "../src/planet.ts";
import { villages, cities, places, nearbyPlaces, roads } from "../src/geography.ts";
import { siteAccessRoads } from "../src/sites.ts";
import { roadFragmentsInBounds } from "../src/continuity-corridor.ts";
import { finalSurfaceRenderChannelsAt } from "../src/world-core.ts";

test("starting-village streets survive inland replacement and remain distinct from the pad", () => {
  const place= villages[0], tile=tileForPosition(place.x,place.z,10);
  const result=rebuildNaturalSurface(tile,buildTile(tile).terrain);
  assert.ok(result.replaced,'inland prepared surfaces need the same bounded refinement as natural shores');
  let streetVertices=0, padVertices=0;
  const ox=tile.minX+tile.size/2,oz=tile.minZ+tile.size/2;
  for(let v=0;v<result.surfaceVertices;v++) {
    const x=ox+result.geometry.positions[v*3],z=oz+result.geometry.positions[v*3+2];
    const surface=finalSurfaceAt(x,z);
    if(surface.groundMaterial==='Road') {
      streetVertices++;
      assert.equal(result.geometry.colors[v*4+3],255,"road coverage is encoded independently from natural soil RGB");
    }
    if(surface.groundMaterial==='Settlement') padVertices++;
  }
  for (let i = 0; i < result.geometry.indices.length; i += 3) {
    const corners = Array.from(result.geometry.indices.slice(i, i + 3));
    if (corners.some(v => v >= result.surfaceVertices)) continue;
    const alphas = corners.map(v => result.geometry.colors[v * 4 + 3]);
    assert.ok(alphas.every(alpha => alpha === alphas[0]),
      "road tint must meet canonical material edges, not spread across soil triangles");
  }
  assert.ok(streetVertices>20,'narrow streets must survive the interior mesh');
  assert.ok(padVertices>20,'the settlement must coexist with its streets');
  assert.ok(result.leaves<=NATURAL_MESH_LIMITS.leaves);
});

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

test("dense real crossing outer coverage respects the unchanged mesh cap", () => {
  const p=finalSurfaceEvidenceAnchors().bridge;
  for(const level of [9,10]) {
    const tile=tileForPosition(p.x,p.z,level);
    const result=rebuildNaturalSurface(tile,buildTile(tile).terrain);
    assert.ok(result.replaced);
    assert.ok(result.leaves<=NATURAL_MESH_LIMITS.leaves);
    assert.ok(result.samples<=NATURAL_MESH_LIMITS.samples);
    assert.ok(result.cpuScratchBytesEstimated<=32*1024*1024);
  }
});


test("shoreline skirts do not hang above the real crossing water", () => {
  const p=finalSurfaceEvidenceAnchors().bridge;
  const tile=tileForPosition(p.x,p.z,14);
  const r=rebuildNaturalSurface(tile,buildTile(tile).terrain),g=r.geometry;
  const ox=tile.minX+tile.size/2,oz=tile.minZ+tile.size/2;
  let wetSkirts=0;
  for(let i=0;i<g.indices.length;i+=3) {
    const ids=[g.indices[i],g.indices[i+1],g.indices[i+2]];
    if(ids.some(v=>v<r.surfaceVertices))continue;
    const x=ids.reduce((sum,v)=>sum+g.positions[v*3],0)/3+ox;
    const z=ids.reduce((sum,v)=>sum+g.positions[v*3+2],0)/3+oz;
    const surface=finalSurfaceAt(x,z);
    if(surface.water.kind==='none')continue;
    const top=Math.max(...ids.map(v=>g.positions[v*3+1]));
    assert.ok(top<=surface.water.level+.03,`skirt conceals water by ${top-surface.water.level}m at ${x},${z}`);
    wetSkirts++;
  }
  assert.ok(wetSkirts>0);
});

test("reuses the exact canonical 4x4 water-boundary verdict from the adaptive 8x8 samples", () => {
  const crossing = finalSurfaceEvidenceAnchors().bridge;
  const drainage = drainageRecipes[0].points[Math.floor(drainageRecipes[0].points.length / 2)];
  const tiles = [
    tileForPosition(villages[0].x, villages[0].z, 14),
    tileForPosition(crossing.x, crossing.z, 14),
    tileForPosition(drainage.x, drainage.z, 14),
  ];
  // The source-coordinate wrap must not change which exact physical samples
  // count as water. Reuse the same four-by-four probe as the old call path.
  tiles.push({ ...tiles[1], minX: tiles[1].minX + SOURCE_PRESENTATION_WIDTH });
  for (const tile of tiles) {
    let wet = false, dry = false;
    for (let z = 0; z <= 4; z++)
      for (let x = 0; x <= 4; x++) {
        const water = finalSurfaceRenderChannelsAt(
          tile.minX + tile.size * x / 4, tile.minZ + tile.size * z / 4,
        ).water.kind;
        if (water === "none") dry = true;
        else wet = true;
      }
    const natural = rebuildNaturalSurface(tile, buildTile(tile).terrain);
    assert.equal(natural.waterBoundary4, wet && dry,
      `tile ${tile.key} must retain the original composed-surface water boundary`);
  }
});

test("local settlement buckets retain every strict detail-refinement match across the source seam", () => {
  // The old world-wide scan is an independent witness. Its boolean must
  // remain identical even for a centre close to a country/seam boundary.
  const anchors = [villages[0], cities[0], villages[villages.length - 1]];
  for (const place of anchors) for (const level of [9, 10, 12, 14]) {
    const tile = tileForPosition(place.x, place.z, level),
      x = tile.minX + tile.size / 2,
      z = tile.minZ + tile.size / 2;
    for (const shiftedX of [x, x + SOURCE_PRESENTATION_WIDTH, x - SOURCE_PRESENTATION_WIDTH]) {
      const exact = (p: typeof places[number]) =>
        Math.hypot(wrapSourceX(p.x - shiftedX), p.z - z) <
        (p.kind === "city" ? 510 : 170) + tile.size * Math.SQRT2 / 2;
      assert.equal(nearbyPlaces(shiftedX, z).some(exact), places.some(exact),
        `lost physical settlement near ${place.code} / level ${level}`);
    }
  }
});


test("indexed detail-road candidates reproduce every exhaustive SEED fragment across scales and seams", () => {
  const allRoads = [...roads, ...siteAccessRoads];
  const bridge = finalSurfaceEvidenceAnchors().bridge;
  const anchors = [villages[0], cities[0], bridge, drainageRecipes[0].points[5]];
  for (const anchor of anchors) for (const level of [9, 12, 14]) {
    const canonical = tileForPosition(anchor.x, anchor.z, level);
    for (const shift of [-SOURCE_PRESENTATION_WIDTH, 0, SOURCE_PRESENTATION_WIDTH]) {
      const tile = { ...canonical, minX: canonical.minX + shift };
      const fragments = (candidates: typeof allRoads) =>
        [...roadFragmentsInBounds(candidates, tile.minX, tile.minZ, tile.size)]
          .filter(r => r.maxZ >= tile.minZ - 12 && r.minZ <= tile.minZ + tile.size + 12 &&
            [-SOURCE_PRESENTATION_WIDTH, 0, SOURCE_PRESENTATION_WIDTH].some(alias =>
              r.maxX + alias >= tile.minX - 12 &&
              r.minX + alias <= tile.minX + tile.size + 12))
          .map(r => [r.code, r.fromX, r.fromZ, r.toX, r.toZ, r.minX, r.maxX, r.minZ, r.maxZ]);
      const subset = naturalSurfaceRoadCandidates(tile);
      assert.ok(subset.length <= allRoads.length, "candidate list cannot grow beyond canonical roads");
      assert.deepEqual(fragments([...subset]), fragments(allRoads),
        `road fragment missing or reordered at ${canonical.key} / shift ${shift}`);
    }
  }
});
