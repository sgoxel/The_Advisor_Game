import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  countries,
  countryAtPosition,
  places,
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

export type SiteAccess = Readonly<{
  roadCode: string;
  branchCode: string;
  roadT: number;
  x: number;
  z: number;
  canonicalPosition: CanonicalPosition;
  lengthM: number;
}>;

export type CriticalSite = Readonly<{
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
}>;

const MAX_CANDIDATE_ATTEMPTS = 96;
const ACCESS_SAMPLES = 16;
const ENVELOPE_SAMPLES = 12;
const SITE_SLOTS_PER_COUNTRY = 2;
const SITE_BUCKET_SOURCE_UNITS = 512;
export const SITE_PAD_CORE_SOURCE_UNITS = 5;
export const SITE_PAD_FALLOFF_SOURCE_UNITS = 7;
export const SITE_PAD_SUPPORT_SOURCE_UNITS =
  SITE_PAD_CORE_SOURCE_UNITS + SITE_PAD_FALLOFF_SOURCE_UNITS;
const MAX_SITE_CUT_M = 4;
const MAX_SITE_FILL_M = 3;
const MAX_ACCESS_GRADE = 0.08;

const SITE_PAD_RADIUS_M = Number(
  (SITE_PAD_CORE_SOURCE_UNITS * CANONICAL_METRES_PER_SOURCE_UNIT).toFixed(2),
);
const SITE_PAD_FALLOFF_M = Number(
  (SITE_PAD_FALLOFF_SOURCE_UNITS * CANONICAL_METRES_PER_SOURCE_UNIT).toFixed(2),
);

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
  const x = road.fromX + wrapSourceX(road.toX - road.fromX) * t,
    z = road.fromZ + (road.toZ - road.fromZ) * t,
    position = sourceToLonLat(x, z),
    normalized = lonLatToSource(position.lon, position.lat);
  return { x: normalized.x, z: normalized.z, canonicalPosition: canonical(position) };
}
function farEnoughFromSettlements(position: CanonicalPosition) {
  return places.every((place) => greatCircleDistance(position, place.canonicalPosition) >= 900);
}
function roadsForCountry(country: Country) {
  return roads.filter(
    (road) =>
      road.code.startsWith(`${country.code}/`) &&
      !road.code.includes("/SITE/") &&
      road.surfaceLengthM > 0,
  );
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

function siteEnvelopeIsLegal(country: Country, x: number, z: number) {
  const centre = naturalSurfaceAt(x, z);
  if (centre.water.kind !== "none" || !centre.walkable || centre.groundHeight <= 0.1) return false;
  const target = centre.groundHeight;
  for (const radius of [SITE_PAD_CORE_SOURCE_UNITS, SITE_PAD_SUPPORT_SOURCE_UNITS]) {
    for (let index = 0; index < ENVELOPE_SAMPLES; index++) {
      const angle = (index / ENVELOPE_SAMPLES) * Math.PI * 2,
        sx = x + Math.cos(angle) * radius,
        sz = z + Math.sin(angle) * radius,
        point = sourceToLonLat(sx, sz),
        surface = naturalSurfaceAt(sx, sz);
      if (
        countryAtPosition(point)?.code !== country.code ||
        surface.water.kind !== "none" ||
        !surface.walkable ||
        surface.groundHeight <= 0.1
      )
        return false;
      if (radius === SITE_PAD_CORE_SOURCE_UNITS) {
        const delta = target - surface.groundHeight;
        if (delta < -MAX_SITE_CUT_M || delta > MAX_SITE_FILL_M) return false;
      }
    }
  }
  return true;
}

function accessIsLegal(
  country: Country,
  site: CanonicalPosition,
  access: CanonicalPosition,
  lengthM: number,
) {
  const siteSource = lonLatToSource(site.lon, site.lat),
    accessSource = lonLatToSource(access.lon, access.lat),
    start = naturalSurfaceAt(siteSource.x, siteSource.z),
    end = naturalSurfaceAt(accessSource.x, accessSource.z);
  if (
    start.water.kind !== "none" ||
    end.water.kind !== "none" ||
    !start.walkable ||
    !end.walkable ||
    lengthM <= 0 ||
    Math.abs(end.groundHeight - start.groundHeight) / lengthM > MAX_ACCESS_GRADE
  )
    return false;
  for (let i = 0; i <= ACCESS_SAMPLES; i++) {
    const t = i / ACCESS_SAMPLES,
      x = siteSource.x + wrapSourceX(accessSource.x - siteSource.x) * t,
      z = siteSource.z + (accessSource.z - siteSource.z) * t,
      point = sourceToLonLat(x, z),
      macro = macroSampleAt(point),
      surface = naturalSurfaceAt(x, z),
      desired = start.groundHeight + (end.groundHeight - start.groundHeight) * t,
      earthwork = desired - surface.groundHeight;
    if (
      !macro.land ||
      macro.domain === "Lake" ||
      countryAtPosition(point)?.code !== country.code ||
      surface.water.kind !== "none" ||
      !surface.walkable ||
      earthwork < -MAX_SITE_CUT_M ||
      earthwork > MAX_SITE_FILL_M ||
      places.some((place) => greatCircleDistance(point, place.canonicalPosition) < 330)
    )
      return false;
  }
  return true;
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
      t = 0.18 + addressed(`${code}/${attempt}/T`) * 0.64,
      access = roadPoint(road, t),
      dx = wrapSourceX(road.toX - road.fromX),
      dz = road.toZ - road.fromZ,
      length = Math.max(1, Math.hypot(dx, dz)),
      side = addressed(`${code}/${attempt}/SIDE`) < 0.5 ? -1 : 1,
      offsetM = 760 + addressed(`${code}/${attempt}/OFFSET`) * 840,
      offsetSource = sourceUnitsForMetres(offsetM),
      candidateX = access.x + (-dz / length) * offsetSource * side,
      candidateZ = access.z + (dx / length) * offsetSource * side,
      candidateLonLat = sourceToLonLat(candidateX, candidateZ),
      normalized = lonLatToSource(candidateLonLat.lon, candidateLonLat.lat),
      position = canonical(candidateLonLat),
      macro = macroSampleAt(position),
      owner = countryAtPosition(position),
      accessLengthM = greatCircleDistance(position, access.canonicalPosition);
    if (
      !macro.land ||
      macro.domain === "Lake" ||
      macro.reliefM > 220 ||
      owner?.code !== country.code ||
      accessLengthM < 600 ||
      accessLengthM > 1800 ||
      !farEnoughFromSettlements(position) ||
      accepted.some((other) => greatCircleDistance(position, other.canonicalPosition) < 1100) ||
      !siteEnvelopeIsLegal(country, normalized.x, normalized.z) ||
      !accessIsLegal(country, position, access.canonicalPosition, accessLengthM)
    )
      continue;

    const variant = digest(code),
      preparedHeightM = naturalSurfaceAt(normalized.x, normalized.z).groundHeight;
    return Object.freeze({
      code,
      name: siteName(country, kind, variant),
      kind,
      countryCode: country.code,
      countryName: country.name,
      continent: country.continent,
      x: normalized.x,
      z: normalized.z,
      canonicalPosition: Object.freeze(position),
      radiusM: SITE_PAD_RADIUS_M,
      falloffM: SITE_PAD_FALLOFF_M,
      preparedHeightM,
      archetype: archetypeFor(kind, variant),
      variant,
      access: Object.freeze({
        roadCode: road.code,
        branchCode: `${code}/ACCESS`,
        roadT: t,
        x: access.x,
        z: access.z,
        canonicalPosition: Object.freeze(access.canonicalPosition),
        lengthM: accessLengthM,
      }),
    });
  }
  throw new Error(`Could not place legal critical site ${code}`);
}

export const criticalSites: readonly CriticalSite[] = Object.freeze((() => {
  const result: CriticalSite[] = [];
  for (const country of countries)
    for (let slot = 0; slot < SITE_SLOTS_PER_COUNTRY; slot++)
      result.push(createSite(country, slot, result));
  return result;
})());

function roadRecord(
  site: CriticalSite,
  code: string,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  fromPosition: CanonicalPosition,
  toPosition: CanonicalPosition,
  surfaceLengthM: number,
  from: string,
  to: string,
): Road {
  const travel = travelMetrics(surfaceLengthM, "good-road");
  return {
    code,
    from,
    to,
    fromX,
    toX,
    fromZ,
    toZ,
    minX: Math.min(fromX, toX),
    maxX: Math.max(fromX, toX),
    minZ: Math.min(fromZ, toZ),
    maxZ: Math.max(fromZ, toZ),
    z: (fromZ + toZ) / 2,
    fromPosition,
    toPosition,
    presentationLengthSourceUnits: Math.hypot(toX - fromX, toZ - fromZ),
    surfaceLengthM,
    walkSurface: "good-road" as const,
    walkSpeedMps: travel.speedMps,
    fantasyWalkSeconds: travel.fantasySeconds,
    realWalkSeconds: travel.realSeconds,
    centerline: undefined,
  } as Road;
}

export const siteAccessRoads: readonly Road[] = Object.freeze(
  criticalSites.map((site) => {
    const parent = roads.find((road) => road.code === site.access.roadCode);
    if (!parent) throw new Error(`Missing parent road for ${site.code}`);
    const toX = site.x + wrapSourceX(site.access.x - site.x);
    return Object.freeze(
      roadRecord(
        site,
        site.access.branchCode,
        site.x,
        site.z,
        toX,
        site.access.z,
        site.canonicalPosition,
        site.access.canonicalPosition,
        site.access.lengthM,
        site.code,
        `${site.code}/JUNCTION`,
      ),
    );
  }),
);

/**
 * A zero-length road-shaped preparation record reuses the existing bounded road
 * spatial index and earthwork profile. final-surface.ts upgrades only `/SITE/n/PAD`
 * identities from road priority 8 to site priority 9 and changes their semantic
 * material/reservation. Access branches remain ordinary priority-8 good roads.
 */
export const sitePadRoads: readonly Road[] = Object.freeze(
  criticalSites.map((site) =>
    Object.freeze(
      roadRecord(
        site,
        `${site.code}/PAD`,
        site.x,
        site.z,
        site.x,
        site.z,
        site.canonicalPosition,
        site.canonicalPosition,
        0,
        site.code,
        site.code,
      ),
    ),
  ),
);

export const siteRoadRecords: readonly Road[] = Object.freeze([
  ...siteAccessRoads,
  ...sitePadRoads,
]);
for (const road of siteRoadRecords)
  if (!roads.some((existing) => existing.code === road.code)) roads.push(road);

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

/** Focus-bounded query in transitional source coordinates; identities remain canonical. */
export function nearbyCriticalSites(
  x: number,
  z: number,
  radiusSourceUnits: number,
  limit = 32,
) {
  if (!Number.isFinite(radiusSourceUnits) || radiusSourceUnits < 0)
    throw new RangeError("Critical-site query radius must be finite and non-negative");
  const span = Math.ceil(radiusSourceUnits / SITE_BUCKET_SOURCE_UNITS) + 1,
    bx = Math.floor(x / SITE_BUCKET_SOURCE_UNITS),
    bz = Math.floor(z / SITE_BUCKET_SOURCE_UNITS),
    found = new Map<string, CriticalSite>();
  for (let dz = -span; dz <= span; dz++)
    for (let dx = -span; dx <= span; dx++)
      for (const site of buckets.get(`${bx + dx}/${bz + dz}`) ?? []) {
        if (Math.hypot(wrapSourceX(site.x - x), site.z - z) <= radiusSourceUnits)
          found.set(site.code, site);
      }
  return [...found.values()]
    .sort(
      (a, b) =>
        Math.hypot(wrapSourceX(a.x - x), a.z - z) -
          Math.hypot(wrapSourceX(b.x - x), b.z - z) ||
        a.code.localeCompare(b.code),
    )
    .slice(0, Math.max(0, Math.floor(limit)));
}

export function siteAcceptanceSummary() {
  return Object.freeze({
    countries: countries.length,
    sites: criticalSites.length,
    ruins: criticalSites.filter((site) => site.kind === "ruin").length,
    criticalPlaces: criticalSites.filter((site) => site.kind === "critical-place").length,
    accessBranches: siteAccessRoads.length,
    preparedPads: sitePadRoads.length,
    maxCandidateAttempts: MAX_CANDIDATE_ATTEMPTS,
    accessSamples: ACCESS_SAMPLES,
    envelopeSamples: ENVELOPE_SAMPLES,
    coarseBuckets: buckets.size,
  });
}
