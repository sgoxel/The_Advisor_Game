import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  countryAtPosition,
  nearestPlace,
  roadAt,
  roadDistanceAt,
  roads,
  villages,
} from "./geography.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  SOURCE_PRESENTATION_POLE_DISTANCE,
  SOURCE_PRESENTATION_RADIUS,
  sourceToLonLat,
  wrapSourceX,
} from "./planet.ts";

/**
 * Canonical world-building precedence. Higher priorities may alter channels
 * established by lower priorities, but stable ASCII IDs decide ties.
 * Presentation, renderer backend, tile visit order and LOD never participate.
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
  | "building-pad"
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
  | "walkability"
  | "affiliation";

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
  countryCode: string | null;
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

const TAU = Math.PI * 2;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const quantizeCm = (value: number) => Math.round(value * 100) / 100;
const asciiCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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

function addressedUnit(address: string) {
  return digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/FINAL/${address}`) / 4294967296;
}

/** Continuous SEED-addressed detail field on the unit sphere. */
function sphericalField(x: number, z: number, frequency: number, layer: number) {
  const position = sourceToLonLat(x, z),
    cosLat = Math.cos(position.lat),
    px = cosLat * Math.cos(position.lon),
    py = Math.sin(position.lat),
    pz = cosLat * Math.sin(position.lon),
    phaseA = addressedUnit(`FIELD/${layer}/A`) * TAU,
    phaseB = addressedUnit(`FIELD/${layer}/B`) * TAU,
    phaseC = addressedUnit(`FIELD/${layer}/C`) * TAU,
    a = Math.sin((px * 1.3 + py * 0.7 + pz * 1.1) * frequency + phaseA),
    b = Math.cos((px * 0.6 - py * 1.4 + pz * 1.7) * frequency * 0.63 + phaseB),
    c = Math.sin((px * 1.8 + py * 1.2 - pz * 0.5) * frequency * 0.31 + phaseC);
  return clamp01(0.5 + a * 0.24 + b * 0.17 + c * 0.09);
}

/** Priority-4 prototype river centreline. Hydrology generation may replace this
 * input later without changing the composition contract. */
export function composedRiverX(z: number): number {
  return 125 + 42 * Math.sin(z / 150) + 18 * Math.sin(z / 57);
}

function canonicalCoordinates(x: number, z: number) {
  return {
    x: wrapSourceX(x),
    z: Math.max(
      -SOURCE_PRESENTATION_POLE_DISTANCE,
      Math.min(SOURCE_PRESENTATION_POLE_DISTANCE, z),
    ),
  };
}

function cacheKey(x: number, z: number) {
  // Local terrain/collision samples repeatedly hit the half-unit lattice. Globe
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

type NaturalBase = Readonly<{
  elevation: number;
  material: string;
  macro: ReturnType<typeof macroSampleAt>;
}>;

function naturalBaseAt(x: number, z: number): NaturalBase {
  const position = sourceToLonLat(x, z),
    macro = macroSampleAt(position);
  if (macro.domain === "Ocean")
    return Object.freeze({ elevation: -2.8, material: "Ocean", macro });
  if (macro.domain === "Lake")
    return Object.freeze({ elevation: -1.8, material: "Lake", macro });

  const localA = sphericalField(x, z, macro.domain === "Island" ? 31 : 13, 1),
    localB = sphericalField(x, z, macro.domain === "Island" ? 71 : 39, 2),
    reliefVariation = 0.88 + 0.12 * sphericalField(x, z, 21, 3),
    base =
      macro.domain === "Island"
        ? 3 + localA * 12
        : 3 + localA * 9 + localB * 2,
    macroRelief = macro.reliefM * reliefVariation,
    cap = macro.domain === "Island" ? 180 : 620,
    terrain = Math.min(cap, base + macroRelief),
    coastSource = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS,
    elevation = quantizeCm(
      lerp(-2.8, terrain, smooth(clamp01((coastSource + 2) / 10))),
    );

  let material: string;
  if (macro.domain === "Island") {
    if (elevation < 0.1) material = "Ocean";
    else if (coastSource < 9) material = "Sandy beach";
    else if (macro.volcanic && macro.mountainIntensity > 0.16)
      material = "Volcanic highlands";
    else if (macro.mountainIntensity > 0.12 || elevation > 70) material = "Highlands";
    else material = "Island meadow";
  } else if (macro.volcanic && macro.mountainIntensity > 0.16)
    material = "Volcanic highlands";
  else if (macro.mountainIntensity > 0.1 || elevation > 70) material = "Highlands";
  else material = sphericalField(x, z, 47, 4) > 0.45 ? "Woodland" : "Meadow";
  return Object.freeze({ elevation, material, macro });
}

type Place = NonNullable<ReturnType<typeof nearestPlace>>;
type PadDescriptor = Readonly<{
  code: string;
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
}>;
type PadHit = Readonly<PadDescriptor & { influence: number; core: boolean }>;

function ringHousePad(place: Place, index: number): PadDescriptor {
  const sx = Math.floor(place.x / 2),
    sz = Math.floor(place.z / 2),
    value = digest(`${SEED_VALUE}/${sx}/${sz}/${20 + index}`),
    side = index % 2 === 0 ? -1 : 1,
    x = place.x + (index < 10 ? side * (15 + (value % 6)) : (index - 14) * 13),
    z =
      place.z +
      (index < 10
        ? (Math.floor(index / 2) - 2) * 14
        : side * (42 + (value % 5))),
    width = 6 + (value % 3),
    depth = 7 + ((value >>> 4) % 3);
  return Object.freeze({
    code: `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/F/${place.id}/${place.kind}/house/${index}`,
    x,
    z,
    halfWidth: width / 2,
    halfDepth: depth / 2,
  });
}

function urbanHousePad(place: Place, index: number): PadDescriptor {
  const sx = Math.floor(place.x / 2),
    sz = Math.floor(place.z / 2),
    gx = ((index % 20) - 9.5) * 29,
    gz = (Math.floor(index / 20) - 9.5) * 29,
    value = digest(`${SEED_VALUE}/${sx}/${sz}/${80 + index}`),
    width = 6 + (value % 3),
    depth = 7 + ((value >>> 4) % 3);
  return Object.freeze({
    code: `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/F/${place.id}/urban-house/${index}`,
    x: place.x + gx,
    z: place.z + gz,
    halfWidth: width / 2,
    halfDepth: depth / 2,
  });
}

function padHitAt(x: number, z: number, place: Place): PadHit | null {
  const usablePerimeter = 2,
    falloff = 6;
  let best: PadHit | null = null;
  const consider = (pad: PadDescriptor) => {
    const dx = Math.abs(wrapSourceX(x - pad.x)),
      dz = Math.abs(z - pad.z),
      edgeX = Math.max(0, dx - (pad.halfWidth + usablePerimeter)),
      edgeZ = Math.max(0, dz - (pad.halfDepth + usablePerimeter)),
      outside = Math.hypot(edgeX, edgeZ);
    if (outside >= falloff) return;
    const core = edgeX === 0 && edgeZ === 0,
      influence = core ? 1 : 1 - smooth(clamp01(outside / falloff)),
      hit = Object.freeze({ ...pad, influence, core });
    if (
      !best ||
      influence > best.influence ||
      (influence === best.influence && asciiCompare(pad.code, best.code) < 0)
    )
      best = hit;
  };

  // Keep and house footprints are deterministic presentation assets already in
  // world.ts. Their pads use the same IDs/anchors, so terrain support is not
  // owned by whichever tile happens to render the structure.
  consider(
    Object.freeze({
      code: `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/F/${place.id}/${place.kind}/keep`,
      x: place.x - 30,
      z: place.z - 28,
      halfWidth: 8,
      halfDepth: 7.5,
    }),
  );
  for (let index = 0; index < 18; index++) consider(ringHousePad(place, index));

  if (place.kind === "city") {
    const localX = wrapSourceX(x - place.x),
      localZ = z - place.z,
      ix = Math.round(localX / 29 + 9.5),
      iz = Math.round(localZ / 29 + 9.5);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx,
          cz = iz + dz;
        if (cx < 0 || cx >= 20 || cz < 0 || cz >= 20) continue;
        const gx = (cx - 9.5) * 29,
          gz = (cz - 9.5) * 29;
        if (Math.abs(gx) <= 40 && Math.abs(gz) <= 55) continue;
        consider(urbanHousePad(place, cz * 20 + cx));
      }
  }
  return best;
}

function roadProfileAt(
  road: NonNullable<ReturnType<typeof roadAt>>,
  x: number,
  z: number,
) {
  const start = naturalBaseAt(road.fromX, road.fromZ).elevation,
    end = naturalBaseAt(road.toX, road.toZ).elevation,
    dx = road.toX - road.fromX,
    dz = road.toZ - road.fromZ,
    px = road.fromX + wrapSourceX(x - road.fromX),
    lengthSq = dx * dx + dz * dz || 1,
    t = clamp01(((px - road.fromX) * dx + (z - road.fromZ) * dz) / lengthSq);
  return quantizeCm(lerp(start, end, t));
}

function composeUncached(x: number, z: number): ComposedSurface {
  const position = sourceToLonLat(x, z),
    natural = naturalBaseAt(x, z),
    macro = natural.macro,
    contributions: SurfaceContribution[] = [];

  if (macro.domain === "Ocean")
    contributions.push(
      contribution(WORLD_BUILDING_PRIORITY.ocean, `${macro.code}/OCEAN`, [
        "elevation",
        "material",
        "water",
        "vegetation",
        "walkability",
      ]),
    );
  else if (macro.domain === "Lake")
    contributions.push(
      contribution(WORLD_BUILDING_PRIORITY.hydrology, `${macro.code}/LAKE`, [
        "elevation",
        "material",
        "water",
        "vegetation",
        "walkability",
      ]),
    );
  else
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

  let groundElevation = natural.elevation,
    surfaceElevation = natural.elevation,
    groundMaterial = natural.material,
    surfaceMaterial = natural.material,
    water: SurfaceWater =
      macro.domain === "Ocean" ? "ocean" : macro.domain === "Lake" ? "lake" : "none",
    flow: { x: number; z: number } | null = null,
    vegetationExcluded = water !== "none",
    reservedUse: SurfaceReservedUse = "none";

  // Priority 4: river carving is reduced before settlements and roads. The
  // riverbed remains authoritative beneath any later priority-8 bridge deck.
  let riverCandidate = false;
  if (macro.domain === "Mainland") {
    const bank = Math.abs(wrapSourceX(x - composedRiverX(z)));
    if (bank < 31) {
      riverCandidate = true;
      const riverBlend = smooth(clamp01((bank - 12) / 19));
      groundElevation = quantizeCm(lerp(-2.8, groundElevation, riverBlend));
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
        contribution(
          WORLD_BUILDING_PRIORITY.hydrology,
          `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/RIVER`,
          ["elevation", "material", "water", "flow", "vegetation", "walkability"],
        ),
      );
    }
  }

  // Priority 5 is affiliation only; political ownership never flattens land.
  const country = countryAtPosition(position),
    countryCode = country?.code ?? null;
  if (countryCode)
    contributions.push(
      contribution(WORLD_BUILDING_PRIORITY.country, countryCode, ["affiliation"]),
    );

  const place = nearestPlace(x, z),
    placeDistance = place
      ? Math.hypot(wrapSourceX(x - place.x), z - place.z)
      : Infinity,
    placeRadius = place?.kind === "city" ? 430 : 90,
    placeWeight = place ? 1 - smooth(clamp01((placeDistance - placeRadius) / 80)) : 0;
  let pad: PadHit | null = null;
  if (place && placeWeight > 0) {
    const priority =
      place.kind === "city"
        ? WORLD_BUILDING_PRIORITY.city
        : WORLD_BUILDING_PRIORITY.village;
    if (placeDistance < (place.kind === "city" ? 420 : 84) && water === "none")
      reservedUse = place.kind;
    // Broad settlement land use clears conflicting natural scatter but does not
    // replace climate/ground material or flatten an entire city/village disc.
    vegetationExcluded = vegetationExcluded || placeDistance < placeRadius + 12;
    contributions.push(
      contribution(priority, place.code, ["vegetation", "reserved-use", "walkability"]),
    );

    if (water === "none") {
      pad = padHitAt(x, z, place);
      if (pad) {
        const target = naturalBaseAt(pad.x, pad.z).elevation,
          // C4: a home pad never cuts/fills more than 3 vertical metres at a
          // sample. Existing accepted low-relief sites make the usable core flat;
          // the support falloff blends deterministically into neighboring ground.
          boundedTarget = Math.max(
            groundElevation - 3,
            Math.min(groundElevation + 3, target),
          );
        groundElevation = quantizeCm(
          lerp(groundElevation, boundedTarget, pad.influence),
        );
        surfaceElevation = groundElevation;
        vegetationExcluded = true;
        if (pad.core) {
          groundMaterial = "Prepared ground";
          surfaceMaterial = "Prepared ground";
          reservedUse = "building-pad";
        }
        contributions.push(
          contribution(priority, pad.code, [
            "elevation",
            "material",
            "vegetation",
            "reserved-use",
            "walkability",
          ]),
        );
      }
    }
  }

  const road = roadAt(x, z);
  let roadCandidate = false;
  if (road) {
    roadCandidate = true;
    const distance = roadDistanceAt(x, z, road),
      roadWeight = 1 - smooth(clamp01((distance - 5) / 7));
    if (distance < 12 && reservedUse !== "building-pad") {
      vegetationExcluded = true;
      if (water === "river" && distance <= 5) {
        // Ground/water remain hydrology truth. The road contributes an explicit
        // elevated traversal surface instead of painting dirt across the river.
        const profile = roadProfileAt(road, x, z);
        surfaceElevation = quantizeCm(Math.max(profile, groundElevation + 1));
        surfaceMaterial = "Bridge";
        reservedUse = "bridge";
      } else if (water === "none") {
        const profile = roadProfileAt(road, x, z),
          // C4 cut/fill ceilings. If the accepted centerline needs more than this,
          // later transport planning can reroute it without changing this reducer.
          boundedProfile = Math.max(
            groundElevation - 4,
            Math.min(groundElevation + 3, profile),
          );
        reservedUse = "road";
        groundElevation = quantizeCm(
          lerp(groundElevation, boundedProfile, roadWeight),
        );
        surfaceElevation = groundElevation;
        if (distance <= 5) {
          groundMaterial = "Dirt foundation";
          surfaceMaterial = "Road";
        } else if (distance <= 7) {
          groundMaterial = "Road shoulder";
          surfaceMaterial = "Road shoulder";
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

  const candidates =
    Number(riverCandidate) + Number(Boolean(place)) + Number(Boolean(pad)) + Number(roadCandidate);
  candidateModifiersExamined += candidates;
  maxCandidateModifiers = Math.max(maxCandidateModifiers, candidates);
  contributions.sort(
    (a, b) => a.priority - b.priority || asciiCompare(a.id, b.id),
  );

  return Object.freeze({
    x,
    z,
    naturalElevation: natural.elevation,
    groundElevation,
    surfaceElevation,
    groundMaterial,
    surfaceMaterial,
    water,
    flow,
    vegetationExcluded,
    reservedUse,
    countryCode,
    contributions: Object.freeze(contributions),
  });
}

/**
 * Fast channel-selective adapter used by render/material generation. It is the
 * same compositor as finalSurfaceAt; it merely omits neighbouring samples needed
 * to derive slope-based walkability.
 */
export function composedSurfaceAt(x: number, z: number): ComposedSurface {
  coreQueries++;
  const canonical = canonicalCoordinates(x, z),
    key = cacheKey(canonical.x, canonical.z),
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
  const result = composeUncached(canonical.x, canonical.z);
  if (key) insertBounded(coreCache, key, result, CORE_CACHE_LIMIT);
  worstQueryMs = Math.max(worstQueryMs, nowMs() - started);
  return result;
}

/** One player-relevant final surface: collision, traversal and inspection derive
 * from the same composed ground/deck/material/water/reservation channels. */
export function finalSurfaceAt(x: number, z: number): FinalSurfaceSample {
  finalQueries++;
  const canonical = canonicalCoordinates(x, z),
    key = cacheKey(canonical.x, canonical.z),
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
  const surface = composedSurfaceAt(canonical.x, canonical.z),
    east = composedSurfaceAt(canonical.x + 1, canonical.z),
    west = composedSurfaceAt(canonical.x - 1, canonical.z),
    north = composedSurfaceAt(canonical.x, canonical.z - 1),
    south = composedSurfaceAt(canonical.x, canonical.z + 1),
    slopeM = quantizeCm(
      Math.max(
        Math.abs(east.groundElevation - west.groundElevation),
        Math.abs(south.groundElevation - north.groundElevation),
      ),
    ),
    privileged =
      surface.reservedUse === "road" ||
      surface.reservedUse === "bridge" ||
      surface.reservedUse === "building-pad",
    walkable =
      privileged ||
      (surface.water === "none" && surface.surfaceElevation > 0.1 && slopeM < 2),
    result = Object.freeze({ ...surface, slopeM, walkable });
  if (key) insertBounded(finalCache, key, result, FINAL_CACHE_LIMIT);
  worstQueryMs = Math.max(worstQueryMs, nowMs() - started);
  return result;
}

/** Deterministic anchors used by tests/inspection to make the road cut and a
 * prepared home pad directly discoverable without camera-dependent searching. */
export function finalSurfaceEvidenceExamples() {
  const road = roads[0],
    village = villages[0],
    roadCandidates = Array.from({ length: 11 }, (_, index) => {
      const t = index / 10,
        x = road.fromX + (road.toX - road.fromX) * t,
        z = road.fromZ + (road.toZ - road.fromZ) * t,
        natural = naturalBaseAt(x, z).elevation,
        profile = roadProfileAt(road, x, z);
      return { x: wrapSourceX(x), z, delta: Math.abs(natural - profile) };
    }),
    roadCut = roadCandidates.sort(
      (a, b) => b.delta - a.delta || a.x - b.x || a.z - b.z,
    )[0],
    homeCandidates = Array.from({ length: 18 }, (_, index) => {
      const pad = ringHousePad(village, index),
        east = naturalBaseAt(pad.x + 2, pad.z).elevation,
        west = naturalBaseAt(pad.x - 2, pad.z).elevation,
        north = naturalBaseAt(pad.x, pad.z - 2).elevation,
        south = naturalBaseAt(pad.x, pad.z + 2).elevation;
      return {
        x: pad.x,
        z: pad.z,
        code: pad.code,
        slope: Math.max(Math.abs(east - west), Math.abs(south - north)),
      };
    }),
    hillsideHome = homeCandidates.sort(
      (a, b) => b.slope - a.slope || asciiCompare(a.code, b.code),
    )[0];
  return Object.freeze({
    roadCut: Object.freeze({ ...roadCut, code: road.code }),
    hillsideHome: Object.freeze(hillsideHome),
  });
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
