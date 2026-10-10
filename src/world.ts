/** World authority. Pure coordinate functions; no RNG, mutable sequence or wall clock. */
import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  canonicalCellId,
  SOURCE_PRESENTATION_POLE_DISTANCE,
  SOURCE_PRESENTATION_RADIUS,
  sourceToLonLat,
  wrapSourceX,
} from "./planet.ts";
import { streamingBudgetForViewport } from "./streaming.ts";
import { nearestPlace, places, roadAt } from "./geography.ts";
import { macroSampleAt } from "./macro-geography.ts";
import { surfaceAt, surfaceElevationAt } from "./surface.ts";
export { WORLD_SEED } from "./config.ts";
export const GENERATOR_VERSION = WORLD_FOUNDATION_VERSION;
export const WORLD_SIZE = 262144;
export const WORLD_MIN = -WORLD_SIZE / 2;
export const CELL_SIZE = 2;
export const MAX_LEVEL = 17; // Finest render tile and logical cell are both 2 × 2 source units.
export type Tile = {
  level: number;
  x: number;
  z: number;
  key: string;
  size: number;
  minX: number;
  minZ: number;
};
export type Feature = {
  kind: "house" | "keep" | "tree" | "rock" | "field" | "well";
  x: number;
  z: number;
  y: number;
  code: string;
  variant: number;
};
export type Cell = {
  code: string;
  x: number;
  z: number;
  elevation: number;
  biome: string;
  walkable: boolean;
  tile: string;
};
export type ProvinceSeed = {
  code: string;
  x: number;
  z: number;
  domain: "Mainland" | "Archipelago";
  elevationLimit: number;
};
export type RegionSeed = {
  code: string;
  x: number;
  z: number;
  landform: "Mainland" | "Island" | "Ocean" | "Lake";
  radius: number;
  elevationLimit: number;
  parent: ProvinceSeed;
};
export type DistrictSeed = {
  code: string;
  x: number;
  z: number;
  parent: RegionSeed;
  coastOffset: number;
  beachWidth: number;
};
export type PatchSeed = {
  code: string;
  x: number;
  z: number;
  parent: DistrictSeed;
  grain: number;
};

/** Stable integer coordinate digest. A content lookup, never a pseudorandom stream.
 * Digests can collide; coordinate-containing canonical codes are the actual identities. */
export function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
export const SEED_VALUE = digest(`${WORLD_SEED}/${GENERATOR_VERSION}`);
/** Five nested source-detail levels. Macro landform authority lives above them. */
export function provinceSeed(cx: number, cz: number): ProvinceSeed {
  const x = Math.floor(cx / 1000),
    z = Math.floor(cz / 1000),
    code = `${WORLD_SEED}/${GENERATOR_VERSION}/L1/${x}/${z}`,
    macro = macroSampleAt(sourceToLonLat(x * 2000 + 1000, z * 2000 + 1000));
  return {
    code,
    x,
    z,
    domain: macro.domain === "Mainland" ? "Mainland" : "Archipelago",
    elevationLimit: 620,
  };
}
// Neighbouring samples almost always share a region: remember the last one built.
let lastRegion: RegionSeed | undefined;
export function regionSeed(cx: number, cz: number): RegionSeed {
  const x = Math.floor(cx / 100),
    z = Math.floor(cz / 100);
  if (lastRegion && lastRegion.x === x && lastRegion.z === z) return lastRegion;
  const parent = provinceSeed(cx, cz),
    code = `${parent.code}/L2/${x - parent.x * 10}/${z - parent.z * 10}`,
    macro = macroSampleAt(sourceToLonLat(x * 200 + 100, z * 200 + 100));
  return (lastRegion = {
    code,
    x,
    z,
    landform: macro.domain,
    // Retained only as source-detail metadata; it no longer controls island geometry.
    radius: 64 + (digest(code) % 12),
    elevationLimit:
      macro.domain === "Mainland" ? 620 : macro.domain === "Island" ? 180 : 0,
    parent,
  });
}
export function districtSeed(cx: number, cz: number): DistrictSeed {
  const parent = regionSeed(cx, cz),
    x = Math.floor(cx / 10) - parent.x * 10,
    z = Math.floor(cz / 10) - parent.z * 10;
  const code = `${parent.code}/L3/${x}/${z}`,
    value = digest(code);
  return {
    code,
    x,
    z,
    parent,
    coastOffset: (value % 13) - 6,
    beachWidth: 3 + ((value >>> 8) % 4),
  };
}
export function patchSeed(cx: number, cz: number): PatchSeed {
  const parent = districtSeed(cx, cz),
    x = Math.floor(cx / 2) - (parent.parent.x * 50 + parent.x * 5),
    z = Math.floor(cz / 2) - (parent.parent.z * 50 + parent.z * 5);
  const code = `${parent.code}/L4/${x}/${z}`;
  return { code, x, z, parent, grain: digest(code) % 5 };
}
export function cellSeed(cx: number, cz: number) {
  const parent = patchSeed(cx, cz),
    x = cx - Math.floor(cx / 2) * 2,
    z = cz - Math.floor(cz / 2) * 2;
  const code = `${parent.code}/L5/${x}/${z}`;
  return {
    code,
    x,
    z,
    parent,
    surface: (parent.grain + (digest(code) % 3)) % 5,
  };
}
/** Signed macro coast margin in source/render units. Positive is dry land. */
export function islandCoast(x: number, z: number, _region?: RegionSeed) {
  return macroSampleAt(sourceToLonLat(x, z)).coastDistanceRad * SOURCE_PRESENTATION_RADIUS;
}
export function coordinateValue(x: number, z: number, layer: number): number {
  let n =
    SEED_VALUE ^
    Math.imul(x, 374761393) ^
    Math.imul(z, 668265263) ^
    Math.imul(layer, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function field(
  x: number,
  z: number,
  spacing: number,
  layer: number,
): number {
  const gx = Math.floor(x / spacing),
    gz = Math.floor(z / spacing);
  const tx = smooth(x / spacing - gx),
    tz = smooth(z / spacing - gz);
  const at = (a: number, b: number) =>
    (coordinateValue(a, b, layer) % 10001) / 10000;
  return lerp(
    lerp(at(gx, gz), at(gx + 1, gz), tx),
    lerp(at(gx, gz + 1), at(gx + 1, gz + 1), tx),
    tz,
  );
}
export function settlement(
  sx: number,
  sz: number,
): { x: number; z: number; name: string } {
  const v = coordinateValue(sx, sz, 10);
  return {
    x: sx * 512,
    z: sz * 512,
    name:
      sx === 0 && sz === 0
        ? "Alderwick"
        : [
            "Briarford",
            "Greyhaven",
            "Oakmere",
            "Westwatch",
            "Ashbourne",
            "Thornfield",
          ][v % 6],
  };
}
/** Global height comes from the shared deterministic final-surface authority. */
export function heightAt(x: number, z: number): number {
  return surfaceElevationAt(x, z);
}
export function biomeAt(x: number, z: number): string {
  const macro = macroSampleAt(sourceToLonLat(x, z)),
    surface = surfaceAt(x, z),
    hierarchy = cellSeed(Math.floor(x / 2), Math.floor(z / 2));
  if (surface.water === "ocean") return "Ocean";
  if (surface.water === "lake") return "Lake";
  if (surface.water === "river") return "River";
  if (surface.riverBank) return "Riverbank";
  if (macro.domain === "Island") {
    const coast = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS;
    if (coast < hierarchy.parent.parent.beachWidth + 5 + hierarchy.surface * 0.15)
      return "Sandy beach";
    if (surface.cliff) return "Cliff";
    if (macro.volcanic && macro.mountainIntensity > 0.16) return "Volcanic highlands";
    if (macro.mountainIntensity > 0.12 || surface.elevation > 70) return "Highlands";
    return "Island meadow";
  }
  const s = nearestPlace(x, z);
  if (
    s &&
    Math.hypot(wrapSourceX(x - s.x), z - s.z) < (s.kind === "city" ? 420 : 84)
  )
    return "Settlement";
  if (roadAt(x, z)) return "Road";
  if (surface.cliff) return "Cliff";
  if (macro.volcanic && macro.mountainIntensity > 0.16) return "Volcanic highlands";
  if (macro.mountainIntensity > 0.1 || surface.elevation > 70) return "Highlands";
  return field(x, z, 90, 4) > 0.45 ? "Woodland" : "Meadow";
}

/**
 * Transitional equirectangular render patches are addressed by a canonical
 * cube-sphere anchor. The address is stable across wrap direction and visit
 * order; the patch rectangle remains disposable presentation data.
 */
function canonicalPatchKey(
  level: number,
  minX: number,
  minZ: number,
  size: number,
): string {
  const centre = sourceToLonLat(
      wrapSourceX(minX + size / 2),
      Math.max(
        -SOURCE_PRESENTATION_POLE_DISTANCE,
        Math.min(SOURCE_PRESENTATION_POLE_DISTANCE, minZ + size / 2),
      ),
    ),
    canonicalLevel = Math.min(24, level + 4);
  return `${canonicalCellId(
    centre.lon,
    centre.lat,
    canonicalLevel,
    WORLD_SEED,
    GENERATOR_VERSION,
  )}/PATCH`;
}

export function tileAt(level: number, x: number, z: number): Tile {
  const count = 2 ** level;
  if (
    !Number.isInteger(level) ||
    level < 0 ||
    level > MAX_LEVEL ||
    !Number.isInteger(x) ||
    !Number.isInteger(z) ||
    x < 0 ||
    z < 0 ||
    x >= count ||
    z >= count
  )
    throw new RangeError("Tile outside world hierarchy");
  const size = WORLD_SIZE / count,
    minX = WORLD_MIN + x * size,
    minZ = WORLD_MIN + z * size;
  return {
    level,
    x,
    z,
    key: canonicalPatchKey(level, minX, minZ, size),
    size,
    minX,
    minZ,
  };
}
export function tileForPosition(x: number, z: number, level = MAX_LEVEL): Tile {
  if (x < WORLD_MIN || x >= -WORLD_MIN || z < WORLD_MIN || z >= -WORLD_MIN)
    throw new RangeError("Position outside generated realm");
  const size = WORLD_SIZE / 2 ** level;
  return tileAt(
    level,
    Math.floor((x - WORLD_MIN) / size),
    Math.floor((z - WORLD_MIN) / size),
  );
}
export function cellAt(x: number, z: number): Cell {
  const tile = tileForPosition(x, z),
    cx = Math.floor(x / CELL_SIZE),
    cz = Math.floor(z / CELL_SIZE),
    px = cx * CELL_SIZE + 1,
    pz = cz * CELL_SIZE + 1,
    surface = surfaceAt(px, pz);
  return {
    code: cellSeed(cx, cz).code,
    x: cx,
    z: cz,
    elevation: surface.elevation,
    biome: biomeAt(px, pz),
    walkable: surface.walkable,
    tile: `${tile.level}/${tile.x}/${tile.z}`,
  };
}
/** Features are owned by their anchor tile; tile order/zoom never changes them. */
export function featuresFor(tile: Tile): Feature[] {
  const features: Feature[] = [];
  const add = (
    kind: Feature["kind"],
    x: number,
    z: number,
    variant: number,
    id: string,
  ) => {
    if (
      x < tile.minX ||
      x >= tile.minX + tile.size ||
      z < tile.minZ ||
      z >= tile.minZ + tile.size
    )
      return;
    const surface = surfaceAt(x, z),
      clearance =
        kind === "keep" ? 18 :
        kind === "field" ? 14 :
        kind === "house" ? 8 :
        kind === "tree" ? 5 : 4,
      macro = macroSampleAt(sourceToLonLat(x, z));
    if (
      surface.water !== "none" ||
      surface.cliff ||
      surface.elevation < 0.2 ||
      surface.freshwaterDistance <= clearance ||
      macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS <= clearance
    ) return;
    features.push({
      kind,
      x,
      z,
      y: surface.elevation,
      variant,
      code: `${WORLD_SEED}/${GENERATOR_VERSION}/F/${id}`,
    });
  };
  for (const s of places) {
    const extent = s.kind === "city" ? 440 : 80;
    if (
      s.x < tile.minX - extent ||
      s.x > tile.minX + tile.size + extent ||
      s.z < tile.minZ - extent ||
      s.z > tile.minZ + tile.size + extent
    )
      continue;
    const sx = Math.floor(s.x / 2),
      sz = Math.floor(s.z / 2),
      id = s.id;
    add(
      "keep",
      s.x - 30,
      s.z - 28,
      coordinateValue(sx, sz, 11),
      `${id}/${s.kind}/keep`,
    );
    add("well", s.x, s.z, 0, `${id}/${s.kind}/well`);
    for (let i = 0; i < 18; i++) {
      const v = coordinateValue(sx, sz, 20 + i);
      const side = i % 2 === 0 ? -1 : 1;
      const x = s.x + (i < 10 ? side * (15 + (v % 6)) : (i - 14) * 13);
      const z =
        s.z + (i < 10 ? (Math.floor(i / 2) - 2) * 14 : side * (42 + (v % 5)));
      if (Math.hypot(x - (s.x - 30), z - (s.z - 28)) > 19)
        add("house", x, z, v, `${id}/${s.kind}/house/${i}`);
    }
    for (let i = 0; i < 4; i++)
      add(
        "field",
        s.x + (i % 2 === 0 ? -1 : 1) * (s.kind === "city" ? 350 : 65),
        s.z + 16 + Math.floor(i / 2) * 24,
        i,
        `${id}/${s.kind}/field/${i}`,
      );
    if (s.kind === "city")
      for (let i = 0; i < 400; i++) {
        const gx = ((i % 20) - 9.5) * 29,
          gz = (Math.floor(i / 20) - 9.5) * 29;
        if (Math.abs(gx) > 40 || Math.abs(gz) > 55)
          add(
            "house",
            s.x + gx,
            s.z + gz,
            coordinateValue(sx, sz, 80 + i),
            `${id}/urban-house/${i}`,
          );
      }
  }
  if (tile.size <= 256) {
    for (
      let gz = Math.floor(tile.minZ / 10) - 1;
      gz < (tile.minZ + tile.size) / 10 + 1;
      gz++
    ) {
      for (
        let gx = Math.floor(tile.minX / 10) - 1;
        gx < (tile.minX + tile.size) / 10 + 1;
        gx++
      ) {
        const v = coordinateValue(gx, gz, 30);
        const x = gx * 10 + (v % 7) - 3,
          z = gz * 10 + ((v >>> 5) % 7) - 3;
        const biome = biomeAt(x, z);
        if (biome === "Woodland" && v % 4 !== 0)
          add("tree", x, z, v, `tree/${gx}/${gz}`);
        else if (
          !["Settlement", "Ocean", "Lake", "River"].includes(biome) &&
          v % 31 === 0
        )
          add("rock", x, z, v, `rock/${gx}/${gz}`);
      }
    }
  }
  return features;
}
export type View = {
  x: number;
  z: number;
  halfHeight: number;
  aspect: number;
  yaw: number;
  pixels: number;
};
/** Viewport bounds of the tilted orthographic camera, enlarged by one tile for prefetch. */
export function viewBounds(view: View) {
  const hw = view.halfHeight * view.aspect,
    hz = view.halfHeight / Math.sin(Math.PI / 3);
  const c = Math.abs(Math.cos(view.yaw)),
    s = Math.abs(Math.sin(view.yaw));
  const margin = Math.max(4, Math.min(48, view.halfHeight * 0.35));
  return { rx: hw * c + hz * s + margin, rz: hw * s + hz * c + margin };
}

function wrappedTileDistanceX(x: number, focusX: number): number {
  return Math.abs(wrapSourceX(x - focusX));
}

/** Exact-pole tangent coverage is a radial presentation ring, not world authority. */
const POLE_ACTIVE_PATCH_LIMIT = 16;

/**
 * Wrap-aware local patch selection. Near a pole, longitude convergence expands
 * the source-domain search so the tangent view receives a complete ring of
 * canonical coverage instead of a narrow equirectangular wedge.
 */
export function selectTiles(
  view: View,
  threshold = 190,
  activeLimit = streamingBudgetForViewport(
    view.pixels * view.aspect,
    view.pixels,
  ).activePatches,
): Tile[] {
  const bounds = viewBounds(view),
    focus = sourceToLonLat(view.x, view.z),
    atPole = Math.abs(Math.abs(focus.lat) - Math.PI / 2) <= 1e-12,
    selectionLimit = atPole
      ? Math.min(activeLimit, POLE_ACTIVE_PATCH_LIMIT)
      : activeLimit,
    streamX = atPole ? 0 : view.x,
    longitudeScale = Math.max(0.02, Math.abs(Math.cos(focus.lat))),
    rx = atPole
      ? WORLD_SIZE / 2
      : Math.min(WORLD_SIZE / 2, bounds.rx / longitudeScale),
    rz = bounds.rz,
    selected = new Map<string, Tile>(),
    centres = [streamX];

  if (streamX - rx < WORLD_MIN) centres.push(streamX + WORLD_SIZE);
  if (streamX + rx > -WORLD_MIN) centres.push(streamX - WORLD_SIZE);

  const visit = (t: Tile, centreX: number) => {
    const maxZ = t.minZ + t.size;
    // The S001 source plane extends past the canonical poles. Never stream
    // those invalid bands. Subdivide coarse crossing patches until the exact
    // level-2 pole boundaries can be selected without folded duplicates.
    if (
      t.minZ >= SOURCE_PRESENTATION_POLE_DISTANCE ||
      maxZ <= -SOURCE_PRESENTATION_POLE_DISTANCE
    )
      return;
    const crossesPole =
      t.minZ < -SOURCE_PRESENTATION_POLE_DISTANCE ||
      maxZ > SOURCE_PRESENTATION_POLE_DISTANCE;
    if (
      t.minX > centreX + rx ||
      t.minX + t.size < centreX - rx ||
      t.minZ > view.z + rz ||
      maxZ < view.z - rz
    )
      return;
    const projectedPixels = (t.size * view.pixels) / (view.halfHeight * 2);
    if (
      t.level < MAX_LEVEL &&
      (crossesPole || projectedPixels > threshold)
    ) {
      for (let dz = 0; dz < 2; dz++)
        for (let dx = 0; dx < 2; dx++)
          visit(tileAt(t.level + 1, t.x * 2 + dx, t.z * 2 + dz), centreX);
    } else selected.set(t.key, t);
  };

  for (const centreX of centres) visit(tileAt(0, 0, 0), centreX);
  if (selected.size > selectionLimit)
    return selectTiles(view, threshold * 1.25, selectionLimit);

  return [...selected.values()].sort(
    (a, b) =>
      Math.hypot(
        wrappedTileDistanceX(a.minX + a.size / 2, streamX),
        a.minZ + a.size / 2 - view.z,
      ) -
      Math.hypot(
        wrappedTileDistanceX(b.minX + b.size / 2, streamX),
        b.minZ + b.size / 2 - view.z,
      ),
  );
}
