import { terrainTint, type Geometry } from "./geometry.ts";
import { biomeAt, field, type Tile } from "./world.ts";
import { macroSampleAt } from "./macro-geography.ts";
import { SOURCE_PRESENTATION_WIDTH, sourceToLonLat } from "./planet.ts";
import {
  drainageRecipesNear,
  surfaceAt,
  type DrainagePoint,
  type SurfaceSample,
} from "./surface.ts";

type RGB = [number, number, number];
type Point = [number, number, number];
type Vertex = { point: Point; tint: RGB };

const WATER_SURFACE_Y = 0;
const LAND_CLIP_Y = 0.035;
const RIVER_WATER: RGB = [58, 126, 148];
const LAKE_WATER: RGB = [62, 122, 151];

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
function smooth01(value: number) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}
function blend(a: RGB, b: RGB, t: number): RGB {
  const amount = clamp01(t);
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

/**
 * Preserve semantic water/cliff meaning before road/settlement presentation.
 * Natural ground cover blends continuously so bilinear source fields do not
 * become visible rectangular material blocks at Province/Village scales.
 */
function refinedTint(x: number, z: number, scale: number, surface: SurfaceSample): RGB {
  const biome = biomeAt(x, z);
  if (surface.water === "ocean") return [79, 129, 145];
  // River/lake water is drawn as explicit smooth canonical surface geometry.
  // Keep the bed subdued so coarse terrain cells cannot look like painted water blocks.
  if (surface.water === "river") return [112, 122, 93];
  if (surface.water === "lake") return [105, 119, 99];
  if (surface.cliff || biome === "Cliff") return [99, 105, 101];
  if (surface.riverBank || biome === "Riverbank") return [145, 143, 105];
  if (["Road", "Settlement", "Sandy beach"].includes(biome)) return terrainTint(x, z, scale);

  const f = field(x, z, 28, 41),
    cover = smooth01((field(x, z, 90, 4) - 0.28) / 0.44),
    meadow: RGB = [116 + f * 22, 140 + f * 24, 79 + f * 20],
    woodland: RGB = [72 + f * 19, 105 + f * 22, 69 + f * 15],
    natural = blend(meadow, woodland, cover),
    macro = macroSampleAt(sourceToLonLat(x, z)),
    mountain = smooth01((macro.mountainIntensity - 0.015) / 0.64),
    highland: RGB = [127 + f * 22, 137 + f * 18, 113 + f * 16],
    volcanic: RGB = [94 + f * 17, 91 + f * 14, 82 + f * 12];
  return macro.volcanic
    ? blend(natural, volcanic, mountain * 0.94)
    : blend(natural, highland, mountain * 0.86);
}

function interpolate(a: Vertex, b: Vertex, t: number): Vertex {
  return {
    point: [
      a.point[0] + (b.point[0] - a.point[0]) * t,
      a.point[1] + (b.point[1] - a.point[1]) * t,
      a.point[2] + (b.point[2] - a.point[2]) * t,
    ],
    tint: blend(a.tint, b.tint, t),
  };
}

/** Clip coast/ocean cells to the water plane instead of letting one dry corner
 * pull an entire coarse terrain triangle across open water. */
function clipLandPolygon(vertices: Vertex[]): Vertex[] {
  const output: Vertex[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i],
      b = vertices[(i + 1) % vertices.length],
      aInside = a.point[1] > LAND_CLIP_Y,
      bInside = b.point[1] > LAND_CLIP_Y;
    if (aInside) output.push(a);
    if (aInside !== bInside) {
      const dy = b.point[1] - a.point[1],
        t = Math.abs(dy) < 1e-8 ? 0 : (LAND_CLIP_Y - a.point[1]) / dy,
        hit = interpolate(a, b, clamp01(t));
      hit.point[1] = LAND_CLIP_Y;
      output.push(hit);
    }
  }
  return output;
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
  const ux = b.point[0] - a.point[0],
    uy = b.point[1] - a.point[1],
    uz = b.point[2] - a.point[2],
    vx = c.point[0] - a.point[0],
    vy = c.point[1] - a.point[1],
    vz = c.point[2] - a.point[2],
    nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx,
    length = Math.hypot(nx, ny, nz) || 1,
    start = positions.length / 3;
  for (const vertex of [a, b, c]) {
    positions.push(...vertex.point);
    normals.push(nx / length, ny / length, nz / length);
    colors.push(clampByte(vertex.tint[0]), clampByte(vertex.tint[1]), clampByte(vertex.tint[2]), 255);
  }
  indices.push(start, start + 1, start + 2);
}

function pushPolygon(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  polygon: Vertex[],
) {
  if (polygon.length < 3) return;
  for (let i = 1; i < polygon.length - 1; i++)
    pushTriangle(positions, normals, colors, indices, polygon[0], polygon[i], polygon[i + 1]);
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

function unwrapNear(x: number, reference: number) {
  let result = x;
  while (result - reference > SOURCE_PRESENTATION_WIDTH / 2) result -= SOURCE_PRESENTATION_WIDTH;
  while (result - reference < -SOURCE_PRESENTATION_WIDTH / 2) result += SOURCE_PRESENTATION_WIDTH;
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

function clipPolygonAxis(
  polygon: Vertex[],
  inside: (vertex: Vertex) => boolean,
  intersection: (a: Vertex, b: Vertex) => Vertex,
) {
  if (!polygon.length) return polygon;
  const output: Vertex[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      ai = inside(a),
      bi = inside(b);
    if (ai) output.push(a);
    if (ai !== bi) output.push(intersection(a, b));
  }
  return output;
}

function clipPolygonToRect(polygon: Vertex[], minX: number, minZ: number, maxX: number, maxZ: number) {
  let out = polygon;
  const clipX = (bound: number, keepGreater: boolean) => {
    out = clipPolygonAxis(
      out,
      (v) => (keepGreater ? v.point[0] >= bound : v.point[0] <= bound),
      (a, b) => {
        const dx = b.point[0] - a.point[0],
          t = Math.abs(dx) < 1e-9 ? 0 : (bound - a.point[0]) / dx,
          hit = interpolate(a, b, clamp01(t));
        hit.point[0] = bound;
        return hit;
      },
    );
  };
  const clipZ = (bound: number, keepGreater: boolean) => {
    out = clipPolygonAxis(
      out,
      (v) => (keepGreater ? v.point[2] >= bound : v.point[2] <= bound),
      (a, b) => {
        const dz = b.point[2] - a.point[2],
          t = Math.abs(dz) < 1e-9 ? 0 : (bound - a.point[2]) / dz,
          hit = interpolate(a, b, clamp01(t));
        hit.point[2] = bound;
        return hit;
      },
    );
  };
  clipX(minX, true);
  clipX(maxX, false);
  clipZ(minZ, true);
  clipZ(maxZ, false);
  return out;
}

function pushRiverSegment(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  tile: Tile,
  a: DrainagePoint,
  b: DrainagePoint,
  width: number,
  tint: RGB,
) {
  const centerX = tile.minX + tile.size / 2,
    ax = unwrapNear(a.x, centerX),
    bx = unwrapNear(b.x, ax),
    clip = clipLineToRect(ax, a.z, bx, b.z, tile.minX - width, tile.minZ - width, tile.minX + tile.size + width, tile.minZ + tile.size + width);
  if (!clip) return;
  const dx = bx - ax,
    dz = b.z - a.z,
    sx = ax + dx * clip.t0,
    sz = a.z + dz * clip.t0,
    ex = ax + dx * clip.t1,
    ez = a.z + dz * clip.t1,
    length = Math.hypot(ex - sx, ez - sz);
  if (length < 1e-5) return;
  const nx = (-(ez - sz) / length) * width,
    nz = ((ex - sx) / length) * width,
    sy = Math.max(0.08, a.bed + (b.bed - a.bed) * clip.t0 + 0.18),
    ey = Math.max(0.08, a.bed + (b.bed - a.bed) * clip.t1 + 0.18),
    va: Vertex = { point: [sx + nx, sy, sz + nz], tint },
    vb: Vertex = { point: [ex + nx, ey, ez + nz], tint },
    vc: Vertex = { point: [ex - nx, ey, ez - nz], tint },
    vd: Vertex = { point: [sx - nx, sy, sz - nz], tint };
  pushQuad(positions, normals, colors, indices, va, vb, vc, vd);
}

/**
 * Local/Province terrain uses a denser, per-vertex-colored surface plus explicit
 * canonical water geometry. Canonical height/biome/walkability are unchanged;
 * this presentation removes coarse painted-water and tile-skirt artifacts.
 */
export function refineTerrainGeometry(tile: Tile, original: Geometry): Geometry {
  if (tile.size > 1024 || tile.size < 2) return original;

  const targetResolution = tile.size <= 128 ? 56 : tile.size <= 512 ? 48 : 36,
    resolution = Math.max(1, Math.min(targetResolution, Math.floor(tile.size / 2))),
    step = tile.size / resolution,
    grid: Vertex[][] = [];

  for (let z = 0; z <= resolution; z++) {
    const row: Vertex[] = [];
    for (let x = 0; x <= resolution; x++) {
      const px = tile.minX + x * step,
        pz = tile.minZ + z * step,
        surface = surfaceAt(px, pz);
      row.push({ point: [px, surface.elevation, pz], tint: refinedTint(px, pz, tile.size, surface) });
    }
    grid.push(row);
  }

  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    indices: number[] = [];

  for (let z = 0; z < resolution; z++)
    for (let x = 0; x < resolution; x++) {
      const quad = [grid[z][x], grid[z + 1][x], grid[z + 1][x + 1], grid[z][x + 1]],
        polygon = clipLandPolygon(quad);
      if (polygon.length === 4 && polygon.every((v, i) => v === quad[i]))
        pushQuad(positions, normals, colors, indices, quad[0], quad[1], quad[2], quad[3], (x + z) % 2 === 1);
      else pushPolygon(positions, normals, colors, indices, polygon);
    }

  // Shared boundary samples already match exactly. Keep only a very shallow,
  // same-colour overlap for transient LOD T-junctions; it must never read as a cliff wall.
  const skirtDepth = Math.min(1.2, Math.max(0.45, step * 0.055));
  const skirt = (topA: Vertex, topB: Vertex) => {
    if (topA.point[1] <= LAND_CLIP_Y && topB.point[1] <= LAND_CLIP_Y) return;
    const a: Vertex = { point: [topA.point[0], Math.max(LAND_CLIP_Y, topA.point[1]), topA.point[2]], tint: topA.tint },
      b: Vertex = { point: [topB.point[0], Math.max(LAND_CLIP_Y, topB.point[1]), topB.point[2]], tint: topB.tint },
      c: Vertex = { point: [b.point[0], b.point[1] - skirtDepth, b.point[2]], tint: b.tint },
      d: Vertex = { point: [a.point[0], a.point[1] - skirtDepth, a.point[2]], tint: a.tint };
    pushQuad(positions, normals, colors, indices, a, b, c, d);
  };
  for (let i = 0; i < resolution; i++) {
    skirt(grid[0][i], grid[0][i + 1]);
    skirt(grid[resolution][i + 1], grid[resolution][i]);
    skirt(grid[i + 1][0], grid[i][0]);
    skirt(grid[i][resolution], grid[i + 1][resolution]);
  }

  const ocean: RGB = [70, 126, 132],
    wa: Vertex = { point: [tile.minX, WATER_SURFACE_Y, tile.minZ], tint: ocean },
    wb: Vertex = { point: [tile.minX, WATER_SURFACE_Y, tile.minZ + tile.size], tint: ocean },
    wc: Vertex = { point: [tile.minX + tile.size, WATER_SURFACE_Y, tile.minZ + tile.size], tint: ocean },
    wd: Vertex = { point: [tile.minX + tile.size, WATER_SURFACE_Y, tile.minZ], tint: ocean };
  pushQuad(positions, normals, colors, indices, wa, wb, wc, wd);

  const recipes = drainageRecipesNear(tile.minX + tile.size / 2, tile.minZ + tile.size / 2, 3);
  for (const recipe of recipes) {
    for (let i = 0; i < recipe.points.length - 1; i++)
      pushRiverSegment(positions, normals, colors, indices, tile, recipe.points[i], recipe.points[i + 1], recipe.width, RIVER_WATER);
    for (let i = 0; i < recipe.tributary.length - 1; i++)
      pushRiverSegment(positions, normals, colors, indices, tile, recipe.tributary[i], recipe.tributary[i + 1], recipe.width * 0.62, RIVER_WATER);
    if (recipe.lake) {
      const centerX = unwrapNear(recipe.lake.x, tile.minX + tile.size / 2),
        y = Math.max(0.08, recipe.lake.level + 0.14),
        circle: Vertex[] = [];
      for (let i = 0; i < 32; i++) {
        const angle = -(i / 32) * Math.PI * 2;
        circle.push({
          point: [centerX + Math.cos(angle) * recipe.lake.radius, y, recipe.lake.z + Math.sin(angle) * recipe.lake.radius],
          tint: LAKE_WATER,
        });
      }
      pushPolygon(
        positions,
        normals,
        colors,
        indices,
        clipPolygonToRect(circle, tile.minX, tile.minZ, tile.minX + tile.size, tile.minZ + tile.size),
      );
    }
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
  };
}