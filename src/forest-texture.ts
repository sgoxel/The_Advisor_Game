import { climateSampleAt, type ForestFamily } from "./climate.ts";
import { CANONICAL_PLANET_RADIUS, sourceToLonLat, type LonLat } from "./planet.ts";
import { coordinateValue, finalSurfaceAt } from "./world.ts";

/**
 * The forest as terrain texture. One pure field decides, for every canonical position, how
 * "dark tree stand" (1) or "open grass" (0) the ground is. The terrain colour paints it at every
 * zoom level; the 3D trees (forest-cover.ts) only appear where the same field is dark, so trees
 * pop up out of the darker areas of the texture and lighter areas stay grass.
 *
 * Deterministic: climate + final surface + seeded value noise, evaluated on the sphere in metres
 * (3D lattice), so there is no antimeridian seam, no pole pinching and the same feature size in
 * every direction. No Math.random, no wall clock.
 */

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-9, edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const fade = (t: number) => t * t * (3 - 2 * t);

/** Feature size (lattice cell, metres) and weight of each noise octave: glades 120 m down to groups of trees 26 m. */
const OCTAVES: readonly { cellM: number; weight: number; layer: number }[] = [
  { cellM: 120, weight: .42, layer: 951 },
  { cellM: 55, weight: .33, layer: 952 },
  { cellM: 26, weight: .25, layer: 953 },
];
/** Family bias added to the stand noise: boreal forest is dense, warm-dry woodland is sparse and grassy. */
const FAMILY_BIAS: Readonly<Record<ForestFamily, number>> = {
  "conifer-boreal": .03,
  "temperate-deciduous-mixed": -.04,
  "warm-dry-woodland": -.10,
};

const corner = (ix: number, iy: number, iz: number, layer: number) =>
  coordinateValue(ix, Math.imul(iy, 73856093) ^ Math.imul(iz, 19349663), layer) / 4294967296;

function valueNoise3(px: number, py: number, pz: number, layer: number) {
  const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz),
    tx = fade(px - ix), ty = fade(py - iy), tz = fade(pz - iz),
    c = (dx: number, dy: number, dz: number) => corner(ix + dx, iy + dy, iz + dz, layer),
    x00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * tx,
    x10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * tx,
    x01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * tx,
    x11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * tx,
    y0 = x00 + (x10 - x00) * ty, y1 = x01 + (x11 - x01) * ty;
  return y0 + (y1 - y0) * tz;
}

/** Seeded stand noise in 0..1 (mean .5) on the sphere, 26-120 m features. */
export function forestStandNoise(position: LonLat): number {
  const clat = Math.cos(position.lat), R = CANONICAL_PLANET_RADIUS,
    x = R * clat * Math.cos(position.lon), y = R * clat * Math.sin(position.lon), z = R * Math.sin(position.lat);
  let n = 0;
  for (const o of OCTAVES) n += o.weight * valueNoise3(x / o.cellM, y / o.cellM, z / o.cellM, o.layer);
  return n;
}

/**
 * Forest texture from already known inputs (the terrain colour pass has them): the climate forest
 * family at this position and the final surface vegetation density (0 on roads, water, inhabited land).
 */
export function forestTextureFor(position: LonLat, family: ForestFamily | null, vegetationDensityScale: number): number {
  if (!family) return 0;
  const presence = smoothstep(.35, .9, vegetationDensityScale);
  if (presence <= 0) return 0;
  // Spread the narrow noise distribution so both deep stands and bare glades occur.
  const stand = (forestStandNoise(position) - .5) * 2.4 + .5 + FAMILY_BIAS[family];
  return smoothstep(.36, .7, stand) * presence;
}

/** 0..1: 1 is a dense dark tree stand, 0 is open grass (or not forest at all). Pure and deterministic. */
export function forestTextureAt(x: number, z: number): number {
  const surface = finalSurfaceAt(x, z);
  if (surface.water.kind !== "none" || surface.vegetationDensityScale <= 0) return 0;
  const position = sourceToLonLat(x, z);
  return forestTextureFor(position, climateSampleAt(position, surface.groundHeight).forestFamily, surface.vegetationDensityScale);
}
