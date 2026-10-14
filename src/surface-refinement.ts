import type { Geometry, TileGeometry } from "./geometry.ts";
import { terrainTint } from "./geometry.ts";
import { roads, type Road } from "./geography.ts";
import { roadFragmentsInBounds, clippedStationRange } from "./continuity-corridor.ts";
import { SOURCE_PRESENTATION_WIDTH } from "./planet.ts";
import { finalSurfaceAt, type Tile } from "./world.ts";

/**
 * Fine presentation refinement for player-relevant prepared/water boundaries.
 *
 * The canonical surface remains finalSurfaceAt(). This module only resamples that
 * authority more densely where the coarse streaming mesh visibly aliases a road,
 * bank or bridge. It never invents terrain height, material, water or walkability.
 */
const LEGACY_BRIDGE_RGB = [115, 88, 56] as const;
export const REFINED_BRIDGE_RGB = [108, 79, 45] as const;
export const REFINED_ROAD_RGB = [143, 122, 84] as const;
export const REFINED_BRIDGE_HALF_WIDTH_SOURCE = 2.1;
const ROAD_RIBBON_HALF_WIDTH_SOURCE = 2.35;
const GROUND_EPSILON = 0.025;
const ROAD_EPSILON = 0.07;
const BRIDGE_EPSILON = 0.1;

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
  return {
    positions: [],
    normals: [],
    colors: [],
    indices: [],
    uvs: withUvs ? [] : undefined,
  };
}

function normalFor(a: Point, b: Point, c: Point): Point {
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2],
    vx = c[0] - a[0],
    vy = c[1] - a[1],
    vz = c[2] - a[2];
  let nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length;
  ny /= length;
  nz /= length;
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
  positions.set(base.positions);
  positions.set(extra.positions, base.positions.length);
  normals.set(base.normals);
  normals.set(extra.normals, base.normals.length);
  colors.set(base.colors);
  colors.set(extra.colors, base.colors.length);
  indices.set(base.indices);
  for (let i = 0; i < extra.indices.length; i++)
    indices[base.indices.length + i] = extra.indices[i] + vertexOffset;

  let uvs = base.uvs;
  if (base.uvs || extra.uvs) {
    const baseUvs = base.uvs || new Float32Array(vertexOffset * 2),
      addedUvs = extra.uvs || new Array((extra.positions.length / 3) * 2).fill(0),
      combined = new Float32Array(baseUvs.length + addedUvs.length);
    combined.set(baseUvs);
    combined.set(addedUvs, baseUvs.length);
    uvs = combined;
  }
  return { positions, normals, colors, indices, uvs };
}

function isLegacyBridgeTriangle(geometry: Geometry, triangleOffset: number) {
  for (let corner = 0; corner < 3; corner++) {
    const vertex = geometry.indices[triangleOffset + corner],
      colorOffset = vertex * 4;
    if (
      geometry.colors[colorOffset] !== LEGACY_BRIDGE_RGB[0] ||
      geometry.colors[colorOffset + 1] !== LEGACY_BRIDGE_RGB[1] ||
      geometry.colors[colorOffset + 2] !== LEGACY_BRIDGE_RGB[2]
    )
      return false;
  }
  return true;
}

/** Remove the old 10-source-unit-wide deck before adding the authority-shaped deck. */
export function stripLegacyBridgeDeck(geometry: Geometry): Geometry {
  let removed = false;
  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < geometry.indices.length; i += 3) {
    if (isLegacyBridgeTriangle(geometry, i)) {
      removed = true;
      continue;
    }
    for (let corner = 0; corner < 3; corner++) {
      const sourceVertex = geometry.indices[i + corner],
        targetVertex = positions.length / 3,
        p = sourceVertex * 3,
        c = sourceVertex * 4;
      positions.push(
        geometry.positions[p],
        geometry.positions[p + 1],
        geometry.positions[p + 2],
      );
      normals.push(
        geometry.normals[p],
        geometry.normals[p + 1],
        geometry.normals[p + 2],
      );
      colors.push(
        geometry.colors[c],
        geometry.colors[c + 1],
        geometry.colors[c + 2],
        geometry.colors[c + 3],
      );
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
        maxX < tile.minX - margin ||
        minX > tile.minX + tile.size + margin ||
        road.maxZ < tile.minZ - margin ||
        road.minZ > tile.minZ + tile.size + margin
      )
        continue;
      matches.push({ road, shiftX });
    }
  return matches;
}

function hasWaterBoundary(tile: Tile) {
  let wet = false,
    dry = false;
  for (let z = 0; z <= 4; z++)
    for (let x = 0; x <= 4; x++) {
      const surface = finalSurfaceAt(
        tile.minX + (tile.size * x) / 4,
        tile.minZ + (tile.size * z) / 4,
      );
      if (surface.water.kind === "none") dry = true;
      else wet = true;
      if (wet && dry) return true;
    }
  return false;
}

/** Fine tiles normally use a 2-source-unit grid. Refined authority samples use <=1. */
export function refinementResolutionForTile(tile: Tile, hasRoad: boolean, waterBoundary: boolean) {
  if (tile.size > 64 || (!hasRoad && !waterBoundary)) return 0;
  return Math.min(32, Math.max(8, Math.ceil(tile.size)));
}

function addGroundRefinement(
  tile: Tile,
  extra: ExtraGeometry,
  resolution: number,
) {
  if (!resolution) return;
  const step = tile.size / resolution;
  for (let z = 0; z < resolution; z++)
    for (let x = 0; x < resolution; x++) {
      const ax = tile.minX + x * step,
        az = tile.minZ + z * step,
        points: Point[] = [
          [ax, finalSurfaceAt(ax, az).groundHeight + GROUND_EPSILON, az],
          [ax, finalSurfaceAt(ax, az + step).groundHeight + GROUND_EPSILON, az + step],
          [ax + step, finalSurfaceAt(ax + step, az + step).groundHeight + GROUND_EPSILON, az + step],
          [ax + step, finalSurfaceAt(ax + step, az).groundHeight + GROUND_EPSILON, az],
        ];
      if (Math.max(...points.map((point) => point[1])) <= 0.05) continue;
      const tints = points.map((point) => terrainTint(point[0], point[2])) as RGB[];
      pushQuad(
        extra,
        tile,
        points[0],
        points[1],
        points[2],
        points[3],
        tints[0],
        tints[1],
        tints[2],
        tints[3],
      );
    }
}

function addRoadAndBridgeRibbons(
  tile: Tile,
  extra: ExtraGeometry,
  matches: readonly { road: Road; shiftX: number }[],
) {
  for (const { road, shiftX } of matches) {
    const vx = road.toX - road.fromX,
      vz = road.toZ - road.fromZ,
      length = Math.hypot(vx, vz);
    if (!length) continue;
    const ux = vx / length,
      uz = vz / length,
      segmentCount = Math.max(1, Math.ceil(length)),
      roadNx = -uz * ROAD_RIBBON_HALF_WIDTH_SOURCE,
      roadNz = ux * ROAD_RIBBON_HALF_WIDTH_SOURCE,
      bridgeNx = -uz * REFINED_BRIDGE_HALF_WIDTH_SOURCE,
      bridgeNz = ux * REFINED_BRIDGE_HALF_WIDTH_SOURCE;
    const [first, last] = clippedStationRange(road.fromX + shiftX, road.fromZ, road.toX + shiftX, road.toZ, tile.minX, tile.minZ, tile.size, segmentCount);
    for (let index = first; index < last; index++) {
      const t0 = index / segmentCount,
        t1 = (index + 1) / segmentCount,
        x0 = road.fromX + shiftX + vx * t0,
        z0 = road.fromZ + vz * t0,
        x1 = road.fromX + shiftX + vx * t1,
        z1 = road.fromZ + vz * t1,
        mx = (x0 + x1) / 2,
        mz = (z0 + z1) / 2;
      if (
        mx < tile.minX ||
        mx >= tile.minX + tile.size ||
        mz < tile.minZ ||
        mz >= tile.minZ + tile.size
      )
        continue;
      const middle = finalSurfaceAt(mx, mz);
      if (middle.deckHeight !== null) {
        const start = finalSurfaceAt(x0, z0), end = finalSurfaceAt(x1, z1),
          y0 = (start.deckHeight ?? start.groundHeight) + BRIDGE_EPSILON,
          y1 = (end.deckHeight ?? end.groundHeight) + BRIDGE_EPSILON,
          a: Point = [x0 + bridgeNx, y0, z0 + bridgeNz],
          b: Point = [x1 + bridgeNx, y1, z1 + bridgeNz],
          c: Point = [x1 - bridgeNx, y1, z1 - bridgeNz],
          d: Point = [x0 - bridgeNx, y0, z0 - bridgeNz];
        pushQuad(extra, tile, a, b, c, d, REFINED_BRIDGE_RGB);
        // Narrow edge strips make the crossing read as a bridge without adding
        // collision-only geometry or broadening its authoritative deck support.
        const rail = 0.16,
          edgeTint: RGB = [73, 54, 35];
        pushQuad(
          extra,
          tile,
          [x0 + bridgeNx, y0 + 0.06, z0 + bridgeNz],
          [x1 + bridgeNx, y1 + 0.06, z1 + bridgeNz],
          [x1 + bridgeNx + uz * rail, y1 + 0.06, z1 + bridgeNz - ux * rail],
          [x0 + bridgeNx + uz * rail, y0 + 0.06, z0 + bridgeNz - ux * rail],
          edgeTint,
        );
        pushQuad(
          extra,
          tile,
          [x0 - bridgeNx - uz * rail, y0 + 0.06, z0 - bridgeNz + ux * rail],
          [x1 - bridgeNx - uz * rail, y1 + 0.06, z1 - bridgeNz + ux * rail],
          [x1 - bridgeNx, y1 + 0.06, z1 - bridgeNz],
          [x0 - bridgeNx, y0 + 0.06, z0 - bridgeNz],
          edgeTint,
        );
        continue;
      }
      if (middle.water.kind !== "none" || middle.groundMaterial !== "Road") continue;
      const corners: Point[] = [
        [x0 + roadNx, finalSurfaceAt(x0 + roadNx, z0 + roadNz).groundHeight + ROAD_EPSILON, z0 + roadNz],
        [x1 + roadNx, finalSurfaceAt(x1 + roadNx, z1 + roadNz).groundHeight + ROAD_EPSILON, z1 + roadNz],
        [x1 - roadNx, finalSurfaceAt(x1 - roadNx, z1 - roadNz).groundHeight + ROAD_EPSILON, z1 - roadNz],
        [x0 - roadNx, finalSurfaceAt(x0 - roadNx, z0 - roadNz).groundHeight + ROAD_EPSILON, z0 - roadNz],
      ];
      // Never paint a presentation road across water: legal crossings are the
      // explicit deck branch above.
      if (
        corners.some((point) => finalSurfaceAt(point[0], point[2]).water.kind !== "none")
      )
        continue;
      pushQuad(
        extra,
        tile,
        corners[0],
        corners[1],
        corners[2],
        corners[3],
        REFINED_ROAD_RGB,
      );
    }
  }
}

/**
 * Resample only the visible alias-prone prepared/water areas. Query work and
 * geometry remain bounded by tile size and intersecting road support.
 */
export function refineTileSurfacePresentation(tile: Tile, data: TileGeometry, preserveGround = false): TileGeometry {
  // Coarse fallback/globe coverage must not materialize every fine road station.
  if (tile.size > 64) return data;
  const matches = shiftedRoadsIntersecting(tile),
    waterBoundary = hasWaterBoundary(tile),
    resolution = refinementResolutionForTile(tile, matches.length > 0, waterBoundary);
  if (!resolution && !matches.length) return data;

  const ground = emptyExtra(true),
    prepared = emptyExtra(false);
  if (!preserveGround) addGroundRefinement(tile, ground, resolution);
  addRoadAndBridgeRibbons(tile, prepared, matches);
  data.terrain = mergeGeometry(data.terrain, ground);
  data.structures = mergeGeometry(stripLegacyBridgeDeck(data.structures), prepared);
  return data;
}
