import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  CANONICAL_PLANET_RADIUS,
  clampLatitude,
  lonLatToUnit,
  normalizeLongitude,
  type LonLat,
  type Unit,
} from "./planet.ts";

export type MacroDomain = "Ocean" | "Mainland" | "Island" | "Lake";
export type MountainKind =
  | "long-chain"
  | "compact-massif"
  | "hooked-range"
  | "low-highlands"
  | "dominant-spine"
  | "volcanic-chain"
  | "volcano";

type Basis = { east: Unit; north: Unit; up: Unit };
type Shape = {
  east: number;
  north: number;
  radiusEast: number;
  radiusNorth: number;
  rotation: number;
  phase: number;
};

export type ContinentRecipe = {
  id: number;
  name: string;
  code: string;
  center: LonLat;
  majorRadiusRad: number;
  minorRadiusRad: number;
  orientationRad: number;
  lobes: Shape[];
  bays: Shape[];
  basis: Basis;
};
export type IslandRecipe = {
  id: number;
  code: string;
  continent: number;
  center: LonLat;
  radiusRad: number;
  aspect: number;
  orientationRad: number;
  phase: number;
  basis: Basis;
};
export type LakeRecipe = IslandRecipe;
export type MountainSystem = {
  id: number;
  code: string;
  continent: number;
  kind: MountainKind;
  center: LonLat;
  path: LonLat[];
  localPath: [number, number][];
  lengthRad: number;
  widthRad: number;
  reliefM: number;
  volcanic: boolean;
};
export type MacroPlan = {
  seed: string;
  version: string;
  variant: number;
  continents: ContinentRecipe[];
  islands: IslandRecipe[];
  lakes: LakeRecipe[];
  mountainSystems: MountainSystem[];
};
export type MacroSample = {
  domain: MacroDomain;
  land: boolean;
  continentId: number;
  islandId: number | null;
  lakeId: number | null;
  code: string;
  coastDistanceRad: number;
  reliefM: number;
  mountainIntensity: number;
  mountainSystemId: number | null;
  mountainCode: string | null;
  mountainKind: MountainKind | null;
  volcanic: boolean;
};

const CONTINENT_NAMES = ["Eldermere", "Westreach", "Dawnlands"] as const;
const TAU = Math.PI * 2;
const SUPPORT_COS = Math.cos(1.12);
const PLAN_ATTEMPTS = 8;
const SLOT_ATTEMPTS = 128;
const ISLAND_COUNT = 18;
const LAKE_COUNT = 6;
const MOUNTAIN_ARCHETYPES: readonly [MountainKind, number, number, number][] = [
  ["long-chain", 0.7, 0.045, 220],
  ["compact-massif", 0.18, 0.08, 260],
  ["hooked-range", 0.58, 0.045, 300],
  ["low-highlands", 0.42, 0.12, 75],
  ["dominant-spine", 0.62, 0.04, 500],
  ["volcanic-chain", 0.38, 0.035, 320],
  ["volcano", 0.05, 0.035, 520],
];

/** Stable addressed digest. It is a content lookup, never a mutable PRNG stream. */
function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function addressed(seed: string, version: string, address: string): number {
  return digest(`${seed}/${version}/${address}`) / 4294967296;
}
const dot = (a: Unit, b: Unit) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function basisAt({ lon, lat }: LonLat): Basis {
  return {
    east: [Math.cos(lon), 0, -Math.sin(lon)],
    north: [
      -Math.sin(lat) * Math.sin(lon),
      Math.cos(lat),
      -Math.sin(lat) * Math.cos(lon),
    ],
    up: lonLatToUnit(lon, lat),
  };
}
function angularDistance(a: LonLat, b: LonLat): number {
  return Math.acos(
    Math.max(-1, Math.min(1, dot(lonLatToUnit(a.lon, a.lat), lonLatToUnit(b.lon, b.lat)))),
  );
}
function destination(origin: LonLat, bearing: number, distance: number): LonLat {
  const sinLat =
    Math.sin(origin.lat) * Math.cos(distance) +
    Math.cos(origin.lat) * Math.sin(distance) * Math.cos(bearing);
  const lat = Math.asin(Math.max(-1, Math.min(1, sinLat)));
  return {
    lon: normalizeLongitude(
      origin.lon +
        Math.atan2(
          Math.sin(bearing) * Math.sin(distance) * Math.cos(origin.lat),
          Math.cos(distance) - Math.sin(origin.lat) * Math.sin(lat),
        ),
    ),
    lat: clampLatitude(lat),
  };
}
function localPoint(continent: ContinentRecipe, east: number, north: number): LonLat {
  const projected = Math.min(0.98, Math.hypot(east, north));
  if (projected < 1e-12) return { ...continent.center };
  return destination(continent.center, Math.atan2(east, north), Math.asin(projected));
}
function project(basis: Basis, point: Unit) {
  return {
    east: dot(point, basis.east),
    north: dot(point, basis.north),
    up: dot(point, basis.up),
  };
}
function shapeScore(shape: Shape, east: number, north: number): number {
  const c = Math.cos(shape.rotation),
    s = Math.sin(shape.rotation),
    dx = east - shape.east,
    dy = north - shape.north,
    x = c * dx + s * dy,
    y = -s * dx + c * dy,
    // Continuous domain warp keeps boundaries irregular without tying them to a grid/LOD.
    wx = x + shape.radiusEast * 0.07 * Math.sin((5.2 * y) / shape.radiusNorth + shape.phase),
    wy = y + shape.radiusNorth * 0.065 * Math.sin((4.3 * x) / shape.radiusEast - shape.phase * 0.7);
  return 1 - Math.hypot(wx / shape.radiusEast, wy / shape.radiusNorth);
}
function continentScore(continent: ContinentRecipe, point: Unit): number {
  const local = project(continent.basis, point);
  if (local.up < SUPPORT_COS) return -10;
  let score = -10;
  for (const lobe of continent.lobes)
    score = Math.max(score, shapeScore(lobe, local.east, local.north));
  // Only cut bays through the outer shelf of the already-composed mainland. This
  // guarantees coastline-facing notches rather than round inland ocean holes.
  const uncutScore = score;
  for (const bay of continent.bays) {
    const cut = shapeScore(bay, local.east, local.north);
    if (cut > 0 && uncutScore < 0.32) score = Math.min(score, -cut * 0.8);
  }
  return score;
}
function smallFeatureScore(feature: IslandRecipe, point: Unit): number {
  const local = project(feature.basis, point);
  if (local.up < Math.cos(0.14)) return -10;
  const c = Math.cos(feature.orientationRad),
    s = Math.sin(feature.orientationRad),
    radiusEast = Math.sin(feature.radiusRad),
    radiusNorth = radiusEast * feature.aspect,
    x = c * local.east + s * local.north,
    y = -s * local.east + c * local.north,
    wx = x + radiusEast * 0.065 * Math.sin((4 * y) / radiusNorth + feature.phase),
    wy = y + radiusNorth * 0.055 * Math.sin((3 * x) / radiusEast - feature.phase);
  return 1 - Math.hypot(wx / radiusEast, wy / radiusNorth);
}
function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { distance: number; t: number } {
  const dx = bx - ax,
    dy = by - ay,
    length2 = dx * dx + dy * dy;
  if (length2 <= 1e-15) return { distance: Math.hypot(px - ax, py - ay), t: 0 };
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)),
    x = ax + t * dx,
    y = ay + t * dy;
  return { distance: Math.hypot(px - x, py - y), t };
}
function smooth01(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}
type MountainHit = { system: MountainSystem; reliefM: number; intensity: number } | null;
function mountainAtUnit(plan: MacroPlan, point: Unit, continentId: number): MountainHit {
  const continent = plan.continents[continentId],
    local = project(continent.basis, point);
  let best: MountainHit = null;
  for (const system of plan.mountainSystems) {
    if (system.continent !== continentId) continue;
    const width = Math.sin(system.widthRad);
    let distance = Infinity,
      pathPosition = 0;
    if (system.localPath.length === 1) {
      distance = Math.hypot(
        local.east - system.localPath[0][0],
        local.north - system.localPath[0][1],
      );
    } else {
      for (let i = 0; i < system.localPath.length - 1; i++) {
        const hit = segmentDistance(
          local.east,
          local.north,
          ...system.localPath[i],
          ...system.localPath[i + 1],
        );
        if (hit.distance < distance) {
          distance = hit.distance;
          pathPosition = i + hit.t;
        }
      }
    }
    const widthVariation =
        system.kind === "volcano"
          ? 1
          : 0.72 + 0.28 * (0.5 + 0.5 * Math.sin(pathPosition * Math.PI * 3.7 + system.id * 2.1)),
      raw = Math.max(0, 1 - distance / Math.max(width * widthVariation, 1e-7));
    if (raw <= 0) continue;
    const intensity = smooth01(raw),
      ridgeVariation =
        0.7 + 0.3 * (0.5 + 0.5 * Math.cos(pathPosition * Math.PI * 5 + system.id * 1.7));
    let reliefM = system.reliefM * intensity * ridgeVariation;
    if (system.kind === "dominant-spine") {
      const peak = system.localPath[Math.floor(system.localPath.length / 2)],
        peakWeight = Math.max(
          0,
          1 -
            Math.hypot(local.east - peak[0], local.north - peak[1]) /
              Math.max(width * 1.5, 1e-7),
        );
      reliefM += system.reliefM * 0.7 * peakWeight * peakWeight;
    } else if (system.kind === "volcano") {
      reliefM = system.reliefM * raw ** 2.25;
    }
    if (!best || reliefM > best.reliefM) best = { system, reliefM, intensity };
  }
  return best;
}

function separatedCenters(seed: string, version: string) {
  let firstValid: { variant: number; centers: LonLat[] } | undefined;
  for (let variant = 0; variant < PLAN_ATTEMPTS; variant++) {
    const centers: LonLat[] = [];
    for (let slot = 0; slot < 3; slot++) {
      let chosen: LonLat | undefined;
      for (let attempt = 0; attempt < SLOT_ATTEMPTS; attempt++) {
        const prefix = `plan/${variant}/continent/${slot}/${attempt}`,
          lon = -Math.PI + TAU * addressed(seed, version, `${prefix}/lon`),
          sinLat = -0.62 + 1.24 * addressed(seed, version, `${prefix}/sin-lat`),
          candidate = { lon, lat: Math.asin(sinLat) };
        if (centers.every((center) => angularDistance(center, candidate) > 1.55)) {
          chosen = candidate;
          break;
        }
      }
      if (!chosen) break;
      centers.push(chosen);
    }
    if (centers.length !== 3) continue;
    const valid = { variant, centers };
    firstValid ??= valid;
    // Prefer a plan that visibly spans hemispheres without fixing any slot's latitude.
    if (
      Math.min(...centers.map((center) => center.lat)) < -0.3 &&
      Math.max(...centers.map((center) => center.lat)) > 0.3
    )
      return valid;
  }
  if (firstValid) return firstValid;
  throw new Error("Seeded macro plan could not place three separated continents");
}

export function createMacroPlan(
  seed = WORLD_SEED,
  version = WORLD_FOUNDATION_VERSION,
): MacroPlan {
  const { variant, centers } = separatedCenters(seed, version),
    continents: ContinentRecipe[] = centers.map((center, id) => {
      const prefix = `plan/${variant}/continent/${id}`,
        majorRadiusRad = 0.67 + 0.13 * addressed(seed, version, `${prefix}/major`),
        minorRadiusRad = 0.43 + 0.11 * addressed(seed, version, `${prefix}/minor`),
        orientationRad = TAU * addressed(seed, version, `${prefix}/orientation`),
        major = Math.sin(majorRadiusRad),
        minor = Math.sin(minorRadiusRad),
        lobes: Shape[] = [
          {
            east: 0,
            north: 0,
            radiusEast: major * 0.88,
            radiusNorth: minor * 0.88,
            rotation: orientationRad,
            phase: TAU * addressed(seed, version, `${prefix}/phase`),
          },
        ];
      for (let lobe = 0; lobe < 6; lobe++) {
        const base = `${prefix}/lobe/${lobe}`,
          angle = TAU * addressed(seed, version, `${base}/theta`),
          offset = 0.34 + 0.3 * addressed(seed, version, `${base}/offset`);
        lobes.push({
          east: Math.sin(angle) * major * offset,
          north: Math.cos(angle) * minor * offset,
          radiusEast: major * (0.28 + 0.26 * addressed(seed, version, `${base}/east-radius`)),
          radiusNorth: minor * (0.28 + 0.24 * addressed(seed, version, `${base}/north-radius`)),
          rotation:
            orientationRad + (addressed(seed, version, `${base}/rotation`) - 0.5) * 2.1,
          phase: TAU * addressed(seed, version, `${base}/phase`),
        });
      }
      const bays: Shape[] = [];
      for (let bay = 0; bay < 3; bay++) {
        const base = `${prefix}/bay/${bay}`,
          angle = TAU * addressed(seed, version, `${base}/theta`),
          offset = 0.84 + 0.14 * addressed(seed, version, `${base}/offset`);
        bays.push({
          east: Math.sin(angle) * major * offset,
          north: Math.cos(angle) * minor * offset,
          radiusEast: major * (0.12 + 0.08 * addressed(seed, version, `${base}/east-radius`)),
          radiusNorth: minor * (0.12 + 0.08 * addressed(seed, version, `${base}/north-radius`)),
          rotation:
            orientationRad + (addressed(seed, version, `${base}/rotation`) - 0.5) * 1.6,
          phase: TAU * addressed(seed, version, `${base}/phase`),
        });
      }
      return {
        id,
        name: CONTINENT_NAMES[id],
        code: `${seed}/${version}/MACRO/CONTINENT/${id}`,
        center,
        majorRadiusRad,
        minorRadiusRad,
        orientationRad,
        lobes,
        bays,
        basis: basisAt(center),
      };
    }),
    plan: MacroPlan = {
      seed,
      version,
      variant,
      continents,
      islands: [],
      lakes: [],
      mountainSystems: [],
    };

  for (let islandId = 0; islandId < ISLAND_COUNT; islandId++) {
    const continent = continents[islandId % continents.length];
    let recipe: IslandRecipe | undefined;
    for (let attempt = 0; attempt < 96; attempt++) {
      const base = `island/${islandId}/${attempt}`,
        bearing = TAU * addressed(seed, version, `${base}/bearing`),
        distance = 0.62 + 0.45 * addressed(seed, version, `${base}/distance`),
        center = destination(continent.center, bearing, distance),
        radiusRad = 0.018 + 0.013 * addressed(seed, version, `island/${islandId}/radius`),
        point = lonLatToUnit(center.lon, center.lat),
        mainlandScore = Math.max(...continents.map((item) => continentScore(item, point)));
      if (mainlandScore > -0.035 || Math.abs(center.lat) > 1.25) continue;
      if (
        plan.islands.some(
          (other) =>
            angularDistance(center, other.center) < radiusRad + other.radiusRad + 0.02,
        )
      )
        continue;
      recipe = {
        id: islandId,
        code: `${seed}/${version}/MACRO/ISLAND/${islandId}`,
        continent: continent.id,
        center,
        radiusRad,
        aspect: 0.55 + 0.4 * addressed(seed, version, `island/${islandId}/aspect`),
        orientationRad: TAU * addressed(seed, version, `island/${islandId}/orientation`),
        phase: TAU * addressed(seed, version, `island/${islandId}/phase`),
        basis: basisAt(center),
      };
      break;
    }
    if (!recipe) throw new Error(`Seeded macro plan could not place island ${islandId}`);
    plan.islands.push(recipe);
  }

  const assignmentShift = digest(`${seed}/${version}/mountain/assignment`) % 3;
  for (let id = 0; id < MOUNTAIN_ARCHETYPES.length; id++) {
    const [kind, lengthFactor, widthFactor, reliefM] = MOUNTAIN_ARCHETYPES[id],
      continent = continents[(id + assignmentShift) % continents.length],
      base = `mountain/${id}/${kind}`,
      length = Math.sin(continent.majorRadiusRad) * lengthFactor,
      width = Math.sin(continent.minorRadiusRad) * widthFactor;
    let points: [number, number][];
    if (kind === "hooked-range") points = [[-length / 2, 0], [0, 0], [0, length / 2]];
    else if (kind === "long-chain") {
      const curve = length * (0.08 + 0.12 * addressed(seed, version, `${base}/curve`));
      points = [[-length / 2, -curve], [0, curve], [length / 2, 0]];
    } else if (kind === "volcanic-chain")
      points = [[-length / 2, 0], [0, length * 0.08], [length / 2, 0]];
    else if (kind === "volcano") points = [[0, 0]];
    else points = [[-length / 2, 0], [length / 2, 0]];

    let center: LonLat | undefined,
      localPath: [number, number][] = [],
      path: LonLat[] = [];
    for (let attempt = 0; attempt < SLOT_ATTEMPTS; attempt++) {
      const placement = `${base}/placement/${attempt}`,
        centerAngle = TAU * addressed(seed, version, `${placement}/center-angle`),
        centerRadius = 0.12 + 0.46 * Math.sqrt(addressed(seed, version, `${placement}/center-radius`)),
        centerEast = Math.sin(centerAngle) * Math.sin(continent.majorRadiusRad) * centerRadius,
        centerNorth = Math.cos(centerAngle) * Math.sin(continent.minorRadiusRad) * centerRadius,
        axis = TAU * addressed(seed, version, `${placement}/axis`),
        c = Math.cos(axis),
        s = Math.sin(axis),
        candidatePath = points.map(
          ([east, north]) =>
            [
              centerEast + c * east - s * north,
              centerNorth + s * east + c * north,
            ] as [number, number],
        ),
        candidateWorldPath = candidatePath.map(([east, north]) => localPoint(continent, east, north)),
        candidateCenter = localPoint(continent, centerEast, centerNorth),
        edgeSafe = candidateWorldPath.every(
          (point) => continentScore(continent, lonLatToUnit(point.lon, point.lat)) > 0.06,
        ),
        minGap = kind === "volcano" ? 0.24 : kind === "low-highlands" ? 0.2 : 0.18,
        separated = plan.mountainSystems.every(
          (other) =>
            other.continent !== continent.id || angularDistance(candidateCenter, other.center) >= minGap,
        );
      if (!edgeSafe || !separated) continue;
      center = candidateCenter;
      localPath = candidatePath;
      path = candidateWorldPath;
      break;
    }
    if (!center)
      throw new Error(`Seeded macro plan could not place mountain system ${id}/${kind}`);
    plan.mountainSystems.push({
      id,
      code: `${seed}/${version}/MACRO/MOUNTAIN/${id}/${kind}`,
      continent: continent.id,
      kind,
      center,
      path,
      localPath,
      lengthRad: Math.asin(Math.min(0.98, length)),
      widthRad: Math.asin(Math.min(0.98, width)),
      reliefM,
      volcanic: kind === "volcanic-chain" || kind === "volcano",
    });
  }

  for (let lakeId = 0; lakeId < LAKE_COUNT; lakeId++) {
    const continent = continents[lakeId % continents.length];
    let recipe: LakeRecipe | undefined;
    for (let attempt = 0; attempt < SLOT_ATTEMPTS; attempt++) {
      const base = `lake/${lakeId}/${attempt}`,
        bearing = TAU * addressed(seed, version, `${base}/bearing`),
        distance = 0.1 + 0.34 * Math.sqrt(addressed(seed, version, `${base}/distance`)),
        center = destination(continent.center, bearing, distance),
        point = lonLatToUnit(center.lon, center.lat),
        score = continentScore(continent, point),
        mountain = mountainAtUnit(plan, point, continent.id),
        radiusRad = 0.025 + 0.028 * addressed(seed, version, `lake/${lakeId}/radius`);
      if (score < 0.18 || (mountain?.reliefM ?? 0) > 30) continue;
      if (
        plan.lakes.some(
          (other) => angularDistance(center, other.center) < radiusRad + other.radiusRad + 0.04,
        )
      )
        continue;
      recipe = {
        id: lakeId,
        code: `${seed}/${version}/MACRO/LAKE/${lakeId}`,
        continent: continent.id,
        center,
        radiusRad,
        aspect: 0.55 + 0.35 * addressed(seed, version, `lake/${lakeId}/aspect`),
        orientationRad: TAU * addressed(seed, version, `lake/${lakeId}/orientation`),
        phase: TAU * addressed(seed, version, `lake/${lakeId}/phase`),
        basis: basisAt(center),
      };
      break;
    }
    if (!recipe) throw new Error(`Seeded macro plan could not place lake ${lakeId}`);
    plan.lakes.push(recipe);
  }

  return plan;
}

export const MACRO_PLAN = createMacroPlan();
export const macroContinents = MACRO_PLAN.continents;
export const macroIslands = MACRO_PLAN.islands;
export const macroLakes = MACRO_PLAN.lakes;
export const mountainSystems = MACRO_PLAN.mountainSystems;

export function macroSampleAt(position: LonLat, plan = MACRO_PLAN): MacroSample {
  const point = lonLatToUnit(position.lon, position.lat),
    scores = plan.continents.map((continent) => continentScore(continent, point));
  let continentId = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[continentId]) continentId = i;
  const continent = plan.continents[continentId],
    score = scores[continentId];

  if (score > 0) {
    let bestLake: { recipe: LakeRecipe; score: number } | undefined;
    for (const lake of plan.lakes) {
      if (lake.continent !== continentId) continue;
      const candidate = smallFeatureScore(lake, point);
      if (!bestLake || candidate > bestLake.score) bestLake = { recipe: lake, score: candidate };
    }
    if (bestLake && bestLake.score > 0) {
      return {
        domain: "Lake",
        land: false,
        continentId,
        islandId: null,
        lakeId: bestLake.recipe.id,
        code: bestLake.recipe.code,
        coastDistanceRad: -bestLake.score * bestLake.recipe.radiusRad * 0.5,
        reliefM: 0,
        mountainIntensity: 0,
        mountainSystemId: null,
        mountainCode: null,
        mountainKind: null,
        volcanic: false,
      };
    }
    const mountain = mountainAtUnit(plan, point, continentId);
    return {
      domain: "Mainland",
      land: true,
      continentId,
      islandId: null,
      lakeId: null,
      code: continent.code,
      coastDistanceRad: score * Math.min(continent.majorRadiusRad, continent.minorRadiusRad) * 0.22,
      reliefM: mountain?.reliefM ?? 0,
      mountainIntensity: mountain?.intensity ?? 0,
      mountainSystemId: mountain?.system.id ?? null,
      mountainCode: mountain?.system.code ?? null,
      mountainKind: mountain?.system.kind ?? null,
      volcanic: mountain?.system.volcanic ?? false,
    };
  }

  let bestIsland: { recipe: IslandRecipe; score: number } | undefined;
  for (const island of plan.islands) {
    const candidate = smallFeatureScore(island, point);
    if (!bestIsland || candidate > bestIsland.score)
      bestIsland = { recipe: island, score: candidate };
  }
  if (bestIsland && bestIsland.score > 0) {
    const mountain = mountainAtUnit(plan, point, bestIsland.recipe.continent);
    return {
      domain: "Island",
      land: true,
      continentId: bestIsland.recipe.continent,
      islandId: bestIsland.recipe.id,
      lakeId: null,
      code: bestIsland.recipe.code,
      coastDistanceRad: bestIsland.score * bestIsland.recipe.radiusRad * 0.5,
      reliefM: mountain?.reliefM ?? 0,
      mountainIntensity: mountain?.intensity ?? 0,
      mountainSystemId: mountain?.system.id ?? null,
      mountainCode: mountain?.system.code ?? null,
      mountainKind: mountain?.system.kind ?? null,
      volcanic: mountain?.system.volcanic ?? false,
    };
  }

  return {
    domain: "Ocean",
    land: false,
    continentId,
    islandId: null,
    lakeId: null,
    code: `${plan.seed}/${plan.version}/MACRO/OCEAN`,
    coastDistanceRad: score * Math.min(continent.majorRadiusRad, continent.minorRadiusRad) * 0.22,
    reliefM: 0,
    mountainIntensity: 0,
    mountainSystemId: null,
    mountainCode: null,
    mountainKind: null,
    volcanic: false,
  };
}

export function macroFeatureDistanceM(a: LonLat, b: LonLat) {
  return angularDistance(a, b) * CANONICAL_PLANET_RADIUS;
}
