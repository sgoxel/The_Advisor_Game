import { terrainTint, type Geometry } from "./geometry.ts";
import { heightAt, type Tile } from "./world.ts";

type RGB = [number, number, number];
type Point = [number, number, number];
type Vertex = { point: Point; tint: RGB };

const WATER_SURFACE_Y = 0;
const LAND_CLIP_Y = 0.06;

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

/** Clip dry terrain against the shared water plane instead of letting a single
 * dry corner stretch a large triangle over a canonical river/coast. */
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
function darken(tint: RGB, amount = 0.82): RGB {
  return [tint[0] * amount, tint[1] * amount, tint[2] * amount];
}

/**
 * Bounded terrain refinement. The prior 40–48 sample grid multiplied expensive
 * canonical hydrology/climate queries enough to time out the required SwiftShader
 * WebGPU ENU regression. This version keeps the improvement over the legacy 16×16
 * mesh while limiting local work to 24×24 and using the already canonical material
 * lookup once per sampled vertex.
 */
export function refineTerrainGeometry(tile: Tile, original: Geometry): Geometry {
  if (tile.size > 1024 || tile.size < 2) return original;

  const targetResolution = tile.size <= 128 ? 24 : tile.size <= 512 ? 20 : 16,
    resolution = Math.max(1, Math.min(targetResolution, Math.floor(tile.size / 2)));
  // Coarse tiles are already at the same or higher sample density in geometry.ts.
  if (resolution <= 16) return original;

  const step = tile.size / resolution,
    grid: Vertex[][] = [];
  for (let z = 0; z <= resolution; z++) {
    const row: Vertex[] = [];
    for (let x = 0; x <= resolution; x++) {
      const px = tile.minX + x * step,
        pz = tile.minZ + z * step,
        elevation = heightAt(px, pz);
      row.push({
        point: [px, elevation, pz],
        tint: terrainTint(px, pz, tile.size, elevation),
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

  // Exact close-range neighbors share canonical edge samples. Avoid visible vertical
  // walls there; retain only a shallow skirt for mixed-LOD Province tiles.
  if (tile.size > 64) {
    const skirtDepth = Math.min(4, Math.max(2, step * 0.28)),
      skirt = (topA: Vertex, topB: Vertex) => {
        if (topA.point[1] <= LAND_CLIP_Y && topB.point[1] <= LAND_CLIP_Y) return;
        const a: Vertex = {
            point: [topA.point[0], Math.max(LAND_CLIP_Y, topA.point[1]), topA.point[2]],
            tint: topA.tint,
          },
          b: Vertex = {
            point: [topB.point[0], Math.max(LAND_CLIP_Y, topB.point[1]), topB.point[2]],
            tint: topB.tint,
          },
          c: Vertex = {
            point: [b.point[0], b.point[1] - skirtDepth, b.point[2]],
            tint: darken(b.tint),
          },
          d: Vertex = {
            point: [a.point[0], a.point[1] - skirtDepth, a.point[2]],
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
  }

  // Water remains presentation-only. Dry terrain is clipped above it, preventing
  // the previous coplanar shoreline triangles while preserving one stable plane.
  const water: RGB = [70, 126, 142],
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
