/** Globe surface image. Presentation only: every texel is the flat world's own
 * canonical climate/material identity and height, sampled through shared generation functions. */
import { places } from "./geography.ts";
import { terrainTint } from "./geometry.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  lonLatToFlat,
  sourceToLonLat,
  PLANET_CIRCUMFERENCE,
  POLE_DISTANCE,
} from "./planet.ts";
import { CELL_SIZE, heightAt } from "./world.ts";

/** Equirectangular RGBA8, row-major, row 0 at the north edge, alpha 255. */
export type GlobeSurface = {
  width: number;
  height: number;
  pixels: Uint8Array;
};
export type GlobeSurfaceOptions = {
  /** Supersampling per texel axis: samples × samples fixed positions, averaged. */
  samples?: number;
  /** Hill-shading strength; 0 leaves the terrain colours untouched. */
  relief?: number;
  /** Half-open row range to build; the other rows stay zero. */
  rows?: [number, number];
};
type RGB = [number, number, number];

/** Lit from the north-west, 45° above the horizon: [toward west, up, toward north]. */
const LIGHT = [0.5, Math.SQRT1_2, 0.5];
/** Vertical exaggeration: canonical planet relief is compressed, so orbit-scale shading magnifies slopes without changing terrain authority. */
const EXAGGERATION = 5.5;
/** RGBA8 globe textures otherwise quantize genuine shallow terrain slopes back to the flat base colour. */
const MIN_VISIBLE_RELIEF = 0.008;
const SHADE_MIN = 0.6,
  SHADE_MAX = 1.3;

// One entry per source-detail generation region. Open-ocean regions may reuse
// elevation, but colour still comes from the canonical climate authority so polar
// sea ice is not collapsed into one global ocean swatch.
const REGION = CELL_SIZE * 100,
  HALF = PLANET_CIRCUMFERENCE / 2,
  COL0 = Math.floor(-HALF / REGION),
  ROW0 = Math.floor(-POLE_DISTANCE / REGION),
  COLS = Math.ceil(HALF / REGION) - COL0,
  ROWS = Math.floor(POLE_DISTANCE / REGION) - ROW0 + 1;
/** Settlement and road ground reaches under 1 km; the shortcut stays well clear of it. */
const PLACE_CLEARANCE = 4096;
const UNKNOWN = 0,
  DETAILED = 1,
  OPEN_OCEAN = 2;
let regions: Uint8Array | undefined;
let seaHeight: number | undefined;

function regionStates(): Uint8Array {
  if (regions) return regions;
  regions = new Uint8Array(COLS * ROWS);
  for (const place of places)
    for (
      let rz = Math.floor((place.z - PLACE_CLEARANCE) / REGION);
      rz <= Math.floor((place.z + PLACE_CLEARANCE) / REGION);
      rz++
    )
      for (
        let rx = Math.floor((place.x - PLACE_CLEARANCE) / REGION);
        rx <= Math.floor((place.x + PLACE_CLEARANCE) / REGION);
        rx++
      )
        if (rx >= COL0 && rx < COL0 + COLS && rz >= ROW0 && rz < ROW0 + ROWS)
          regions[(rz - ROW0) * COLS + rx - COL0] = DETAILED;
  return regions;
}

/**
 * Conservative bounded proof for the open-ocean cache. Macro islands/lakes are
 * much wider than a 200-source-unit region, so a 3×3 probe catches any canonical
 * feature intersecting the region. Any uncertainty stays DETAILED rather than
 * inventing ocean. This runs once per visited region, never per frame.
 */
function regionIsOpenOcean(rx: number, rz: number): boolean {
  for (const v of [0.05, 0.5, 0.95])
    for (const u of [0.05, 0.5, 0.95]) {
      const x = (rx + u) * REGION,
        z = Math.max(-POLE_DISTANCE, Math.min(POLE_DISTANCE, (rz + v) * REGION));
      if (macroSampleAt(sourceToLonLat(x, z)).domain !== "Ocean") return false;
    }
  return true;
}

/** Memoised: is the generation region holding this position proven open ocean? */
function openOcean(x: number, z: number): boolean {
  if (x < -HALF || x >= HALF || z < -POLE_DISTANCE || z > POLE_DISTANCE)
    return false;
  const states = regionStates(),
    rx = Math.floor(x / REGION),
    rz = Math.floor(z / REGION),
    index = (rz - ROW0) * COLS + rx - COL0;
  if (states[index] === UNKNOWN)
    states[index] = regionIsOpenOcean(rx, rz) ? OPEN_OCEAN : DETAILED;
  return states[index] === OPEN_OCEAN;
}

/** Read the shared ocean elevation once; polar sea ice changes material, not sea level. */
function openSeaHeight() {
  if (seaHeight !== undefined) return seaHeight;
  for (let rz = ROW0; rz < ROW0 + ROWS; rz++)
    for (let rx = COL0; rx < COL0 + COLS; rx++) {
      const x = (rx + 0.5) * REGION,
        z = (rz + 0.5) * REGION;
      if (openOcean(x, z)) return (seaHeight = heightAt(x, z));
    }
  return (seaHeight = -2.8);
}

/** Vertex colours reach the flat terrain mesh through a Uint8Array: same truncation. */
const bytes = ([r, g, b]: RGB): RGB => [r | 0, g | 0, b | 0];

/** Unshaded surface colour at a flat position from the shared semantic material authority. */
export function globeSurfaceColor(x: number, z: number): RGB {
  return bytes(terrainTint(x, z, openOcean(x, z) ? 4096 : 32));
}

export function buildGlobeSurface(
  width: number,
  height: number,
  options: GlobeSurfaceOptions = {},
): GlobeSurface {
  const { samples = 1, relief = 1, rows = [0, height] } = options,
    [from, to] = rows;
  if (
    ![width, height, samples, from, to].every(Number.isInteger) ||
    width < 1 ||
    height < 1 ||
    samples < 1 ||
    from < 0 ||
    to > height ||
    from > to ||
    !Number.isFinite(relief)
  )
    throw new RangeError("Invalid globe surface request");
  const pixels = new Uint8Array(width * height * 4),
    oceanHeight = openSeaHeight(),
    count = samples * samples;
  // Flat x depends only on the column and flat z only on the row: map each once.
  const xs = new Float64Array(width * samples),
    zs = new Float64Array(height * samples),
    centreX = new Float64Array(width),
    centreZ = new Float64Array(height);
  const lon = (column: number) => (column / width) * 2 * Math.PI - Math.PI,
    lat = (row: number) => Math.PI / 2 - (row / height) * Math.PI;
  for (let i = 0; i < width; i++) {
    centreX[i] = lonLatToFlat(lon(i + 0.5), 0).x;
    for (let a = 0; a < samples; a++)
      xs[i * samples + a] = lonLatToFlat(lon(i + (a + 0.5) / samples), 0).x;
  }
  for (let j = 0; j < height; j++) {
    centreZ[j] = lonLatToFlat(0, lat(j + 0.5)).z;
    for (let b = 0; b < samples; b++)
      zs[j * samples + b] = lonLatToFlat(0, lat(j + (b + 0.5) / samples)).z;
  }
  // Heights at texel centres, read on demand and shared by neighbouring texels.
  const heights = new Float32Array(relief ? (to - from + 2) * width : 0).fill(NaN);
  const elevation = (i: number, j: number) => {
    const index = (j - from + 1) * width + i;
    if (Number.isNaN(heights[index])) {
      const x = centreX[i],
        z = centreZ[j];
      heights[index] = openOcean(x, z) ? oceanHeight : heightAt(x, z);
    }
    return heights[index];
  };
  // Slopes in flat metres between neighbouring texel centres. The planet closes
  // east–west; a pole row has no neighbour beyond it.
  const shade = (i: number, j: number) => {
    const west = (i + width - 1) % width,
      east = (i + 1) % width,
      north = Math.max(0, j - 1),
      south = Math.min(height - 1, j + 1);
    const eastward =
        ((elevation(east, j) - elevation(west, j)) * EXAGGERATION) /
        ((2 * PLANET_CIRCUMFERENCE) / width),
      southward =
        south === north
          ? 0
          : ((elevation(i, south) - elevation(i, north)) * EXAGGERATION) /
            (centreZ[south] - centreZ[north]);
    const lit =
        (LIGHT[0] * eastward + LIGHT[1] + LIGHT[2] * southward) /
        Math.sqrt(1 + eastward * eastward + southward * southward),
      raw = lit / LIGHT[1] - 1,
      slopeMagnitude = Math.abs(eastward) + Math.abs(southward),
      signed = raw || LIGHT[0] * eastward + LIGHT[2] * southward || eastward - southward,
      directional =
        slopeMagnitude > 1e-7 && Math.abs(raw) < MIN_VISIBLE_RELIEF
          ? Math.sign(signed || 1) * MIN_VISIBLE_RELIEF
          : raw;
    return Math.max(
      SHADE_MIN,
      Math.min(SHADE_MAX, 1 + relief * directional),
    );
  };
  for (let j = from; j < to; j++)
    for (let i = 0; i < width; i++) {
      let landR = 0,
        landG = 0,
        landB = 0,
        waterR = 0,
        waterG = 0,
        waterB = 0,
        land = 0;
      for (let sb = 0; sb < samples; sb++) {
        const z = zs[j * samples + sb];
        for (let sa = 0; sa < samples; sa++) {
          const x = xs[i * samples + sa],
            isOpenOcean = openOcean(x, z),
            c = globeSurfaceColor(x, z),
            wet = isOpenOcean || heightAt(x, z) <= 0.1;
          if (wet) {
            waterR += c[0];
            waterG += c[1];
            waterB += c[2];
          } else {
            landR += c[0];
            landG += c[1];
            landB += c[2];
            land++;
          }
        }
      }
      const light = land && relief ? shade(i, j) : 1,
        offset = (j * width + i) * 4;
      pixels[offset] = Math.min(255, Math.round((landR * light + waterR) / count));
      pixels[offset + 1] = Math.min(255, Math.round((landG * light + waterG) / count));
      pixels[offset + 2] = Math.min(255, Math.round((landB * light + waterB) / count));
      pixels[offset + 3] = 255;
    }
  return { width, height, pixels };
}
