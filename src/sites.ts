import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  countries,
  countryAtPosition,
  places,
  roads,
  type Country,
  type Road,
} from "./geography.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  greatCircleDistance,
  lonLatToSource,
  sourceToLonLat,
  wrapSourceX,
  type CanonicalPosition,
} from "./planet.ts";

export type CriticalSiteKind = "ruin" | "critical-place";

export type SiteAccess = {
  roadCode: string;
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
  archetype: "fallen-keep" | "stone-circle" | "way-shrine" | "old-watch";
  variant: number;
  access: SiteAccess;
};

const MAX_CANDIDATE_ATTEMPTS = 64;
const ACCESS_SAMPLES = 12;
const SITE_SLOTS_PER_COUNTRY = 2;
const SITE_BUCKET_M = 4096;

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function addressed(address: string) {
  return digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/CRITICAL_SITE/${address}`) / 4294967296;
}
function canonical(position: ReturnType<typeof sourceToLonLat>, elevation = 0): CanonicalPosition {
  return { lon: position.lon, lat: position.lat, elevation };
}
function roadPoint(road: Road, t: number) {
  const x = road.fromX + (road.toX - road.fromX) * t,
    z = road.fromZ + (road.toZ - road.fromZ) * t,
    position = sourceToLonLat(x, z),
    normalized = lonLatToSource(position.lon, position.lat);
  return { x: normalized.x, z: normalized.z, canonicalPosition: canonical(position) };
}
function accessIsLegal(country: Country, site: CanonicalPosition, access: CanonicalPosition) {
  const siteSource = lonLatToSource(site.lon, site.lat),
    accessSource = lonLatToSource(access.lon, access.lat);
  for (let i = 0; i <= ACCESS_SAMPLES; i++) {
    const t = i / ACCESS_SAMPLES,
      x = siteSource.x + wrapSourceX(accessSource.x - siteSource.x) * t,
      z = siteSource.z + (accessSource.z - siteSource.z) * t,
      point = sourceToLonLat(x, z),
      macro = macroSampleAt(point);
    if (
      !macro.land ||
      macro.domain === "Lake" ||
      countryAtPosition(point)?.code !== country.code ||
      macro.reliefM > 220
    ) return false;
  }
  return true;
}
function farEnoughFromSettlements(position: CanonicalPosition) {
  return places.every(
    (place) => greatCircleDistance(position, place.canonicalPosition) >= 650,
  );
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
      t = 0.2 + addressed(`${code}/${attempt}/T`) * 0.6,
      access = roadPoint(road, t),
      dx = wrapSourceX(road.toX - road.fromX),
      dz = road.toZ - road.fromZ,
      length = Math.max(1, Math.hypot(dx, dz)),
      side = addressed(`${code}/${attempt}/SIDE`) < 0.5 ? -1 : 1,
      offset = 220 + addressed(`${code}/${attempt}/OFFSET`) * 520,
      candidateX = access.x + (-dz / length) * offset * side,
      candidateZ = access.z + (dx / length) * offset * side,
      candidateLonLat = sourceToLonLat(candidateX, candidateZ),
      normalized = lonLatToSource(candidateLonLat.lon, candidateLonLat.lat),
      position = canonical(candidateLonLat),
      macro = macroSampleAt(position),
      owner = countryAtPosition(position),
      accessLengthM = greatCircleDistance(position, access.canonicalPosition);
    if (
      !macro.land ||
      macro.domain === "Lake" ||
      macro.reliefM > 190 ||
      owner?.code !== country.code ||
      accessLengthM < 160 ||
      accessLengthM > 950 ||
      !farEnoughFromSettlements(position) ||
      accepted.some((other) => greatCircleDistance(position, other.canonicalPosition) < 900) ||
      !accessIsLegal(country, position, access.canonicalPosition)
    ) continue;

    const variant = digest(code),
      radiusM = kind === "ruin" ? 42 + (variant % 17) : 26 + (variant % 13);
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
      radiusM,
      falloffM: 28,
      archetype: archetypeFor(kind, variant),
      variant,
      access: {
        roadCode: road.code,
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

const buckets = new Map<string, CriticalSite[]>();
for (const site of criticalSites) {
  const key = `${Math.floor(site.x / SITE_BUCKET_M)}/${Math.floor(site.z / SITE_BUCKET_M)}`,
    bucket = buckets.get(key) ?? [];
  bucket.push(site);
  buckets.set(key, bucket);
}

/** Focus-bounded query: coarse metadata exists globally, detailed consumers only inspect nearby buckets. */
export function nearbyCriticalSites(x: number, z: number, radiusM: number, limit = 24) {
  const span = Math.ceil(radiusM / SITE_BUCKET_M) + 1,
    bx = Math.floor(x / SITE_BUCKET_M),
    bz = Math.floor(z / SITE_BUCKET_M),
    found = new Map<string, CriticalSite>();
  for (let dz = -span; dz <= span; dz++)
    for (let dx = -span; dx <= span; dx++)
      for (const site of buckets.get(`${bx + dx}/${bz + dz}`) ?? []) {
        if (Math.hypot(wrapSourceX(site.x - x), site.z - z) <= radiusM) found.set(site.code, site);
      }
  return [...found.values()]
    .sort((a, b) =>
      Math.hypot(wrapSourceX(a.x - x), a.z - z) -
        Math.hypot(wrapSourceX(b.x - x), b.z - z) ||
      a.code.localeCompare(b.code),
    )
    .slice(0, limit);
}

export type SiteSurfaceSample = {
  height: number;
  cleared: boolean;
  walkable: boolean;
  influence: number;
};

/**
 * Priority-9 local preparation contract. The caller supplies the existing composed
 * height; the same bounded function is used for site presentation and site walkability.
 */
export function siteSurfaceSample(
  site: CriticalSite,
  x: number,
  z: number,
  baseHeight: number,
  targetHeight: number,
): SiteSurfaceSample {
  const distance = Math.hypot(wrapSourceX(x - site.x), z - site.z),
    support = site.radiusM + site.falloffM;
  if (distance >= support)
    return { height: baseHeight, cleared: false, walkable: baseHeight > 0.1, influence: 0 };
  const influence =
    distance <= site.radiusM
      ? 1
      : 1 - (distance - site.radiusM) / site.falloffM,
    smooth = influence * influence * (3 - 2 * influence),
    height = baseHeight + (targetHeight - baseHeight) * smooth;
  return { height, cleared: true, walkable: height > 0.1, influence: smooth };
}

export function siteAcceptanceSummary() {
  return {
    countries: countries.length,
    sites: criticalSites.length,
    ruins: criticalSites.filter((site) => site.kind === "ruin").length,
    criticalPlaces: criticalSites.filter((site) => site.kind === "critical-place").length,
    maxCandidateAttempts: MAX_CANDIDATE_ATTEMPTS,
    accessSamples: ACCESS_SAMPLES,
    coarseBuckets: buckets.size,
  } as const;
}
