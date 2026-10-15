import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import { countries, countryAtPosition, places, roads, type Country, type Road } from "./geography.ts";
import { naturalSurfaceAt } from "./hydrology.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  CANONICAL_METRES_PER_SOURCE_UNIT,
  SOURCE_PRESENTATION_WIDTH,
  greatCircleDistance,
  lonLatToSource,
  sourceToLonLat,
  wrapSourceX,
  type CanonicalPosition,
} from "./planet.ts";
import { travelMetrics } from "./travel.ts";

export type CriticalSiteKind = "ruin" | "critical-place";
export type SiteVisibility = "public" | "hidden";
export type SiteAccess = {
  roadCode: string;
  branchCode: string;
  roadT: number;
  x: number;
  z: number;
  canonicalPosition: CanonicalPosition;
  lengthM: number;
};
export type CriticalSite = {
  code: string;
  name: string;
  kind: CriticalSiteKind;
  visibility: SiteVisibility;
  importance: number;
  countryCode: string;
  countryName: string;
  continent: number;
  x: number;
  z: number;
  canonicalPosition: CanonicalPosition;
  radiusM: number;
  falloffM: number;
  preparedHeightM: number;
  archetype: "fallen-keep" | "stone-circle" | "way-shrine" | "old-watch";
  variant: number;
  access: SiteAccess;
};

const MAX_CANDIDATE_ATTEMPTS = 128;
const ACCESS_SAMPLES = 16;
const SITE_SLOTS_PER_COUNTRY = 2;
const SITE_BUCKET_SOURCE_UNITS = 512;
const SITE_ROAD_CORE_SOURCE_UNITS = 5;
const SITE_ROAD_FALLOFF_SOURCE_UNITS = 7;
const SITE_PREP_RADIUS_M = Number((SITE_ROAD_CORE_SOURCE_UNITS * CANONICAL_METRES_PER_SOURCE_UNIT).toFixed(2));
const SITE_PREP_FALLOFF_M = Number((SITE_ROAD_FALLOFF_SOURCE_UNITS * CANONICAL_METRES_PER_SOURCE_UNIT).toFixed(2));

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function addressed(address: string) {
  return digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/CRITICAL_SITE/${address}`) / 4294967296;
}
function sourceUnitsForMetres(metres: number) {
  return metres / CANONICAL_METRES_PER_SOURCE_UNIT;
}
function canonical(position: ReturnType<typeof sourceToLonLat>, elevation = 0): CanonicalPosition {
  return { lon: position.lon, lat: position.lat, elevation };
}
function roadPoint(road: Road, t: number) {
  const x = road.fromX + wrapSourceX(road.toX - road.fromX) * t,
    z = road.fromZ + (road.toZ - road.fromZ) * t,
    position = sourceToLonLat(x, z),
    normalized = lonLatToSource(position.lon, position.lat);
  return { x: normalized.x, z: normalized.z, canonicalPosition: canonical(position) };
}
function dryWalkable(x: number, z: number) {
  const natural = naturalSurfaceAt(x, z);
  return natural.water.kind === "none" && natural.walkable && natural.groundHeight > 0.1;
}
function accessIsLegal(country: Country, site: CanonicalPosition, access: CanonicalPosition) {
  const siteSource = lonLatToSource(site.lon, site.lat), accessSource = lonLatToSource(access.lon, access.lat);
  for (let i = 0; i <= ACCESS_SAMPLES; i++) {
    const t = i / ACCESS_SAMPLES,
      x = siteSource.x + wrapSourceX(accessSource.x - siteSource.x) * t,
      z = siteSource.z + (accessSource.z - siteSource.z) * t,
      point = sourceToLonLat(x, z),
      macro = macroSampleAt(point);
    if (!macro.land || macro.domain === "Lake" || countryAtPosition(point)?.code !== country.code || macro.reliefM > 220 || !dryWalkable(x, z)) return false;
  }
  return true;
}
function farEnoughFromSettlements(position: CanonicalPosition) {
  return places.every((place) => greatCircleDistance(position, place.canonicalPosition) >= 900);
}
function roadsForCountry(country: Country) {
  return roads.filter((road) => road.code.startsWith(`${country.code}/`));
}
function siteName(country: Country, kind: CriticalSiteKind, variant: number) {
  const ruin = ["Oldwatch Ruin", "Fallen Keep", "Broken Tower", "Ashen Court"],
    critical = ["Wayfarer Shrine", "Oathstone", "Pilgrim Ring", "Beacon Stones"],
    names = kind === "ruin" ? ruin : critical;
  return `${country.name} ${names[variant % names.length]}`;
}
function archetypeFor(kind: CriticalSiteKind, variant: number): CriticalSite["archetype"] {
  if (kind === "ruin") return variant % 2 ? "fallen-keep" : "old-watch";
  return variant % 2 ? "stone-circle" : "way-shrine";
}
function createSite(country: Country, slot: number, accepted: readonly CriticalSite[]): CriticalSite {
  const kind: CriticalSiteKind = slot === 0 ? "ruin" : "critical-place",
    code = `${country.code}/SITE/${slot}`,
    localRoads = roadsForCountry(country);
  if (!localRoads.length) throw new Error(`No access road available for ${code}`);

  for (let attempt = 0; attempt < MAX_CANDIDATE_ATTEMPTS; attempt++) {
    const road = localRoads[Math.floor(addressed(`${code}/${attempt}/ROAD`) * localRoads.length)],
      t = 0.18 + addressed(`${code}/${attempt}/T`) * 0.64,
      access = roadPoint(road, t),
      dx = wrapSourceX(road.toX - road.fromX),
      dz = road.toZ - road.fromZ,
      length = Math.max(1, Math.hypot(dx, dz)),
      side = addressed(`${code}/${attempt}/SIDE`) < 0.5 ? -1 : 1,
      offsetM = 900 + addressed(`${code}/${attempt}/OFFSET`) * 1200,
      offsetSource = sourceUnitsForMetres(offsetM),
      candidateX = access.x + (-dz / length) * offsetSource * side,
      candidateZ = access.z + (dx / length) * offsetSource * side,
      candidateLonLat = sourceToLonLat(candidateX, candidateZ),
      normalized = lonLatToSource(candidateLonLat.lon, candidateLonLat.lat),
      position = canonical(candidateLonLat),
      macro = macroSampleAt(position),
      owner = countryAtPosition(position),
      accessLengthM = greatCircleDistance(position, access.canonicalPosition),
      natural = naturalSurfaceAt(normalized.x, normalized.z);
    if (!macro.land || macro.domain === "Lake" || macro.reliefM > 190 || owner?.code !== country.code || accessLengthM < 650 || accessLengthM > 2300 || natural.water.kind !== "none" || !natural.walkable || !farEnoughFromSettlements(position) || accepted.some((other) => greatCircleDistance(position, other.canonicalPosition) < 1100) || !accessIsLegal(country, position, access.canonicalPosition)) continue;
    const variant = digest(code);
    return {
      code,
      name: siteName(country, kind, variant),
      kind,
      visibility: "public",
      importance: kind === "critical-place" ? 90 : 78,
      countryCode: country.code,
      countryName: country.name,
      continent: country.continent,
      x: normalized.x,
      z: normalized.z,
      canonicalPosition: position,
      radiusM: SITE_PREP_RADIUS_M,
      falloffM: SITE_PREP_FALLOFF_M,
      preparedHeightM: natural.groundHeight,
      archetype: archetypeFor(kind, variant),
      variant,
      access: { roadCode: road.code, branchCode: `${code}/ACCESS`, roadT: t, x: access.x, z: access.z, canonicalPosition: access.canonicalPosition, lengthM: accessLengthM },
    };
  }
  throw new Error(`Could not place legal critical site ${code}`);
}

export const criticalSites: readonly CriticalSite[] = (() => {
  const result: CriticalSite[] = [];
  for (const country of countries) for (let slot = 0; slot < SITE_SLOTS_PER_COUNTRY; slot++) result.push(createSite(country, slot, result));
  return result;
})();

export const siteAccessRoads: readonly Road[] = criticalSites.map((site) => {
  const parent = roads.find((road) => road.code === site.access.roadCode);
  if (!parent) throw new Error(`Missing parent road for ${site.code}`);
  const dx = wrapSourceX(site.access.x - site.x), toX = site.x + dx, fromZ = site.z, toZ = site.access.z,
    travel = travelMetrics(site.access.lengthM, "good-road"), junctionVillage = site.access.roadT <= 0.5 ? parent.from : parent.to;
  return {
    code: site.access.branchCode,
    from: junctionVillage,
    to: site.code,
    fromX: site.x,
    toX,
    fromZ,
    toZ,
    minX: Math.min(site.x, toX), maxX: Math.max(site.x, toX), minZ: Math.min(fromZ, toZ), maxZ: Math.max(fromZ, toZ),
    z: (fromZ + toZ) / 2,
    fromPosition: site.canonicalPosition,
    toPosition: site.access.canonicalPosition,
    presentationLengthSourceUnits: Math.hypot(dx, toZ - fromZ),
    surfaceLengthM: site.access.lengthM,
    walkSurface: "good-road" as const,
    walkSpeedMps: travel.speedMps,
    fantasyWalkSeconds: travel.fantasySeconds,
    realWalkSeconds: travel.realSeconds,
    centerline: [
      { x: site.x, z: site.z, position: site.canonicalPosition },
      { x: toX, z: toZ, position: site.access.canonicalPosition },
    ] as const,
  } as Road;
});
for (const branch of siteAccessRoads) if (!roads.some((road) => road.code === branch.code)) roads.push(branch);

const buckets = new Map<string, CriticalSite[]>();
function addToBucket(site: CriticalSite, x: number) {
  const key = `${Math.floor(x / SITE_BUCKET_SOURCE_UNITS)}/${Math.floor(site.z / SITE_BUCKET_SOURCE_UNITS)}`, bucket = buckets.get(key) ?? [];
  if (!bucket.includes(site)) bucket.push(site);
  buckets.set(key, bucket);
}
for (const site of criticalSites) {
  addToBucket(site, site.x);
  if (site.x < -SOURCE_PRESENTATION_WIDTH / 2 + SITE_BUCKET_SOURCE_UNITS) addToBucket(site, site.x + SOURCE_PRESENTATION_WIDTH);
  if (site.x > SOURCE_PRESENTATION_WIDTH / 2 - SITE_BUCKET_SOURCE_UNITS) addToBucket(site, site.x - SOURCE_PRESENTATION_WIDTH);
}

export function nearbyCriticalSites(x: number, z: number, radiusSourceUnits: number, limit = 24) {
  const span = Math.ceil(radiusSourceUnits / SITE_BUCKET_SOURCE_UNITS) + 1, bx = Math.floor(x / SITE_BUCKET_SOURCE_UNITS), bz = Math.floor(z / SITE_BUCKET_SOURCE_UNITS), found = new Map<string, CriticalSite>();
  for (let dz = -span; dz <= span; dz++) for (let dx = -span; dx <= span; dx++) for (const site of buckets.get(`${bx + dx}/${bz + dz}`) ?? []) {
    if (site.visibility === "public" && Math.hypot(wrapSourceX(site.x - x), site.z - z) <= radiusSourceUnits) found.set(site.code, site);
  }
  return [...found.values()].sort((a, b) => Math.hypot(wrapSourceX(a.x - x), a.z - z) - Math.hypot(wrapSourceX(b.x - x), b.z - z) || b.importance - a.importance || a.code.localeCompare(b.code)).slice(0, limit);
}

export type SiteSurfaceSample = { height: number; cleared: boolean; walkable: boolean; influence: number };
export function siteSurfaceSample(site: CriticalSite, x: number, z: number, baseHeight: number): SiteSurfaceSample {
  const distanceSource = Math.hypot(wrapSourceX(x - site.x), z - site.z), radiusSource = sourceUnitsForMetres(site.radiusM), falloffSource = sourceUnitsForMetres(site.falloffM), supportSource = radiusSource + falloffSource;
  if (distanceSource >= supportSource) return { height: baseHeight, cleared: false, walkable: baseHeight > 0.1, influence: 0 };
  const influence = distanceSource <= radiusSource ? 1 : 1 - (distanceSource - radiusSource) / falloffSource,
    smooth = influence * influence * (3 - 2 * influence),
    target = Math.max(baseHeight - 3, Math.min(baseHeight + 3, site.preparedHeightM)),
    height = baseHeight + (target - baseHeight) * smooth;
  return { height, cleared: true, walkable: height > 0.1, influence: smooth };
}

export function siteAcceptanceSummary() {
  return {
    countries: countries.length,
    sites: criticalSites.length,
    ruins: criticalSites.filter((site) => site.kind === "ruin").length,
    criticalPlaces: criticalSites.filter((site) => site.kind === "critical-place").length,
    publicSites: criticalSites.filter((site) => site.visibility === "public").length,
    accessBranches: siteAccessRoads.length,
    maxCandidateAttempts: MAX_CANDIDATE_ATTEMPTS,
    accessSamples: ACCESS_SAMPLES,
    coarseBuckets: buckets.size,
  } as const;
}
