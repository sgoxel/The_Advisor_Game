import type { Geometry } from "./geometry.ts";
import { terrainTint } from "./geometry.ts";
import { finalSurfaceAt, type Tile } from "./world.ts";
import { drainageSegmentsInBounds } from "./hydrology.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  SOURCE_PRESENTATION_RADIUS,
  SOURCE_PRESENTATION_WIDTH,
  sourceToLonLat,
  wrapSourceX,
} from "./planet.ts";

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
  tint: readonly number[];
  wet: string;
  shoreDistance: number;
};

/**
 * One bounded replacement surface. The old coarse ground cannot occlude canonical
 * water, but uniform leaves use two triangles instead of a centre fan. The centre
 * fan is retained only where water or a river actually crosses a leaf so narrow
 * channels keep their canonical identity without doubling every dry vertex.
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
} {
  const unchanged = {
    geometry: original,
    replaced: false,
    leaves: 0,
    samples: 0,
    surfaceVertices: 0,
    cpuScratchBytesEstimated: 0,
  };
  if (tile.size > NATURAL_MESH_LIMITS.maximumTile) return unchanged;

  const segments =
      tile.size <= 512
        ? drainageSegmentsInBounds(tile.minX, tile.minZ, tile.size)
        : [],
    cache = new Map<string, Sample>(),
    positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [],
    indices: number[] = [],
    uvs: number[] = [];
  let leaves = 0;

  const sample = (x: number, z: number) => {
    const key = `${x}/${z}`,
      cached = cache.get(key);
    if (cached) return cached;
    if (cache.size >= NATURAL_MESH_LIMITS.samples)
      throw new RangeError("Natural mesh sample cap exceeded");
    const surface = finalSurfaceAt(x, z),
      macro = macroSampleAt(sourceToLonLat(x, z)),
      wet = surface.water.kind,
      value = {
        x,
        z,
        y: wet === "none" ? surface.groundHeight : surface.water.level + 0.0025,
        tint: terrainTint(x, z),
        wet,
        shoreDistance: macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS,
      };
    cache.set(key, value);
    return value;
  };

  let majorBoundary = false,
    initialWet: string | undefined;
  for (let z = 0; z <= 8; z++)
    for (let x = 0; x <= 8; x++) {
      const s = sample(
          tile.minX + (tile.size * x) / 8,
          tile.minZ + (tile.size * z) / 8,
        ),
        major = s.wet === "lake" || s.wet === "ocean" ? "wet" : "dry";
      if (initialWet === undefined) initialWet = major;
      else if (major !== initialWet) majorBoundary = true;
    }
  if (!segments.length && !majorBoundary) return unchanged;

  const originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2;
  const triangle = (a: Sample, b: Sample, c: Sample) => {
    const ux = b.x - a.x,
      uy = b.y - a.y,
      uz = b.z - a.z,
      vx = c.x - a.x,
      vy = c.y - a.y,
      vz = c.z - a.z,
      n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx],
      length = Math.hypot(...n) || 1,
      start = positions.length / 3;
    for (const p of [a, b, c]) {
      positions.push(p.x - originX, p.y, p.z - originZ);
      normals.push(...n.map((v) => v / length));
      colors.push(...p.tint, 255);
      uvs.push(
        p.x / SOURCE_PRESENTATION_WIDTH + 0.5,
        Math.max(0, Math.min(1, 0.5 + (2 * p.z) / SOURCE_PRESENTATION_WIDTH)),
      );
    }
    indices.push(start, start + 1, start + 2);
  };
  const quad = (a: Sample, b: Sample, c: Sample, d: Sample) => {
    triangle(a, b, c);
    triangle(a, c, d);
  };

  const nearRiver = (x: number, z: number, size: number) =>
    segments.some((s) => {
      const dx = wrapSourceX(s.bx - s.ax),
        dz = s.bz - s.az,
        qx = wrapSourceX(x - s.ax),
        qz = z - s.az,
        t = Math.max(
          0,
          Math.min(1, (qx * dx + qz * dz) / (dx * dx + dz * dz || 1)),
        );
      return (
        Math.hypot(qx - dx * t, qz - dz * t) <=
        (size * Math.SQRT2) / 2 + s.width + 12
      );
    });

  const visit = (x: number, z: number, size: number) => {
    const half = size / 2,
      a = sample(x, z),
      b = sample(x, z + size),
      c = sample(x + size, z + size),
      d = sample(x + size, z),
      middle = sample(x + half, z + half),
      river = nearRiver(middle.x, middle.z, size),
      wetClasses = [a, b, c, d, middle].map((s) =>
        s.wet === "ocean" || s.wet === "lake" ? "wet" : "dry",
      ),
      major = wetClasses.some((value) => value !== wetClasses[0]),
      nearCoast =
        majorBoundary &&
        [a, b, c, d, middle].some(
          (s) => Math.abs(s.shoreDistance) <= size * Math.SQRT2 + 8,
        ),
      target = river
        ? Math.min(
            tile.size >= 256 ? 2 : tile.size >= 128 ? 1 : 0.5,
            tile.size / 32,
          )
        : Math.max(2, tile.size / 128);
    if (size > target && (river || major || nearCoast)) {
      visit(x, z, half);
      visit(x, z + half, half);
      visit(x + half, z + half, half);
      visit(x + half, z, half);
      return;
    }
    if (++leaves > NATURAL_MESH_LIMITS.leaves)
      throw new RangeError("Natural mesh leaf cap exceeded");

    const centreNeeded = river || major || middle.wet !== a.wet;
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

  // Record the actual top-surface range before skirts append deliberately lowered
  // edge vertices. Tests and telemetry can therefore validate visible canonical
  // surface vertices without assuming one fixed triangle count per adaptive leaf.
  const surfaceVertices = positions.length / 3;

  const borderStep = segments.length
    ? Math.max(2, tile.size / 128)
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
        a = point(offset),
        b = point(next),
        c = { ...b, y: b.y - 12 },
        d = { ...a, y: a.y - 12 };
      quad(a, b, c, d);
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
    cpuScratchBytesEstimated:
      (positions.length + normals.length + colors.length + indices.length + uvs.length) *
        8 +
      cache.size * 192,
  };
}
