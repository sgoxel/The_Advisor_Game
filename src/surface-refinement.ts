import type { Geometry, TileGeometry } from "./geometry.ts";
import { terrainTint } from "./geometry.ts";
import { roads, type Road } from "./geography.ts";
import { roadFragmentsInBounds, clippedStationRange } from "./continuity-corridor.ts";
import {
  drainageSegmentsInBounds,
  RIVER_BANK_HALF_WIDTH_SOURCE,
  type DrainageSegment,
} from "./hydrology.ts";
import { SOURCE_PRESENTATION_WIDTH, wrapSourceX } from "./planet.ts";
import { finalSurfaceAt, type Tile } from "./world.ts";

/**
 * Presentation resampling for canonical prepared/water boundaries.
 * Every height/material/water value is read from finalSurfaceAt(); generated
 * meshes never become collision, routing or identity authority.
 */
const LEGACY_BRIDGE_RGB = [115, 88, 56] as const;
export const REFINED_BRIDGE_RGB = [108, 79, 45] as const;
export const REFINED_ROAD_RGB = [143, 122, 84] as const;
export const REFINED_BRIDGE_HALF_WIDTH_SOURCE = 2.1;
const ROAD_RIBBON_HALF_WIDTH_SOURCE = 2.35;
const GROUND_EPSILON = 0.025;
const BANK_EPSILON = 0.045;
const WATER_EPSILON = 0.065;
const ROAD_EPSILON = 0.07;
const BRIDGE_EPSILON = 0.1;
const NATURAL_RIBBON_MAX_TILE = 512;
const BANK_MASK_OVERDRAW_SOURCE = 2.5;

type Point = [number, number, number];
type RGB = readonly [number, number, number];
type ExtraGeometry = {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  uvs?: number[];
};

function emptyExtra(withUvs = false): ExtraGeometry {
  return { positions: [], normals: [], colors: [], indices: [], uvs: withUvs ? [] : undefined };
}
function normalFor(a: Point, b: Point, c: Point): Point {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2],
    vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length; ny /= length; nz /= length;
  return [nx, ny, nz];
}
function pushTriangle(
  extra: ExtraGeometry,
  tile: Tile,
  a: Point,
  b: Point,
  c: Point,
  tintA: RGB,
  tintB: RGB = tintA,
  tintC: RGB = tintA,
) {
  const originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2,
    n = normalFor(a, b, c),
    base = extra.positions.length / 3,
    points = [a, b, c] as const,
    tints = [tintA, tintB, tintC] as const;
  for (let i = 0; i < 3; i++) {
    const point = points[i];
    extra.positions.push(point[0] - originX, point[1], point[2] - originZ);
    extra.normals.push(...n);
    extra.colors.push(tints[i][0], tints[i][1], tints[i][2], 255);
    if (extra.uvs)
      extra.uvs.push(
        point[0] / SOURCE_PRESENTATION_WIDTH + 0.5,
        Math.max(0, Math.min(1, 0.5 + (point[2] * 2) / SOURCE_PRESENTATION_WIDTH)),
      );
  }
  extra.indices.push(base, base + 1, base + 2);
}
function pushQuad(
  extra: ExtraGeometry,
  tile: Tile,
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  tintA: RGB,
  tintB: RGB = tintA,
  tintC: RGB = tintA,
  tintD: RGB = tintA,
) {
  pushTriangle(extra, tile, a, b, c, tintA, tintB, tintC);
  pushTriangle(extra, tile, a, c, d, tintA, tintC, tintD);
}
function mergeGeometry(base: Geometry, extra: ExtraGeometry): Geometry {
  if (!extra.positions.length) return base;
  const vertexOffset = base.positions.length / 3,
    positions = new Float32Array(base.positions.length + extra.positions.length),
    normals = new Float32Array(base.normals.length + extra.normals.length),
    colors = new Uint8Array(base.colors.length + extra.colors.length),
    indices = new Uint32Array(base.indices.length + extra.indices.length);
  positions.set(base.positions); positions.set(extra.positions, base.positions.length);
  normals.set(base.normals); normals.set(extra.normals, base.normals.length);
  colors.set(base.colors); colors.set(extra.colors, base.colors.length);
  indices.set(base.indices);
  for (let i = 0; i < extra.indices.length; i++) indices[base.indices.length + i] = extra.indices[i] + vertexOffset;

  let uvs = base.uvs;
  if (base.uvs || extra.uvs) {
    const baseUvs = base.uvs || new Float32Array(vertexOffset * 2),
      addedUvs = extra.uvs || new Array((extra.positions.length / 3) * 2).fill(0),
      combined = new Float32Array(baseUvs.length + addedUvs.length);
    combined.set(baseUvs); combined.set(addedUvs, baseUvs.length); uvs = combined;
  }
  return { positions, normals, colors, indices, uvs };
}

function isLegacyBridgeTriangle(geometry: Geometry, triangleOffset: number) {
  for (let corner = 0; corner < 3; corner++) {
    const vertex = geometry.indices[triangleOffset + corner], c = vertex * 4;
    if (
      geometry.colors[c] !== LEGACY_BRIDGE_RGB[0] ||
      geometry.colors[c + 1] !== LEGACY_BRIDGE_RGB[1] ||
      geometry.colors[c + 2] !== LEGACY_BRIDGE_RGB[2]
    ) return false;
  }
  return true;
}
export function stripLegacyBridgeDeck(geometry: Geometry): Geometry {
  let removed = false;
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let i = 0; i < geometry.indices.length; i += 3) {
    if (isLegacyBridgeTriangle(geometry, i)) { removed = true; continue; }
    for (let corner = 0; corner < 3; corner++) {
      const sourceVertex = geometry.indices[i + corner], targetVertex = positions.length / 3,
        p = sourceVertex * 3, c = sourceVertex * 4;
      positions.push(geometry.positions[p], geometry.positions[p + 1], geometry.positions[p + 2]);
      normals.push(geometry.normals[p], geometry.normals[p + 1], geometry.normals[p + 2]);
      colors.push(geometry.colors[c], geometry.colors[c + 1], geometry.colors[c + 2], geometry.colors[c + 3]);
      indices.push(targetVertex);
    }
  }
  if (!removed) return geometry;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
  };
}

function shiftedRoadsIntersecting(tile: Tile): { road: Road; shiftX: number }[] {
  const matches: { road: Road; shiftX: number }[] = [];
  for (const road of roadFragmentsInBounds(roads, tile.minX, tile.minZ, tile.size))
    for (const shiftX of [-SOURCE_PRESENTATION_WIDTH, 0, SOURCE_PRESENTATION_WIDTH]) {
      const margin = 14,
        minX = road.minX + shiftX,
        maxX = road.maxX + shiftX;
      if (
        maxX < tile.minX - margin || minX > tile.minX + tile.size + margin ||
        road.maxZ < tile.minZ - margin || road.minZ > tile.minZ + tile.size + margin
      ) continue;
      matches.push({ road, shiftX });
    }
  return matches;
}
function hasWaterBoundary(tile: Tile) {
  let wet = false, dry = false;
  for (let z = 0; z <= 4; z++)
    for (let x = 0; x <= 4; x++) {
      const surface = finalSurfaceAt(tile.minX + (tile.size * x) / 4, tile.minZ + (tile.size * z) / 4);
      if (surface.water.kind === "none") dry = true; else wet = true;
      if (wet && dry) return true;
    }
  return false;
}

/** Mixed-water coarse tiles receive bounded local resampling; dry road refinement stays fine-only. */
export function refinementResolutionForTile(tile: Tile, hasRoad: boolean, waterBoundary: boolean) {
  if (waterBoundary) {
    if (tile.size > NATURAL_RIBBON_MAX_TILE) return 0;
    if (tile.size <= 64) return Math.min(48, Math.max(8, Math.ceil(tile.size)));
    return Math.min(32, Math.max(12, Math.ceil(tile.size / 16)));
  }
  if (tile.size > 64 || !hasRoad) return 0;
  return Math.min(32, Math.max(8, Math.ceil(tile.size)));
}

function presentationPoint(x: number, z: number, waterBoundary: boolean): Point {
  const surface = finalSurfaceAt(x, z);
  if (waterBoundary && surface.water.kind !== "none" && surface.deckHeight === null)
    return [x, surface.water.level + WATER_EPSILON, z];
  return [x, surface.groundHeight + GROUND_EPSILON, z];
}
function addGroundRefinement(tile: Tile, extra: ExtraGeometry, resolution: number, waterBoundary: boolean) {
  if (!resolution) return;
  const step = tile.size / resolution;
  for (let z = 0; z < resolution; z++)
    for (let x = 0; x < resolution; x++) {
      const ax = tile.minX + x * step, az = tile.minZ + z * step,
        points: Point[] = [
          presentationPoint(ax, az, waterBoundary),
          presentationPoint(ax, az + step, waterBoundary),
          presentationPoint(ax + step, az + step, waterBoundary),
          presentationPoint(ax + step, az, waterBoundary),
        ];
      if (!waterBoundary && Math.max(...points.map((point) => point[1])) <= 0.05) continue;
      const tints = points.map((point) => terrainTint(point[0], point[2])) as RGB[];
      pushQuad(extra, tile, points[0], points[1], points[2], points[3], tints[0], tints[1], tints[2], tints[3]);
    }
}

function shiftedSegmentStartX(tile: Tile, segment: DrainageSegment) {
  const center = tile.minX + tile.size * 0.5;
  let best = segment.ax, bestDistance = Math.abs(segment.ax - center);
  for (const shift of [-SOURCE_PRESENTATION_WIDTH, SOURCE_PRESENTATION_WIDTH]) {
    const candidate = segment.ax + shift, distance = Math.abs(candidate - center);
    if (distance < bestDistance) { best = candidate; bestDistance = distance; }
  }
  return best;
}
function surfacePoint(x: number, z: number, epsilon: number): Point {
  return [x, finalSurfaceAt(x, z).groundHeight + epsilon, z];
}

/** Smooth render strips from the same canonical drainage support and surface samples. */
function addNaturalHydrologyRibbons(tile: Tile, extra: ExtraGeometry, segments: readonly DrainageSegment[]) {
  const sampleStep = tile.size > 64 ? 4 : 2;
  for (const segment of segments) {
    const ax = shiftedSegmentStartX(tile, segment),
      vx = wrapSourceX(segment.bx - segment.ax),
      vz = segment.bz - segment.az,
      length = Math.hypot(vx, vz);
    if (!length) continue;
    const ux = vx / length, uz = vz / length,
      nx = -uz, nz = ux,
      count = Math.max(1, Math.ceil(length / sampleStep)),
      wetHalf = Math.max(0.2, segment.width * 0.96),
      bankInner = segment.width + 0.08,
      bankOuter = segment.width + RIVER_BANK_HALF_WIDTH_SOURCE + BANK_MASK_OVERDRAW_SOURCE;
    for (let index = 0; index < count; index++) {
      const t0 = index / count, t1 = (index + 1) / count,
        x0 = ax + vx * t0, z0 = segment.az + vz * t0,
        x1 = ax + vx * t1, z1 = segment.az + vz * t1,
        mx = (x0 + x1) * 0.5, mz = (z0 + z1) * 0.5;
      if (mx < tile.minX || mx >= tile.minX + tile.size || mz < tile.minZ || mz >= tile.minZ + tile.size) continue;
      const middle = finalSurfaceAt(mx, mz);
      if (middle.water.kind !== "river") continue;

      const leftOuter0 = surfacePoint(x0 + nx * bankOuter, z0 + nz * bankOuter, BANK_EPSILON),
        leftOuter1 = surfacePoint(x1 + nx * bankOuter, z1 + nz * bankOuter, BANK_EPSILON),
        leftInner1 = surfacePoint(x1 + nx * bankInner, z1 + nz * bankInner, BANK_EPSILON),
        leftInner0 = surfacePoint(x0 + nx * bankInner, z0 + nz * bankInner, BANK_EPSILON),
        rightInner0 = surfacePoint(x0 - nx * bankInner, z0 - nz * bankInner, BANK_EPSILON),
        rightInner1 = surfacePoint(x1 - nx * bankInner, z1 - nz * bankInner, BANK_EPSILON),
        rightOuter1 = surfacePoint(x1 - nx * bankOuter, z1 - nz * bankOuter, BANK_EPSILON),
        rightOuter0 = surfacePoint(x0 - nx * bankOuter, z0 - nz * bankOuter, BANK_EPSILON);
      pushQuad(
        extra, tile,
        leftOuter0, leftOuter1, leftInner1, leftInner0,
        terrainTint(leftOuter0[0], leftOuter0[2]), terrainTint(leftOuter1[0], leftOuter1[2]),
        terrainTint(leftInner1[0], leftInner1[2]), terrainTint(leftInner0[0], leftInner0[2]),
      );
      pushQuad(
        extra, tile,
        rightInner0, rightInner1, rightOuter1, rightOuter0,
        terrainTint(rightInner0[0], rightInner0[2]), terrainTint(rightInner1[0], rightInner1[2]),
        terrainTint(rightOuter1[0], rightOuter1[2]), terrainTint(rightOuter0[0], rightOuter0[2]),
      );

      const startSurface = finalSurfaceAt(x0, z0), endSurface = finalSurfaceAt(x1, z1),
        y0 = (startSurface.water.kind === "river" ? startSurface.water.level : middle.water.level) + WATER_EPSILON,
        y1 = (endSurface.water.kind === "river" ? endSurface.water.level : middle.water.level) + WATER_EPSILON,
        waterTint0 = terrainTint(x0, z0), waterTint1 = terrainTint(x1, z1);
      pushQuad(
        extra, tile,
        [x0 + nx * wetHalf, y0, z0 + nz * wetHalf],
        [x1 + nx * wetHalf, y1, z1 + nz * wetHalf],
        [x1 - nx * wetHalf, y1, z1 - nz * wetHalf],
        [x0 - nx * wetHalf, y0, z0 - nz * wetHalf],
        waterTint0, waterTint1, waterTint1, waterTint0,
      );
    }
  }
}

function addRoadAndBridgeRibbons(tile: Tile, extra: ExtraGeometry, matches: readonly { road: Road; shiftX: number }[]) {
  for (const { road, shiftX } of matches) {
    const vx = road.toX - road.fromX, vz = road.toZ - road.fromZ, length = Math.hypot(vx, vz);
    if (!length) continue;
    const ux = vx / length, uz = vz / length,
      segmentCount = Math.max(1, Math.ceil(length)),
      roadNx = -uz * ROAD_RIBBON_HALF_WIDTH_SOURCE, roadNz = ux * ROAD_RIBBON_HALF_WIDTH_SOURCE,
      bridgeNx = -uz * REFINED_BRIDGE_HALF_WIDTH_SOURCE, bridgeNz = ux * REFINED_BRIDGE_HALF_WIDTH_SOURCE;
    const [first, last] = clippedStationRange(
      road.fromX + shiftX, road.fromZ, road.toX + shiftX, road.toZ,
      tile.minX, tile.minZ, tile.size, segmentCount,
    );
    for (let index = first; index < last; index++) {
      const t0 = index / segmentCount, t1 = (index + 1) / segmentCount,
        x0 = road.fromX + shiftX + vx * t0, z0 = road.fromZ + vz * t0,
        x1 = road.fromX + shiftX + vx * t1, z1 = road.fromZ + vz * t1,
        mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      if (mx < tile.minX || mx >= tile.minX + tile.size || mz < tile.minZ || mz >= tile.minZ + tile.size) continue;
      const middle = finalSurfaceAt(mx, mz);
      if (middle.deckHeight !== null) {
        const y = middle.deckHeight + BRIDGE_EPSILON,
          a: Point = [x0 + bridgeNx, y, z0 + bridgeNz], b: Point = [x1 + bridgeNx, y, z1 + bridgeNz],
          c: Point = [x1 - bridgeNx, y, z1 - bridgeNz], d: Point = [x0 - bridgeNx, y, z0 - bridgeNz];
        pushQuad(extra, tile, a, b, c, d, REFINED_BRIDGE_RGB);
        const rail = 0.16, edgeTint: RGB = [73, 54, 35];
        pushQuad(extra, tile,
          [x0 + bridgeNx, y + 0.06, z0 + bridgeNz], [x1 + bridgeNx, y + 0.06, z1 + bridgeNz],
          [x1 + bridgeNx - ux * rail, y + 0.06, z1 + bridgeNz - uz * rail],
          [x0 + bridgeNx - ux * rail, y + 0.06, z0 + bridgeNz - uz * rail], edgeTint);
        pushQuad(extra, tile,
          [x0 - bridgeNx + ux * rail, y + 0.06, z0 - bridgeNz + uz * rail],
          [x1 - bridgeNx + ux * rail, y + 0.06, z1 - bridgeNz + uz * rail],
          [x1 - bridgeNx, y + 0.06, z1 - bridgeNz], [x0 - bridgeNx, y + 0.06, z0 - bridgeNz], edgeTint);
        continue;
      }
      if (middle.water.kind !== "none" || middle.groundMaterial !== "Road") continue;
      const corners: Point[] = [
        [x0 + roadNx, finalSurfaceAt(x0 + roadNx, z0 + roadNz).groundHeight + ROAD_EPSILON, z0 + roadNz],
        [x1 + roadNx, finalSurfaceAt(x1 + roadNx, z1 + roadNz).groundHeight + ROAD_EPSILON, z1 + roadNz],
        [x1 - roadNx, finalSurfaceAt(x1 - roadNx, z1 - roadNz).groundHeight + ROAD_EPSILON, z1 - roadNz],
        [x0 - roadNx, finalSurfaceAt(x0 - roadNx, z0 - roadNz).groundHeight + ROAD_EPSILON, z0 - roadNz],
      ];
      if (corners.some((point) => finalSurfaceAt(point[0], point[2]).water.kind !== "none")) continue;
      pushQuad(extra, tile, corners[0], corners[1], corners[2], corners[3], REFINED_ROAD_RGB);
    }
  }
}

export function refineTileSurfacePresentation(tile: Tile, data: TileGeometry): TileGeometry {
  if (tile.size > NATURAL_RIBBON_MAX_TILE) return data;
  const hydrologySegments = drainageSegmentsInBounds(tile.minX, tile.minZ, tile.size),
    waterBoundary = hasWaterBoundary(tile),
    hydrology = emptyExtra(true),
    ground = emptyExtra(true);
  addNaturalHydrologyRibbons(tile, hydrology, hydrologySegments);

  if (tile.size > 64) {
    const resolution = refinementResolutionForTile(tile, false, waterBoundary);
    addGroundRefinement(tile, ground, resolution, waterBoundary);
    if (!ground.positions.length && !hydrology.positions.length) return data;
    data.terrain = mergeGeometry(mergeGeometry(data.terrain, ground), hydrology);
    return data;
  }

  const matches = shiftedRoadsIntersecting(tile),
    resolution = refinementResolutionForTile(tile, matches.length > 0, waterBoundary);
  if (!resolution && !matches.length && !hydrology.positions.length) return data;

  const prepared = emptyExtra(false);
  addGroundRefinement(tile, ground, resolution, waterBoundary);
  addRoadAndBridgeRibbons(tile, prepared, matches);
  data.terrain = mergeGeometry(mergeGeometry(data.terrain, ground), hydrology);
  data.structures = mergeGeometry(stripLegacyBridgeDeck(data.structures), prepared);
  return data;
}
