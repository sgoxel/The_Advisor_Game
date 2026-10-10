import type { Geometry } from "./geometry.ts";
import { terrainTint } from "./geometry.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  SOURCE_PRESENTATION_WIDTH,
  sourceToLonLat,
  wrapSourceX,
} from "./planet.ts";
import {
  drainageLakeRadiusAt,
  drainageRiverWidthAt,
  drainageRecipesNear,
  surfaceAt,
  type DrainagePoint,
  type DrainageRecipe,
  type SurfaceSample,
} from "./surface.ts";
import type { Tile } from "./world.ts";

type RGB = [number, number, number];
type Point = [number, number, number];
type Vertex = {
  point: Point;
  tint: RGB;
  normal: Point;
  wet: boolean;
  cliff: boolean;
};

const OCEAN_WATER: RGB = [70, 126, 132];
const RIVER_WATER: RGB = [58, 126, 148];
const LAKE_WATER: RGB = [62, 122, 151];
const UP: Point = [0, 1, 0];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const blend = (a: RGB, b: RGB, amount: number): RGB => {
  const t = clamp01(amount);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
};
function normalize(point: Point): Point {
  const length = Math.hypot(point[0], point[1], point[2]) || 1;
  return [point[0] / length, point[1] / length, point[2] / length];
}
function interpolate(a: Vertex, b: Vertex, t: number): Vertex {
  return {
    point: [
      a.point[0] + (b.point[0] - a.point[0]) * t,
      a.point[1] + (b.point[1] - a.point[1]) * t,
      a.point[2] + (b.point[2] - a.point[2]) * t,
    ],
    tint: blend(a.tint, b.tint, t),
    normal: normalize([
      a.normal[0] + (b.normal[0] - a.normal[0]) * t,
      a.normal[1] + (b.normal[1] - a.normal[1]) * t,
      a.normal[2] + (b.normal[2] - a.normal[2]) * t,
    ]),
    wet: t < 0.5 ? a.wet : b.wet,
    cliff: a.cliff || b.cliff,
  };
}

/** Presentation shade only; canonical height/traversal remains surfaceAt(). */
function shadedTint(vertex: Vertex): RGB {
  if (vertex.wet) return vertex.tint;
  const n = vertex.normal,
    light = n[0] * -0.36 + n[1] * 0.86 + n[2] * -0.36,
    slope = 1 - Math.max(0, n[1]),
    shade = Math.max(0.7, Math.min(1.22, 0.82 + light * 0.34 + slope * 0.08)),
    base = vertex.cliff
      ? blend(vertex.tint, [113, 114, 106], 0.18)
      : vertex.tint;
  return [base[0] * shade, base[1] * shade, base[2] * shade];
}

function presentationTint(x: number, z: number, surface: SurfaceSample, scale: number): RGB {
  // Shared terrainTint keeps Realm/local climate and material identity aligned.
  // Cliff colour stays a weak overlay; the final-surface slope supplies the shape.
  const base = terrainTint(
    x,
    z,
    Math.min(512, Math.max(2, scale)),
    surface.elevation,
  );
  if (!surface.cliff) return base;
  const severity = clamp01((surface.slope - 0.55) / 1.6);
  return blend(base, [118, 117, 108], 0.12 + severity * 0.16);
}

function pushTriangle(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  a: Vertex,
  b: Vertex,
  c: Vertex,
) {
  const start = positions.length / 3;
  for (const vertex of [a, b, c]) {
    const tint = shadedTint(vertex);
    positions.push(...vertex.point);
    normals.push(...vertex.normal);
    colors.push(byte(tint[0]), byte(tint[1]), byte(tint[2]), 255);
  }
  indices.push(start, start + 1, start + 2);
}
function pushQuad(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  a: Vertex,
  b: Vertex,
  c: Vertex,
  d: Vertex,
  alternate = false,
) {
  if (alternate) {
    pushTriangle(positions, normals, colors, indices, b, c, d);
    pushTriangle(positions, normals, colors, indices, b, d, a);
  } else {
    pushTriangle(positions, normals, colors, indices, a, b, c);
    pushTriangle(positions, normals, colors, indices, a, c, d);
  }
}
function pushPolygon(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  polygon: Vertex[],
) {
  for (let i = 1; i < polygon.length - 1; i++)
    pushTriangle(
      positions,
      normals,
      colors,
      indices,
      polygon[0],
      polygon[i],
      polygon[i + 1],
    );
}

/** Deterministically bisect a semantic wet/dry edge instead of a deep bed chord. */
function waterBoundary(a: Vertex, b: Vertex): Vertex {
  let low = 0,
    high = 1;
  const aWet = a.wet;
  for (let i = 0; i < 8; i++) {
    const t = (low + high) / 2,
      x = a.point[0] + (b.point[0] - a.point[0]) * t,
      z = a.point[2] + (b.point[2] - a.point[2]) * t,
      wet = surfaceAt(x, z).water !== "none";
    if (wet === aWet) low = t;
    else high = t;
  }
  const hit = interpolate(a, b, (low + high) / 2);
  hit.wet = false;
  hit.point[1] = Math.max(0.045, hit.point[1]);
  return hit;
}
function clipLand(vertices: Vertex[]): Vertex[] {
  const output: Vertex[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i],
      b = vertices[(i + 1) % vertices.length];
    if (!a.wet) output.push(a);
    if (a.wet !== b.wet) output.push(waterBoundary(a, b));
  }
  return output;
}

function unwrapNear(x: number, reference: number) {
  let result = x;
  while (result - reference > SOURCE_PRESENTATION_WIDTH / 2)
    result -= SOURCE_PRESENTATION_WIDTH;
  while (result - reference < -SOURCE_PRESENTATION_WIDTH / 2)
    result += SOURCE_PRESENTATION_WIDTH;
  return result;
}
function clipLineToRect(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
) {
  const dx = x1 - x0,
    dz = z1 - z0,
    p = [-dx, dx, -dz, dz],
    q = [x0 - minX, maxX - x0, z0 - minZ, maxZ - z0];
  let t0 = 0,
    t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return null;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return null;
  }
  return { t0, t1 };
}
function waterVertex(x: number, y: number, z: number, tint: RGB): Vertex {
  return { point: [x, y, z], tint, normal: UP, wet: true, cliff: false };
}

/** Continuous water ribbons replace 40-triangle discs at every drainage sample. */
function pushRiverSegment(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  tile: Tile,
  a: DrainagePoint,
  b: DrainagePoint,
  width: number,
) {
  const centerX = tile.minX + tile.size / 2,
    ax = unwrapNear(a.x, centerX),
    bx = unwrapNear(b.x, ax),
    clip = clipLineToRect(
      ax,
      a.z,
      bx,
      b.z,
      tile.minX - width,
      tile.minZ - width,
      tile.minX + tile.size + width,
      tile.minZ + tile.size + width,
    );
  if (!clip) return;
  const dx = bx - ax,
    dz = b.z - a.z,
    sx = ax + dx * clip.t0,
    sz = a.z + dz * clip.t0,
    ex = ax + dx * clip.t1,
    ez = a.z + dz * clip.t1,
    length = Math.hypot(ex - sx, ez - sz);
  if (length < 1e-6) return;
  const nx = (-(ez - sz) / length) * width,
    nz = ((ex - sx) / length) * width,
    sy = Math.max(0.08, a.bed + (b.bed - a.bed) * clip.t0 + 0.18),
    ey = Math.max(0.08, a.bed + (b.bed - a.bed) * clip.t1 + 0.18);
  pushQuad(
    positions,
    normals,
    colors,
    indices,
    waterVertex(sx + nx, sy, sz + nz, RIVER_WATER),
    waterVertex(ex + nx, ey, ez + nz, RIVER_WATER),
    waterVertex(ex - nx, ey, ez - nz, RIVER_WATER),
    waterVertex(sx - nx, sy, sz - nz, RIVER_WATER),
  );
}
function pushRiverPath(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  tile: Tile,
  recipe: DrainageRecipe,
  tributary = false,
) {
  const path = tributary ? recipe.tributary : recipe.points;
  for (let i = 0; i < path.length - 1; i++)
    pushRiverSegment(
      positions,
      normals,
      colors,
      indices,
      tile,
      path[i],
      path[i + 1],
      drainageRiverWidthAt(recipe, i, tributary),
    );
}
function pushLake(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  tile: Tile,
  lake: NonNullable<DrainageRecipe["lake"]>,
) {
  const x = unwrapNear(lake.x, tile.minX + tile.size / 2),
    maxRadius = lake.radius * 1.45;
  if (
    x + maxRadius < tile.minX ||
    x - maxRadius > tile.minX + tile.size ||
    lake.z + maxRadius < tile.minZ ||
    lake.z - maxRadius > tile.minZ + tile.size
  )
    return;
  const y = Math.max(0.08, lake.level + 0.14),
    center = waterVertex(x, y, lake.z, LAKE_WATER),
    sides = 72;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2,
      b = ((i + 1) / sides) * Math.PI * 2,
      radiusA = drainageLakeRadiusAt(lake, a),
      radiusB = drainageLakeRadiusAt(lake, b);
    pushTriangle(
      positions,
      normals,
      colors,
      indices,
      center,
      waterVertex(
        x + Math.cos(a) * radiusA,
        y,
        lake.z + Math.sin(a) * radiusA,
        LAKE_WATER,
      ),
      waterVertex(
        x + Math.cos(b) * radiusB,
        y,
        lake.z + Math.sin(b) * radiusB,
        LAKE_WATER,
      ),
    );
  }
}

function refinementResolution(tile: Tile) {
  const samples = [
      macroSampleAt(
        sourceToLonLat(
          wrapSourceX(tile.minX + tile.size / 2),
          tile.minZ + tile.size / 2,
        ),
      ),
      macroSampleAt(sourceToLonLat(wrapSourceX(tile.minX), tile.minZ)),
      macroSampleAt(
        sourceToLonLat(wrapSourceX(tile.minX + tile.size), tile.minZ),
      ),
      macroSampleAt(
        sourceToLonLat(wrapSourceX(tile.minX), tile.minZ + tile.size),
      ),
      macroSampleAt(
        sourceToLonLat(
          wrapSourceX(tile.minX + tile.size),
          tile.minZ + tile.size,
        ),
      ),
    ],
    coastal =
      samples.some((sample) => sample.land) &&
      samples.some((sample) => !sample.land),
    rugged = samples.some(
      (sample) => sample.reliefM >= 70 || sample.mountainIntensity >= 0.055,
    );
  let target: number;
  if (tile.size <= 32) target = coastal || rugged ? 32 : 18;
  else if (tile.size <= 64) target = coastal || rugged ? 40 : 26;
  else if (tile.size <= 128) target = coastal || rugged ? 48 : 32;
  else if (tile.size <= 256) target = coastal || rugged ? 56 : 38;
  else target = coastal || rugged ? 48 : 30;
  return Math.max(2, Math.min(target, Math.floor(tile.size * 1.5)));
}

/**
 * Runtime presentation mesher. 1024-unit Country patches keep the bounded coarse
 * mesh because local detail is already visually absent there; Province and closer
 * meshes are rebuilt from the same final composed surface authority.
 */
export function refineRuntimeTerrain(tile: Tile, original: Geometry): Geometry {
  if (tile.size >= 1024 || tile.size < 2) return original;

  const resolution = refinementResolution(tile),
    step = tile.size / resolution,
    grid: Vertex[][] = [];

  for (let iz = 0; iz <= resolution; iz++) {
    const row: Vertex[] = [];
    for (let ix = 0; ix <= resolution; ix++) {
      const x = tile.minX + ix * step,
        z = tile.minZ + iz * step,
        surface = surfaceAt(x, z);
      row.push({
        point: [x, surface.elevation, z],
        tint: presentationTint(x, z, surface, step),
        normal: UP,
        wet: surface.water !== "none",
        cliff: surface.cliff,
      });
    }
    grid.push(row);
  }

  // Grid-neighbour derivatives expose real local mountain/cliff silhouette from
  // the final heights instead of smoothing it with a fixed 48 m derivative.
  for (let iz = 0; iz <= resolution; iz++) {
    for (let ix = 0; ix <= resolution; ix++) {
      const left = grid[iz][Math.max(0, ix - 1)],
        right = grid[iz][Math.min(resolution, ix + 1)],
        north = grid[Math.max(0, iz - 1)][ix],
        south = grid[Math.min(resolution, iz + 1)][ix],
        dx = Math.max(1e-6, right.point[0] - left.point[0]),
        dz = Math.max(1e-6, south.point[2] - north.point[2]),
        slopeX = (right.point[1] - left.point[1]) / dx,
        slopeZ = (south.point[1] - north.point[1]) / dz;
      grid[iz][ix].normal = normalize([-slopeX, 1, -slopeZ]);
    }
  }

  // Smooth presentation normals over neighbouring final-height samples at Province/Village
  // scales. Geometry and canonical slope/cliff truth are untouched; this removes coherent
  // grid-frequency ribbing without flattening the actual mountain or cliff silhouette.
  const smoothingPasses = tile.size >= 128 ? 2 : tile.size >= 64 ? 1 : 0;
  for (let pass = 0; pass < smoothingPasses; pass++) {
    const next = grid.map((row) => row.map((vertex) => vertex.normal));
    for (let iz = 0; iz <= resolution; iz++)
      for (let ix = 0; ix <= resolution; ix++) {
        const centre = grid[iz][ix].normal,
          neighbours = [
            grid[iz][Math.max(0, ix - 1)].normal,
            grid[iz][Math.min(resolution, ix + 1)].normal,
            grid[Math.max(0, iz - 1)][ix].normal,
            grid[Math.min(resolution, iz + 1)][ix].normal,
          ];
        next[iz][ix] = normalize([
          centre[0] * 4 + neighbours.reduce((sum, n) => sum + n[0], 0),
          centre[1] * 4 + neighbours.reduce((sum, n) => sum + n[1], 0),
          centre[2] * 4 + neighbours.reduce((sum, n) => sum + n[2], 0),
        ]);
      }
    for (let iz = 0; iz <= resolution; iz++)
      for (let ix = 0; ix <= resolution; ix++) grid[iz][ix].normal = next[iz][ix];
  }

  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    indices: number[] = [];

  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      const quad: Vertex[] = [
          grid[iz][ix],
          grid[iz + 1][ix],
          grid[iz + 1][ix + 1],
          grid[iz][ix + 1],
        ],
        polygon = clipLand(quad);
      if (
        polygon.length === 4 &&
        polygon.every((vertex, index) => vertex === quad[index])
      )
        pushQuad(
          positions,
          normals,
          colors,
          indices,
          quad[0],
          quad[1],
          quad[2],
          quad[3],
          Math.abs(quad[0].point[1] - quad[2].point[1]) >
            Math.abs(quad[1].point[1] - quad[3].point[1]),
        );
      else if (polygon.length >= 3)
        pushPolygon(positions, normals, colors, indices, polygon);
    }
  }

  const skirtDepth = Math.min(0.7, Math.max(0.24, step * 0.025));
  const skirt = (topA: Vertex, topB: Vertex) => {
    if (topA.wet || topB.wet) return;
    const c: Vertex = {
        ...topB,
        point: [topB.point[0], topB.point[1] - skirtDepth, topB.point[2]],
      },
      d: Vertex = {
        ...topA,
        point: [topA.point[0], topA.point[1] - skirtDepth, topA.point[2]],
      };
    pushQuad(positions, normals, colors, indices, topA, topB, c, d);
  };
  for (let i = 0; i < resolution; i++) {
    skirt(grid[0][i], grid[0][i + 1]);
    skirt(grid[resolution][i + 1], grid[resolution][i]);
    skirt(grid[i + 1][0], grid[i][0]);
    skirt(grid[i][resolution], grid[i + 1][resolution]);
  }

  pushQuad(
    positions,
    normals,
    colors,
    indices,
    waterVertex(tile.minX, 0, tile.minZ, OCEAN_WATER),
    waterVertex(tile.minX, 0, tile.minZ + tile.size, OCEAN_WATER),
    waterVertex(tile.minX + tile.size, 0, tile.minZ + tile.size, OCEAN_WATER),
    waterVertex(tile.minX + tile.size, 0, tile.minZ, OCEAN_WATER),
  );

  for (const recipe of drainageRecipesNear(
    tile.minX + tile.size / 2,
    tile.minZ + tile.size / 2,
    3,
  )) {
    pushRiverPath(positions, normals, colors, indices, tile, recipe, false);
    pushRiverPath(positions, normals, colors, indices, tile, recipe, true);
    if (recipe.lake)
      pushLake(positions, normals, colors, indices, tile, recipe.lake);
  }

  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let i = 0, v = 0; i < positions.length; i += 3, v += 2) {
    uvs[v] = positions[i] / SOURCE_PRESENTATION_WIDTH + 0.5;
    uvs[v + 1] = Math.max(
      0,
      Math.min(1, 0.5 + (positions[i + 2] * 2) / SOURCE_PRESENTATION_WIDTH),
    );
  }

  const originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= originX;
    positions[i + 2] -= originZ;
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
    uvs,
  };
}
