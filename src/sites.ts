import { canonicalRoadBucketX } from "./road-spatial-index.ts";
import "./transport-network.ts";
import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  countries,
  countryAtPosition,
  nearbyPlaces,
  roadDistanceAt,
  roads,
  type Country,
  type Road,
} from "./geography.ts";
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

const MAX_CANDIDATE_ATTEMPTS = 96;
const ACCESS_SAMPLES = 16;
const SITE_SLOTS_PER_COUNTRY = 2;
const SITE_BUCKET_SOURCE_UNITS = 512;
const SITE_CORE_SOURCE_UNITS = 6;
const SITE_FALLOFF_SOURCE_UNITS = 6;
const SITE_SUPPORT_RING_SAMPLES = 8;
const SITE_PREP_MAX_CUT_M = 3;
const SITE_PREP_MAX_FILL_M = 3;
const EXISTING_ROAD_SUPPORT_SOURCE_UNITS = 12;
const MIN_SETTLEMENT_CLEARANCE_M = 650;
// Priority-6/7 settlement planning may reserve a city envelope up to 420 m plus
// a 260 m entrance reach, or a village envelope up to 240 m plus 140 m access.
// These conservative radial reaches enclose those homes/services/gates without
// importing the much heavier all-country political access planner at runtime.
const SETTLEMENT_RESERVED_REACH_M = { city: 680, village: 380 } as const;
const SITE_PREP_RADIUS_M = Number(
  (SITE_CORE_SOURCE_UNITS * CANONICAL_METRES_PER_SOURCE_UNIT).toFixed(2),
);
const SITE_PREP_FALLOFF_M = Number(
  (SITE_FALLOFF_SOURCE_UNITS * CANONICAL_METRES_PER_SOURCE_UNIT).toFixed(2),
);
const SITE_PREP_SUPPORT_M = SITE_PREP_RADIUS_M + SITE_PREP_FALLOFF_M;
const ACCESS_RESERVATION_CLEARANCE_M =
  EXISTING_ROAD_SUPPORT_SOURCE_UNITS * CANONICAL_METRES_PER_SOURCE_UNIT;

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
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
  if (t <= 0)
    return { x: road.fromX, z: road.fromZ, canonicalPosition: road.fromPosition };
  if (t >= 1)
    return { x: road.toX, z: road.toZ, canonicalPosition: road.toPosition };
  const path = road.centerline || [
      { x: road.fromX, z: road.fromZ, position: road.fromPosition },
      { x: road.toX, z: road.toZ, position: road.toPosition },
    ],
    lengths: number[] = [],
    total = path.slice(1).reduce((sum, point, index) => {
      const previous = path[index],
        length = Math.hypot(wrapSourceX(point.x - previous.x), point.z - previous.z);
      lengths.push(length);
      return sum + length;
    }, 0),
    target = total * t;
  let traversed = 0;
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1],
      b = path[index],
      length = lengths[index - 1];
    if (traversed + length < target && index < path.length - 1) {
      traversed += length;
      continue;
    }
    const localT = length > 0 ? Math.max(0, Math.min(1, (target - traversed) / length)) : 0,
      x = a.x + wrapSourceX(b.x - a.x) * localT,
      z = a.z + (b.z - a.z) * localT,
      position = sourceToLonLat(x, z),
      normalized = lonLatToSource(position.lon, position.lat);
    return { x: normalized.x, z: normalized.z, canonicalPosition: canonical(position) };
  }
  return { x: road.toX, z: road.toZ, canonicalPosition: road.toPosition };
}
function naturalLandAt(x: number, z: number) {
  const surface = naturalSurfaceAt(x, z);
  return surface.water.kind === "none" && surface.groundHeight > 0.1 && surface.walkable;
}
function siteSupportIsLegal(country: Country, x: number, z: number) {
  const support = SITE_CORE_SOURCE_UNITS + SITE_FALLOFF_SOURCE_UNITS,
    probes = [{ x, z }];
  for (let index = 0; index < SITE_SUPPORT_RING_SAMPLES; index++) {
    const angle = (index * Math.PI * 2) / SITE_SUPPORT_RING_SAMPLES,
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    probes.push({ x: x + cos * support, z: z + sin * support });
    if (index % 2 === 0)
      probes.push({ x: x + cos * support * 0.5, z: z + sin * support * 0.5 });
  }
  for (const probe of probes) {
    const point = sourceToLonLat(probe.x, probe.z),
      macro = macroSampleAt(point);
    if (
      !macro.land ||
      macro.domain === "Lake" ||
      macro.reliefM > 220 ||
      countryAtPosition(point)?.code !== country.code ||
      !naturalLandAt(probe.x, probe.z)
    )
      return false;
  }
  return true;
}
function clearsSettlementReservations(position: CanonicalPosition, clearanceM: number) {
  const source = lonLatToSource(position.lon, position.lat);
  return nearbyPlaces(source.x, source.z).every(
    (place) =>
      greatCircleDistance(position, place.canonicalPosition) >=
      SETTLEMENT_RESERVED_REACH_M[place.kind] + clearanceM,
  );
}
function farEnoughFromSettlements(position: CanonicalPosition) {
  const source = lonLatToSource(position.lon, position.lat);
  return nearbyPlaces(source.x, source.z).every(
    (place) =>
      greatCircleDistance(position, place.canonicalPosition) >=
      Math.max(
        MIN_SETTLEMENT_CLEARANCE_M,
        SETTLEMENT_RESERVED_REACH_M[place.kind] + SITE_PREP_SUPPORT_M,
      ),
  );
}
function accessIsLegal(country: Country, site: CanonicalPosition, access: CanonicalPosition) {
  const siteSource = lonLatToSource(site.lon, site.lat),
    accessSource = lonLatToSource(access.lon, access.lat);
  for (let i = 0; i <= ACCESS_SAMPLES; i++) {
    const t = i / ACCESS_SAMPLES,
      x = siteSource.x + wrapSourceX(accessSource.x - siteSource.x) * t,
      z = siteSource.z + (accessSource.z - siteSource.z) * t,
      point = canonical(sourceToLonLat(x, z)),
      macro = macroSampleAt(point);
    if (
      !macro.land ||
      macro.domain === "Lake" ||
      countryAtPosition(point)?.code !== country.code ||
      macro.reliefM > 220 ||
      !naturalLandAt(x, z) ||
      !clearsSettlementReservations(point, ACCESS_RESERVATION_CLEARANCE_M)
    )
      return false;
  }
  return true;
}
// Country ownership comes from canonical endpoints, never a historical road-code prefix.
const countryRoadIndex = new Map<string, Road[]>();
for (const road of roads) {
  if (!road.from.startsWith("J/") && !road.to.startsWith("J/")) continue;
  const fromOwner = countryAtPosition(road.fromPosition), toOwner = countryAtPosition(road.toPosition);
  if (!fromOwner || fromOwner.code !== toOwner?.code) continue;
  const bucket = countryRoadIndex.get(fromOwner.code) ?? [];
  bucket.push(road);
  countryRoadIndex.set(fromOwner.code, bucket);
}
function roadsForCountry(country: Country) {
  return countryRoadIndex.get(country.code) ?? [];
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

function createSite(
  country: Country,
  slot: number,
  accepted: readonly CriticalSite[],
): CriticalSite {
  const kind: CriticalSiteKind = slot === 0 ? "ruin" : "critical-place",
    code = `${country.code}/SITE/${slot}`,
    localRoads = roadsForCountry(country);
  if (!localRoads.length) throw new Error(`No access road available for ${code}`);

  for (let attempt = 0; attempt < MAX_CANDIDATE_ATTEMPTS; attempt++) {
    const road = localRoads[
        Math.floor(addressed(`${code}/${attempt}/ROAD`) * localRoads.length)
      ],
      junctionEnds = [
        ...(road.from.startsWith("J/") ? ([0] as const) : []),
        ...(road.to.startsWith("J/") ? ([1] as const) : []),
      ];
    if (!junctionEnds.length) continue;
    const t = junctionEnds[
        Math.floor(addressed(`${code}/${attempt}/END`) * junctionEnds.length)
      ],
      access = roadPoint(road, t),
      path = road.centerline || [
        { x: road.fromX, z: road.fromZ },
        { x: road.toX, z: road.toZ },
      ],
      segmentIndex = t === 0 ? 0 : Math.max(0, path.length - 2),
      segmentA = path[segmentIndex],
      segmentB = path[segmentIndex + 1],
      dx = wrapSourceX(segmentB.x - segmentA.x),
      dz = segmentB.z - segmentA.z,
      length = Math.max(1, Math.hypot(dx, dz)),
      side = addressed(`${code}/${attempt}/SIDE`) < 0.5 ? -1 : 1,
      offsetM = 700 + addressed(`${code}/${attempt}/OFFSET`) * 800,
      offsetSource = sourceUnitsForMetres(offsetM),
      candidateX = access.x + (-dz / length) * offsetSource * side,
      candidateZ = access.z + (dx / length) * offsetSource * side,
      candidateLonLat = sourceToLonLat(candidateX, candidateZ),
      normalized = lonLatToSource(candidateLonLat.lon, candidateLonLat.lat),
      position = canonical(candidateLonLat),
      macro = macroSampleAt(position),
      owner = countryAtPosition(position),
      accessLengthM = greatCircleDistance(position, access.canonicalPosition),
      natural = naturalSurfaceAt(normalized.x, normalized.z),
      siteRoadClearance =
        SITE_CORE_SOURCE_UNITS + SITE_FALLOFF_SOURCE_UNITS + EXISTING_ROAD_SUPPORT_SOURCE_UNITS;
    if (
      !macro.land ||
      macro.domain === "Lake" ||
      macro.reliefM > 190 ||
      owner?.code !== country.code ||
      accessLengthM < 500 ||
      accessLengthM > 1800 ||
      natural.water.kind !== "none" ||
      natural.groundHeight <= 0.1 ||
      !natural.walkable ||
      !siteSupportIsLegal(country, normalized.x, normalized.z) ||
      !farEnoughFromSettlements(position) ||
      roads.some(
        (candidateRoad) =>
          roadDistanceAt(normalized.x, normalized.z, candidateRoad) < siteRoadClearance,
      ) ||
      accepted.some((other) => greatCircleDistance(position, other.canonicalPosition) < 900) ||
      !accessIsLegal(country, position, access.canonicalPosition)
    )
      continue;

    const variant = digest(code);
    return {
      code,
      name: siteName(country, kind, variant),
      kind,
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
      access: {
        roadCode: road.code,
        branchCode: `${code}/ACCESS`,
        roadT: t,
        x: access.x,
        z: access.z,
        canonicalPosition: access.canonicalPosition,
        lengthM: accessLengthM,
      },
    };
  }
  throw new Error(`Could not place legal critical site ${code}`);
}

export const criticalSites: readonly CriticalSite[] = (() => {
  const result: CriticalSite[] = [];
  for (const country of countries)
    for (let slot = 0; slot < SITE_SLOTS_PER_COUNTRY; slot++)
      result.push(createSite(country, slot, result));
  return result;
})();

/**
 * Priority-8 access branches are canonical transport records. They stay separate
 * from the inter-village road registry because that registry carries the binding
 * 60-fantasy-minute settlement-spacing invariant. world.ts composes both sets into
 * one bounded final-surface road index for render, traversal and collision.
 */
export const siteAccessRoads: readonly Road[] = criticalSites.map((site) => {
  const parent = roads.find((road) => road.code === site.access.roadCode);
  if (!parent) throw new Error(`Missing parent road for ${site.code}`);
  const dx = wrapSourceX(site.access.x - site.x),
    toX = site.x + dx,
    fromZ = site.z,
    toZ = site.access.z,
    surfaceLengthM = site.access.lengthM,
    travel = travelMetrics(surfaceLengthM, "good-road"),
    to = site.access.roadT === 0 ? parent.from : parent.to,
    fromPosition = site.canonicalPosition,
    toPosition = site.access.canonicalPosition;
  return {
    code: site.access.branchCode,
    networkId: site.access.branchCode,
    networkKind: "link" as const,
    coarseFallback: false,
    from: site.code,
    to,
    fromX: site.x,
    toX,
    fromZ,
    toZ,
    minX: Math.min(site.x, toX),
    maxX: Math.max(site.x, toX),
    minZ: Math.min(fromZ, toZ),
    maxZ: Math.max(fromZ, toZ),
    z: (fromZ + toZ) / 2,
    fromPosition,
    toPosition,
    presentationLengthSourceUnits: Math.hypot(dx, toZ - fromZ),
    surfaceLengthM,
    walkSurface: "good-road" as const,
    walkSpeedMps: travel.speedMps,
    fantasyWalkSeconds: travel.fantasySeconds,
    realWalkSeconds: travel.realSeconds,
    centerline: [
      { x: site.x, z: site.z, position: fromPosition },
      { x: toX, z: toZ, position: toPosition },
    ],
  } as Road;
});

const buckets = new Map<string, CriticalSite[]>();
function addToBucket(site: CriticalSite, x: number) {
  const key = `${Math.floor(x / SITE_BUCKET_SOURCE_UNITS)}/${Math.floor(site.z / SITE_BUCKET_SOURCE_UNITS)}`,
    bucket = buckets.get(key) ?? [];
  if (!bucket.includes(site)) bucket.push(site);
  buckets.set(key, bucket);
}
for (const site of criticalSites) {
  addToBucket(site, site.x);
  if (site.x < -SOURCE_PRESENTATION_WIDTH / 2 + SITE_BUCKET_SOURCE_UNITS)
    addToBucket(site, site.x + SOURCE_PRESENTATION_WIDTH);
  if (site.x > SOURCE_PRESENTATION_WIDTH / 2 - SITE_BUCKET_SOURCE_UNITS)
    addToBucket(site, site.x - SOURCE_PRESENTATION_WIDTH);
}

export const siteRegistryBytesEstimated = JSON.stringify({ criticalSites, siteAccessRoads }).length * 2
  + (criticalSites.length + siteAccessRoads.length) * 1024 + buckets.size * 256;

/** Focus-bounded query in transitional source coordinates; identities remain canonical. */
export function nearbyCriticalSites(
  x: number,
  z: number,
  radiusSourceUnits: number,
  limit = 24,
) {
  const minX = Math.floor((x - radiusSourceUnits) / SITE_BUCKET_SOURCE_UNITS),
    maxX = Math.floor((x + radiusSourceUnits) / SITE_BUCKET_SOURCE_UNITS),
    minZ = Math.floor((z - radiusSourceUnits) / SITE_BUCKET_SOURCE_UNITS),
    maxZ = Math.floor((z + radiusSourceUnits) / SITE_BUCKET_SOURCE_UNITS),
    found = new Map<string, CriticalSite>();
  for (let bz = minZ; bz <= maxZ; bz++)
    for (let bx = minX; bx <= maxX; bx++)
      for (const site of buckets.get(`${canonicalRoadBucketX(bx, SITE_BUCKET_SOURCE_UNITS, SOURCE_PRESENTATION_WIDTH)}/${bz}`) ?? []) {
        if (Math.hypot(wrapSourceX(site.x - x), site.z - z) <= radiusSourceUnits)
          found.set(site.code, site);
      }
  return [...found.values()]
    .sort(
      (a, b) =>
        Math.hypot(wrapSourceX(a.x - x), a.z - z) -
          Math.hypot(wrapSourceX(b.x - x), b.z - z) ||
        (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
    )
    .slice(0, limit);
}

export type SiteSurfaceSample = {
  height: number;
  cleared: boolean;
  walkable: boolean;
  influence: number;
};

/** Bounded priority-9 site preparation; water authority is never overwritten. */
export function siteSurfaceSample(
  site: CriticalSite,
  x: number,
  z: number,
  baseHeight: number,
): SiteSurfaceSample {
  const distanceSource = Math.hypot(wrapSourceX(x - site.x), z - site.z),
    radiusSource = sourceUnitsForMetres(site.radiusM),
    falloffSource = sourceUnitsForMetres(site.falloffM),
    supportSource = radiusSource + falloffSource;
  if (distanceSource >= supportSource)
    return { height: baseHeight, cleared: false, walkable: baseHeight > 0.1, influence: 0 };
  const influence =
      distanceSource <= radiusSource
        ? 1
        : 1 - (distanceSource - radiusSource) / falloffSource,
    smooth = influence * influence * (3 - 2 * influence),
    boundedTarget = Math.max(
      baseHeight - SITE_PREP_MAX_CUT_M,
      Math.min(baseHeight + SITE_PREP_MAX_FILL_M, site.preparedHeightM),
    ),
    height = baseHeight + (boundedTarget - baseHeight) * smooth;
  return { height, cleared: true, walkable: height > 0.1, influence: smooth };
}

export function siteAcceptanceSummary() {
  return {
    countries: countries.length,
    sites: criticalSites.length,
    ruins: criticalSites.filter((site) => site.kind === "ruin").length,
    criticalPlaces: criticalSites.filter((site) => site.kind === "critical-place").length,
    accessBranches: siteAccessRoads.length,
    maxCandidateAttempts: MAX_CANDIDATE_ATTEMPTS,
    accessSamples: ACCESS_SAMPLES,
    supportRingSamples: SITE_SUPPORT_RING_SAMPLES,
    coarseBuckets: buckets.size,
    maxCutM: SITE_PREP_MAX_CUT_M,
    maxFillM: SITE_PREP_MAX_FILL_M,
  } as const;
}
