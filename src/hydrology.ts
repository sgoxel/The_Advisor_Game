import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import { MACRO_PLAN, macroSampleAt } from "./macro-geography.ts";
import {
  SOURCE_PRESENTATION_POLE_DISTANCE,
  SOURCE_PRESENTATION_RADIUS,
  SOURCE_PRESENTATION_WIDTH,
  lonLatToSource,
  sourceToLonLat,
  wrapSourceX,
} from "./planet.ts";

export type WaterKind = "none" | "ocean" | "lake" | "river";
export type TraversalKind = "walkable" | "difficult" | "blocked-water" | "blocked-cliff";
export type SurfaceSample = {
  elevation: number;
  water: WaterKind;
  traversal: TraversalKind;
  walkable: boolean;
  slope: number;
  cliff: boolean;
  riverBank: boolean;
  freshwaterDistance: number;
  catchmentCode: string | null;
};
export type DrainagePoint = { x: number; z: number; bed: number };
export type DrainageLake = {
  x: number;
  z: number;
  radius: number;
  level: number;
  phase: number;
  elongation: number;
  rotation: number;
};
export type DrainageRecipe = {
  code: string;
  continentId: number;
  points: DrainagePoint[];
  tributary: DrainagePoint[];
  width: number;
  lake: DrainageLake | null;
  outlet: "ocean" | "lake";
};

type BasinEntry = { recipe: DrainageRecipe | null; used: number };
type HydroHit = {
  water: "none" | "lake" | "river";
  bank: boolean;
  distance: number;
  bed: number;
  code: string | null;
};
type PreparedSurface = {
  elevation: number;
  hydro: HydroHit;
  macro: ReturnType<typeof macroSampleAt>;
};

const BASIN_SIZE = 4096;
const BASIN_COLUMNS = SOURCE_PRESENTATION_WIDTH / BASIN_SIZE;
const BASIN_ROWS = (SOURCE_PRESENTATION_POLE_DISTANCE * 2) / BASIN_SIZE;
const CACHE_LIMIT = 96;
const CORE_CACHE_LIMIT = 8192;
const RIVER_STEPS = 48;
const RIVER_STEP = 165;
const GRADIENT_STEP = 170;
const SEARCH_RADIUS = 2;
const basinCache = new Map<string, BasinEntry>();
const coreCache = new Map<string, PreparedSurface>();
let useTick = 0;
let generatedBasins = 0;
let queryCount = 0;

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function addressed(address: string): number {
  return digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/${address}`) / 4294967296;
}
function smooth01(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
/** Canonical deterministic shoreline radius shared by hydrology queries and rendering. */
export function drainageLakeRadiusAt(lake: DrainageLake, angle: number) {
  const local = angle - lake.rotation,
    c = Math.cos(local),
    s = Math.sin(local),
    major = 1 + lake.elongation,
    minor = 1 - lake.elongation * 0.45,
    ellipse =
      lake.radius /
      Math.sqrt((c * c) / (major * major) + (s * s) / (minor * minor)),
    irregular =
      1 +
      0.1 * Math.sin(angle * 3 + lake.phase) +
      0.06 * Math.sin(angle * 5 - lake.phase * 0.61) +
      0.035 * Math.cos(angle * 7 + lake.phase * 1.37);
  return Math.max(lake.radius * 0.68, ellipse * irregular);
}
function sphericalNoise(x: number, z: number, layer: number) {
  const p = sourceToLonLat(wrapSourceX(x), z),
    phase = addressed(`SURFACE-NOISE/${layer}`) * Math.PI * 2,
    a = Math.sin(p.lon * (7 + layer * 2.1) + p.lat * (5 + layer * 1.7) + phase),
    b = Math.cos(p.lon * (13 + layer * 2.7) - p.lat * (9 + layer * 1.3) - phase * 0.73),
    c = Math.sin(p.lon * (23 + layer * 3.2) + p.lat * (17 + layer * 1.9) + phase * 0.41);
  return Math.max(0, Math.min(1, (a * 0.5 + b * 0.3 + c * 0.2 + 1) * 0.5));
}
function terrainNoise(x: number, z: number) {
  return sphericalNoise(x, z, 0) * 0.5 + sphericalNoise(x, z, 1) * 0.32 + sphericalNoise(x, z, 2) * 0.18;
}

/**
 * Canonical natural terrain. All local detail is spherical/periodic, so no source-grid
 * cell structure can appear and the east/west wrap remains identical.
 */
export function naturalElevationAt(x: number, z: number): number {
  const sx = wrapSourceX(x),
    position = sourceToLonLat(sx, z),
    macro = macroSampleAt(position);
  if (macro.domain === "Ocean") return -2.8;
  if (macro.domain === "Lake") return -1.8;

  const noise = terrainNoise(sx, z),
    broad = sphericalNoise(sx, z, 3),
    mountainWeight = smooth01(macro.mountainIntensity / 0.36),
    ridgePhase = addressed(`RIDGE/${macro.continentId}`) * Math.PI * 2,
    secondaryPhase = addressed(`RIDGE-SECONDARY/${macro.continentId}`) * Math.PI * 2,
    tertiaryPhase = addressed(`RIDGE-TERTIARY/${macro.continentId}`) * Math.PI * 2,
    // Three differently oriented smooth waves interfere into irregular crags.
    // Unlike the old abs(sin()) ridge mask, this has no repeated narrow stripe crest.
    ridgeTexture =
      Math.sin(position.lon * 317 + position.lat * 211 + ridgePhase) * 0.44 +
      Math.sin(position.lon * 197 - position.lat * 389 + secondaryPhase) * 0.34 +
      Math.cos(position.lon * 461 + position.lat * 137 + tertiaryPhase) * 0.22,
    ridgeDetail = ridgeTexture * Math.min(176, macro.reliefM * 0.38) * mountainWeight,
    base = macro.domain === "Island" ? 3.5 + noise * 13 : 3.5 + broad * 8 + noise * 4.5,
    macroRelief = macro.reliefM * (0.8 + 0.2 * noise) + ridgeDetail,
    cap = macro.domain === "Island" ? 180 : 620,
    terrain = Math.min(cap, Math.max(1.2, base + macroRelief)),
    coastSource = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS;
  return lerp(-2.8, terrain, smooth01((coastSource + 2) / 12));
}

function canonicalBasinX(gx: number) {
  return ((gx % BASIN_COLUMNS) + BASIN_COLUMNS) % BASIN_COLUMNS;
}
function basinKey(gx: number, gz: number) {
  return `${canonicalBasinX(gx)}/${gz}`;
}
function basinAnchor(gx: number, gz: number) {
  const cx = canonicalBasinX(gx),
    key = basinKey(cx, gz),
    x = -SOURCE_PRESENTATION_WIDTH / 2 + (cx + 0.18 + addressed(`${key}/x`) * 0.64) * BASIN_SIZE,
    z = -SOURCE_PRESENTATION_POLE_DISTANCE + (gz + 0.18 + addressed(`${key}/z`) * 0.64) * BASIN_SIZE;
  return { x: wrapSourceX(x), z };
}
function coastSourceAt(x: number, z: number) {
  return macroSampleAt(sourceToLonLat(wrapSourceX(x), z)).coastDistanceRad * SOURCE_PRESENTATION_RADIUS;
}

/** Downhill/coastward flow target. No square source-grid interpolation is used. */
function flowTarget(x: number, z: number, continentId: number) {
  const sx = wrapSourceX(x),
    left = coastSourceAt(sx - GRADIENT_STEP, z),
    right = coastSourceAt(sx + GRADIENT_STEP, z),
    up = coastSourceAt(sx, z - GRADIENT_STEP),
    down = coastSourceAt(sx, z + GRADIENT_STEP),
    gx = (right - left) / (GRADIENT_STEP * 2),
    gz = (down - up) / (GRADIENT_STEP * 2),
    centre = lonLatToSource(MACRO_PLAN.continents[continentId].center.lon, MACRO_PLAN.continents[continentId].center.lat),
    awayX = wrapSourceX(sx - centre.x),
    awayZ = z - centre.z,
    awayLength = Math.hypot(awayX, awayZ) || 1,
    gradientLength = Math.hypot(gx, gz),
    fallbackX = awayX / awayLength,
    fallbackZ = awayZ / awayLength,
    baseX = gradientLength > 0.015 ? -gx / gradientLength : fallbackX,
    baseZ = gradientLength > 0.015 ? -gz / gradientLength : fallbackZ,
    turn = (sphericalNoise(sx, z, 83 + continentId) - 0.5) * 0.82;
  let dx = baseX - baseZ * turn,
    dz = baseZ + baseX * turn;
  const length = Math.hypot(dx, dz) || 1;
  dx /= length;
  dz /= length;
  return { x: dx, z: dz };
}
function blendDirection(previous: { x: number; z: number }, target: { x: number; z: number }, amount: number) {
  const x = previous.x * (1 - amount) + target.x * amount,
    z = previous.z * (1 - amount) + target.z * amount,
    length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
}
function pointDistanceToSegment(px: number, pz: number, a: DrainagePoint, b: DrainagePoint) {
  const dx = wrapSourceX(b.x - a.x),
    dz = b.z - a.z,
    qx = wrapSourceX(px - a.x),
    qz = pz - a.z,
    length2 = dx * dx + dz * dz,
    t = length2 <= 1e-8 ? 0 : Math.max(0, Math.min(1, (qx * dx + qz * dz) / length2));
  return { distance: Math.hypot(qx - dx * t, qz - dz * t), t };
}
function evictBasins() {
  if (basinCache.size <= CACHE_LIMIT) return;
  const oldest = [...basinCache.entries()].sort((a, b) => a[1].used - b[1].used);
  for (let i = 0; i < basinCache.size - CACHE_LIMIT; i++) basinCache.delete(oldest[i][0]);
}
function extendToWater(
  points: DrainagePoint[],
  continentId: number,
  key: string,
  incoming: { x: number; z: number },
): "ocean" | "lake" | null {
  let current = points[points.length - 1],
    previousBed = current.bed,
    direction = incoming;
  for (let extra = 0; extra < 24; extra++) {
    direction = blendDirection(direction, flowTarget(current.x, current.z, continentId), 0.38);
    const stride = 150 + addressed(`${key}/outlet/${extra}`) * 70,
      nx = wrapSourceX(current.x + direction.x * stride),
      nz = Math.max(
        -SOURCE_PRESENTATION_POLE_DISTANCE + 8,
        Math.min(SOURCE_PRESENTATION_POLE_DISTANCE - 8, current.z + direction.z * stride),
      ),
      macro = macroSampleAt(sourceToLonLat(nx, nz));
    if (!macro.land) {
      points.push({ x: nx, z: nz, bed: Math.min(-0.35, previousBed - 0.4) });
      return macro.domain === "Lake" ? "lake" : "ocean";
    }
    const bed = Math.min(naturalElevationAt(nx, nz) - 0.8, previousBed - 0.2);
    current = { x: nx, z: nz, bed };
    points.push(current);
    previousBed = bed;
  }
  return null;
}

export function drainageRecipeAt(gx: number, gz: number): DrainageRecipe | null {
  if (gz < 0 || gz >= BASIN_ROWS) return null;
  const key = basinKey(gx, gz),
    cached = basinCache.get(key);
  if (cached) {
    cached.used = ++useTick;
    return cached.recipe;
  }

  const head = basinAnchor(gx, gz),
    macro = macroSampleAt(sourceToLonLat(head.x, head.z));
  let recipe: DrainageRecipe | null = null;
  if (macro.land && macro.domain !== "Lake" && macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS > 900) {
    const points: DrainagePoint[] = [],
      width = 11 + addressed(`${key}/width`) * 12;
    let x = head.x,
      z = head.z,
      previousBed = Math.max(2, naturalElevationAt(x, z) - 1.2),
      direction = flowTarget(x, z, macro.continentId),
      outlet: "ocean" | "lake" | null = null;
    points.push({ x, z, bed: previousBed });

    for (let step = 0; step < RIVER_STEPS; step++) {
      direction = blendDirection(direction, flowTarget(x, z, macro.continentId), 0.34);
      const stride = RIVER_STEP * (0.9 + addressed(`${key}/stride/${step}`) * 0.2),
        nx = wrapSourceX(x + direction.x * stride),
        nz = Math.max(
          -SOURCE_PRESENTATION_POLE_DISTANCE + 8,
          Math.min(SOURCE_PRESENTATION_POLE_DISTANCE - 8, z + direction.z * stride),
        ),
        nextMacro = macroSampleAt(sourceToLonLat(nx, nz)),
        natural = naturalElevationAt(nx, nz);
      if (!nextMacro.land) {
        outlet = nextMacro.domain === "Lake" ? "lake" : "ocean";
        points.push({ x: nx, z: nz, bed: Math.min(-0.35, previousBed - 0.4) });
        break;
      }
      const bed = Math.min(natural - 0.8, previousBed - 0.2);
      points.push({ x: nx, z: nz, bed });
      x = nx;
      z = nz;
      previousBed = bed;
    }
    if (!outlet && points.length >= 5)
      outlet = extendToWater(points, macro.continentId, key, direction);

    if (outlet && points.length >= 5) {
      const joinIndex = Math.min(points.length - 2, Math.max(3, Math.floor(points.length * 0.44))),
        join = points[joinIndex],
        before = points[Math.max(0, joinIndex - 1)],
        tangentX = wrapSourceX(join.x - before.x),
        tangentZ = join.z - before.z,
        tangentLength = Math.hypot(tangentX, tangentZ) || 1,
        side = addressed(`${key}/tributary-side`) < 0.5 ? -1 : 1,
        offset = 820 + addressed(`${key}/tributary-offset`) * 680,
        startX = wrapSourceX(join.x - (tangentZ / tangentLength) * side * offset),
        startZ = Math.max(
          -SOURCE_PRESENTATION_POLE_DISTANCE + 8,
          Math.min(
            SOURCE_PRESENTATION_POLE_DISTANCE - 8,
            join.z + (tangentX / tangentLength) * side * (820 + addressed(`${key}/tributary-offset-z`) * 680),
          ),
        ),
        bend = (addressed(`${key}/tributary-bend`) - 0.5) * 720,
        controlX = wrapSourceX((startX + join.x) / 2 - (tangentZ / tangentLength) * bend),
        controlZ = (startZ + join.z) / 2 + (tangentX / tangentLength) * bend,
        tributary: DrainagePoint[] = [],
        tributarySteps = 16,
        startBed = Math.max(join.bed + 2.5, naturalElevationAt(startX, startZ) - 0.7);
      for (let i = 0; i <= tributarySteps; i++) {
        const t = i / tributarySteps,
          u = 1 - t,
          sx = startX,
          jx = startX + wrapSourceX(join.x - startX),
          cx = startX + wrapSourceX(controlX - startX),
          px = u * u * sx + 2 * u * t * cx + t * t * jx,
          pz = u * u * startZ + 2 * u * t * controlZ + t * t * join.z;
        tributary.push({
          x: wrapSourceX(px),
          z: pz,
          bed: lerp(startBed, join.bed, t),
        });
      }

      const lakeIndex = Math.min(points.length - 2, 6),
        lakePoint = points[lakeIndex],
        lake =
          addressed(`${key}/lake`) > 0.68 &&
          macroSampleAt(sourceToLonLat(lakePoint.x, lakePoint.z)).land
            ? {
                x: lakePoint.x,
                z: lakePoint.z,
                radius: 64 + addressed(`${key}/lake-radius`) * 96,
                level: Math.min(
                  lakePoint.bed + 0.35,
                  naturalElevationAt(lakePoint.x, lakePoint.z) - 0.45,
                ),
                phase: addressed(`${key}/lake-phase`) * Math.PI * 2,
                elongation: 0.05 + addressed(`${key}/lake-elongation`) * 0.13,
                rotation: addressed(`${key}/lake-rotation`) * Math.PI * 2,
              }
            : null;
      recipe = {
        code: `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/HYDRO/${key}`,
        continentId: macro.continentId,
        points,
        tributary,
        width,
        lake,
        outlet,
      };
    }
  }

  basinCache.set(key, { recipe, used: ++useTick });
  generatedBasins++;
  evictBasins();
  return recipe;
}

/** Bounded render/query helper. Recipes are canonical and never camera-derived. */
export function drainageRecipesNear(x: number, z: number, radius = 3): DrainageRecipe[] {
  const canonicalX = wrapSourceX(x),
    gx = Math.floor((canonicalX + SOURCE_PRESENTATION_WIDTH / 2) / BASIN_SIZE),
    gz = Math.floor((z + SOURCE_PRESENTATION_POLE_DISTANCE) / BASIN_SIZE),
    result = new Map<string, DrainageRecipe>();
  for (let dz = -radius; dz <= radius; dz++)
    for (let dx = -radius; dx <= radius; dx++) {
      const recipe = drainageRecipeAt(gx + dx, gz + dz);
      if (recipe) result.set(recipe.code, recipe);
    }
  return [...result.values()];
}

function nearestHydrology(x: number, z: number): HydroHit {
  queryCount++;
  const canonicalX = wrapSourceX(x),
    gx = Math.floor((canonicalX + SOURCE_PRESENTATION_WIDTH / 2) / BASIN_SIZE),
    gz = Math.floor((z + SOURCE_PRESENTATION_POLE_DISTANCE) / BASIN_SIZE);
  let best: HydroHit = {
    water: "none",
    bank: false,
    distance: Infinity,
    bed: naturalElevationAt(canonicalX, z),
    code: null,
  };

  for (let dz = -SEARCH_RADIUS; dz <= SEARCH_RADIUS; dz++) {
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
      const recipe = drainageRecipeAt(gx + dx, gz + dz);
      if (!recipe) continue;
      const headDistance = Math.hypot(
        wrapSourceX(canonicalX - recipe.points[0].x),
        z - recipe.points[0].z,
      );
      if (headDistance > 13_500) continue;

      if (recipe.lake) {
        const lakeDx = wrapSourceX(canonicalX - recipe.lake.x),
          lakeDz = z - recipe.lake.z,
          shoreRadius = drainageLakeRadiusAt(recipe.lake, Math.atan2(lakeDz, lakeDx)),
          distance = Math.hypot(lakeDx, lakeDz) - shoreRadius;
        if (distance < best.distance)
          best = {
            water: distance <= 0 ? "lake" : "none",
            bank: distance > 0 && distance <= 24,
            distance,
            bed: recipe.lake.level,
            code: recipe.code,
          };
      }
      for (const path of [recipe.points, recipe.tributary]) {
        for (let i = 0; i < path.length - 1; i++) {
          const hit = pointDistanceToSegment(canonicalX, z, path[i], path[i + 1]),
            width = path === recipe.points ? recipe.width : recipe.width * 0.62,
            distance = hit.distance - width,
            bed = lerp(path[i].bed, path[i + 1].bed, hit.t);
          if (distance < best.distance)
            best = {
              water: distance <= 0 ? "river" : "none",
              bank: distance > 0 && distance <= 18,
              distance,
              bed,
              code: recipe.code,
            };
        }
      }
    }
  }
  return best;
}

function cachePrepared(key: string, value: PreparedSurface) {
  coreCache.set(key, value);
  if (coreCache.size > CORE_CACHE_LIMIT) {
    const first = coreCache.keys().next().value;
    if (typeof first === "string") coreCache.delete(first);
  }
  return value;
}
function preparedElevationAt(x: number, z: number): PreparedSurface {
  const sx = wrapSourceX(x),
    key = `${sx}/${z}`,
    cached = coreCache.get(key);
  if (cached) return cached;
  const macro = macroSampleAt(sourceToLonLat(sx, z));
  if (macro.domain === "Ocean")
    return cachePrepared(key, {
      elevation: -2.8,
      hydro: { water: "none", bank: false, distance: Infinity, bed: -2.8, code: null },
      macro,
    });
  if (macro.domain === "Lake")
    return cachePrepared(key, {
      elevation: -1.8,
      hydro: { water: "none", bank: false, distance: 0, bed: -1.8, code: macro.code },
      macro,
    });

  const natural = naturalElevationAt(sx, z),
    hydro = nearestHydrology(sx, z);
  let elevation = natural;
  if (hydro.water === "lake") elevation = hydro.bed - 0.25;
  else if (hydro.water === "river" || hydro.bank) {
    const influence = smooth01(1 - Math.max(0, hydro.distance) / 26);
    elevation = lerp(
      natural,
      Math.min(natural, hydro.bed),
      hydro.water === "river" ? 1 : influence,
    );
  }
  return cachePrepared(key, { elevation, hydro, macro });
}

export function surfaceElevationAt(x: number, z: number) {
  return preparedElevationAt(x, z).elevation;
}

export function surfaceAt(x: number, z: number): SurfaceSample {
  const sx = wrapSourceX(x),
    core = preparedElevationAt(sx, z),
    macroWater: WaterKind =
      core.macro.domain === "Ocean"
        ? "ocean"
        : core.macro.domain === "Lake"
          ? "lake"
          : "none",
    water: WaterKind = macroWater !== "none" ? macroWater : core.hydro.water;

  // Only mountain/high-relief dry ground needs the expensive structural-gradient query.
  // Water and ordinary lowlands keep a zero/low structural slope, avoiding four extra
  // full natural-terrain samples for every streamed terrain vertex.
  let slope = 0;
  if (
    water === "none" &&
    (core.macro.mountainIntensity > 0.025 || core.macro.reliefM > 42)
  ) {
    const step = 2,
      dx =
        Math.abs(
          naturalElevationAt(sx + step, z) - naturalElevationAt(sx - step, z),
        ) /
        (step * 2),
      dz =
        Math.abs(
          naturalElevationAt(sx, z + step) - naturalElevationAt(sx, z - step),
        ) /
        (step * 2);
    slope = Math.max(dx, dz);
  }
  const cliff = water === "none" && slope >= 1.15,
    traversal: TraversalKind =
      water !== "none"
        ? "blocked-water"
        : cliff
          ? "blocked-cliff"
          : slope >= 0.42
            ? "difficult"
            : "walkable";
  return {
    elevation: core.elevation,
    water,
    traversal,
    walkable: traversal === "walkable" || traversal === "difficult",
    slope,
    cliff,
    riverBank: core.hydro.bank && core.hydro.water === "none",
    freshwaterDistance: core.hydro.distance,
    catchmentCode: core.hydro.code,
  };
}

export function freshwaterDistanceAt(x: number, z: number) {
  const sx = wrapSourceX(x),
    macro = macroSampleAt(sourceToLonLat(sx, z));
  if (macro.domain === "Lake") return 0;
  return Math.max(0, preparedElevationAt(sx, z).hydro.distance);
}

export const hydrologyDiagnostics = {
  basinSize: BASIN_SIZE,
  basinColumns: BASIN_COLUMNS,
  basinRows: BASIN_ROWS,
  cacheLimit: CACHE_LIMIT,
  coreCacheLimit: CORE_CACHE_LIMIT,
  get cacheSize() {
    return basinCache.size;
  },
  get coreCacheSize() {
    return coreCache.size;
  },
  get generatedBasins() {
    return generatedBasins;
  },
  get queryCount() {
    return queryCount;
  },
} as const;
