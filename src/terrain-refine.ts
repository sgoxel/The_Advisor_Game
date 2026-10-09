import { terrainTint, type Geometry } from "./geometry.ts";
import { biomeAt, heightAt, type Tile } from "./world.ts";

type RGB = [number, number, number];
type Point = [number, number, number];
type Vertex = { point: Point; tint: RGB };

const WATER_SURFACE_Y = 0;
const LAND_CLIP_Y = 0.035;

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function blend(a: RGB, b: RGB, t: number): RGB {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/**
 * Preserve semantic water/cliff meaning before road/settlement presentation.
 * geometry.ts historically checked road tint first, which could paint a jagged
 * dry-road triangle over a canonical river crossing.
 */
function refinedTint(x: number, z: number, scale: number): RGB {
  const biome = biomeAt(x, z);
  if (biome === "River" || biome === "Ocean") return [83, 134, 145];
  if (biome === "Lake") return [69, 123, 148];
  if (biome === "Cliff") return [111, 116, 108];
  if (biome === "Riverbank") return [151, 148, 108];
  return terrainTint(x, z, scale);
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
        hit = interpolate(a, b, Math.max(0, Math.min(1, t)));
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
    colors.push(
      clampByte(vertex.tint[0]),
      clampByte(vertex.tint[1]),
      clampByte(vertex.tint[2]),
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
) {
  pushTriangle(positions, normals, colors, indices, a, b, c);
  pushTriangle(positions, normals, colors, indices, a, c, d);
}

function darken(tint: RGB, amount = 0.78): RGB {
  return [tint[0] * amount, tint[1] * amount, tint[2] * amount];
}

/**
 * Local/Province terrain uses a denser, per-vertex-colored surface than the
 * legacy 16×16 flat-color quads. Canonical height/biome queries are unchanged;
 * this only removes presentation artifacts exposed by WP-S002-004-005 evidence.
 */
export function refineTerrainGeometry(tile: Tile, original: Geometry): Geometry {
  if (tile.size > 1024 || tile.size < 2) return original;

  const targetResolution = tile.size <= 128 ? 48 : tile.size <= 512 ? 40 : 28,
    resolution = Math.max(1, Math.min(targetResolution, Math.floor(tile.size / 2))),
    step = tile.size / resolution,
    grid: Vertex[][] = [];

  for (let z = 0; z <= resolution; z++) {
    const row: Vertex[] = [];
    for (let x = 0; x <= resolution; x++) {
      const px = tile.minX + x * step,
        pz = tile.minZ + z * step;
      row.push({
        point: [px, heightAt(px, pz), pz],
        tint: refinedTint(px, pz, tile.size),
      });
    }
    grid.push(row);
  }

  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    indices: number[] = [];

  for (let z = 0; z < resolution; z++)
    for (let x = 0; x < resolution; x++)
      pushPolygon(
        positions,
        normals,
        colors,
        indices,
        clipLandPolygon([grid[z][x], grid[z + 1][x], grid[z + 1][x + 1], grid[z][x + 1]]),
      );

  // Keep a shallow overlap skirt for LOD replacement, but avoid the previous
  // deep vertical walls that read as cliffs/seams in Street evidence.
  const skirtDepth = Math.min(7, Math.max(3, step * 0.45));
  const skirt = (topA: Vertex, topB: Vertex) => {
    if (topA.point[1] <= LAND_CLIP_Y && topB.point[1] <= LAND_CLIP_Y) return;
    const a = {
        point: [topA.point[0], Math.max(LAND_CLIP_Y, topA.point[1]), topA.point[2]] as Point,
        tint: topA.tint,
      },
      b = {
        point: [topB.point[0], Math.max(LAND_CLIP_Y, topB.point[1]), topB.point[2]] as Point,
        tint: topB.tint,
      },
      c = {
        point: [b.point[0], b.point[1] - skirtDepth, b.point[2]] as Point,
        tint: darken(b.tint),
      },
      d = {
        point: [a.point[0], a.point[1] - skirtDepth, a.point[2]] as Point,
        tint: darken(a.tint),
      };
    pushQuad(positions, normals, colors, indices, a, b, c, d);
  };
  for (let i = 0; i < resolution; i++) {
    skirt(grid[0][i], grid[0][i + 1]);
    skirt(grid[resolution][i + 1], grid[resolution][i]);
    skirt(grid[i + 1][0], grid[i][0]);
    skirt(grid[i][resolution], grid[i + 1][resolution]);
  }

  const water: RGB = [70, 126, 132],
    wa: Vertex = { point: [tile.minX, WATER_SURFACE_Y, tile.minZ], tint: water },
    wb: Vertex = { point: [tile.minX, WATER_SURFACE_Y, tile.minZ + tile.size], tint: water },
    wc: Vertex = {
      point: [tile.minX + tile.size, WATER_SURFACE_Y, tile.minZ + tile.size],
      tint: water,
    },
    wd: Vertex = { point: [tile.minX + tile.size, WATER_SURFACE_Y, tile.minZ], tint: water };
  pushQuad(positions, normals, colors, indices, wa, wb, wc, wd);

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
