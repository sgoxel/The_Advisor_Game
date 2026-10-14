import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import { MACRO_PLAN, macroSampleAt, mountainSystems } from "./macro-geography.ts";
import {
  CANONICAL_METRES_PER_SOURCE_UNIT,
  SOURCE_PRESENTATION_POLE_DISTANCE,
  SOURCE_PRESENTATION_RADIUS,
  lonLatToSource,
  sourceToLonLat,
  wrapSourceX,
} from "./planet.ts";
import type { SurfaceMaterial, SurfaceWater } from "./final-surface.ts";

/** Deterministic priority-3/4 terrain + freshwater authority for WP-S003-003-001. */
export type DrainagePoint = Readonly<{ x: number; z: number; bed: number }>;
export type DrainageRecipe = Readonly<{
  code: string;
  continentId: number;
  width: number;
  points: readonly DrainagePoint[];
  tributary: readonly DrainagePoint[];
  outlet: "ocean" | "lake";
}>;
export type DrainageSegment = Readonly<{
  code: string;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  width: number;
  bedA: number;
  bedB: number;
}>;
export type NaturalSurface = Readonly<{
  groundHeight: number;
  material: SurfaceMaterial;
  water: SurfaceWater;
  walkable: boolean;
  vegetationDensityScale: number;
  slope: number;
  cliff: boolean;
  freshwaterDistanceSource: number;
  catchmentCode: string | null;
}>;

type SegmentHit = { segment: DrainageSegment; distance: number; t: number } | null;

const TAU = Math.PI * 2;
const BUCKET_SIZE = 4096;
const RIVER_SYSTEMS_PER_CONTINENT = 4;
const MAX_MAIN_STEPS = 96;
const SAMPLE_STEP_SOURCE = 12;
export const RIVER_BANK_HALF_WIDTH_SOURCE = 4.5;
const segmentsByBucket = new Map<string, DrainageSegment[]>();
let naturalQueries = 0;
let segmentChecks = 0;

function digest(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
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
function phase(layer: number) {
  return addressed(`NATURAL-SURFACE/PHASE/${layer}`) * TAU;
}
function sphericalDetail(x: number, z: number, layer: number) {
  const p = sourceToLonLat(wrapSourceX(x), z),
    q = phase(layer),
    a = Math.sin(p.lon * (13 + layer * 2) + p.lat * (17 + layer * 3) + q),
    b = Math.cos(p.lon * (23 + layer * 3) - p.lat * (11 + layer * 2) - q * 0.67),
    c = Math.sin(p.lon * (31 + layer * 2) + p.lat * (29 + layer) + q * 1.31);
  return a * 0.42 + b * 0.34 + c * 0.24;
}

/** Pure natural elevation; camera/LOD/renderer state is never an input. */
export function naturalElevationAt(x: number, z: number) {
  const sx = wrapSourceX(x),
    macro = macroSampleAt(sourceToLonLat(sx, z));
  if (macro.domain === "Ocean") return -2.8;
  if (macro.domain === "Lake") return -1.8;

  const broad = sphericalDetail(sx, z, 0),
    detail = sphericalDetail(sx, z, 2),
    shoulder = sphericalDetail(sx, z, 4),
    mountainWeight = smooth01(macro.mountainIntensity / 0.58),
    base = macro.domain === "Island" ? 18 + broad * 18 + detail * 7 : 22 + broad * 24 + detail * 10,
    coherentRelief = macro.reliefM * (0.78 + broad * 0.06),
    localRelief = macro.reliefM * mountainWeight * (detail * 0.11 + shoulder * 0.06),
    cap = macro.domain === "Island" ? 210 : 680,
    terrain = Math.max(1.2, Math.min(cap, base + coherentRelief + localRelief)),
    coastSource = macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS,
    coastWeight = smooth01(Math.max(0, Math.min(1, coastSource / 90)));
  return lerp(0.08, terrain, coastWeight);
}

function coastSourceAt(x: number, z: number) {
  return macroSampleAt(sourceToLonLat(wrapSourceX(x), z)).coastDistanceRad * SOURCE_PRESENTATION_RADIUS;
}
function coastwardDirection(x: number, z: number, continentId: number) {
  const step = 700,
    left = coastSourceAt(x - step, z),
    right = coastSourceAt(x + step, z),
    north = coastSourceAt(x, z - step),
    south = coastSourceAt(x, z + step),
    gx = (right - left) / (step * 2),
    gz = (south - north) / (step * 2),
    centre = lonLatToSource(MACRO_PLAN.continents[continentId].center.lon, MACRO_PLAN.continents[continentId].center.lat),
    outwardX = wrapSourceX(x - centre.x),
    outwardZ = z - centre.z,
    outwardLength = Math.hypot(outwardX, outwardZ) || 1,
    gradientLength = Math.hypot(gx, gz);
  if (gradientLength > 0.002) return { x: -gx / gradientLength, z: -gz / gradientLength };
  return { x: outwardX / outwardLength, z: outwardZ / outwardLength };
}
function rotate(direction: { x: number; z: number }, angle: number) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: direction.x * c - direction.z * s, z: direction.x * s + direction.z * c };
}
function blendDirection(a: { x: number; z: number }, b: { x: number; z: number }, amount: number) {
  const x = a.x * (1 - amount) + b.x * amount,
    z = a.z * (1 - amount) + b.z * amount,
    length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
}
function clampZ(z: number) {
  return Math.max(-SOURCE_PRESENTATION_POLE_DISTANCE + 8, Math.min(SOURCE_PRESENTATION_POLE_DISTANCE - 8, z));
}

function traceRiver(continentId: number, slot: number): DrainageRecipe | null {
  const candidates = mountainSystems.filter((system) => system.continent === continentId);
  if (!candidates.length) return null;
  const system = candidates[slot % candidates.length],
    sourcePosition = system.path[Math.min(system.path.length - 1, Math.max(0, Math.floor(system.path.length * (0.28 + 0.13 * (slot % 3)))))],
    source = lonLatToSource(sourcePosition.lon, sourcePosition.lat),
    code = `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/DRAINAGE/${continentId}/${slot}`,
    points: DrainagePoint[] = [],
    sourceHeight = Math.max(24, naturalElevationAt(source.x, source.z)),
    width = 2.35 + addressed(`${code}/width`) * 1.35;
  let x = source.x,
    z = source.z,
    direction = coastwardDirection(x, z, continentId),
    outlet: "ocean" | "lake" = "ocean";

  for (let index = 0; index < MAX_MAIN_STEPS; index++) {
    const progress = index / Math.max(1, MAX_MAIN_STEPS - 1),
      bed = Math.max(0.18, sourceHeight * (1 - progress) * (1 - progress) * 0.72 + 0.18);
    points.push(Object.freeze({ x: wrapSourceX(x), z, bed }));
    const target = coastwardDirection(x, z, continentId),
      meanderPhase = addressed(`${code}/meander-phase-v2`) * TAU,
      meander = Math.sin(index * 0.73 + meanderPhase) * 0.2 + Math.sin(index * 0.31 + meanderPhase * 1.7) * 0.085;
    direction = rotate(blendDirection(direction, target, 0.42), meander);
    const stride = 380 + addressed(`${code}/stride/${index}`) * 170,
      nx = wrapSourceX(x + direction.x * stride),
      nz = clampZ(z + direction.z * stride),
      macro = macroSampleAt(sourceToLonLat(nx, nz));
    x = nx;
    z = nz;
    if (!macro.land) {
      outlet = macro.domain === "Lake" ? "lake" : "ocean";
      points.push(Object.freeze({ x, z, bed: 0.05 }));
      break;
    }
  }
  if (points.length < 8) return null;
  const terminal = points[points.length - 1],
    terminalMacro = macroSampleAt(sourceToLonLat(terminal.x, terminal.z));
  if (terminalMacro.land) return null;
  outlet = terminalMacro.domain === "Lake" ? "lake" : "ocean";

  const joinIndex = Math.min(points.length - 3, Math.max(4, Math.floor(points.length * 0.52))),
    join = points[joinIndex],
    previous = points[Math.max(0, joinIndex - 2)],
    dx = wrapSourceX(join.x - previous.x),
    dz = join.z - previous.z,
    length = Math.hypot(dx, dz) || 1,
    side = addressed(`${code}/tributary-side`) < 0.5 ? -1 : 1,
    offset = 1500 + addressed(`${code}/tributary-offset`) * 1200,
    tributaryStart = {
      x: wrapSourceX(join.x + (-dz / length) * offset * side),
      z: clampZ(join.z + (dx / length) * offset * side),
    },
    tributary: DrainagePoint[] = [];
  for (let i = 0; i <= 9; i++) {
    const t = i / 9,
      bow = Math.sin(Math.PI * t) * (addressed(`${code}/tributary-bow`) - 0.5) * 520,
      px = wrapSourceX(tributaryStart.x + wrapSourceX(join.x - tributaryStart.x) * t + (-dz / length) * bow),
      pz = clampZ(tributaryStart.z + (join.z - tributaryStart.z) * t + (dx / length) * bow),
      bed = lerp(Math.max(join.bed + 4, naturalElevationAt(tributaryStart.x, tributaryStart.z) * 0.62), join.bed, t);
    if (macroSampleAt(sourceToLonLat(px, pz)).land || i === 9)
      tributary.push(Object.freeze({ x: px, z: pz, bed }));
  }
  return Object.freeze({ code, continentId, width, points: Object.freeze(points), tributary: Object.freeze(tributary), outlet });
}

export const drainageRecipes: readonly DrainageRecipe[] = Object.freeze(
  MACRO_PLAN.continents.flatMap((_, continentId) =>
    Array.from({ length: RIVER_SYSTEMS_PER_CONTINENT }, (_, slot) => traceRiver(continentId, slot)).filter(
      (recipe): recipe is DrainageRecipe => Boolean(recipe),
    ),
  ),
);

function bucketCoordinate(value: number) {
  return Math.floor(value / BUCKET_SIZE);
}
function bucketKey(x: number, z: number) {
  return `${bucketCoordinate(wrapSourceX(x))}/${bucketCoordinate(z)}`;
}
function registerSegment(segment: DrainageSegment) {
  const mx = wrapSourceX(segment.ax + wrapSourceX(segment.bx - segment.ax) * 0.5),
    mz = (segment.az + segment.bz) * 0.5,
    bx = bucketCoordinate(mx),
    bz = bucketCoordinate(mz);
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const key = `${bx + dx}/${bz + dz}`,
        bucket = segmentsByBucket.get(key);
      if (bucket) bucket.push(segment);
      else segmentsByBucket.set(key, [segment]);
    }
}
for (const recipe of drainageRecipes) {
  for (const [kind, path] of [["MAIN", recipe.points], ["TRIBUTARY", recipe.tributary]] as const)
    for (let i = 0; i < path.length - 1; i++)
      registerSegment(Object.freeze({
        code: `${recipe.code}/${kind}/${i}`,
        ax: path[i].x,
        az: path[i].z,
        bx: path[i + 1].x,
        bz: path[i + 1].z,
        width: kind === "MAIN" ? recipe.width : recipe.width * 0.62,
        bedA: path[i].bed,
        bedB: path[i + 1].bed,
      }));
}

function pointToSegment(x: number, z: number, segment: DrainageSegment) {
  const dx = wrapSourceX(segment.bx - segment.ax),
    dz = segment.bz - segment.az,
    qx = wrapSourceX(x - segment.ax),
    qz = z - segment.az,
    length2 = dx * dx + dz * dz,
    t = length2 <= 1e-9 ? 0 : Math.max(0, Math.min(1, (qx * dx + qz * dz) / length2));
  return { distance: Math.hypot(qx - dx * t, qz - dz * t), t };
}
function nearestRiver(x: number, z: number): SegmentHit {
  const candidates = segmentsByBucket.get(bucketKey(x, z)) ?? [];
  let best: SegmentHit = null;
  for (const segment of candidates) {
    segmentChecks++;
    const hit = pointToSegment(x, z, segment);
    if (!best || hit.distance < best.distance) best = { segment, ...hit };
  }
  return best;
}

/** Bounded presentation query: at <=512-source tiles one indexed bucket is sufficient. */
export function drainageSegmentsInBounds(minX: number, minZ: number, size: number) {
  if (size <= 0 || size > 512) return Object.freeze([]) as readonly DrainageSegment[];
  const cx = wrapSourceX(minX + size * 0.5),
    cz = minZ + size * 0.5,
    radius = Math.hypot(size, size) * 0.5 + RIVER_BANK_HALF_WIDTH_SOURCE;
  return Object.freeze(
    (segmentsByBucket.get(bucketKey(cx, cz)) ?? []).filter(
      (segment) => pointToSegment(cx, cz, segment).distance <= radius + segment.width,
    ),
  );
}

export function freshwaterCrossingSpanMAt(x: number, z: number) {
  const hit = nearestRiver(wrapSourceX(x), z);
  if (!hit || hit.distance > hit.segment.width) return 0;
  return hit.segment.width * 2 * CANONICAL_METRES_PER_SOURCE_UNIT;
}

function drySlopeAt(x: number, z: number, centre: number) {
  const macro = macroSampleAt(sourceToLonLat(x, z));
  if (macro.mountainIntensity < 0.34) return 0;
  const step = SAMPLE_STEP_SOURCE,
    hx = naturalElevationAt(x + step, z) - naturalElevationAt(x - step, z),
    hz = naturalElevationAt(x, z + step) - naturalElevationAt(x, z - step),
    runM = step * 2 * CANONICAL_METRES_PER_SOURCE_UNIT,
    slope = Math.hypot(hx, hz) / Math.max(1, runM);
  return Number.isFinite(slope) ? slope : Math.abs(centre) * 0;
}

export function naturalSurfaceAt(x: number, z: number): NaturalSurface {
  naturalQueries++;
  const sx = wrapSourceX(x),
    macro = macroSampleAt(sourceToLonLat(sx, z));
  if (macro.domain === "Ocean")
    return Object.freeze({ groundHeight: -2.8, material: "Ocean", water: { kind: "ocean", level: 0, flowX: 0, flowZ: 0 } as SurfaceWater, walkable: false, vegetationDensityScale: 0, slope: 0, cliff: false, freshwaterDistanceSource: Infinity, catchmentCode: null });
  if (macro.domain === "Lake")
    return Object.freeze({ groundHeight: -1.8, material: "Lake", water: { kind: "lake", level: 0, flowX: 0, flowZ: 0 } as SurfaceWater, walkable: false, vegetationDensityScale: 0, slope: 0, cliff: false, freshwaterDistanceSource: 0, catchmentCode: macro.code });

  const terrain = naturalElevationAt(sx, z),
    hit = nearestRiver(sx, z),
    riverDistance = hit?.distance ?? Infinity;
  if (hit && riverDistance <= hit.segment.width) {
    const dx = wrapSourceX(hit.segment.bx - hit.segment.ax),
      dz = hit.segment.bz - hit.segment.az,
      length = Math.hypot(dx, dz) || 1,
      bed = Math.min(terrain - 0.35, lerp(hit.segment.bedA, hit.segment.bedB, hit.t));
    return Object.freeze({
      groundHeight: Math.max(-0.5, bed),
      material: "River",
      water: { kind: "river", level: Math.max(0, bed + 0.24), flowX: dx / length, flowZ: dz / length } as SurfaceWater,
      walkable: false,
      vegetationDensityScale: 0,
      slope: 0,
      cliff: false,
      freshwaterDistanceSource: riverDistance,
      catchmentCode: hit.segment.code.split("/MAIN/")[0].split("/TRIBUTARY/")[0],
    });
  }
  if (hit && riverDistance <= hit.segment.width + RIVER_BANK_HALF_WIDTH_SOURCE) {
    const t = smooth01((riverDistance - hit.segment.width) / RIVER_BANK_HALF_WIDTH_SOURCE),
      bed = lerp(hit.segment.bedA, hit.segment.bedB, hit.t),
      bankHeight = lerp(Math.min(terrain, bed + 0.75), terrain, t);
    return Object.freeze({
      groundHeight: bankHeight,
      material: "Riverbank",
      water: { kind: "none", level: -Infinity, flowX: 0, flowZ: 0 } as SurfaceWater,
      walkable: true,
      vegetationDensityScale: lerp(0.28, 0.86, t),
      slope: 0,
      cliff: false,
      freshwaterDistanceSource: riverDistance,
      catchmentCode: hit.segment.code.split("/MAIN/")[0].split("/TRIBUTARY/")[0],
    });
  }

  const slope = drySlopeAt(sx, z, terrain),
    cliff = slope > 0.68,
    highland = macro.mountainIntensity > 0.15 || terrain > 105;
  let material: SurfaceMaterial = highland ? (macro.volcanic ? "Volcanic highlands" : "Highlands") : "Meadow";
  if (macro.domain === "Island" && !highland) material = "Island meadow";
  if (macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS < 14) material = "Sandy beach";
  return Object.freeze({
    groundHeight: terrain,
    material,
    water: { kind: "none", level: -Infinity, flowX: 0, flowZ: 0 } as SurfaceWater,
    walkable: !cliff,
    vegetationDensityScale: cliff ? 0.08 : highland ? 0.55 : 1,
    slope,
    cliff,
    freshwaterDistanceSource: riverDistance,
    catchmentCode: hit ? hit.segment.code.split("/MAIN/")[0].split("/TRIBUTARY/")[0] : null,
  });
}

export function hydrologyTelemetry() {
  return Object.freeze({
    recipes: drainageRecipes.length,
    segments: [...segmentsByBucket.values()].reduce((sum, value) => sum + value.length, 0) / 9,
    spatialBuckets: segmentsByBucket.size,
    naturalQueries,
    segmentChecks,
  });
}
