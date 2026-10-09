import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import { nearestPlace, roadAt } from "./geography.ts";
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
export type DrainageRecipe = {
  code: string;
  continentId: number;
  points: DrainagePoint[];
  tributary: DrainagePoint[];
  width: number;
  lake: { x: number; z: number; radius: number; level: number } | null;
  outlet: "ocean" | "lake" | "coast";
};

type BasinEntry = { recipe: DrainageRecipe | null; used: number };
type HydroHit = {
  water: "none" | "lake" | "river";
  bank: boolean;
  distance: number;
  bed: number;
  code: string | null;
};

const BASIN_SIZE = 4096;
const BASIN_COLUMNS = SOURCE_PRESENTATION_WIDTH / BASIN_SIZE;
const BASIN_ROWS = (SOURCE_PRESENTATION_POLE_DISTANCE * 2) / BASIN_SIZE;
const CACHE_LIMIT = 96;
const RIVER_STEPS = 14;
const RIVER_STEP = 520;
const GRADIENT_STEP = 180;
const SEARCH_RADIUS = 2;
const basinCache = new Map<string, BasinEntry>();
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
function coordinateValue(x: number, z: number, layer: number): number {
  let n =
    digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/SURFACE`) ^
    Math.imul(x, 374761393) ^
    Math.imul(z, 668265263) ^
    Math.imul(layer, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return (n ^ (n >>> 16)) >>> 0;
}
function field(x: number, z: number, spacing: number, layer: number): number {
  const gx = Math.floor(x / spacing),
    gz = Math.floor(z / spacing),
    tx = smooth01(x / spacing - gx),
    tz = smooth01(z / spacing - gz),
    at = (a: number, b: number) => (coordinateValue(a, b, layer) % 10001) / 10000;
  return lerp(lerp(at(gx, gz), at(gx + 1, gz), tx), lerp(at(gx, gz + 1), at(gx + 1, gz + 1), tx), tz);
}
function terrainNoise(x: number, z: number) {
  const c = Math.SQRT1_2,
    rx = (x + z) * c,
    rz = (z - x) * c;
  return field(x, z, 210, 1) * 0.48 + field(rx, rz, 88, 2) * 0.32 + field(x - z * 0.31, z + x * 0.19, 37, 3) * 0.2;
}

/** Natural priority-3/4 base before settlement/road earthworks. */
export function naturalElevationAt(x: number, z: number): number {
  const macro = macroSampleAt(sourceToLonLat(x, z));
  if (macro.domain === "Ocean") return -2.8;
  if (macro.domain === "Lake") return -1.8;
  const noise = terrainNoise(x, z),
    broad = terrainNoise(x * 0.37 + 1137, z * 0.37 - 911),
    base = macro.domain === "Island" ? 3.5 + noise * 13 : 3.5 + broad * 8 + noise * 4.5,
    macroRelief = macro.reliefM * (0.84 + 0.16 * noise),
    cap = macro.domain === "Island" ? 180 : 620,
    terrain = Math.min(cap, base + macroRelief),
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
  return macroSampleAt(sourceToLonLat(x, z)).coastDistanceRad * SOURCE_PRESENTATION_RADIUS;
}
function flowDirection(x: number, z: number, continentId: number, step: number) {
  const left = coastSourceAt(x - GRADIENT_STEP, z),
    right = coastSourceAt(x + GRADIENT_STEP, z),
    up = coastSourceAt(x, z - GRADIENT_STEP),
    down = coastSourceAt(x, z + GRADIENT_STEP),
    gx = (right - left) / (GRADIENT_STEP * 2),
    gz = (down - up) / (GRADIENT_STEP * 2),
    centre = lonLatToSource(MACRO_PLAN.continents[continentId].center.lon, MACRO_PLAN.continents[continentId].center.lat),
    awayX = wrapSourceX(x - centre.x),
    awayZ = z - centre.z,
    awayLength = Math.hypot(awayX, awayZ) || 1,
    gradientLength = Math.hypot(gx, gz),
    fallbackX = awayX / awayLength,
    fallbackZ = awayZ / awayLength,
    baseX = gradientLength > 0.015 ? -gx / gradientLength : fallbackX,
    baseZ = gradientLength > 0.015 ? -gz / gradientLength : fallbackZ,
    turn = (addressed(`FLOW/${continentId}/${Math.round(x / 64)}/${Math.round(z / 64)}/${step}`) - 0.5) * 0.5,
    dx = baseX - baseZ * turn,
    dz = baseZ + baseX * turn,
    length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}
function pointDistanceToSegment(px: number, pz: number, a: DrainagePoint, b: DrainagePoint) {
  const dx = wrapSourceX(b.x - a.x),
    dz = b.z - a.z,
    qx = wrapSourceX(px - a.x),
    qz = pz - a.z,
    length2 = dx * dx + dz * dz;
  const t = length2 <= 1e-8 ? 0 : Math.max(0, Math.min(1, (qx * dx + qz * dz) / length2));
  return { distance: Math.hypot(qx - dx * t, qz - dz * t), t };
}
function evictBasins() {
  if (basinCache.size <= CACHE_LIMIT) return;
  const oldest = [...basinCache.entries()].sort((a, b) => a[1].used - b[1].used);
  for (let i = 0; i < basinCache.size - CACHE_LIMIT; i++) basinCache.delete(oldest[i][0]);
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
      width = 10 + addressed(`${key}/width`) * 11;
    let x = head.x,
      z = head.z,
      previousBed = Math.max(2, naturalElevationAt(x, z) - 1.2),
      outlet: DrainageRecipe["outlet"] = "coast";
    points.push({ x, z, bed: previousBed });
    for (let step = 0; step < RIVER_STEPS; step++) {
      const direction = flowDirection(x, z, macro.continentId, step),
        stride = RIVER_STEP * (0.82 + addressed(`${key}/stride/${step}`) * 0.36),
        nx = wrapSourceX(x + direction.x * stride),
        nz = Math.max(-SOURCE_PRESENTATION_POLE_DISTANCE + 8, Math.min(SOURCE_PRESENTATION_POLE_DISTANCE - 8, z + direction.z * stride)),
        nextMacro = macroSampleAt(sourceToLonLat(nx, nz)),
        natural = naturalElevationAt(nx, nz);
      if (!nextMacro.land) {
        outlet = nextMacro.domain === "Lake" ? "lake" : "ocean";
        points.push({ x: nx, z: nz, bed: Math.min(-0.35, previousBed - 0.4) });
        break;
      }
      const bed = Math.min(natural - 0.8, previousBed - 0.24);
      points.push({ x: nx, z: nz, bed });
      x = nx;
      z = nz;
      previousBed = bed;
      if (nextMacro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS < 18) {
        outlet = "coast";
        break;
      }
    }
    if (points.length >= 5) {
      const joinIndex = Math.min(points.length - 2, Math.max(2, Math.floor(points.length * 0.48))),
        join = points[joinIndex],
        before = points[Math.max(0, joinIndex - 1)],
        tangentX = wrapSourceX(join.x - before.x),
        tangentZ = join.z - before.z,
        length = Math.hypot(tangentX, tangentZ) || 1,
        side = addressed(`${key}/tributary-side`) < 0.5 ? -1 : 1,
        startX = wrapSourceX(join.x - tangentZ / length * side * (820 + addressed(`${key}/tributary-offset`) * 680)),
        startZ = Math.max(-SOURCE_PRESENTATION_POLE_DISTANCE + 8, Math.min(SOURCE_PRESENTATION_POLE_DISTANCE - 8, join.z + tangentX / length * side * (820 + addressed(`${key}/tributary-offset-z`) * 680))),
        tributary: DrainagePoint[] = [],
        tributarySteps = 5,
        startBed = Math.max(join.bed + 2.5, naturalElevationAt(startX, startZ) - 0.7);
      for (let i = 0; i <= tributarySteps; i++) {
        const t = i / tributarySteps,
          bend = Math.sin(Math.PI * t) * (addressed(`${key}/tributary-bend`) - 0.5) * 360;
        tributary.push({
          x: wrapSourceX(lerp(startX, join.x, t) - tangentZ / length * bend),
          z: lerp(startZ, join.z, t) + tangentX / length * bend,
          bed: lerp(startBed, join.bed, t),
        });
      }
      const lakeIndex = Math.min(points.length - 2, 3),
        lakePoint = points[lakeIndex],
        lake = addressed(`${key}/lake`) > 0.72 && macroSampleAt(sourceToLonLat(lakePoint.x, lakePoint.z)).land
          ? {
              x: lakePoint.x,
              z: lakePoint.z,
              radius: 58 + addressed(`${key}/lake-radius`) * 92,
              level: Math.min(lakePoint.bed + 0.35, naturalElevationAt(lakePoint.x, lakePoint.z) - 0.45),
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

function nearestHydrology(x: number, z: number): HydroHit {
  queryCount++;
  const canonicalX = wrapSourceX(x),
    gx = Math.floor((canonicalX + SOURCE_PRESENTATION_WIDTH / 2) / BASIN_SIZE),
    gz = Math.floor((z + SOURCE_PRESENTATION_POLE_DISTANCE) / BASIN_SIZE);
  let best: HydroHit = { water: "none", bank: false, distance: Infinity, bed: naturalElevationAt(x, z), code: null };
  for (let dz = -SEARCH_RADIUS; dz <= SEARCH_RADIUS; dz++) {
    for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
      const recipe = drainageRecipeAt(gx + dx, gz + dz);
      if (!recipe) continue;
      if (recipe.lake) {
        const distance = Math.hypot(wrapSourceX(x - recipe.lake.x), z - recipe.lake.z) - recipe.lake.radius;
        if (distance < best.distance) best = { water: distance <= 0 ? "lake" : "none", bank: distance <= 24, distance, bed: recipe.lake.level, code: recipe.code };
      }
      for (const path of [recipe.points, recipe.tributary]) {
        for (let i = 0; i < path.length - 1; i++) {
          const hit = pointDistanceToSegment(x, z, path[i], path[i + 1]),
            width = path === recipe.points ? recipe.width : recipe.width * 0.62,
            distance = hit.distance - width,
            bed = lerp(path[i].bed, path[i + 1].bed, hit.t);
          if (distance < best.distance)
            best = { water: distance <= 0 ? "river" : "none", bank: distance <= width + 20, distance, bed, code: recipe.code };
        }
      }
    }
  }
  return best;
}

function preparedElevationAt(x: number, z: number) {
  const macro = macroSampleAt(sourceToLonLat(x, z));
  if (macro.domain === "Ocean") return -2.8;
  if (macro.domain === "Lake") return -1.8;
  const natural = naturalElevationAt(x, z),
    hydro = nearestHydrology(x, z);
  let elevation = natural;
  if (hydro.water === "lake") elevation = hydro.bed - 0.25;
  else if (hydro.water === "river" || hydro.bank) {
    const influence = smooth01(1 - Math.max(0, hydro.distance) / 28);
    elevation = lerp(natural, Math.min(natural, hydro.bed), hydro.water === "river" ? 1 : influence);
  }
  const place = nearestPlace(x, z),
    placeDistance = place ? Math.hypot(wrapSourceX(x - place.x), z - place.z) : Infinity,
    placeRadius = place?.kind === "city" ? 430 : 90,
    placeBlend = place ? smooth01(Math.max(0, Math.min(1, (placeDistance - placeRadius) / 80))) : 1,
    road = roadAt(x, z),
    roadBlend = road ? smooth01(Math.max(0, Math.min(1, (Math.abs(z - road.z) - 5) / 7))) : 1,
    flatten = Math.min(placeBlend, roadBlend);
  if (hydro.water === "none") elevation = lerp(3, elevation, flatten);
  return { elevation, hydro, macro };
}

export function surfaceElevationAt(x: number, z: number) {
  return preparedElevationAt(x, z).elevation;
}

export function surfaceAt(x: number, z: number): SurfaceSample {
  const core = preparedElevationAt(x, z),
    macroWater: WaterKind = core.macro.domain === "Ocean" ? "ocean" : core.macro.domain === "Lake" ? "lake" : "none",
    water: WaterKind = macroWater !== "none" ? macroWater : core.hydro.water,
    step = 2,
    dx = Math.abs(surfaceElevationAt(x + step, z) - surfaceElevationAt(x - step, z)) / (step * 2),
    dz = Math.abs(surfaceElevationAt(x, z + step) - surfaceElevationAt(x, z - step)) / (step * 2),
    slope = Math.max(dx, dz),
    cliff = water === "none" && slope >= 1.15,
    traversal: TraversalKind = water !== "none" ? "blocked-water" : cliff ? "blocked-cliff" : slope >= 0.42 ? "difficult" : "walkable";
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
  const macro = macroSampleAt(sourceToLonLat(x, z));
  if (macro.domain === "Lake") return 0;
  return Math.max(0, nearestHydrology(x, z).distance);
}

export const hydrologyDiagnostics = {
  basinSize: BASIN_SIZE,
  cacheLimit: CACHE_LIMIT,
  get cacheSize() {
    return basinCache.size;
  },
  get generatedBasins() {
    return generatedBasins;
  },
  get queryCount() {
    return queryCount;
  },
} as const;
