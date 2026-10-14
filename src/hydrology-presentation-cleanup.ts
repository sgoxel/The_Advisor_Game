import type { Geometry } from "./geometry.ts";
import { terrainTint } from "./geometry.ts";
import { SOURCE_PRESENTATION_WIDTH, wrapSourceX } from "./planet.ts";
import { finalSurfaceAt, type Tile } from "./world.ts";

/**
 * Presentation-only cleanup for natural hydrology. Canonical water ownership,
 * elevation, traversal, routing and SEED-derived drainage never change here.
 */
const RIVER_PRESENTATION_MAX_TILE = 512;
const MAJOR_BOUNDARY_MAX_TILE = 2048;
const MAJOR_BOUNDARY_MIN_RESOLUTION = 16;
const MAJOR_BOUNDARY_MAX_RESOLUTION = 64;
const MAJOR_BOUNDARY_TARGET_STEP = 2;
const BOUNDARY_GROUND_EPSILON = 0.14;
const BOUNDARY_WATER_EPSILON = 0.16;
const DRY_TINT_RADII = [8, 16, 28, 48] as const;
const DRY_TINT_DIRECTIONS = [
  [1, 0],
  [Math.SQRT1_2, Math.SQRT1_2],
  [0, 1],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-1, 0],
  [-Math.SQRT1_2, -Math.SQRT1_2],
  [0, -1],
  [Math.SQRT1_2, -Math.SQRT1_2],
] as const;

type RGB = readonly [number, number, number];
type Point = readonly [number, number, number];
type BoundarySample = Readonly<{ point: Point; tint: RGB; majorWet: boolean }>;
type ExtraGeometry = {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  uvs: number[];
};

function isMajorWater(kind: ReturnType<typeof finalSurfaceAt>["water"]["kind"]) {
  return kind === "ocean" || kind === "lake";
}

function averageTint(tints: readonly RGB[]): RGB {
  if (!tints.length) return [120, 132, 92];
  let r = 0, g = 0, b = 0;
  for (const tint of tints) {
    r += tint[0];
    g += tint[1];
    b += tint[2];
  }
  return [Math.round(r / tints.length), Math.round(g / tints.length), Math.round(b / tints.length)];
}

function nearbyDryTint(x: number, z: number): RGB {
  for (const radius of DRY_TINT_RADII) {
    const candidates: RGB[] = [];
    for (const [dx, dz] of DRY_TINT_DIRECTIONS) {
      const sx = wrapSourceX(x + dx * radius), sz = z + dz * radius,
        surface = finalSurfaceAt(sx, sz);
      if (
        surface.water.kind === "none" &&
        surface.groundMaterial !== "Riverbank" &&
        surface.groundHeight > 0.05
      ) candidates.push(terrainTint(sx, sz));
    }
    if (candidates.length) return averageTint(candidates);
  }
  return terrainTint(x, z);
}

/**
 * The canonical base grid is intentionally coarse. River/Riverbank colors on
 * those duplicated base vertices interpolate across whole grid triangles and
 * create large teeth. Retint only those base vertices; the joined fine river
 * ribbon remains the visible hydrology presentation above them.
 */
function normalizeCoarseRiverColors(
  tile: Tile,
  geometry: Geometry,
  canonicalVertexCount: number,
): Geometry {
  if (tile.size > RIVER_PRESENTATION_MAX_TILE || canonicalVertexCount <= 0) return geometry;
  const colors = new Uint8Array(geometry.colors),
    originX = tile.minX + tile.size * 0.5,
    originZ = tile.minZ + tile.size * 0.5,
    cache = new Map<string, RGB>();
  let changed = false;
  for (let vertex = 0; vertex < Math.min(canonicalVertexCount, geometry.positions.length / 3); vertex++) {
    const p = vertex * 3,
      x = wrapSourceX(geometry.positions[p] + originX),
      z = geometry.positions[p + 2] + originZ,
      surface = finalSurfaceAt(x, z);
    if (surface.water.kind !== "river" && surface.groundMaterial !== "Riverbank") continue;
    const key = `${x.toFixed(4)}/${z.toFixed(4)}`,
      tint = cache.get(key) ?? nearbyDryTint(x, z),
      c = vertex * 4;
    cache.set(key, tint);
    colors[c] = tint[0];
    colors[c + 1] = tint[1];
    colors[c + 2] = tint[2];
    changed = true;
  }
  return changed ? { ...geometry, colors } : geometry;
}

function normalFor(a: Point, b: Point, c: Point): Point {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2],
    vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
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
  a: BoundarySample,
  b: BoundarySample,
  c: BoundarySample,
) {
  const originX = tile.minX + tile.size * 0.5,
    originZ = tile.minZ + tile.size * 0.5,
    n = normalFor(a.point, b.point, c.point),
    base = extra.positions.length / 3;
  for (const sample of [a, b, c]) {
    const point = sample.point;
    extra.positions.push(point[0] - originX, point[1], point[2] - originZ);
    extra.normals.push(...n);
    extra.colors.push(sample.tint[0], sample.tint[1], sample.tint[2], 255);
    extra.uvs.push(
      point[0] / SOURCE_PRESENTATION_WIDTH + 0.5,
      Math.max(0, Math.min(1, 0.5 + (point[2] * 2) / SOURCE_PRESENTATION_WIDTH)),
    );
  }
  extra.indices.push(base, base + 1, base + 2);
}

function boundarySample(
  x: number,
  z: number,
  cache: Map<string, BoundarySample>,
): BoundarySample {
  const key = `${x.toFixed(6)}/${z.toFixed(6)}`,
    cached = cache.get(key);
  if (cached) return cached;
  const surface = finalSurfaceAt(x, z),
    majorWet = isMajorWater(surface.water.kind),
    point: Point = majorWet && surface.deckHeight === null
      ? [x, surface.water.level + BOUNDARY_WATER_EPSILON, z]
      : [x, surface.groundHeight + BOUNDARY_GROUND_EPSILON, z],
    sample = Object.freeze({ point, tint: terrainTint(x, z), majorWet });
  cache.set(key, sample);
  return sample;
}

function mixedBoundaryCell(
  ax: number,
  az: number,
  size: number,
  cache: Map<string, BoundarySample>,
) {
  const half = size * 0.5,
    samples = [
      boundarySample(ax, az, cache),
      boundarySample(ax, az + size, cache),
      boundarySample(ax + size, az + size, cache),
      boundarySample(ax + size, az, cache),
      boundarySample(ax + half, az + half, cache),
    ];
  return samples.some((sample) => sample.majorWet !== samples[0].majorWet);
}

function renderBoundaryLeaf(
  tile: Tile,
  extra: ExtraGeometry,
  cache: Map<string, BoundarySample>,
  ax: number,
  az: number,
  size: number,
) {
  const half = size * 0.5,
    a = boundarySample(ax, az, cache),
    b = boundarySample(ax, az + size, cache),
    c = boundarySample(ax + size, az + size, cache),
    d = boundarySample(ax + size, az, cache),
    center = boundarySample(ax + half, az + half, cache);
  pushTriangle(extra, tile, a, b, center);
  pushTriangle(extra, tile, b, c, center);
  pushTriangle(extra, tile, c, d, center);
  pushTriangle(extra, tile, d, a, center);
}

/** Cover an entire coarse mixed cell so the older coarse fan cannot protrude. */
function coverBoundaryParent(
  tile: Tile,
  extra: ExtraGeometry,
  cache: Map<string, BoundarySample>,
  ax: number,
  az: number,
  size: number,
  depth: number,
) {
  if (depth <= 0) {
    renderBoundaryLeaf(tile, extra, cache, ax, az, size);
    return;
  }
  const half = size * 0.5;
  coverBoundaryParent(tile, extra, cache, ax, az, half, depth - 1);
  coverBoundaryParent(tile, extra, cache, ax, az + half, half, depth - 1);
  coverBoundaryParent(tile, extra, cache, ax + half, az + half, half, depth - 1);
  coverBoundaryParent(tile, extra, cache, ax + half, az, half, depth - 1);
}

function boundaryResolution(tile: Tile) {
  return Math.min(
    MAJOR_BOUNDARY_MAX_RESOLUTION,
    Math.max(MAJOR_BOUNDARY_MIN_RESOLUTION, Math.ceil(tile.size / MAJOR_BOUNDARY_TARGET_STEP)),
  );
}

function addHighDetailMajorBoundary(tile: Tile, geometry: Geometry): Geometry {
  if (tile.size > MAJOR_BOUNDARY_MAX_TILE) return geometry;
  const resolution = boundaryResolution(tile),
    step = tile.size / resolution,
    depth = Math.min(4, Math.max(0, Math.ceil(Math.log2(step / MAJOR_BOUNDARY_TARGET_STEP)))),
    cache = new Map<string, BoundarySample>(),
    extra: ExtraGeometry = { positions: [], normals: [], colors: [], indices: [], uvs: [] };
  for (let z = 0; z < resolution; z++)
    for (let x = 0; x < resolution; x++) {
      const ax = tile.minX + x * step, az = tile.minZ + z * step;
      if (!mixedBoundaryCell(ax, az, step, cache)) continue;
      coverBoundaryParent(tile, extra, cache, ax, az, step, depth);
    }
  if (!extra.positions.length) return geometry;

  const vertexOffset = geometry.positions.length / 3,
    positions = new Float32Array(geometry.positions.length + extra.positions.length),
    normals = new Float32Array(geometry.normals.length + extra.normals.length),
    colors = new Uint8Array(geometry.colors.length + extra.colors.length),
    indices = new Uint32Array(geometry.indices.length + extra.indices.length);
  positions.set(geometry.positions);
  positions.set(extra.positions, geometry.positions.length);
  normals.set(geometry.normals);
  normals.set(extra.normals, geometry.normals.length);
  colors.set(geometry.colors);
  colors.set(extra.colors, geometry.colors.length);
  indices.set(geometry.indices);
  for (let i = 0; i < extra.indices.length; i++)
    indices[geometry.indices.length + i] = extra.indices[i] + vertexOffset;

  let uvs = geometry.uvs;
  if (geometry.uvs) {
    const combined = new Float32Array(geometry.uvs.length + extra.uvs.length);
    combined.set(geometry.uvs);
    combined.set(extra.uvs, geometry.uvs.length);
    uvs = combined;
  }
  return { positions, normals, colors, indices, uvs };
}

export function stabilizeHydrologyPresentation(
  tile: Tile,
  geometry: Geometry,
  canonicalVertexCount: number,
): Geometry {
  return addHighDetailMajorBoundary(
    tile,
    normalizeCoarseRiverColors(tile, geometry, canonicalVertexCount),
  );
}
