import type { Geometry } from "./geometry.ts";
import { landformAt, nearbyLandforms, wildernessTerrainAt } from './wilderness-terrain.ts';
import { sourceUnitsPerMetreAt } from './physical-scale.ts';
import { terrainTint } from "./geometry.ts";
import { finalSurfaceAt, finalSurfaceGroundMaterialAt, type Tile } from "./world.ts";
import { finalSurfaceRenderChannelsAt } from "./world-core.ts";
import { drainageSegmentsInBounds, naturalSurfaceAt, naturalWaterKindAt, RIVER_BANK_HALF_WIDTH_SOURCE } from "./hydrology.ts";
import { macroSampleAt } from "./macro-geography.ts";
import { nearbyPlaces, roads, roadDistanceAt } from "./geography.ts";
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

/** Preserve the original wilderness water classification without evaluating
 * dry elevation/slope for a point that has no local water-changing landform.
 * Every actual landform still executes the original full canonical path.
 * This predicate cannot certify legal traversal or supply a mesh vertex. */
export function sparseNaturalWildernessWaterKindAt(
  x: number, z: number,
): ReturnType<typeof naturalWaterKindAt> {
  const kind = naturalWaterKindAt(x, z);
  return kind === "none" && landformAt(x, z)
    ? wildernessTerrainAt(x, z, naturalSurfaceAt(x, z)).water.kind
    : kind;
}

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
  waterBoundary4: boolean | undefined;
} {
  const unchanged = {
    geometry: original,
    replaced: false,
    leaves: 0,
    samples: 0,
    surfaceVertices: 0,
    cpuScratchBytesEstimated: 0,
    waterBoundary4: undefined as boolean | undefined,
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
    // At tile.size <= 512 the largest possible settlement reach is
    // 510 + 512 * sqrt(2)/2 < 873 source units. Geography's immutable
    // seam-aware 2048-unit buckets include every possible positive match
    // in their 3x3 neighbourhood. Preserve the exact original predicate
    // and SEED result, without scanning every settlement in the world for
    // every ordinary detail tile.
    preparedPlace = tile.size <= 512 && nearbyPlaces(tile.minX + tile.size / 2, tile.minZ + tile.size / 2).some(p =>
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

  // Most tiles contain no local roads, settlement or relief and cannot
  // replace the original mesh unless real SEED water changes across them.
  // The canonical composer preserves base.water verbatim: use the identical
  // hydrology+wilderness water channel for this negative-only proof before
  // doing 81 costly road/site/final-surface compositions. Any actual
  // coastline or feature still uses the full original composed sampling.
  if (!formations.length && !segments.length && !preparedRoads.length && !preparedPlace) {
    let firstMajor: string | undefined, mixedMajor = false;
    let wet4 = false, dry4 = false;
    for (let z = 0; z <= 8; z++)
      for (let x = 0; x <= 8; x++) {
        const sx = tile.minX + tile.size * x / 8,
          sz = tile.minZ + tile.size * z / 8,
          wet = sparseNaturalWildernessWaterKindAt(sx, sz),
          major = wet === "lake" || wet === "ocean" ? "wet" : "dry";
        if (firstMajor === undefined) firstMajor = major;
        else if (major !== firstMajor) mixedMajor = true;
        if ((x & 1) === 0 && (z & 1) === 0) {
          if (wet === "none") dry4 = true;
          else wet4 = true;
        }
      }
    if (!mixedMajor)
      return { ...unchanged, waterBoundary4: wet4 && dry4 };
  }

  let majorBoundary = false,
    initialWet: string | undefined,
    waterProbeWet = false,
    waterProbeDry = false;
  for (let z = 0; z <= 8; z++)
    for (let x = 0; x <= 8; x++) {
      const s = sample(
          tile.minX + (tile.size * x) / 8,
          tile.minZ + (tile.size * z) / 8,
        ),
        major = s.wet === "lake" || s.wet === "ocean" ? "wet" : "dry";
      // The 4x4 water-boundary probe used by fine-tile refinement is the
      // even-coordinate subset of these same 8x8 canonical samples.
      if ((x & 1) === 0 && (z & 1) === 0) {
        if (s.wet === "none") waterProbeDry = true;
        else waterProbeWet = true;
      }
      if (initialWet === undefined) initialWet = major;
      else if (major !== initialWet) majorBoundary = true;
    }
  const waterBoundary4 = waterProbeWet && waterProbeDry;
  if (!formations.length && !segments.length && !majorBoundary && !preparedRoads.length && !preparedPlace)
    return { ...unchanged, waterBoundary4 };
  // These canonical feature descriptors are fixed for this tile. Adaptive
  // recursion may visit thousands of cells; avoid repeating unchanged
  // metre-scale conversion and segment vector lengths at every visit.
  const formationMetres = formations.map(f => ({ f, metres: sourceUnitsPerMetreAt(f.z) })),
    segmentVectors = segments.map(s => {
      const dx = wrapSourceX(s.bx - s.ax), dz = s.bz - s.az;
      return { s, dx, dz, lengthSquared: dx * dx + dz * dz || 1,
        minDx: Math.min(0, dx), maxDx: Math.max(0, dx),
        minDz: Math.min(0, dz), maxDz: Math.max(0, dz) };
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
    // Preserve ordered indexed-normal sums without allocating a fresh
    // three-element array for every emitted adaptive triangle.
    normals[ia * 3] += nx;
    normals[ia * 3 + 1] += ny;
    normals[ia * 3 + 2] += nz;
    normals[ib * 3] += nx;
    normals[ib * 3 + 1] += ny;
    normals[ib * 3 + 2] += nz;
    normals[ic * 3] += nx;
    normals[ic * 3 + 1] += ny;
    normals[ic * 3 + 2] += nz;
    indices.push(ia, ib, ic);
  };
  // Both shoreline and road-cut caches use default-sort lexicographic keys.
  // Compare the two exact strings without allocating and sorting a pair per cut.
  const cutEdgeKey = (a: Sample, b: Sample) => {
    const first = `${a.x}/${a.z}`, second = `${b.x}/${b.z}`;
    return first <= second ? `${first}|${second}` : `${second}|${first}`;
  };
  const cuts = new Map<string, { wet: Sample; dry: Sample }>();
  const wet = (p: Sample) => p.wet !== "none";
  const cut = (a: Sample, b: Sample) => {
    const key = cutEdgeKey(a, b);
    let result = cuts.get(key);
    if (result) return result;
    if (cuts.size >= 8192) throw new RangeError("Natural shoreline cut cap exceeded");
    let lo = 0, hi = 1;
    for (let i = 0; i < 10; i++) {
      const t = (lo + hi) / 2;
      const inside = naturalWaterKindAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) !== "none";
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
    const key = cutEdgeKey(a, b);
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
    // Most triangles have a single material. Avoid three-element scratch arrays
    // and predicate callbacks until the exact mixed-material split needs them.
    const firstRoad = onRoad(a);
    if (wet(a) || wet(b) || wet(c) ||
        (onRoad(b) === firstRoad && onRoad(c) === firstRoad))
      return emitTriangle(a, b, c);
    const corners = [a, b, c];
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

  const nearRiver = (x: number, z: number, size: number) => {
    // Visit the identical segment order and keep the exact closest-point
    // predicate; avoid allocating a fresh .some callback for every adaptive cell.
    for (const { s, dx, dz, lengthSquared, minDx, maxDx, minDz, maxDz } of segmentVectors) {
      const reach = (size * Math.SQRT2) / 2 + s.width + RIVER_BANK_HALF_WIDTH_SOURCE,
        qz = z - s.az;
      // A point outside the segment's reach-expanded box cannot pass the
      // original exact closest-point distance test. Reject it before wrap and
      // projection work, retaining exact math for every possible river cell.
      if (qz < minDz - reach || qz > maxDz + reach) continue;
      const qx = wrapSourceX(x - s.ax);
      if (qx < minDx - reach || qx > maxDx + reach) continue;
      const t = Math.max(0, Math.min(1, (qx * dx + qz * dz) / lengthSquared));
      if (Math.hypot(qx - dx * t, qz - dz * t) <= reach) return true;
    }
    return false;
  };

  // Reuse one ordered scan for each adaptive road/bridge-cell probe instead
  // of allocating a new .some callback per visited cell. Preserve the
  // ordinary road's strict bound and bridge-bank's inclusive bound.
  const nearRoad = (x: number, z: number, reach: number, includeEdge: boolean) => {
    for (const r of preparedRoads) {
      const distance = roadDistanceAt(x, z, r, reach);
      if (includeEdge ? distance <= reach : distance < reach) return true;
    }
    return false;
  };

  // Adaptive cells reuse one ordered formation scan rather than allocating
  // a new .find predicate on every visit; preserve the first matching SEED
  // formation, the exact wrap conversion and the strict radial boundary.
  const formationAt = (point: Sample, size: number) => {
    for (const { f, metres: m } of formationMetres) {
      const east = wrapSourceX(point.x-f.x)/m.x,
        north = (point.z-f.z)/m.z,
        reach = f.radiusM+size/m.z;
      // A point outside either reach extent cannot pass the original exact
      // radial threshold. Keep Math.hypot for every possible landform cell.
      if (east >= -reach && east <= reach && north >= -reach && north <= reach &&
          Math.hypot(east,north)<reach) return f;
    }
    return undefined;
  };

  const majorWet = (s: Sample) => s.wet === "ocean" || s.wet === "lake";
  // Reuse a single predicate across adaptive cells; do not create an array
  // and callback closure for every short-circuit coast probe.
  const nearCoastPoint = (s: Sample, reach: number) =>
    s.wet === "none" && Math.abs(shoreDistance(s)) <= reach;
  const visit = (x: number, z: number, size: number) => {
    const half = size / 2,
      a = sample(x, z),
      b = sample(x, z + size),
      c = sample(x + size, z + size),
      d = sample(x + size, z),
      middle = sample(x + half, z + half),
      river = nearRiver(middle.x, middle.z, size),
      majorClass = majorWet(a),
      major = majorWet(b) !== majorClass || majorWet(c) !== majorClass ||
        majorWet(d) !== majorClass || majorWet(middle) !== majorClass,
      coastReach = size * Math.SQRT2 + 8,
      nearCoast = majorBoundary && (
        nearCoastPoint(a, coastReach) || nearCoastPoint(b, coastReach) ||
        nearCoastPoint(c, coastReach) || nearCoastPoint(d, coastReach) ||
        nearCoastPoint(middle, coastReach)
      ),
      // Threshold-limited road distance retains the identical yes/no geometry
      // decision while skipping far immutable polyline segments in every cell.
      roadReach = size * Math.SQRT2 / 2 + 12,
      road = nearRoad(middle.x, middle.z, roadReach, false),
      // The worker uses this mesh instead of the coarse ground refinement at
      // real river crossings. Tighten only road-adjacent mixed wet/dry landing
      // cells, not entire river strips or unrelated tiles.
      bridgeReach = size * Math.SQRT2 / 2 + 2,
      bridgeBank = river && (wet(a) !== wet(middle) || wet(b) !== wet(middle) ||
        wet(c) !== wet(middle) || wet(d) !== wet(middle)) &&
        nearRoad(middle.x, middle.z, bridgeReach, true),
      materialBoundary = a.material !== middle.material || b.material !== middle.material ||
        c.material !== middle.material || d.material !== middle.material,
      prepared = road || (preparedPlace && materialBoundary),
      formation = formationAt(middle, size),
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
    waterBoundary4,
    cpuScratchBytesEstimated:
      (positions.length + normals.length + colors.length + indices.length + uvs.length) *
        8 +
      cache.size * 192 +
      vertexIndices.size * 96 + (cuts.size + roadCuts.size) * 256,
  };
}
