/**
 * Unified world-surface compositor (WP-S002-004-012).
 *
 * One SEED-owned plan answers final elevation, ground material, vegetation
 * exclusion, water, reserved use and walkability for every consumer (terrain
 * meshes, vegetation scatter, cell inspection, route cost). Natural layers
 * (priorities 0-5) come from the macro/natural height authority; bounded
 * earthwork modifiers (6 cities, 7 villages, 8 roads) are composed on top in
 * canonical (priority, channel, SEED code) order. Caches only memoise pure
 * values; they never decide terrain or identity, so visit order cannot matter.
 */
import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import { SOURCE_PRESENTATION_WIDTH, wrapSourceX } from "./planet.ts";
import { places, roads } from "./geography.ts";

/** Exact owner 0-9 semantic mapping (docs/WORLD_BUILDING_PRIORITY.md). */
export const WORLD_PRIORITIES = [
  { priority: 0, key: "oceans", label: "Oceans" },
  { priority: 1, key: "continents", label: "Continents" },
  { priority: 2, key: "islands", label: "Islands" },
  { priority: 3, key: "natural-biomes", label: "Forests, deserts, grasslands and mountains" },
  { priority: 4, key: "fresh-water", label: "Lakes and rivers" },
  { priority: 5, key: "countries", label: "Countries" },
  { priority: 6, key: "cities", label: "Capital cities and big cities" },
  { priority: 7, key: "villages", label: "Villages" },
  { priority: 8, key: "roads", label: "Roads" },
  { priority: 9, key: "critical-sites", label: "Ruins and critical quest places" },
] as const;

/** Composition channels, applied per modifier in this fixed order. */
export const SURFACE_CHANNELS = [
  "elevation",
  "water",
  "material",
  "vegetation",
  "reserved",
  "walkability",
] as const;

export type SurfaceMaterial =
  | "natural"
  | "water"
  | "prepared-ground"
  | "road-surface"
  | "dirt-foundation"
  | "earthwork-cut"
  | "earthwork-fill"
  | "bridge-deck";
export type ReservedUse = "none" | "city" | "village" | "road" | "bridge";
export type SurfaceWalk = "road" | "bridge" | "open" | "blocked";

/** Versioned earthwork limits in source units (product targets, not engineering standards). */
export const EARTHWORK_LIMITS = {
  roadSurfaceHalfWidth: 4,
  roadFoundationHalfWidth: 5,
  roadShoulderHalfWidth: 6,
  roadFalloffMin: 4,
  roadFalloffMax: 14,
  /** Falloff width per unit of cut/fill depth (about 1:1.5 side slope). */
  roadFalloffPerDepth: 1.5,
  roadStationSpacing: 8,
  /** Profile smoothing half-window in stations (±32 units): near-flat grade. */
  roadProfileWindow: 4,
  /** Bridge deck/roadbed never sits below this height (water is near 0). */
  roadMinimumHeight: 3,
  villagePadRadius: 90,
  cityPadRadius: 430,
  padFalloff: 80,
  vegetationClearance: 10,
  waterLevel: 0.1,
} as const;

type ModifierBase = {
  code: string;
  priority: 6 | 7 | 8;
  /** Canonical rank in the global (priority, code) order. */
  rank: number;
  /** Support bounds including falloff, in source x relative to anchorX (unwrapped) and absolute z. */
  minDX: number;
  maxDX: number;
  minZ: number;
  maxZ: number;
  anchorX: number;
};
export type PadModifier = ModifierBase & {
  kind: "city" | "village";
  z: number;
  radius: number;
  falloff: number;
  placeId: string;
};
export type RoadModifier = ModifierBase & {
  kind: "road";
  z: number;
  /** Signed source span from anchorX (fromX) to the road end. */
  extent: number;
  roadIndex: number;
};
export type SurfaceModifier = PadModifier | RoadModifier;

export type NaturalSampler = (x: number, z: number) => number;

export type SurfaceContribution = {
  code: string;
  priority: number;
  kind: SurfaceModifier["kind"];
  weight: number;
  targetHeight: number;
};
export type SurfaceSample = {
  naturalHeight: number;
  height: number;
  /** height - naturalHeight: positive fill, negative cut. Zero outside support. */
  cutFill: number;
  material: SurfaceMaterial;
  water: boolean;
  vegetationExcluded: boolean;
  reservedUse: ReservedUse;
  walk: SurfaceWalk;
  bridge: boolean;
  /** Deck height when a road crosses water; otherwise equals height. */
  deckHeight: number;
  modifiers: SurfaceContribution[];
};

const L = EARTHWORK_LIMITS;
const smooth = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const byCanonicalCode = (a: { priority: number; code: string }, b: { priority: number; code: string }) =>
  a.priority - b.priority || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

const BUCKET = 2048;
const COLUMNS = SOURCE_PRESENTATION_WIDTH / BUCKET;

let modifiers: SurfaceModifier[] | undefined;
const buckets = new Map<string, SurfaceModifier[]>();
const stationCache = new Map<string, number>();
const padHeightCache = new Map<string, number>();
const STATION_CACHE_LIMIT = 60_000;

export const compositorStats = {
  queries: 0,
  modifierHits: 0,
  stationComputations: 0,
  indexBuilds: 0,
  cacheClears: 0,
};

/** The SEED-derived modifier plan, built lazily once and ranked canonically. */
export function surfaceModifiers(): readonly SurfaceModifier[] {
  if (modifiers) return modifiers;
  const plan: SurfaceModifier[] = [];
  for (const place of places) {
    const radius = place.kind === "city" ? L.cityPadRadius : L.villagePadRadius,
      reach = radius + L.padFalloff;
    plan.push({
      kind: place.kind,
      code: `${place.code}/PAD`,
      priority: place.kind === "city" ? 6 : 7,
      rank: 0,
      anchorX: place.x,
      z: place.z,
      radius,
      falloff: L.padFalloff,
      placeId: place.id,
      minDX: -reach,
      maxDX: reach,
      minZ: place.z - reach,
      maxZ: place.z + reach,
    });
  }
  roads.forEach((road, roadIndex) => {
    const reach = L.roadShoulderHalfWidth + L.roadFalloffMax,
      extent = road.toX - road.fromX;
    plan.push({
      kind: "road",
      code: `${road.code}/EARTHWORK`,
      priority: 8,
      rank: 0,
      anchorX: road.fromX,
      z: road.z,
      extent,
      roadIndex,
      minDX: Math.min(0, extent) - reach,
      maxDX: Math.max(0, extent) + reach,
      minZ: road.z - reach,
      maxZ: road.z + reach,
    });
  });
  plan.sort(byCanonicalCode);
  plan.forEach((modifier, rank) => (modifier.rank = rank));
  // Full-support spatial index, wrapped into the canonical column ring so a
  // modifier anchored in a neighbouring tile/seam column is always found.
  for (const modifier of plan) {
    const c0 = Math.floor((modifier.anchorX + modifier.minDX) / BUCKET),
      c1 = Math.floor((modifier.anchorX + modifier.maxDX) / BUCKET),
      r0 = Math.floor(modifier.minZ / BUCKET),
      r1 = Math.floor(modifier.maxZ / BUCKET);
    for (let c = c0; c <= Math.min(c1, c0 + COLUMNS - 1); c++)
      for (let r = r0; r <= r1; r++) {
        const key = `${((c % COLUMNS) + COLUMNS) % COLUMNS}/${r}`,
          bucket = buckets.get(key) || [];
        if (!bucket.includes(modifier)) bucket.push(modifier);
        buckets.set(key, bucket);
      }
  }
  for (const bucket of buckets.values()) bucket.sort((a, b) => a.rank - b.rank);
  compositorStats.indexBuilds++;
  modifiers = plan;
  return plan;
}

/** Modifiers whose full support (including falloff) contains the point, in canonical order. */
export function modifiersAt(x: number, z: number): SurfaceModifier[] {
  surfaceModifiers();
  const wx = wrapSourceX(x),
    column = ((Math.floor(wx / BUCKET) % COLUMNS) + COLUMNS) % COLUMNS,
    bucket = buckets.get(`${column}/${Math.floor(z / BUCKET)}`);
  if (!bucket) return [];
  const result: SurfaceModifier[] = [];
  for (const modifier of bucket) {
    if (z < modifier.minZ || z > modifier.maxZ) continue;
    const dx = wrapSourceX(wx - modifier.anchorX);
    if (dx >= modifier.minDX && dx <= modifier.maxDX) result.push(modifier);
  }
  return result;
}

/** Fast reserved-use lookup for route cost (no height evaluation). */
export function reservedUseAt(x: number, z: number): ReservedUse {
  let use: ReservedUse = "none";
  for (const modifier of modifiersAt(x, z)) {
    if (modifier.kind === "road") {
      const { along, across } = roadFrame(modifier, x, z);
      if (Math.hypot(along, across) <= L.roadShoulderHalfWidth) use = "road";
    } else if (padDistance(modifier, x, z) <= modifier.radius) use = modifier.kind;
  }
  return use;
}

function padDistance(pad: PadModifier, x: number, z: number) {
  return Math.hypot(wrapSourceX(x - pad.anchorX), z - pad.z);
}
/** along: distance outside the road's end span (0 inside); across: |z - road z|. */
function roadFrame(road: RoadModifier, x: number, z: number) {
  const dx = wrapSourceX(x - road.anchorX),
    lo = Math.min(0, road.extent),
    hi = Math.max(0, road.extent);
  return {
    along: dx < lo ? lo - dx : dx > hi ? dx - hi : 0,
    across: Math.abs(z - road.z),
    distance: Math.max(0, Math.min(Math.abs(road.extent), Math.abs(dx))),
  };
}

function padTargetHeight(pad: PadModifier, natural: NaturalSampler) {
  let height = padHeightCache.get(pad.code);
  if (height === undefined) {
    const r = pad.radius * 0.5;
    height =
      (natural(pad.anchorX, pad.z) * 2 +
        natural(pad.anchorX + r, pad.z) +
        natural(pad.anchorX - r, pad.z) +
        natural(pad.anchorX, pad.z + r) +
        natural(pad.anchorX, pad.z - r)) /
      6;
    height = Math.max(L.roadMinimumHeight, height);
    padHeightCache.set(pad.code, height);
  }
  return height;
}

/** Height after natural layers and settlement pads only (priorities 0-7). */
function padComposedHeight(x: number, z: number, natural: NaturalSampler) {
  let height = natural(x, z);
  if (height < L.waterLevel) return height;
  for (const modifier of modifiersAt(x, z)) {
    if (modifier.kind === "road") continue;
    const weight = padWeight(modifier, x, z);
    if (weight > 0) height = lerp(height, padTargetHeight(modifier, natural), weight);
  }
  return height;
}
function padWeight(pad: PadModifier, x: number, z: number) {
  return 1 - smooth((padDistance(pad, x, z) - pad.radius) / pad.falloff);
}

function stationHeight(road: RoadModifier, index: number, natural: NaturalSampler) {
  const key = `${road.rank}/${index}`;
  let height = stationCache.get(key);
  if (height === undefined) {
    const length = Math.abs(road.extent),
      sign = road.extent < 0 ? -1 : 1;
    let sum = 0,
      count = 0;
    for (let k = -L.roadProfileWindow; k <= L.roadProfileWindow; k++) {
      const s = Math.max(0, Math.min(length, (index + k) * L.roadStationSpacing));
      sum += Math.max(L.roadMinimumHeight, padComposedHeight(road.anchorX + sign * s, road.z, natural));
      count++;
    }
    height = sum / count;
    if (stationCache.size >= STATION_CACHE_LIMIT) {
      stationCache.clear();
      compositorStats.cacheClears++;
    }
    stationCache.set(key, height);
    compositorStats.stationComputations++;
  }
  return height;
}

/** Graded road profile at a distance along the centreline (canonical stations). */
export function roadProfileHeight(road: RoadModifier, distance: number, natural: NaturalSampler) {
  const t = Math.max(0, Math.min(Math.abs(road.extent), distance)) / L.roadStationSpacing,
    i = Math.floor(t);
  return lerp(stationHeight(road, i, natural), stationHeight(road, i + 1, natural), t - i);
}

/** Full composed surface sample: the single answer every consumer reads. */
export function surfaceSampleAt(x: number, z: number, natural: NaturalSampler): SurfaceSample {
  compositorStats.queries++;
  const naturalHeight = natural(x, z),
    water = naturalHeight < L.waterLevel,
    sample: SurfaceSample = {
      naturalHeight,
      height: naturalHeight,
      cutFill: 0,
      material: water ? "water" : "natural",
      water,
      vegetationExcluded: false,
      reservedUse: "none",
      walk: water ? "blocked" : "open",
      bridge: false,
      deckHeight: naturalHeight,
      modifiers: [],
    };
  for (const modifier of modifiersAt(x, z)) {
    compositorStats.modifierHits++;
    if (modifier.kind === "road") {
      const { along, across, distance } = roadFrame(modifier, x, z),
        target = roadProfileHeight(modifier, distance, natural),
        depth = Math.abs(sample.height - target),
        falloff = Math.max(
          L.roadFalloffMin,
          Math.min(L.roadFalloffMax, depth * L.roadFalloffPerDepth),
        ),
        offset = Math.hypot(along, across),
        weight = 1 - smooth((offset - L.roadShoulderHalfWidth) / falloff);
      if (weight <= 0) continue;
      sample.modifiers.push({ code: modifier.code, priority: 8, kind: "road", weight, targetHeight: target });
      if (water) {
        // Legal crossing: a bridge deck over unchanged water, never dirt fill.
        if (offset <= L.roadShoulderHalfWidth) {
          sample.bridge = true;
          sample.deckHeight = target;
          sample.material = "bridge-deck";
          sample.reservedUse = "bridge";
          sample.walk = "bridge";
        }
        continue;
      }
      sample.height = lerp(sample.height, target, weight);
      if (offset <= L.roadSurfaceHalfWidth) sample.material = "road-surface";
      else if (offset <= L.roadShoulderHalfWidth) sample.material = "dirt-foundation";
      if (offset <= L.roadShoulderHalfWidth) {
        sample.reservedUse = "road";
        sample.walk = "road";
      }
      if (offset <= L.roadShoulderHalfWidth + L.vegetationClearance / 2 + falloff * 0.5)
        sample.vegetationExcluded = true;
    } else {
      const weight = padWeight(modifier, x, z);
      if (weight <= 0) continue;
      const target = padTargetHeight(modifier, natural),
        distance = padDistance(modifier, x, z);
      sample.modifiers.push({
        code: modifier.code,
        priority: modifier.priority,
        kind: modifier.kind,
        weight,
        targetHeight: target,
      });
      if (water) continue; // Pads never dam rivers, lakes or sea.
      sample.height = lerp(sample.height, target, weight);
      if (distance <= modifier.radius) {
        sample.material = "prepared-ground";
        sample.reservedUse = modifier.kind;
        sample.walk = "open";
      }
      if (distance <= modifier.radius + L.vegetationClearance) sample.vegetationExcluded = true;
    }
  }
  sample.cutFill = sample.height - naturalHeight;
  if (!sample.bridge) sample.deckHeight = sample.height;
  if (
    !water &&
    (sample.material === "natural" || sample.material === "prepared-ground") &&
    sample.modifiers.length &&
    Math.abs(sample.cutFill) > 0.6 &&
    sample.reservedUse === "none"
  ) {
    sample.material = sample.cutFill < 0 ? "earthwork-cut" : "earthwork-fill";
    sample.vegetationExcluded = true;
  }
  return sample;
}

/** Hot path for mesh vertices: final height without building contribution records. */
export function surfaceHeightAt(x: number, z: number, natural: NaturalSampler): number {
  const found = modifiersAt(x, z);
  const naturalHeight = natural(x, z);
  if (!found.length || naturalHeight < L.waterLevel) return naturalHeight;
  let height = naturalHeight;
  for (const modifier of found) {
    if (modifier.kind === "road") {
      const { along, across, distance } = roadFrame(modifier, x, z),
        offset = Math.hypot(along, across);
      if (offset > L.roadShoulderHalfWidth + L.roadFalloffMax) continue;
      const target = roadProfileHeight(modifier, distance, natural),
        falloff = Math.max(
          L.roadFalloffMin,
          Math.min(L.roadFalloffMax, Math.abs(height - target) * L.roadFalloffPerDepth),
        ),
        weight = 1 - smooth((offset - L.roadShoulderHalfWidth) / falloff);
      if (weight > 0) height = lerp(height, target, weight);
    } else {
      const weight = padWeight(modifier, x, z);
      if (weight > 0) height = lerp(height, padTargetHeight(modifier, natural), weight);
    }
  }
  return height;
}

export function compositorDiagnostics() {
  return {
    version: `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/SURFACE-COMPOSITOR/1`,
    modifiers: surfaceModifiers().length,
    indexBuckets: buckets.size,
    stationCacheSize: stationCache.size,
    padCacheSize: padHeightCache.size,
    ...compositorStats,
  };
}

/** Drop memoised values; results must be identical afterwards (tests use this). */
export function clearSurfaceCaches() {
  stationCache.clear();
  padHeightCache.clear();
}

/**
 * Inspectable SEED examples: the road with the deepest centreline cut and the
 * village pad with the largest hillside cut/fill. Bounded scan of plan data.
 */
export function earthworkExamples(natural: NaturalSampler) {
  let road: { code: string; x: number; z: number; cut: number } | undefined,
    pad: { code: string; placeId: string; x: number; z: number; cutFill: number } | undefined;
  for (const modifier of surfaceModifiers()) {
    if (modifier.kind === "road") {
      const length = Math.abs(modifier.extent),
        sign = modifier.extent < 0 ? -1 : 1;
      for (let s = 24; s < length - 24; s += 48) {
        const x = wrapSourceX(modifier.anchorX + sign * s),
          naturalHeight = natural(x, modifier.z);
        if (naturalHeight < L.waterLevel) continue;
        // Inspect open-country cuts, not streets already levelled by a pad.
        if (modifiersAt(x, modifier.z).some((other) => other.kind !== "road")) continue;
        const cut = naturalHeight - roadProfileHeight(modifier, s, natural);
        if (!road || cut > road.cut) road = { code: modifier.code, x, z: modifier.z, cut };
      }
    } else if (modifier.kind === "village") {
      const target = padTargetHeight(modifier, natural);
      let worst = 0;
      for (let a = 0; a < 8; a++) {
        const angle = (a * Math.PI) / 4,
          h = natural(
            modifier.anchorX + Math.cos(angle) * modifier.radius,
            modifier.z + Math.sin(angle) * modifier.radius,
          );
        if (h >= L.waterLevel) worst = Math.max(worst, Math.abs(h - target));
      }
      if (!pad || worst > Math.abs(pad.cutFill))
        pad = { code: modifier.code, placeId: modifier.placeId, x: modifier.anchorX, z: modifier.z, cutFill: worst };
    }
  }
  return { road, pad };
}
