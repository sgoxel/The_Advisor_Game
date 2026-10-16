import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  countries,
  countryAtPosition,
  places,
  roadDistanceAt,
  roads,
  type Country,
  type Place,
  type Road,
} from "./geography.ts";
import { naturalSurfaceAt } from "./hydrology.ts";
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
  hostPlaceCode: string;
  x: number;
  z: number;
  canonicalPosition: CanonicalPosition;
  radiusM: number;
  falloffM: number;
  archetype: "fallen-keep" | "stone-circle" | "way-shrine" | "old-watch";
  variant: number;
  access: SiteAccess;
};

const SITE_SLOTS_PER_COUNTRY = 2;
const SITE_BUCKET_SOURCE_UNITS = 512;
// These exactly match the existing priority-9 keep pad in world.ts: a 10-source-unit
// usable core and a 6-source-unit blend. This registry gives that existing final-
// surface reservation a stable player-facing identity instead of inventing a second
// terrain authority.
const SITE_CORE_SOURCE_UNITS = 10;
const SITE_FALLOFF_SOURCE_UNITS = 6;

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function addressed(address: string) {
  return digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/CRITICAL_SITE/${address}`) / 4294967296;
}
function canonical(position: ReturnType<typeof sourceToLonLat>): CanonicalPosition {
  return { lon: position.lon, lat: position.lat, elevation: 0 };
}
function countryPlaces(country: Country) {
  return places
    .filter(
      (place) =>
        place.kind === "village" &&
        place.continent === country.continent &&
        place.country === country.id,
    )
    .sort((a, b) => a.code.localeCompare(b.code));
}
function hostFor(country: Country, slot: number, used: ReadonlySet<string>) {
  const candidates = countryPlaces(country).filter((place) => !used.has(place.code));
  if (!candidates.length) throw new Error(`No seeded village site foundation available for ${country.code}`);
  return candidates[Math.floor(addressed(`${country.code}/HOST/${slot}`) * candidates.length)];
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
function roadsForCountry(country: Country) {
  return roads.filter((road) => road.code.startsWith(`${country.code}/`));
}
function nearestPointOnRoad(x: number, z: number, road: Road) {
  const px = road.fromX + wrapSourceX(x - road.fromX),
    path = road.centerline ?? [
      { x: road.fromX, z: road.fromZ },
      { x: road.toX, z: road.toZ },
    ];
  let best = { x: road.fromX, z: road.fromZ, distance: Infinity };
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1],
      b = path[index],
      ax = road.fromX + wrapSourceX(a.x - road.fromX),
      bx = ax + wrapSourceX(b.x - a.x),
      vx = bx - ax,
      vz = b.z - a.z,
      lengthSq = vx * vx + vz * vz,
      t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (z - a.z) * vz) / lengthSq)),
      qx = ax + vx * t,
      qz = a.z + vz * t,
      distance = Math.hypot(px - qx, z - qz);
    if (distance < best.distance) best = { x: wrapSourceX(qx), z: qz, distance };
  }
  return best;
}
function accessFor(country: Country, siteX: number, siteZ: number) {
  const localRoads = roadsForCountry(country);
  if (!localRoads.length) throw new Error(`No legal road available for ${country.code}`);
  let bestRoad = localRoads[0],
    bestPoint = nearestPointOnRoad(siteX, siteZ, bestRoad),
    bestDistance = roadDistanceAt(siteX, siteZ, bestRoad);
  for (const road of localRoads.slice(1)) {
    const distance = roadDistanceAt(siteX, siteZ, road);
    if (distance < bestDistance || (distance === bestDistance && road.code < bestRoad.code)) {
      bestRoad = road;
      bestPoint = nearestPointOnRoad(siteX, siteZ, road);
      bestDistance = distance;
    }
  }
  const position = canonical(sourceToLonLat(bestPoint.x, bestPoint.z));
  return { road: bestRoad, point: bestPoint, position };
}
function accessIsLegal(country: Country, site: CriticalSite, samples = 12) {
  for (let index = 0; index <= samples; index++) {
    const t = index / samples,
      x = site.x + wrapSourceX(site.access.x - site.x) * t,
      z = site.z + (site.access.z - site.z) * t,
      surface = naturalSurfaceAt(x, z),
      owner = countryAtPosition(sourceToLonLat(x, z));
    if (surface.water.kind !== "none" || !surface.walkable || owner?.code !== country.code) return false;
  }
  return true;
}

export const criticalSites: readonly CriticalSite[] = (() => {
  const result: CriticalSite[] = [];
  for (const country of countries) {
    const used = new Set<string>();
    for (let slot = 0; slot < SITE_SLOTS_PER_COUNTRY; slot++) {
      const host = hostFor(country, slot, used);
      used.add(host.code);
      // world.ts already owns this exact priority-9 foundation for each seeded place.
      const x = wrapSourceX(host.x - 30),
        z = host.z - 28,
        canonicalPosition = canonical(sourceToLonLat(x, z)),
        code = `${host.code}/SITE/KEEP`,
        kind: CriticalSiteKind = slot === 0 ? "ruin" : "critical-place",
        variant = digest(code),
        access = accessFor(country, x, z),
        lengthM = greatCircleDistance(canonicalPosition, access.position),
        site: CriticalSite = {
          code,
          name: siteName(country, kind, variant),
          kind,
          countryCode: country.code,
          countryName: country.name,
          continent: country.continent,
          hostPlaceCode: host.code,
          x,
          z,
          canonicalPosition,
          radiusM: Number((SITE_CORE_SOURCE_UNITS * CANONICAL_METRES_PER_SOURCE_UNIT).toFixed(2)),
          falloffM: Number((SITE_FALLOFF_SOURCE_UNITS * CANONICAL_METRES_PER_SOURCE_UNIT).toFixed(2)),
          archetype: archetypeFor(kind, variant),
          variant,
          access: {
            roadCode: access.road.code,
            branchCode: `${code}/ACCESS`,
            x: access.point.x,
            z: access.point.z,
            canonicalPosition: access.position,
            lengthM,
          },
        };
      if (!accessIsLegal(country, site)) throw new Error(`Illegal priority-9 site access ${code}`);
      result.push(site);
    }
  }
  return result;
})();

/** Real access branches are registered before world.ts builds its final-surface road index. */
export const siteAccessRoads: readonly Road[] = criticalSites.map((site) => {
  const parent = roads.find((road) => road.code === site.access.roadCode);
  if (!parent) throw new Error(`Missing parent road for ${site.code}`);
  const dx = wrapSourceX(site.access.x - site.x),
    toX = site.x + dx,
    surfaceLengthM = site.access.lengthM,
    travel = travelMetrics(surfaceLengthM, "good-road"),
    host = places.find((place) => place.code === site.hostPlaceCode) as Place | undefined;
  if (!host) throw new Error(`Missing host place for ${site.code}`);
  return {
    code: site.access.branchCode,
    from: host.id,
    to: site.code,
    fromX: site.x,
    toX,
    fromZ: site.z,
    toZ: site.access.z,
    minX: Math.min(site.x, toX),
    maxX: Math.max(site.x, toX),
    minZ: Math.min(site.z, site.access.z),
    maxZ: Math.max(site.z, site.access.z),
    z: (site.z + site.access.z) / 2,
    fromPosition: site.canonicalPosition,
    toPosition: site.access.canonicalPosition,
    presentationLengthSourceUnits: Math.hypot(dx, site.access.z - site.z),
    surfaceLengthM,
    walkSurface: "good-road" as const,
    walkSpeedMps: travel.speedMps,
    fantasyWalkSeconds: travel.fantasySeconds,
    realWalkSeconds: travel.realSeconds,
    centerline: undefined,
  } as Road;
});
for (const branch of siteAccessRoads)
  if (!roads.some((road) => road.code === branch.code)) roads.push(branch);

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

/** Focus-bounded query; renderer/cache state never creates site identity. */
export function nearbyCriticalSites(x: number, z: number, radiusSourceUnits: number, limit = 24) {
  const span = Math.ceil(radiusSourceUnits / SITE_BUCKET_SOURCE_UNITS) + 1,
    bx = Math.floor(x / SITE_BUCKET_SOURCE_UNITS),
    bz = Math.floor(z / SITE_BUCKET_SOURCE_UNITS),
    found = new Map<string, CriticalSite>();
  for (let dz = -span; dz <= span; dz++)
    for (let dx = -span; dx <= span; dx++)
      for (const site of buckets.get(`${bx + dx}/${bz + dz}`) ?? [])
        if (Math.hypot(wrapSourceX(site.x - x), site.z - z) <= radiusSourceUnits) found.set(site.code, site);
  return [...found.values()]
    .sort((a, b) =>
      Math.hypot(wrapSourceX(a.x - x), a.z - z) - Math.hypot(wrapSourceX(b.x - x), b.z - z) || a.code.localeCompare(b.code),
    )
    .slice(0, limit);
}

export function siteAcceptanceSummary() {
  return {
    countries: countries.length,
    sites: criticalSites.length,
    ruins: criticalSites.filter((site) => site.kind === "ruin").length,
    criticalPlaces: criticalSites.filter((site) => site.kind === "critical-place").length,
    accessBranches: siteAccessRoads.length,
    coarseBuckets: buckets.size,
    priority9Foundation: "existing-final-surface-keep-pad",
  } as const;
}
