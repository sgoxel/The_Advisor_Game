import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import { nearestPlace, roadAt, roadDistanceAt } from "./geography.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  SOURCE_PRESENTATION_RADIUS,
  sourceToLonLat,
  wrapSourceX,
} from "./planet.ts";

/**
 * Canonical world-building precedence. Higher priorities may alter channels
 * established by lower priorities, but stable IDs decide ties. Presentation,
 * renderer backend, tile visit order and LOD never participate in this order.
 */
export const WORLD_BUILDING_PRIORITY = Object.freeze({
  ocean: 0,
  continent: 1,
  island: 2,
  naturalTerrain: 3,
  hydrology: 4,
  country: 5,
  city: 6,
  village: 7,
  road: 8,
  criticalSite: 9,
} as const);

export type SurfaceWater = "none" | "ocean" | "lake" | "river";
export type SurfaceReservedUse =
  | "none"
  | "city"
  | "village"
  | "road"
  | "bridge"
  | "critical-site";
export type SurfaceChannel =
  | "elevation"
  | "material"
  | "water"
  | "flow"
  | "vegetation"
  | "reserved-use"
  | "walkability";

export type SurfaceContribution = Readonly<{
  priority: number;
  id: string;
  channels: readonly SurfaceChannel[];
}>;

export type ComposedSurface = Readonly<{
  x: number;
  z: number;
  naturalElevation: number;
  groundElevation: number;
  surfaceElevation: number;
  groundMaterial: string;
  surfaceMaterial: string;
  water: SurfaceWater;
  flow: Readonly<{ x: number; z: number }> | null;
  vegetationExcluded: boolean;
  reservedUse: SurfaceReservedUse;
  contributions: readonly SurfaceContribution[];
}>;

export type FinalSurfaceSample = ComposedSurface &
  Readonly<{
    slopeM: number;
    walkable: boolean;
  }>;

const CORE_CACHE_LIMIT = 16_384;
const FINAL_CACHE_LIMIT = 4_096;
const coreCache = new Map<string, ComposedSurface>();
const finalCache = new Map<string, FinalSurfaceSample>();
let coreQueries = 0,
  finalQueries = 0,
  cacheHits = 0,
  cacheMisses = 0,
  candidateModifiersExamined = 0,
  maxCandidateModifiers = 0,
  worstQueryMs = 0,
  evictions = 0;

function nowMs() {
  // Timing is telemetry only and never contributes to world state.
  return globalThis.performance?.now?.() ?? 0;
}

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
const SEED_VALUE = digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}`);

function coordinateValue(x: number, z: number, layer: number): number {
  let n =
    SEED_VALUE ^
    Math.imul(x, 374761393) ^
    Math.imul(z, 668265263) ^
    Math.imul(layer, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function field(x: number, z: number, spacing: number, layer: number): number {
  const gx = Math.floor(x / spacing),
    gz = Math.floor(z / spacing),
    tx = smooth(x / spacing - gx),
    tz = smooth(z / spacing - gz),
    at = (a: number, b: number) =>
      (coordinateValue(a, b, layer) % 10001) / 10000;
  return lerp(
    lerp(at(gx, gz), at(gx + 1, gz), tx),
    lerp(at(gx, gz + 1), at(gx + 1, gz + 1), tx),
    tz,
  );
}

/** Priority-4 prototype river centreline. Hydrology generation may replace this
 * input later without changing the composition contract. */
export function composedRiverX(z: number): number {
  return 125 + 42 * Math.sin(z / 150) + 18 * Math.sin(z / 57);
}

function cacheKey(x: number, z: number) {
  // Local terrain/collision samples repeatedly hit the half-metre lattice. Globe
  // texels are mostly unique floats; refusing to cache those prevents camera/LOD
  // presentation work from churning authority memory.
  const hx = x * 2,
    hz = z * 2;
  if (Math.abs(hx - Math.round(hx)) > 1e-9 || Math.abs(hz - Math.round(hz)) > 1e-9)
    return undefined;
  return `${x}/${z}`;
}

function insertBounded<T>(map: Map<string, T>, key: string, value: T, limit: number) {
  if (map.size >= limit) {
    const first = map.keys().next().value as string | undefined;
    if (first !== undefined) {
      map.delete(first);
      evictions++;
    }
  }
  map.set(key, value);
}

function contribution(
  priority: number,
  id: string,
  channels: readonly SurfaceChannel[],
): SurfaceContribution {
  return Object.freeze({ priority, id, channels: Object.freeze([...channels]) });
}

function naturalMaterial(
  x: number,
  z: number,
  elevation: number,
  macro: ReturnType<typeof macroSampleAt>,
) {
  if (macro.domain === "Ocean") return "Ocean";
  if (macro.domain === "Lake") return "Lake";
  if (macro.domain === "Island") {
    if (elevation < 0.1) return "Ocean";
    const coast = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS;
    if (coast < 9) return "Sandy beach";
    if (macro.volcanic && macro.mountainIntensity > 0.16) return "Volcanic highlands";
    if (macro.mountainIntensity > 0.12 || elevation > 70) return "Highlands";
    return "Island meadow";
  }
  if (macro.volcanic && macro.mountainIntensity > 0.16) return "Volcanic highlands";
  if (macro.mountainIntensity > 0.1 || elevation > 70) return "Highlands";
  return field(x, z, 90, 4) > 0.45 ? "Woodland" : "Meadow";
}

function composeUncached(x: number, z: number): ComposedSurface {
  const position = sourceToLonLat(x, z),
    macro = macroSampleAt(position),
    contributions: SurfaceContribution[] = [];

  let naturalElevation: number;
  if (macro.domain === "Ocean") {
    naturalElevation = -2.8;
    contributions.push(
      contribution(WORLD_BUILDING_PRIORITY.ocean, `${macro.code}/OCEAN`, [
        "elevation",
        "material",
        "water",
        "vegetation",
        "walkability",
      ]),
    );
  } else if (macro.domain === "Lake") {
    naturalElevation = -1.8;
    contributions.push(
      contribution(WORLD_BUILDING_PRIORITY.hydrology, `${macro.code}/LAKE`, [
        "elevation",
        "material",
        "water",
        "vegetation",
        "walkability",
      ]),
    );
  } else {
    const base =
        macro.domain === "Island"
          ? 3 + field(x, z, 58, 2) * 12
          : 3 + field(x, z, 160, 1) * 9 + field(x, z, 48, 2) * 2,
      macroRelief = macro.reliefM * (0.88 + 0.12 * field(x, z, 110, 3)),
      cap = macro.domain === "Island" ? 180 : 620,
      terrain = Math.min(cap, base + macroRelief),
      coastSource = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS;
    naturalElevation = lerp(
      -2.8,
      terrain,
      smooth(clamp01((coastSource + 2) / 10)),
    );
    contributions.push(
      contribution(
        macro.domain === "Island"
          ? WORLD_BUILDING_PRIORITY.island
          : WORLD_BUILDING_PRIORITY.continent,
        `${macro.code}/${macro.domain.toUpperCase()}`,
        ["elevation"],
      ),
      contribution(WORLD_BUILDING_PRIORITY.naturalTerrain, `${macro.code}/NATURAL`, [
        "elevation",
        "material",
        "vegetation",
        "walkability",
      ]),
    );
  }

  let groundElevation = naturalElevation,
    surfaceElevation = naturalElevation,
    groundMaterial = naturalMaterial(x, z, naturalElevation, macro),
    surfaceMaterial = groundMaterial,
    water: SurfaceWater =
      macro.domain === "Ocean" ? "ocean" : macro.domain === "Lake" ? "lake" : "none",
    flow: { x: number; z: number } | null = null,
    vegetationExcluded = water !== "none",
    reservedUse: SurfaceReservedUse = "none";

  // Priority 4: river carving is reduced before settlements and roads. The
  // riverbed remains visible beneath a later priority-8 bridge deck.
  let riverCandidate = false;
  if (macro.domain === "Mainland") {
    const bank = Math.abs(wrapSourceX(x - composedRiverX(z)));
    if (bank < 31) {
      riverCandidate = true;
      const riverBlend = smooth(clamp01((bank - 12) / 19));
      groundElevation = lerp(-2.8, groundElevation, riverBlend);
      surfaceElevation = groundElevation;
      const dx = (composedRiverX(z + 1) - composedRiverX(z - 1)) / 2,
        length = Math.hypot(dx, 1) || 1;
      flow = Object.freeze({ x: dx / length, z: 1 / length });
      if (groundElevation < 0.1) {
        water = "river";
        groundMaterial = "River";
        surfaceMaterial = "River";
        vegetationExcluded = true;
      } else {
        groundMaterial = "Riverbank";
        surfaceMaterial = "Riverbank";
      }
      contributions.push(
        contribution(WORLD_BUILDING_PRIORITY.hydrology, `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/RIVER`, [
          "elevation",
          "material",
          "water",
          "flow",
          "vegetation",
          "walkability",
        ]),
      );
    }
  }

  const place = nearestPlace(x, z),
    placeDistance = place
      ? Math.hypot(wrapSourceX(x - place.x), z - place.z)
      : Infinity,
    placeRadius = place?.kind === "city" ? 430 : 90,
    placeWeight = place ? 1 - smooth(clamp01((placeDistance - placeRadius) / 80)) : 0;
  if (place && placeWeight > 0) {
    const priority =
      place.kind === "city"
        ? WORLD_BUILDING_PRIORITY.city
        : WORLD_BUILDING_PRIORITY.village;
    if (water === "none") {
      groundElevation = lerp(groundElevation, 3, placeWeight);
      surfaceElevation = groundElevation;
    }
    if (placeDistance < (place.kind === "city" ? 420 : 84) && water === "none") {
      groundMaterial = "Settlement";
      surfaceMaterial = "Settlement";
      reservedUse = place.kind;
    }
    vegetationExcluded = vegetationExcluded || placeDistance < placeRadius + 12;
    contributions.push(
      contribution(priority, place.code, [
        "elevation",
        "material",
        "vegetation",
        "reserved-use",
        "walkability",
      ]),
    );
  }

  const road = roadAt(x, z);
  let roadCandidate = false;
  if (road) {
    roadCandidate = true;
    const distance = roadDistanceAt(x, z, road),
      roadWeight = 1 - smooth(clamp01((distance - 5) / 7));
    if (distance < 12) {
      vegetationExcluded = true;
      if (water !== "none" && distance <= 5) {
        // The ground/water channel remains hydrology truth. The priority-8 road
        // contributes a legal deck as the player-relevant surface instead of
        // silently filling the river/lake/ocean.
        surfaceElevation = Math.max(3, groundElevation + 0.35);
        surfaceMaterial = "Bridge";
        reservedUse = "bridge";
      } else if (water === "none") {
        // The full graded support corridor is reserved by the road and therefore
        // remains legally walkable. Only the <=5-unit core receives the road
        // material; shoulders keep the underlying material while inheriting the
        // priority-8 right-of-way and grading.
        reservedUse = "road";
        groundElevation = lerp(groundElevation, 3, roadWeight);
        surfaceElevation = groundElevation;
        if (distance <= 5) {
          groundMaterial = "Road";
          surfaceMaterial = "Road";
        }
      }
      contributions.push(
        contribution(WORLD_BUILDING_PRIORITY.road, road.code, [
          "elevation",
          "material",
          "vegetation",
          "reserved-use",
          "walkability",
        ]),
      );
    }
  }

  const candidates = Number(riverCandidate) + Number(Boolean(place)) + Number(roadCandidate);
  candidateModifiersExamined += candidates;
  maxCandidateModifiers = Math.max(maxCandidateModifiers, candidates);
  contributions.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  return Object.freeze({
    x,
    z,
    naturalElevation,
    groundElevation,
    surfaceElevation,
    groundMaterial,
    surfaceMaterial,
    water,
    flow,
    vegetationExcluded,
    reservedUse,
    contributions: Object.freeze(contributions),
  });
}

/**
 * Fast channel-selective adapter used by render/material generation. It is the
 * same compositor as finalSurfaceAt; it merely omits the neighbouring samples
 * needed to derive slope-based walkability.
 */
export function composedSurfaceAt(x: number, z: number): ComposedSurface {
  coreQueries++;
  const key = cacheKey(x, z),
    started = nowMs();
  if (key) {
    const hit = coreCache.get(key);
    if (hit) {
      cacheHits++;
      worstQueryMs = Math.max(worstQueryMs, nowMs() - started);
      return hit;
    }
    cacheMisses++;
  }
  const result = composeUncached(x, z);
  if (key) insertBounded(coreCache, key, result, CORE_CACHE_LIMIT);
  worstQueryMs = Math.max(worstQueryMs, nowMs() - started);
  return result;
}

/** One player-relevant final surface: collision, traversal and inspection derive
 * from the same composed ground/deck/material/water/reservation channels. */
export function finalSurfaceAt(x: number, z: number): FinalSurfaceSample {
  finalQueries++;
  const key = cacheKey(x, z),
    started = nowMs();
  if (key) {
    const hit = finalCache.get(key);
    if (hit) {
      cacheHits++;
      worstQueryMs = Math.max(worstQueryMs, nowMs() - started);
      return hit;
    }
    cacheMisses++;
  }
  const surface = composedSurfaceAt(x, z),
    east = composedSurfaceAt(x + 1, z),
    west = composedSurfaceAt(x - 1, z),
    north = composedSurfaceAt(x, z - 1),
    south = composedSurfaceAt(x, z + 1),
    slopeM = Math.max(
      Math.abs(east.groundElevation - west.groundElevation),
      Math.abs(south.groundElevation - north.groundElevation),
    ),
    privileged = surface.reservedUse === "road" || surface.reservedUse === "bridge",
    walkable =
      privileged ||
      (surface.water === "none" && surface.surfaceElevation > 0.1 && slopeM < 2),
    result = Object.freeze({ ...surface, slopeM, walkable });
  if (key) insertBounded(finalCache, key, result, FINAL_CACHE_LIMIT);
  worstQueryMs = Math.max(worstQueryMs, nowMs() - started);
  return result;
}

export function clearFinalSurfaceCache() {
  coreCache.clear();
  finalCache.clear();
}

export function resetFinalSurfaceTelemetry() {
  coreQueries = 0;
  finalQueries = 0;
  cacheHits = 0;
  cacheMisses = 0;
  candidateModifiersExamined = 0;
  maxCandidateModifiers = 0;
  worstQueryMs = 0;
  evictions = 0;
}

export function finalSurfaceStats() {
  return Object.freeze({
    coreQueries,
    finalQueries,
    cacheHits,
    cacheMisses,
    cacheEntries: coreCache.size + finalCache.size,
    cacheLimit: CORE_CACHE_LIMIT + FINAL_CACHE_LIMIT,
    candidateModifiersExamined,
    maxCandidateModifiers,
    worstQueryMs,
    evictions,
  });
}
