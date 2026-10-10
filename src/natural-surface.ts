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

export type NaturalWaterKind = "none" | "ocean" | "lake" | "river";
export type NaturalTraversalKind =
  | "walkable"
  | "difficult"
  | "blocked-water"
  | "blocked-cliff";

export type NaturalSurfaceSample = {
  elevation: number;
  water: NaturalWaterKind;
  traversal: NaturalTraversalKind;
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
type SegmentCandidate = {
  kind: "segment";
  a: DrainagePoint;
  b: DrainagePoint;
  width: number;
  code: string;
};
type LakeCandidate = {
  kind: "lake";
  x: number;
  z: number;
  radius: number;
  level: number;
  code: string;
};
type HydroCandidate = SegmentCandidate | LakeCandidate;
type QueryEntry = { candidates: HydroCandidate[]; used: number };

export const HYDRO_BASIN_SIZE = 4096;
const BASIN_COLUMNS = Math.round(SOURCE_PRESENTATION_WIDTH / HYDRO_BASIN_SIZE);
const BASIN_ROWS = Math.round(
  (SOURCE_PRESENTATION_POLE_DISTANCE * 2) / HYDRO_BASIN_SIZE,
);
const BASIN_CACHE_LIMIT = 96;
const QUERY_CELL = 512;
const QUERY_CACHE_LIMIT = 320;
const QUERY_BASIN_RADIUS = 2;
const QUERY_MARGIN = HYDRO_BASIN_SIZE * 0.82 + Math.SQRT2 * QUERY_CELL * 0.5 + 64;
const RIVER_STEPS = 42;
const RIVER_STEP = 185;
const GRADIENT_STEP = 150;
const basinCache = new Map<string, BasinEntry>();
const queryCache = new Map<string, QueryEntry>();
let useTick = 0;
let generatedBasins = 0;
let queryCount = 0;

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function addressed(address: string) {
  return digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/${address}`) / 4294967296;
}
function smooth01(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Wrap-safe deterministic detail: all phases are evaluated in canonical lon/lat space. */
function sphericalNoise(x: number, z: number, layer: number) {
  const p = sourceToLonLat(wrapSourceX(x), z),
    phase = addressed(`SURFACE-NOISE/${layer}`) * Math.PI * 2,
    a = Math.sin(p.lon * (7 + layer * 2.1) + p.lat * (5 + layer * 1.7) + phase),
    b = Math.cos(p.lon * (13 + layer * 2.7) - p.lat * (9 + layer * 1.3) - phase * 0.73),
    c = Math.sin(p.lon * (23 + layer * 3.2) + p.lat * (17 + layer * 1.9) + phase * 0.41);
  return Math.max(0, Math.min(1, (a * 0.5 + b * 0.3 + c * 0.2 + 1) * 0.5));
}

export function naturalElevationAt(x: number, z: number): number {
  const sx = wrapSourceX(x),
    macro = macroSampleAt(sourceToLonLat(sx, z));
  if (macro.domain === "Ocean") return -2.8;
  if (macro.domain === "Lake") return -1.8;
  const noise =
      sphericalNoise(sx, z, 0) * 0.5 +
      sphericalNoise(sx, z, 1) * 0.32 +
      sphericalNoise(sx, z, 2) * 0.18,
    broad = sphericalNoise(sx, z, 3),
    mountainWeight = smooth01(macro.mountainIntensity / 0.46),
    ridgeField = sphericalNoise(sx, z, 7) * 0.68 + sphericalNoise(sx, z, 8) * 0.32,
    ridge = 1 - Math.abs(ridgeField * 2 - 1),
    ridgeDetail = (ridge - 0.4) * Math.min(125, macro.reliefM * 0.3) * mountainWeight,
    base = macro.domain === "Island" ? 3.5 + noise * 13 : 3.5 + broad * 8 + noise * 4.5,
    macroRelief = macro.reliefM * (0.76 + 0.24 * noise) + ridgeDetail,
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
    x =
      -SOURCE_PRESENTATION_WIDTH / 2 +
      (cx + 0.18 + addressed(`${key}/x`) * 0.64) * HYDRO_BASIN_SIZE,
    z =
      -SOURCE_PRESENTATION_POLE_DISTANCE +
      (gz + 0.18 + addressed(`${key}/z`) * 0.64) * HYDRO_BASIN_SIZE;
  return { x: wrapSourceX(x), z };
}
function coastSourceAt(x: number, z: number) {
  return (
    macroSampleAt(sourceToLonLat(wrapSourceX(x), z)).coastDistanceRad *
    SOURCE_PRESENTATION_RADIUS
  );
}
function flowDirection(x: number, z: number, continentId: number, step: number) {
  const sx = wrapSourceX(x),
    left = coastSourceAt(sx - GRADIENT_STEP, z),
    right = coastSourceAt(sx + GRADIENT_STEP, z),
    north = coastSourceAt(sx, z - GRADIENT_STEP),
    south = coastSourceAt(sx, z + GRADIENT_STEP),
    gx = (right - left) / (GRADIENT_STEP * 2),
    gz = (south - north) / (GRADIENT_STEP * 2),
    centre = lonLatToSource(
      MACRO_PLAN.continents[continentId].center.lon,
      MACRO_PLAN.continents[continentId].center.lat,
    ),
    awayX = wrapSourceX(sx - centre.x),
    awayZ = z - centre.z,
    awayLength = Math.hypot(awayX, awayZ) || 1,
    gradientLength = Math.hypot(gx, gz),
    fallbackX = awayX / awayLength,
    fallbackZ = awayZ / awayLength,
    baseX = gradientLength > 0.012 ? -gx / gradientLength : fallbackX,
    baseZ = gradientLength > 0.012 ? -gz / gradientLength : fallbackZ,
    turn =
      (sphericalNoise(sx + step * 17, z - step * 11, 31 + continentId) - 0.5) * 0.92 +
      (sphericalNoise(sx - step * 7, z + step * 13, 41 + continentId) - 0.5) * 0.38;
  const dx = baseX - baseZ * turn,
    dz = baseZ + baseX * turn,
    length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}
function pointDistanceToSegment(
  px: number,
  pz: number,
  a: DrainagePoint,
  b: DrainagePoint,
) {
  const dx = wrapSourceX(b.x - a.x),
    dz = b.z - a.z,
    qx = wrapSourceX(px - a.x),
    qz = pz - a.z,
    length2 = dx * dx + dz * dz,
    t = length2 <= 1e-8 ? 0 : Math.max(0, Math.min(1, (qx * dx + qz * dz) / length2));
  return { distance: Math.hypot(qx - dx * t, qz - dz * t), t };
}
function evictBasins() {
  if (basinCache.size <= BASIN_CACHE_LIMIT) return;
  const oldest = [...basinCache.entries()].sort((a, b) => a[1].used - b[1].used);
  for (let i = 0; i < basinCache.size - BASIN_CACHE_LIMIT; i++)
    basinCache.delete(oldest[i][0]);
}
function extendToWater(
  points: DrainagePoint[],
  continentId: number,
  key: string,
): "ocean" | "lake" | null {
  let current = points[points.length - 1],
    previousBed = current.bed;
  for (let extra = 0; extra < 30; extra++) {
    const direction = flowDirection(current.x, current.z, continentId, RIVER_STEPS + extra),
      stride = 145 + addressed(`${key}/outlet/${extra}`) * 95,
      nx = wrapSourceX(current.x + direction.x * stride),
      nz = Math.max(
        -SOURCE_PRESENTATION_POLE_DISTANCE + 8,
        Math.min(
          SOURCE_PRESENTATION_POLE_DISTANCE - 8,
          current.z + direction.z * stride,
        ),
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
function curvedTributary(key: string, points: DrainagePoint[]) {
  const joinIndex = Math.min(points.length - 2, Math.max(2, Math.floor(points.length * 0.46))),
    join = points[joinIndex],
    before = points[Math.max(0, joinIndex - 1)],
    tx = wrapSourceX(join.x - before.x),
    tz = join.z - before.z,
    length = Math.hypot(tx, tz) || 1,
    side = addressed(`${key}/tributary-side`) < 0.5 ? -1 : 1,
    normalX = (-tz / length) * side,
    normalZ = (tx / length) * side,
    offset = 850 + addressed(`${key}/tributary-offset`) * 700,
    startX = wrapSourceX(join.x + normalX * offset - (tx / length) * 380),
    startZ = Math.max(
      -SOURCE_PRESENTATION_POLE_DISTANCE + 8,
      Math.min(
        SOURCE_PRESENTATION_POLE_DISTANCE - 8,
        join.z + normalZ * offset - (tz / length) * 380,
      ),
    ),
    startBed = Math.max(join.bed + 3.2, naturalElevationAt(startX, startZ) - 0.7),
    curve = 320 + addressed(`${key}/tributary-curve`) * 360,
    result: DrainagePoint[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20,
      ease = t * t * (3 - 2 * t),
      bend =
        Math.sin(Math.PI * t) * curve * side +
        Math.sin(Math.PI * 2 * t) * curve * 0.2;
    result.push({
      x: wrapSourceX(lerp(startX, join.x, ease) + normalX * bend * (1 - t)),
      z: lerp(startZ, join.z, ease) + normalZ * bend * (1 - t),
      bed: lerp(startBed, join.bed, t),
    });
  }
  result[result.length - 1] = { ...join };
  return result;
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
  if (
    macro.land &&
    macro.domain !== "Lake" &&
    macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS > 900
  ) {
    const points: DrainagePoint[] = [],
      width = 10 + addressed(`${key}/width`) * 13;
    let x = head.x,
      z = head.z,
      previousBed = Math.max(2, naturalElevationAt(x, z) - 1.2),
      outlet: "ocean" | "lake" | null = null;
    points.push({ x, z, bed: previousBed });
    for (let step = 0; step < RIVER_STEPS; step++) {
      const direction = flowDirection(x, z, macro.continentId, step),
        stride = RIVER_STEP * (0.78 + addressed(`${key}/stride/${step}`) * 0.44),
        nx = wrapSourceX(x + direction.x * stride),
        nz = Math.max(
          -SOURCE_PRESENTATION_POLE_DISTANCE + 8,
          Math.min(SOURCE_PRESENTATION_POLE_DISTANCE - 8, z + direction.z * stride),
        ),
        nextMacro = macroSampleAt(sourceToLonLat(nx, nz));
      if (!nextMacro.land) {
        outlet = nextMacro.domain === "Lake" ? "lake" : "ocean";
        points.push({ x: nx, z: nz, bed: Math.min(-0.35, previousBed - 0.4) });
        break;
      }
      const bed = Math.min(naturalElevationAt(nx, nz) - 0.8, previousBed - 0.2);
      points.push({ x: nx, z: nz, bed });
      x = nx;
      z = nz;
      previousBed = bed;
    }
    if (!outlet && points.length >= 5)
      outlet = extendToWater(points, macro.continentId, key);
    if (outlet && points.length >= 5) {
      const tributary = curvedTributary(key, points),
        lakeIndex = Math.min(points.length - 2, Math.max(4, Math.floor(points.length * 0.2))),
        lakePoint = points[lakeIndex],
        lake =
          addressed(`${key}/lake`) > 0.72 &&
          macroSampleAt(sourceToLonLat(lakePoint.x, lakePoint.z)).land
            ? {
                x: lakePoint.x,
                z: lakePoint.z,
                radius: 70 + addressed(`${key}/lake-radius`) * 110,
                level: Math.min(
                  lakePoint.bed + 0.35,
                  naturalElevationAt(lakePoint.x, lakePoint.z) - 0.45,
                ),
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

export function drainageRecipesNear(x: number, z: number, radius = 3) {
  const canonicalX = wrapSourceX(x),
    gx = Math.floor((canonicalX + SOURCE_PRESENTATION_WIDTH / 2) / HYDRO_BASIN_SIZE),
    gz = Math.floor((z + SOURCE_PRESENTATION_POLE_DISTANCE) / HYDRO_BASIN_SIZE),
    result = new Map<string, DrainageRecipe>();
  for (let dz = -radius; dz <= radius; dz++)
    for (let dx = -radius; dx <= radius; dx++) {
      const recipe = drainageRecipeAt(gx + dx, gz + dz);
      if (recipe) result.set(recipe.code, recipe);
    }
  return [...result.values()];
}
function evictQueries() {
  if (queryCache.size <= QUERY_CACHE_LIMIT) return;
  const oldest = [...queryCache.entries()].sort((a, b) => a[1].used - b[1].used);
  for (let i = 0; i < queryCache.size - QUERY_CACHE_LIMIT; i++)
    queryCache.delete(oldest[i][0]);
}
function queryCellKey(x: number, z: number) {
  return `${Math.floor((wrapSourceX(x) + SOURCE_PRESENTATION_WIDTH / 2) / QUERY_CELL)}/${Math.floor((z + SOURCE_PRESENTATION_POLE_DISTANCE) / QUERY_CELL)}`;
}
function queryCandidates(x: number, z: number): HydroCandidate[] {
  const key = queryCellKey(x, z),
    cached = queryCache.get(key);
  if (cached) {
    cached.used = ++useTick;
    return cached.candidates;
  }
  const canonicalX = wrapSourceX(x),
    cellX = Math.floor((canonicalX + SOURCE_PRESENTATION_WIDTH / 2) / QUERY_CELL),
    cellZ = Math.floor((z + SOURCE_PRESENTATION_POLE_DISTANCE) / QUERY_CELL),
    centerX = wrapSourceX(
      -SOURCE_PRESENTATION_WIDTH / 2 + (cellX + 0.5) * QUERY_CELL,
    ),
    centerZ = -SOURCE_PRESENTATION_POLE_DISTANCE + (cellZ + 0.5) * QUERY_CELL,
    gx = Math.floor((centerX + SOURCE_PRESENTATION_WIDTH / 2) / HYDRO_BASIN_SIZE),
    gz = Math.floor((centerZ + SOURCE_PRESENTATION_POLE_DISTANCE) / HYDRO_BASIN_SIZE),
    candidates: HydroCandidate[] = [];
  for (let dz = -QUERY_BASIN_RADIUS; dz <= QUERY_BASIN_RADIUS; dz++)
    for (let dx = -QUERY_BASIN_RADIUS; dx <= QUERY_BASIN_RADIUS; dx++) {
      const recipe = drainageRecipeAt(gx + dx, gz + dz);
      if (!recipe) continue;
      if (recipe.lake) {
        const lakeDistance = Math.hypot(
          wrapSourceX(centerX - recipe.lake.x),
          centerZ - recipe.lake.z,
        );
        if (lakeDistance <= QUERY_MARGIN + recipe.lake.radius + 24)
          candidates.push({
            kind: "lake",
            x: recipe.lake.x,
            z: recipe.lake.z,
            radius: recipe.lake.radius,
            level: recipe.lake.level,
            code: recipe.code,
          });
      }
      for (const [path, width] of [
        [recipe.points, recipe.width],
        [recipe.tributary, recipe.width * 0.62],
      ] as const)
        for (let i = 0; i < path.length - 1; i++) {
          const hit = pointDistanceToSegment(centerX, centerZ, path[i], path[i + 1]);
          if (hit.distance <= QUERY_MARGIN + width + 24)
            candidates.push({
              kind: "segment",
              a: path[i],
              b: path[i + 1],
              width,
              code: recipe.code,
            });
        }
    }
  queryCache.set(key, { candidates, used: ++useTick });
  evictQueries();
  return candidates;
}
function nearestHydrology(x: number, z: number): HydroHit {
  queryCount++;
  const canonicalX = wrapSourceX(x);
  let best: HydroHit = {
    water: "none",
    bank: false,
    distance: Infinity,
    bed: naturalElevationAt(canonicalX, z),
    code: null,
  };
  for (const candidate of queryCandidates(canonicalX, z)) {
    if (candidate.kind === "lake") {
      const distance =
        Math.hypot(wrapSourceX(canonicalX - candidate.x), z - candidate.z) -
        candidate.radius;
      if (distance < best.distance)
        best = {
          water: distance <= 0 ? "lake" : "none",
          bank: distance > 0 && distance <= 26,
          distance,
          bed: candidate.level,
          code: candidate.code,
        };
      continue;
    }
    const hit = pointDistanceToSegment(canonicalX, z, candidate.a, candidate.b),
      distance = hit.distance - candidate.width,
      bed = lerp(candidate.a.bed, candidate.b.bed, hit.t);
    if (distance < best.distance)
      best = {
        water: distance <= 0 ? "river" : "none",
        bank: distance > 0 && distance <= 20,
        distance,
        bed,
        code: candidate.code,
      };
  }
  return best;
}

export function naturalSurfaceElevationAt(x: number, z: number) {
  const sx = wrapSourceX(x),
    macro = macroSampleAt(sourceToLonLat(sx, z));
  if (macro.domain === "Ocean") return -2.8;
  if (macro.domain === "Lake") return -1.8;
  const natural = naturalElevationAt(sx, z),
    hydro = nearestHydrology(sx, z);
  if (hydro.water === "lake") return hydro.bed - 0.25;
  if (hydro.water === "river") return Math.min(natural, hydro.bed);
  if (hydro.bank) {
    const influence = smooth01(1 - Math.max(0, hydro.distance) / 20);
    return lerp(natural, Math.min(natural, hydro.bed), influence);
  }
  return natural;
}

export function naturalSurfaceAt(x: number, z: number): NaturalSurfaceSample {
  const sx = wrapSourceX(x),
    macro = macroSampleAt(sourceToLonLat(sx, z)),
    hydro = macro.land ? nearestHydrology(sx, z) : null,
    water: NaturalWaterKind =
      macro.domain === "Ocean"
        ? "ocean"
        : macro.domain === "Lake"
          ? "lake"
          : hydro?.water ?? "none",
    elevation =
      water === "ocean"
        ? -2.8
        : water === "lake" && macro.domain === "Lake"
          ? -1.8
          : naturalSurfaceElevationAt(sx, z),
    step = 2,
    dx =
      Math.abs(naturalElevationAt(sx + step, z) - naturalElevationAt(sx - step, z)) /
      (step * 2),
    dz =
      Math.abs(naturalElevationAt(sx, z + step) - naturalElevationAt(sx, z - step)) /
      (step * 2),
    slope = Math.max(dx, dz),
    cliff = water === "none" && slope >= 1.15,
    traversal: NaturalTraversalKind =
      water !== "none"
        ? "blocked-water"
        : cliff
          ? "blocked-cliff"
          : slope >= 0.42
            ? "difficult"
            : "walkable";
  return {
    elevation,
    water,
    traversal,
    walkable: traversal === "walkable" || traversal === "difficult",
    slope,
    cliff,
    riverBank: Boolean(hydro?.bank && hydro.water === "none"),
    freshwaterDistance:
      macro.domain === "Lake" ? 0 : Math.max(0, hydro?.distance ?? Infinity),
    catchmentCode: macro.domain === "Lake" ? macro.code : hydro?.code ?? null,
  };
}

export function naturalFreshwaterDistanceAt(x: number, z: number) {
  return naturalSurfaceAt(x, z).freshwaterDistance;
}

export const naturalHydrologyDiagnostics = {
  basinSize: HYDRO_BASIN_SIZE,
  basinColumns: BASIN_COLUMNS,
  basinRows: BASIN_ROWS,
  basinCacheLimit: BASIN_CACHE_LIMIT,
  queryCacheLimit: QUERY_CACHE_LIMIT,
  get basinCacheSize() {
    return basinCache.size;
  },
  get queryCacheSize() {
    return queryCache.size;
  },
  get generatedBasins() {
    return generatedBasins;
  },
  get queryCount() {
    return queryCount;
  },
} as const;
