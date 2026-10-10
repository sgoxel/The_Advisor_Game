import type { Geometry } from "./geometry.ts";
import { nearestPlace, roadAt, roadDistanceAt } from "./geography.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  SOURCE_PRESENTATION_WIDTH,
  sourceToLonLat,
  wrapSourceX,
} from "./planet.ts";
import {
  drainageLakeRadiusAt,
  drainageRecipesNear,
  surfaceAt,
  type DrainagePoint,
  type DrainageRecipe,
  type SurfaceSample,
} from "./surface.ts";
import type { Tile } from "./world.ts";

type RGB = [number, number, number];
type Point = [number, number, number];
type Vertex = { point: Point; tint: RGB };

const WATER_SURFACE_Y = 0;
const LAND_CLIP_Y = 0.035;
const RIVER_WATER: RGB = [58, 126, 148];
const LAKE_WATER: RGB = [62, 122, 151];
const OCEAN_WATER: RGB = [70, 126, 132];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth01 = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
function blend(a: RGB, b: RGB, t: number): RGB {
  const amount = clamp01(t);
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

/** Seam-safe presentation variation; unlike source-grid fields it cannot expose rectangular bands. */
function naturalDetail(x: number, z: number) {
  const p = sourceToLonLat(wrapSourceX(x), z),
    a = Math.sin(p.lon * 137 + p.lat * 91 + 0.73),
    b = Math.cos(p.lon * 223 - p.lat * 157 - 1.17),
    c = Math.sin(p.lon * 359 + p.lat * 211 + 2.03);
  return clamp01((a * 0.46 + b * 0.34 + c * 0.2 + 1) * 0.5);
}

/** One already-sampled final surface drives local material presentation. */
function refinedTint(x: number, z: number, surface: SurfaceSample): RGB {
  if (surface.water === "ocean") return OCEAN_WATER;
  // Beds remain earthen; exact water is a separate geometry layer below.
  if (surface.water === "river") return [112, 122, 93];
  if (surface.water === "lake") return [105, 119, 99];
  if (surface.cliff) return [91, 98, 97];
  if (surface.riverBank) return [145, 143, 105];

  const macro = macroSampleAt(sourceToLonLat(x, z)),
    detail = naturalDetail(x, z),
    place = nearestPlace(x, z),
    placeDistance = place
      ? Math.hypot(wrapSourceX(x - place.x), z - place.z)
      : Infinity,
    road = roadAt(x, z),
    onRoad = Boolean(road && roadDistanceAt(x, z, road) <= 6);
  if (onRoad || (place && placeDistance <= (place.kind === "city" ? 18 : 12)))
    return [170, 151, 113];

  const coast = macro.coastDistanceRad * 41721,
    beach = macro.land && coast < 18;
  if (beach) return [191 + detail * 12, 177 + detail * 10, 126 + detail * 9];

  const meadow: RGB = [115 + detail * 25, 139 + detail * 26, 78 + detail * 20],
    forestFactor = smooth01((naturalDetail(x + 37, z - 29) - 0.34) / 0.46),
    woodland: RGB = [70 + detail * 20, 102 + detail * 23, 67 + detail * 16],
    natural = blend(meadow, woodland, forestFactor),
    mountain = smooth01((macro.mountainIntensity - 0.012) / 0.55),
    highland: RGB = [122 + detail * 23, 132 + detail * 20, 108 + detail * 18],
    volcanic: RGB = [91 + detail * 18, 89 + detail * 15, 80 + detail * 13];
  return macro.volcanic
    ? blend(natural, volcanic, mountain * 0.96)
    : blend(natural, highland, mountain * 0.9);
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

/** Clip land exactly at the shared water plane instead of stretching coarse dry triangles over water. */
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
    unitX = nx / length,
    unitY = ny / length,
    unitZ = nz / length,
    // Presentation-only flat relief shading. Flat surfaces keep their exact
    // palette regardless of triangle winding; real slopes/cliffs gain readable form.
    light = unitX * -0.38 + unitY * 0.86 + unitZ * -0.34,
    shade = Math.abs(unitY) > 0.995 ? 1 : Math.max(0.9, Math.min(1.045, 0.965 + light * 0.085)),
    start = positions.length / 3;
  for (const vertex of [a, b, c]) {
    positions.push(...vertex.point);
    normals.push(unitX, unitY, unitZ);
    colors.push(
      byte(vertex.tint[0] * shade),
      byte(vertex.tint[1] * shade),
      byte(vertex.tint[2] * shade),
      255,
    );
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

/** Draw the exact semantic segment capsule: rectangle plus round endpoint/join discs. */
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
function pushWaterDisc(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  tile: Tile,
  point: DrainagePoint,
  radius: number,
  tint: RGB,
) {
  const x = unwrapNear(point.x, tile.minX + tile.size / 2);
  if (
    x + radius < tile.minX ||
    x - radius > tile.minX + tile.size ||
    point.z + radius < tile.minZ ||
    point.z - radius > tile.minZ + tile.size
  )
    return;
  const y = Math.max(0.08, point.bed + 0.18),
    center: Vertex = { point: [x, y, point.z], tint },
    sides = 24;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2,
      b = ((i + 1) / sides) * Math.PI * 2,
      va: Vertex = {
        point: [x + Math.cos(a) * radius, y, point.z + Math.sin(a) * radius],
        tint,
      },
      vb: Vertex = {
        point: [x + Math.cos(b) * radius, y, point.z + Math.sin(b) * radius],
        tint,
      };
    pushTriangle(positions, normals, colors, indices, center, va, vb);
  }
}
function pushRiverPath(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  tile: Tile,
  path: DrainagePoint[],
  width: number,
  tint: RGB,
) {
  for (let i = 0; i < path.length - 1; i++)
    pushRiverSegment(positions, normals, colors, indices, tile, path[i], path[i + 1], width, tint);
  for (const point of path) pushWaterDisc(positions, normals, colors, indices, tile, point, width, tint);
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
    center: Vertex = { point: [x, y, lake.z], tint: LAKE_WATER },
    sides = 64;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2,
      b = ((i + 1) / sides) * Math.PI * 2,
      radiusA = drainageLakeRadiusAt(lake, a),
      radiusB = drainageLakeRadiusAt(lake, b),
      va: Vertex = {
        point: [x + Math.cos(a) * radiusA, y, lake.z + Math.sin(a) * radiusA],
        tint: LAKE_WATER,
      },
      vb: Vertex = {
        point: [x + Math.cos(b) * radiusB, y, lake.z + Math.sin(b) * radiusB],
        tint: LAKE_WATER,
      };
    pushTriangle(positions, normals, colors, indices, center, va, vb);
  }
}

/**
 * Bounded local refinement. One final-surface sample is made per grid vertex; river/lake
 * presentation is the exact canonical segment-buffer authority rather than painted cells.
 */
export function refineTerrainGeometry(tile: Tile, original: Geometry): Geometry {
  if (tile.size > 1024 || tile.size < 2) return original;
  // Spend refinement only where the player can see the silhouette. Close tiles
  // receive enough samples to remove obvious river/cliff stair steps while wider
  // Province tiles stay bounded for phone and renderer parity.
  const center = macroSampleAt(
      sourceToLonLat(wrapSourceX(tile.minX + tile.size / 2), tile.minZ + tile.size / 2),
    ),
    rugged = center.reliefM >= 80 || center.mountainIntensity >= 0.06,
    targetResolution = tile.size <= 128 ? 68 : tile.size <= 512 ? (rugged ? 52 : 40) : rugged ? 40 : 28,
    resolution = Math.max(1, Math.min(targetResolution, Math.floor(tile.size / 2))),
    step = tile.size / resolution,
    grid: Vertex[][] = [];

  for (let iz = 0; iz <= resolution; iz++) {
    const row: Vertex[] = [];
    for (let ix = 0; ix <= resolution; ix++) {
      const x = tile.minX + ix * step,
        z = tile.minZ + iz * step,
        surface = surfaceAt(x, z);
      row.push({ point: [x, surface.elevation, z], tint: refinedTint(x, z, surface) });
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
        pushQuad(
          positions,
          normals,
          colors,
          indices,
          quad[0],
          quad[1],
          quad[2],
          quad[3],
          (x + z) % 2 === 1,
        );
      else pushPolygon(positions, normals, colors, indices, polygon);
    }

  // A shallow matching-colour overlap hides transient LOD T-junctions without becoming a cliff wall.
  const skirtDepth = Math.min(0.9, Math.max(0.35, step * 0.04));
  const skirt = (topA: Vertex, topB: Vertex) => {
    if (topA.point[1] <= LAND_CLIP_Y && topB.point[1] <= LAND_CLIP_Y) return;
    const a: Vertex = {
        point: [topA.point[0], Math.max(LAND_CLIP_Y, topA.point[1]), topA.point[2]],
        tint: topA.tint,
      },
      b: Vertex = {
        point: [topB.point[0], Math.max(LAND_CLIP_Y, topB.point[1]), topB.point[2]],
        tint: topB.tint,
      },
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

  const wa: Vertex = { point: [tile.minX, WATER_SURFACE_Y, tile.minZ], tint: OCEAN_WATER },
    wb: Vertex = {
      point: [tile.minX, WATER_SURFACE_Y, tile.minZ + tile.size],
      tint: OCEAN_WATER,
    },
    wc: Vertex = {
      point: [tile.minX + tile.size, WATER_SURFACE_Y, tile.minZ + tile.size],
      tint: OCEAN_WATER,
    },
    wd: Vertex = {
      point: [tile.minX + tile.size, WATER_SURFACE_Y, tile.minZ],
      tint: OCEAN_WATER,
    };
  pushQuad(positions, normals, colors, indices, wa, wb, wc, wd);

  for (const recipe of drainageRecipesNear(
    tile.minX + tile.size / 2,
    tile.minZ + tile.size / 2,
    3,
  )) {
    pushRiverPath(positions, normals, colors, indices, tile, recipe.points, recipe.width, RIVER_WATER);
    pushRiverPath(
      positions,
      normals,
      colors,
      indices,
      tile,
      recipe.tributary,
      recipe.width * 0.62,
      RIVER_WATER,
    );
    if (recipe.lake) pushLake(positions, normals, colors, indices, tile, recipe.lake);
  }

  const originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2;
  // Refined terrain creates new clipped/water vertices, so rebuild the canonical
  // source-coordinate UV0 required by the shared projection material while the
  // positions are still absolute, before converting them to tile-local precision.
  const uvs = new Float32Array((positions.length / 3) * 2);
  for (let i = 0, v = 0; i < positions.length; i += 3, v += 2) {
    uvs[v] = positions[i] / SOURCE_PRESENTATION_WIDTH + 0.5;
    uvs[v + 1] = Math.max(
      0,
      Math.min(1, 0.5 + (positions[i + 2] * 2) / SOURCE_PRESENTATION_WIDTH),
    );
  }
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
