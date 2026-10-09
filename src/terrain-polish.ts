import { terrainTint, type Geometry } from "./geometry.ts";
import { surfaceAt } from "./surface.ts";
import { heightAt, type Tile } from "./world.ts";

type RGB = [number, number, number];

const WATER: RGB = [70, 126, 132];
const WATER_LIFT = 0.12;
const NORMAL_RELIEF_GAIN = 1.35;

function pushColor(target: number[], tint: RGB) {
  target.push(
    Math.max(0, Math.min(255, Math.round(tint[0]))),
    Math.max(0, Math.min(255, Math.round(tint[1]))),
    Math.max(0, Math.min(255, Math.round(tint[2]))),
    255,
  );
}

function normalAt(x: number, z: number, sample: number): [number, number, number] {
  const hL = heightAt(x - sample, z),
    hR = heightAt(x + sample, z),
    hN = heightAt(x, z - sample),
    hS = heightAt(x, z + sample),
    nx = (hL - hR) * NORMAL_RELIEF_GAIN,
    ny = sample * 2,
    nz = (hN - hS) * NORMAL_RELIEF_GAIN,
    length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

function waterHeightAt(x: number, z: number): number | null {
  const surface = surfaceAt(x, z);
  if (surface.water === "none") return null;
  if (surface.water === "ocean" || surface.water === "lake") return 0.02;
  return surface.elevation + WATER_LIFT;
}

/**
 * Rebuild only the presentation mesh for a tile at a bounded, LOD-aware density.
 * Canonical terrain/hydrology identity remains owned by world.ts/surface.ts.
 */
export function buildPolishedTerrain(tile: Tile): Geometry {
  const localCap = tile.size <= 512 ? 32 : 24,
    resolution = Math.max(1, Math.min(localCap, Math.round(tile.size / 2))),
    step = tile.size / resolution,
    originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2,
    positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    indices: number[] = [],
    row = resolution + 1,
    sample = Math.max(1, Math.min(8, step * 0.5));

  for (let z = 0; z <= resolution; z++) {
    for (let x = 0; x <= resolution; x++) {
      const worldX = tile.minX + x * step,
        worldZ = tile.minZ + z * step,
        height = heightAt(worldX, worldZ),
        normal = normalAt(worldX, worldZ, sample),
        tint = terrainTint(worldX, worldZ, tile.size);
      positions.push(worldX - originX, height, worldZ - originZ);
      normals.push(...normal);
      pushColor(colors, tint);
    }
  }

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const a = z * row + x,
        b = (z + 1) * row + x,
        c = (z + 1) * row + x + 1,
        d = z * row + x + 1;
      indices.push(a, b, c, a, c, d);
    }
  }

  // Render water only where the canonical surface reports water. This avoids
  // a full-tile coplanar water sheet and substantially reduces shoreline z-fighting.
  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const x0 = tile.minX + x * step,
        z0 = tile.minZ + z * step,
        x1 = x0 + step,
        z1 = z0 + step,
        centreX = x0 + step / 2,
        centreZ = z0 + step / 2,
        centre = waterHeightAt(centreX, centreZ);
      if (centre === null) continue;

      const heights = [
          waterHeightAt(x0, z0),
          waterHeightAt(x0, z1),
          waterHeightAt(x1, z1),
          waterHeightAt(x1, z0),
        ].map((value) => value ?? centre),
        base = positions.length / 3;
      positions.push(
        x0 - originX,
        heights[0],
        z0 - originZ,
        x0 - originX,
        heights[1],
        z1 - originZ,
        x1 - originX,
        heights[2],
        z1 - originZ,
        x1 - originX,
        heights[3],
        z0 - originZ,
      );
      normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      pushColor(colors, WATER);
      pushColor(colors, WATER);
      pushColor(colors, WATER);
      pushColor(colors, WATER);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  // Close-range neighboring patches share exact canonical edge samples, so visible
  // skirts are unnecessary and were reading as cliff seams. Keep a shallow skirt
  // only on coarser patches where mixed-LOD crack masking is still useful.
  if (tile.size > 64) {
    const skirtDepth = Math.max(2, Math.min(6, step * 0.35));
    const addSkirt = (edge: number[]) => {
      for (let i = 0; i < edge.length - 1; i++) {
        const topA = edge[i],
          topB = edge[i + 1],
          ax = positions[topA * 3],
          ay = positions[topA * 3 + 1],
          az = positions[topA * 3 + 2],
          bx = positions[topB * 3],
          by = positions[topB * 3 + 1],
          bz = positions[topB * 3 + 2],
          base = positions.length / 3;
        positions.push(ax, ay, az, bx, by, bz, bx, by - skirtDepth, bz, ax, ay - skirtDepth, az);
        normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
        const tintA: RGB = [colors[topA * 4], colors[topA * 4 + 1], colors[topA * 4 + 2]],
          tintB: RGB = [colors[topB * 4], colors[topB * 4 + 1], colors[topB * 4 + 2]];
        pushColor(colors, tintA);
        pushColor(colors, tintB);
        pushColor(colors, tintB);
        pushColor(colors, tintA);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    };
    addSkirt(Array.from({ length: row }, (_, i) => i));
    addSkirt(Array.from({ length: row }, (_, i) => resolution * row + i));
    addSkirt(Array.from({ length: row }, (_, i) => i * row));
    addSkirt(Array.from({ length: row }, (_, i) => i * row + resolution));
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Uint8Array(colors),
    indices: new Uint32Array(indices),
  };
}
