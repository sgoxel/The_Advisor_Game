import type { Geometry } from "./geometry.ts";
import { nearbyLandforms } from './wilderness-terrain.ts';
import { sourceUnitsPerMetreAt } from './physical-scale.ts';
import { terrainTint } from "./geometry.ts";
import { finalSurfaceAt, finalSurfaceGroundMaterialAt, type Tile } from "./world.ts";
import { finalSurfaceRenderChannelsAt } from "./world-core.ts";
import { drainageSegmentsInBounds, naturalSurfaceAt, RIVER_BANK_HALF_WIDTH_SOURCE } from "./hydrology.ts";
import { macroSampleAt } from "./macro-geography.ts";
import { places, roads, roadDistanceAt } from "./geography.ts";
import { siteAccessRoads } from "./sites.ts";
import { roadFragmentsInBounds } from "./continuity-corridor.ts";
import {
  SOURCE_PRESENTATION_RADIUS,
  SOURCE_PRESENTATION_WIDTH,
  sourceToLonLat,
  wrapSourceX,
} from "./planet.ts";

// Both road registries are immutable SEED foundations; sharing their original
// concatenation avoids rebuilding an identical array for every detail tile.
const canonicalSurfaceRoads = [...roads, ...siteAccessRoads];
// A clipped fragment retains its source's complete immutable centerline.
// Reuse the canonical Road as roadDistanceAt's WeakMap key instead of rebuilding
// the *same full-polyline metric list* for every throwaway tile fragment.
const canonicalDistanceRoadByLine = new Map(canonicalSurfaceRoads
  .filter(road => road.centerline && road.centerline.length > 1)
  .map(road => [road.centerline!, road] as const));

export const NATURAL_MESH_LIMITS = Object.freeze({
  maximumTile: 2048,
  leaves: 16384,
  samples: 65536,
  riverStep: 2,
  shoreStep: 16,
});

type Sample = {
  x: number;
  z: number;
  y: number;
  /** Computed only when a sampled point becomes a rendered vertex. */
  tint?: readonly number[];
  wet: string;
  /** Only read on tiles with a real major wet/dry boundary. */
  shoreDistance?: number;
  material: string;
  /** Same canonical composed channels already queried to create this sample. */
  surface: ReturnType<typeof finalSurfaceRenderChannelsAt>;
};

/**
 * One bounded replacement surface. The old coarse ground cannot occlude canonical
 * water, but adaptive triangles now share canonical vertices and accumulate smooth
 * normals. This keeps river/coast refinement without multiplying upload memory for
 * every triangle. Skirts use a separate vertex group so their vertical normals do
 * not soften the visible top-surface edge.
 */
export function rebuildNaturalSurface(
  tile: Tile,
  original: Geometry,
): {
  geometry: Geometry;
  replaced: boolean;
  leaves: number;
  samples: number;
  surfaceVertices: number;
  cpuScratchBytesEstimated: number;
} {
  const unchanged = {
    geometry: original,
    replaced: false,
    leaves: 0,
    samples: 0,
    surfaceVertices: 0,
    cpuScratchBytesEstimated: 0,
  };
  if (tile.size > NATURAL_MESH_LIMITS.maximumTile) return unchanged;

  const formations=tile.size<=512?nearbyLandforms(tile.minX+tile.size/2,tile.minZ+tile.size/2,tile.size):[];
  const segments =
      tile.size <= 512
        ? drainageSegmentsInBounds(tile.minX, tile.minZ, tile.size)
        : [],
    preparedRoads = tile.size <= 512 ? [...roadFragmentsInBounds(canonicalSurfaceRoads, tile.minX, tile.minZ, tile.size)]
      .filter(r => r.maxZ >= tile.minZ - 12 && r.minZ <= tile.minZ + tile.size + 12 &&
        [-SOURCE_PRESENTATION_WIDTH,0,SOURCE_PRESENTATION_WIDTH].some(shift =>
          r.maxX + shift >= tile.minX - 12 && r.minX + shift <= tile.minX + tile.size + 12))
      .map(r => r.centerline ? canonicalDistanceRoadByLine.get(r.centerline) ?? r : r) : [],
    preparedPlace = tile.size <= 512 && places.some(p =>
      Math.hypot(wrapSourceX(p.x - tile.minX - tile.size / 2), p.z - tile.minZ - tile.size / 2) <
        (p.kind === 'city' ? 510 : 170) + tile.size * Math.SQRT2 / 2),
    cache = new Map<string, Sample>(),
    positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    indices: number[] = [],
    uvs: number[] = [],
    vertexIndices = new Map<string, number>();
  let leaves = 0;

  const sample = (x: number, z: number) => {
    const key = `${x}/${z}`,
      cached = cache.get(key);
    if (cached) return cached;
    if (cache.size >= NATURAL_MESH_LIMITS.samples)
      throw new RangeError("Natural mesh sample cap exceeded");
    const surface = finalSurfaceRenderChannelsAt(x, z),
      wet = surface.water.kind,
      value = {
        x,
        z,
        y: wet === "none" ? surface.groundHeight : surface.water.level + 0.0025,
        material: surface.groundMaterial,
        wet,
        surface,
      };
    cache.set(key, value);
    return value;
  };

  // Computing full macro mountain/coast data is expensive and is only used
  // for adaptive coast subdivision when a tile really straddles major water.
  // A cached sample must still return the identical exact canonical distance
  // when its first lookup happens after the 8x8 boundary probe.
  const shoreDistance = (point: Sample): number =>
    point.shoreDistance ?? (point.shoreDistance =
      macroSampleAt(sourceToLonLat(point.x, point.z)).coastDistanceRad * SOURCE_PRESENTATION_RADIUS);

  // The early 8x8 shoreline probe and unused adaptive samples never emit
  // vertices; defer their identical SEED-derived tint until vertex emission.
  const tint = (point: Sample): readonly number[] =>
    point.tint ?? (point.tint = terrainTint(point.x, point.z,32,undefined,0,false,point.surface));

  let majorBoundary = false,
    initialWet: string | undefined;
  for (let z = 0; z <= 8; z++)
    for (let x = 0; x <= 8; x++) {
      const s = sample(
          tile.minX + (tile.size * x) / 8,
          tile.minZ + (tile.size * z) / 8,
        ),
        major = s.wet === "lake" || s.wet === "ocean" ? "wet" : "dry";
      if (initialWet === undefined) initialWet = major;
      else if (major !== initialWet) majorBoundary = true;
    }
  if (!formations.length && !segments.length && !majorBoundary && !preparedRoads.length && !preparedPlace) return unchanged;
  // These canonical feature descriptors are fixed for this tile. Adaptive
  // recursion may visit thousands of cells; avoid repeating unchanged
  // metre-scale conversion and segment vector lengths at every visit.
  const formationMetres = formations.map(f => ({ f, metres: sourceUnitsPerMetreAt(f.z) })),
    segmentVectors = segments.map(s => {
      const dx = wrapSourceX(s.bx - s.ax), dz = s.bz - s.az;
      return { s, dx, dz, lengthSquared: dx * dx + dz * dz || 1 };
    });

  const originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2;
  const vertex = (p: Sample, group: "surface" | "skirt") => {
    const key = `${group}/${p.x}/${p.z}/${p.y}`,
      cached = vertexIndices.get(key);
    if (cached !== undefined) return cached;
    const index = positions.length / 3;
    vertexIndices.set(key, index);
    positions.push(p.x - originX, p.y, p.z - originZ);
    normals.push(0, 0, 0);
    colors.push(...tint(p), p.material === "Road" && p.wet === "none" ? 255 : 0);
    uvs.push(
      p.x / SOURCE_PRESENTATION_WIDTH + 0.5,
      Math.max(0, Math.min(1, 0.5 + (2 * p.z) / SOURCE_PRESENTATION_WIDTH)),
    );
    return index;
  };
  const emitTriangle = (
    a: Sample,
    b: Sample,
    c: Sample,
    group: "surface" | "skirt" = "surface",
  ) => {
    const ux = b.x - a.x,
      uy = b.y - a.y,
      uz = b.z - a.z,
      vx = c.x - a.x,
      vy = c.y - a.y,
      vz = c.z - a.z,
      nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx,
      area = Math.hypot(nx,ny,nz);
    if(area<1e-14)return;
    const ia = vertex(a, group), ib = vertex(b, group), ic = vertex(c, group);
    for (const index of [ia, ib, ic]) {
      normals[index * 3] += nx;
      normals[index * 3 + 1] += ny;
      normals[index * 3 + 2] += nz;
    }
    indices.push(ia, ib, ic);
  };
  const cuts = new Map<string, { wet: Sample; dry: Sample }>();
  const wet = (p: Sample) => p.wet !== "none";
  const cut = (a: Sample, b: Sample) => {
    const keys = [`${a.x}/${a.z}`, `${b.x}/${b.z}`].sort(), key = keys.join("|");
    let result = cuts.get(key);
    if (result) return result;
    if (cuts.size >= 8192) throw new RangeError("Natural shoreline cut cap exceeded");
    let lo = 0, hi = 1;
    for (let i = 0; i < 10; i++) {
      const t = (lo + hi) / 2;
      const inside = naturalSurfaceAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t).water.kind !== "none";
      if (inside === wet(a)) lo = t; else hi = t;
    }
    const before = sample(a.x + (b.x - a.x) * lo, a.z + (b.z - a.z) * lo);
    const after = sample(a.x + (b.x - a.x) * hi, a.z + (b.z - a.z) * hi);
    result = wet(before) ? { wet: before, dry: after } : { wet: after, dry: before };
    cuts.set(key, result);
    return result;
  };
  const roadCuts = new Map<string, { road: Sample; ground: Sample }>();
  const onRoad = (p: Sample) => p.wet === "none" && p.material === "Road";
  const roadCut = (a: Sample, b: Sample) => {
    const key = [`${a.x}/${a.z}`, `${b.x}/${b.z}`].sort().join("|");
    const cached = roadCuts.get(key);
    if (cached) return cached;
    if (roadCuts.size >= 8192)
      throw new RangeError("Natural road material cut cap exceeded");
    // Locate the canonical road/material boundary instead of interpolating a
    // binary vertex tint over the full adaptive triangle (a jagged shoulder).
    const wasRoad = onRoad(a);
    let lo = 0, hi = 1;
    for (let i = 0; i < 5; i++) {
      const t = (lo + hi) / 2;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const midRoad = finalSurfaceGroundMaterialAt(x, z) === "Road";
      if (midRoad === wasRoad) lo = t;
      else hi = t;
    }
    const before = sample(a.x + (b.x - a.x) * lo, a.z + (b.z - a.z) * lo);
    const after = sample(a.x + (b.x - a.x) * hi, a.z + (b.z - a.z) * hi);
    const result = onRoad(before)
      ? { road: before, ground: after }
      : { road: after, ground: before };
    roadCuts.set(key, result);
    return result;
  };
  const roadTriangle = (a: Sample, b: Sample, c: Sample) => {
    const corners = [a, b, c];
    if (corners.some(wet) || corners.every(p => onRoad(p) === onRoad(a)))
      return emitTriangle(a, b, c);
    // Separate road and soil triangles at the same canonical boundary.
    // No triangle may blend road alpha over an unrelated shoulder.
    for (const road of [false, true]) {
      const polygon: Sample[] = [];
      for (let i = 0; i < 3; i++) {
        const p = corners[i], q = corners[(i + 1) % 3];
        if (onRoad(p) === road) polygon.push(p);
        if (onRoad(p) !== onRoad(q))
          polygon.push(road ? roadCut(p, q).road : roadCut(p, q).ground);
      }
      for (let i = 1; i < polygon.length - 1; i++)
        emitTriangle(polygon[0], polygon[i], polygon[i + 1]);
    }
  };
  const triangle = (a: Sample, b: Sample, c: Sample, group: "surface" | "skirt"="surface") => {
    if(group==="skirt")return emitTriangle(a,b,c,group);
    if (wet(a) === wet(b) && wet(b) === wet(c)) return roadTriangle(a,b,c);
    const corners = [a,b,c];
    for (const water of [false,true]) {
      const polygon: Sample[] = [];
      for (let i=0;i<3;i++) {
        const p=corners[i],q=corners[(i+1)%3];
        if (wet(p) === water) polygon.push(p);
        if (wet(p) !== wet(q)) polygon.push(water ? cut(p,q).wet : cut(p,q).dry);
      }
      for (let i=1;i<polygon.length-1;i++) roadTriangle(polygon[0],polygon[i],polygon[i+1]);
    }
  };
  const quad = (
    a: Sample,
    b: Sample,
    c: Sample,
    d: Sample,
    group: "surface" | "skirt" = "surface",
  ) => {
    triangle(a, b, c, group);
    triangle(a, c, d, group);
  };

  const nearRiver = (x: number, z: number, size: number) =>
    segmentVectors.some(({ s, dx, dz, lengthSquared }) => {
      const qx = wrapSourceX(x - s.ax),
        qz = z - s.az,
        t = Math.max(
          0,
          Math.min(1, (qx * dx + qz * dz) / lengthSquared),
        );
      return (
        Math.hypot(qx - dx * t, qz - dz * t) <=
        (size * Math.SQRT2) / 2 + s.width + RIVER_BANK_HALF_WIDTH_SOURCE
      );
    });

  const visit = (x: number, z: number, size: number) => {
    const half = size / 2,
      a = sample(x, z),
      b = sample(x, z + size),
      c = sample(x + size, z + size),
      d = sample(x + size, z),
      middle = sample(x + half, z + half),
      river = nearRiver(middle.x, middle.z, size),
      wetClasses = [a, b, c, d, middle].map((s) =>
        s.wet === "ocean" || s.wet === "lake" ? "wet" : "dry",
      ),
      major = wetClasses.some((value) => value !== wetClasses[0]),
      nearCoast =
        majorBoundary &&
        [a, b, c, d, middle].some(
          (s) => s.wet === "none" && Math.abs(shoreDistance(s)) <= size * Math.SQRT2 + 8,
        ),
      // Threshold-limited road distance retains the identical yes/no geometry
      // decision while skipping far immutable polyline segments in every cell.
      roadReach = size * Math.SQRT2 / 2 + 12,
      road = preparedRoads.some(r => roadDistanceAt(middle.x, middle.z, r, roadReach) < roadReach),
      // The worker uses this mesh instead of the coarse ground refinement at
      // real river crossings. Tighten only road-adjacent mixed wet/dry landing
      // cells, not entire river strips or unrelated tiles.
      bridgeReach = size * Math.SQRT2 / 2 + 2,
      bridgeBank = river && [a, b, c, d].some(p => wet(p) !== wet(middle)) &&
        preparedRoads.some(r => roadDistanceAt(middle.x, middle.z, r, bridgeReach) <= bridgeReach),
      materialBoundary = [a,b,c,d].some(p => p.material !== middle.material),
      prepared = road || (preparedPlace && materialBoundary),
      formation=formationMetres.find(({ f, metres: m }) => Math.hypot(wrapSourceX(middle.x-f.x)/m.x,(middle.z-f.z)/m.z)<f.radiusM+size/m.z)?.f,
      target = formation ? Math.max(tile.size/128,formation.kind==='waterfall'?.125:formation.kind==='hill'?1:.5) : bridgeBank ? Math.max(0.25, tile.size / 256) : river
        ? Math.max(tile.size / 128, Math.min(
            tile.size >= 256 ? 2 : tile.size >= 128 ? 1 : 0.5,
            tile.size / 32,
          ))
        : prepared ? Math.max(0.5, tile.size / 64) : Math.max(2, tile.size / 128);
    if (size > target && (formation || river || major || nearCoast || prepared)) {
      visit(x, z, half);
      visit(x, z + half, half);
      visit(x + half, z + half, half);
      visit(x + half, z, half);
      return;
    }
    if (++leaves > NATURAL_MESH_LIMITS.leaves)
      throw new RangeError("Natural mesh leaf cap exceeded");

    const centreNeeded = river || major || materialBoundary || middle.wet !== a.wet;
    if (centreNeeded) {
      triangle(a, b, middle);
      triangle(b, c, middle);
      triangle(c, d, middle);
      triangle(d, a, middle);
    } else quad(a, b, c, d);
  };

  const base = tile.size / 16;
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++)
      visit(tile.minX + x * base, tile.minZ + z * base, base);

  // Surface vertices are uniquely indexed before skirts append their separately
  // normalled edge vertices. Tests can validate canonical top heights directly.
  const surfaceVertices = positions.length / 3;

  const borderStep = formations.length ? Math.max(tile.size/128,.125) : segments.length
    ? Math.max(tile.size / 128, Math.min(tile.size >= 256 ? 2 : tile.size >= 128 ? 1 : 0.5, tile.size / 32))
    : Math.max(4, tile.size / 128);
  for (let edge = 0; edge < 4; edge++)
    for (let offset = 0; offset < tile.size; offset += borderStep) {
      const next = Math.min(tile.size, offset + borderStep),
        point = (t: number) =>
          edge === 0
            ? sample(tile.minX + t, tile.minZ)
            : edge === 1
              ? sample(tile.minX + tile.size, tile.minZ + t)
              : edge === 2
                ? sample(tile.minX + tile.size - t, tile.minZ + tile.size)
                : sample(tile.minX, tile.minZ + tile.size - t),
        a = point(offset), b = point(next);
      const skirt = (a: Sample,b: Sample) => quad(a,b,{...b,y:b.y-12},{...a,y:a.y-12},"skirt");
      // A coarse dry-to-water chord can put the skirt's top above the real
      // channel. Split it at the same exact shoreline used by the top surface.
      if(wet(a)!==wet(b)) {
        const boundary=cut(a,b);
        skirt(a,wet(a)?boundary.wet:boundary.dry);
        skirt(wet(b)?boundary.wet:boundary.dry,b);
      } else skirt(a,b);
    }

  for (let index = 0; index < positions.length / 3; index++) {
    const x = normals[index * 3],
      y = normals[index * 3 + 1],
      z = normals[index * 3 + 2],
      length = Math.hypot(x, y, z) || 1;
    normals[index * 3] = x / length;
    normals[index * 3 + 1] = y / length;
    normals[index * 3 + 2] = z / length;
  }

  const geometry = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
    uvs: new Float32Array(uvs),
  };
  return {
    geometry,
    replaced: true,
    leaves,
    samples: cache.size,
    surfaceVertices,
    cpuScratchBytesEstimated:
      (positions.length + normals.length + colors.length + indices.length + uvs.length) *
        8 +
      cache.size * 192 +
      vertexIndices.size * 96 + (cuts.size + roadCuts.size) * 256,
  };
}
