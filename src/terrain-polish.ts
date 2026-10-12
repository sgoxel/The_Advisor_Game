import type { Geometry } from "./geometry.ts";
import { terrainTint } from "./geometry.ts";
import { surfaceAt } from "./surface.ts";
import { refineRuntimeTerrain } from "./terrain-runtime.ts";
import type { Tile } from "./world.ts";

type RGB = [number, number, number];
type Point = [number, number, number];

const WATER_COLORS = new Set([
  "70,126,132",
  "58,126,148",
  "62,122,151",
]);
const ROCK: RGB = [105, 104, 96];
const HIGHLAND: RGB = [132, 126, 108];

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const blend = (a: RGB, b: RGB, t: number): RGB => {
  const amount = clamp01(t);
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
};
const normalize = (point: Point): Point => {
  const length = Math.hypot(point[0], point[1], point[2]) || 1;
  return [point[0] / length, point[1] / length, point[2] / length];
};

function presentationNormal(nx: number, ny: number, nz: number, tileSize: number): Point {
  const vertical = Math.max(0.12, Math.abs(ny)),
    slopeX = nx / vertical,
    slopeZ = nz / vertical,
    // Province relief is communicated primarily by broad canonical elevation,
    // not high-frequency normal stripes. Close views retain enough slope signal
    // for real cliff faces and shoulders to read clearly.
    slopeScale =
      tileSize >= 256 ? 0.16 :
      tileSize >= 128 ? 0.24 :
      tileSize >= 64 ? 0.45 : 0.78;
  return normalize([slopeX * slopeScale, 1, slopeZ * slopeScale]);
}

function presentationColor(
  x: number,
  z: number,
  tileSize: number,
  normal: Point,
): RGB {
  const surface = surfaceAt(x, z),
    base = terrainTint(x, z, 2048, surface.elevation),
    highland = clamp01((surface.elevation - 18) / 300),
    steep = clamp01((surface.slope - 0.24) / 1.25),
    close = tileSize <= 64,
    highlandMaterial = blend(base, HIGHLAND, highland * (tileSize >= 128 ? 0.08 : 0.07)),
    rockWeight = Math.min(
      0.42,
      steep * (close ? 0.25 : 0.12) +
        highland * (close ? 0.06 : 0.035) +
        (surface.cliff ? (close ? 0.12 : 0.04) : 0),
    ),
    material = blend(highlandMaterial, ROCK, rockWeight),
    light = normal[0] * -0.36 + normal[1] * 0.86 + normal[2] * -0.36,
    normalContrast =
      tileSize <= 32 ? 0.86 :
      tileSize <= 64 ? 0.76 :
      tileSize <= 128 ? 0.46 : 0.22,
    altitudeTone = highland * (tileSize >= 128 ? 0.075 : 0.06),
    slopeTone = steep * (close ? -0.12 : -0.045),
    shade = Math.max(
      0.78,
      Math.min(1.2, 0.985 + altitudeTone + slopeTone + (light - 0.86) * normalContrast),
    );
  return [material[0] * shade, material[1] * shade, material[2] * shade];
}

/**
 * Presentation-only local terrain polish. Canonical geometry, elevation, water,
 * traversal and SEED identity remain owned by refineRuntimeTerrain/surfaceAt.
 */
export function polishRuntimeTerrain(tile: Tile, original: Geometry): Geometry {
  const geometry = refineRuntimeTerrain(tile, original);
  if (tile.size >= 1024 || geometry === original) return geometry;

  const originX = tile.minX + tile.size / 2,
    originZ = tile.minZ + tile.size / 2,
    cache = new Map<string, { normal: Point; color: RGB }>();

  for (let vertex = 0; vertex < geometry.positions.length / 3; vertex++) {
    const p = vertex * 3,
      c = vertex * 4,
      colorKey = `${geometry.colors[c]},${geometry.colors[c + 1]},${geometry.colors[c + 2]}`;
    if (WATER_COLORS.has(colorKey)) continue;

    const x = originX + geometry.positions[p],
      z = originZ + geometry.positions[p + 2],
      key = `${x.toFixed(4)},${z.toFixed(4)}`;
    let sample = cache.get(key);
    if (!sample) {
      const normal = presentationNormal(
          geometry.normals[p],
          geometry.normals[p + 1],
          geometry.normals[p + 2],
          tile.size,
        ),
        color = presentationColor(x, z, tile.size, normal);
      sample = { normal, color };
      cache.set(key, sample);
    }

    geometry.normals[p] = sample.normal[0];
    geometry.normals[p + 1] = sample.normal[1];
    geometry.normals[p + 2] = sample.normal[2];
    geometry.colors[c] = byte(sample.color[0]);
    geometry.colors[c + 1] = byte(sample.color[1]);
    geometry.colors[c + 2] = byte(sample.color[2]);
    geometry.colors[c + 3] = 255;
  }

  return geometry;
}
