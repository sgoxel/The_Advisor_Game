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
  preparedGroundHeightM: number;
  terrainReliefM: number;
  archetype: "fallen-keep" | "stone-circle" | "way-shrine" | "old-watch";
  variant: number;
  access: SiteAccess;
};

const SITE_SLOTS_PER_COUNTRY = 2;
const SITE_BUCKET_SOURCE_UNITS = 512;
export const SITE_CORE_SOURCE_UNITS = 10;
export const SITE_FALLOFF_SOURCE_UNITS = 6;
export const SITE_SUPPORT_SOURCE_UNITS = SITE_CORE_SOURCE_UNITS + SITE_FALLOFF_SOURCE_UNITS;
const ROAD_SUPPORT_SOURCE_UNITS = 12;
const SITE_SEPARATION_SOURCE_UNITS = SITE_SUPPORT_SOURCE_UNITS * 2 + 24;
const ACCESS_SAMPLES = 16;
const ACCESS_MAX_GRADE = 0.14;
const MAX_CORE_RELIEF_M = 2.5;
const MAX_SUPPORT_RELIEF_M = 6;
const CANDIDATE_RADII = [190, 220, 260, 310, 370, 440, 520, 620] as const;
const CANDIDATE_DIRECTIONS = [
  [1, 0], [3, 1], [1, 1], [1, 3], [0, 1], [-1, 3], [-1, 1], [-3, 1],
  [-1, 0], [-3, -1], [-1, -1], [-1, -3], [0, -1], [1, -3], [1, -1], [3, -1],
] as const;

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function addressed(address: string) {
  return digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/CRITICAL_SITE/${address}`) / 4294967296;
}
function canonical(position: ReturnType<typeof sourceToLonLat>): CanonicalPosition {
  return { lon: position.lon, lat: position.lat, elevation: 0 };
}
function sourceDistance(ax: number, az: number, bx: number, bz: number) {
  return Math.hypot(wrapSourceX(ax - bx), az - bz);
}
function placeReservationRadius(place: Place) {
  // These match the current final-surface settlement support: city 430+80,
  // village 90+80. Priority 9 must live outside that earlier ownership.
  return place.kind === "city" ? 510 : 170;
}
function countryPlaces(country: Country) {
  return places
    .filter((place) => place.kind === "village" && place.continent === country.continent && place.country === country.id)
    .sort((a, b) => a.code.localeCompare(b.code));
}
function hostOrder(country: Country, slot: number, used: ReadonlySet<string>) {
  const candidates = countryPlaces(country).filter((place) => !used.has(place.code));
  if (!candidates.length) throw new Error(`No seeded village available to address a critical site for ${country.code}`);
  const start = Math.floor(addressed(`${country.code}/HOST/${slot}`) * candidates.length);
  return candidates.map((_, index) => candidates[(start + index) % candidates.length]);
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
  return roads.filter((road) => road.code.startsWith(`${country.code}/`) && !road.code.endsWith("/ACCESS"));
}
function nearestPointOnRoad(x: number, z: number, road: Road) {
  const px = road.fromX + wrapSourceX(x - road.fromX),
    path = road.centerline ?? [{ x: road.fromX, z: road.fromZ }, { x: road.toX, z: road.toZ }];
  let best = { x: road.fromX, z: road.fromZ, distance: Infinity };
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1], b = path[index],
      ax = road.fromX + wrapSourceX(a.x - road.fromX),
      bx = ax + wrapSourceX(b.x - a.x),
      vx = bx - ax, vz = b.z - a.z, lengthSq = vx * vx + vz * vz,
      t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (z - a.z) * vz) / lengthSq)),
      qx = ax + vx * t, qz = a.z + vz * t, distance = Math.hypot(px - qx, z - qz);
    if (distance < best.distance) best = { x: wrapSourceX(qx), z: qz, distance };
  }
  return best;
}
function reliefAt(x: number, z: number, radius: number) {
  const heights = [naturalSurfaceAt(x, z).groundHeight];
  for (const [vx, vz] of CANDIDATE_DIRECTIONS.filter((_, index) => index % 2 === 0)) {
    const length = Math.hypot(vx, vz);
    heights.push(naturalSurfaceAt(x + (vx / length) * radius, z + (vz / length) * radius).groundHeight);
  }
  return Math.max(...heights) - Math.min(...heights);
}
function footprintIsLegal(country: Country, x: number, z: number, accepted: readonly CriticalSite[]) {
  const probes = [[0, 0], ...CANDIDATE_DIRECTIONS.filter((_, index) => index % 2 === 0).map(([vx, vz]) => {
    const length = Math.hypot(vx, vz);
    return [(vx / length) * SITE_SUPPORT_SOURCE_UNITS, (vz / length) * SITE_SUPPORT_SOURCE_UNITS] as const;
  })];
  for (const [dx, dz] of probes) {
    const px = wrapSourceX(x + dx), pz = z + dz, surface = naturalSurfaceAt(px, pz), owner = countryAtPosition(sourceToLonLat(px, pz));
    if (surface.water.kind !== "none" || !surface.walkable || owner?.code !== country.code) return false;
    if (surface.freshwaterDistanceSource <= 4) return false;
  }
  if (reliefAt(x, z, SITE_CORE_SOURCE_UNITS) > MAX_CORE_RELIEF_M) return false;
  if (reliefAt(x, z, SITE_SUPPORT_SOURCE_UNITS) > MAX_SUPPORT_RELIEF_M) return false;
  for (const place of places)
    if (sourceDistance(x, z, place.x, place.z) < placeReservationRadius(place) + SITE_SUPPORT_SOURCE_UNITS + 8) return false;
  for (const road of roads)
    if (!road.code.endsWith("/ACCESS") && roadDistanceAt(x, z, road) < SITE_SUPPORT_SOURCE_UNITS + ROAD_SUPPORT_SOURCE_UNITS) return false;
  for (const site of accepted)
    if (sourceDistance(x, z, site.x, site.z) < SITE_SEPARATION_SOURCE_UNITS) return false;
  return true;
}
function accessPathIsLegal(country: Country, x: number, z: number, point: { x: number; z: number }, accepted: readonly CriticalSite[]) {
  const dx = wrapSourceX(point.x - x), dz = point.z - z,
    segmentSource = Math.hypot(dx, dz) / ACCESS_SAMPLES,
    segmentM = Math.max(1, segmentSource * CANONICAL_METRES_PER_SOURCE_UNIT);
  let previousHeight = naturalSurfaceAt(x, z).groundHeight;
  for (let index = 0; index <= ACCESS_SAMPLES; index++) {
    const t = index / ACCESS_SAMPLES, px = wrapSourceX(x + dx * t), pz = z + dz * t,
      surface = naturalSurfaceAt(px, pz), owner = countryAtPosition(sourceToLonLat(px, pz));
    if (surface.water.kind !== "none" || !surface.walkable || owner?.code !== country.code) return false;
    if (surface.freshwaterDistanceSource <= 3.7) return false;
    for (const place of places)
      if (sourceDistance(px, pz, place.x, place.z) < placeReservationRadius(place) + 8) return false;
    for (const site of accepted)
      if (sourceDistance(px, pz, site.x, site.z) < SITE_SUPPORT_SOURCE_UNITS + 8) return false;
    if (index > 0 && Math.abs(surface.groundHeight - previousHeight) / segmentM > ACCESS_MAX_GRADE) return false;
    previousHeight = surface.groundHeight;
  }
  return true;
}
function legalAccessFor(country: Country, x: number, z: number, accepted: readonly CriticalSite[]) {
  const candidates = roadsForCountry(country)
    .map((road) => ({ road, point: nearestPointOnRoad(x, z, road) }))
    .sort((a, b) => a.point.distance - b.point.distance || a.road.code.localeCompare(b.road.code));
  for (const candidate of candidates)
    if (accessPathIsLegal(country, x, z, candidate.point, accepted)) return candidate;
  return null;
}
function candidatePositions(host: Place, country: Country, slot: number) {
  const directionStart = digest(`${country.code}/${host.code}/${slot}/DIRECTION`) % CANDIDATE_DIRECTIONS.length,
    radiusStart = digest(`${country.code}/${host.code}/${slot}/RADIUS`) % CANDIDATE_RADII.length,
    result: { x: number; z: number; order: number }[] = [];
  let order = 0;
  for (let radiusIndex = 0; radiusIndex < CANDIDATE_RADII.length; radiusIndex++) {
    const radius = CANDIDATE_RADII[(radiusStart + radiusIndex) % CANDIDATE_RADII.length];
    for (let directionIndex = 0; directionIndex < CANDIDATE_DIRECTIONS.length; directionIndex++) {
      const [vx, vz] = CANDIDATE_DIRECTIONS[(directionStart + directionIndex) % CANDIDATE_DIRECTIONS.length], length = Math.hypot(vx, vz);
      result.push({ x: wrapSourceX(host.x + (vx / length) * radius), z: host.z + (vz / length) * radius, order: order++ });
    }
  }
  return result;
}
function planSite(country: Country, slot: number, usedHosts: ReadonlySet<string>, accepted: readonly CriticalSite[]) {
  const kind: CriticalSiteKind = slot === 0 ? "ruin" : "critical-place";
  for (const host of hostOrder(country, slot, usedHosts)) {
    const legal: { x: number; z: number; order: number; access: NonNullable<ReturnType<typeof legalAccessFor>>; relief: number }[] = [];
    for (const candidate of candidatePositions(host, country, slot)) {
      if (!footprintIsLegal(country, candidate.x, candidate.z, accepted)) continue;
      const access = legalAccessFor(country, candidate.x, candidate.z, accepted);
      if (!access) continue;
      legal.push({ ...candidate, access, relief: reliefAt(candidate.x, candidate.z, SITE_SUPPORT_SOURCE_UNITS) });
      if (kind === "critical-place" && legal.length >= 1) break;
      if (legal.length >= 12) break;
    }
    if (!legal.length) continue;
    // Ruins deliberately choose the most terrain-challenging legal bounded pad
    // from a small deterministic candidate set; critical places use first legal.
    legal.sort((a, b) => kind === "ruin" ? b.relief - a.relief || a.order - b.order : a.order - b.order);
    const chosen = legal[0], canonicalPosition = canonical(sourceToLonLat(chosen.x, chosen.z)),
      code = `${host.code}/SITE/KEEP`, variant = digest(code), accessPosition = canonical(sourceToLonLat(chosen.access.point.x, chosen.access.point.z)),
      lengthM = greatCircleDistance(canonicalPosition, accessPosition);
    return {
      code,
      name: siteName(country, kind, variant),
      kind,
      countryCode: country.code,
      countryName: country.name,
      continent: country.continent,
      hostPlaceCode: host.code,
      x: chosen.x,
      z: chosen.z,
      canonicalPosition,
      radiusM: Number((SITE_CORE_SOURCE_UNITS * CANONICAL_METRES_PER_SOURCE_UNIT).toFixed(2)),
      falloffM: Number((SITE_FALLOFF_SOURCE_UNITS * CANONICAL_METRES_PER_SOURCE_UNIT).toFixed(2)),
      preparedGroundHeightM: naturalSurfaceAt(chosen.x, chosen.z).groundHeight,
      terrainReliefM: Number(chosen.relief.toFixed(3)),
      archetype: archetypeFor(kind, variant),
      variant,
      access: {
        roadCode: chosen.access.road.code,
        branchCode: `${code}/ACCESS`,
        x: chosen.access.point.x,
        z: chosen.access.point.z,
        canonicalPosition: accessPosition,
        lengthM,
      },
    } satisfies CriticalSite;
  }
  throw new Error(`No legal priority-9 ${kind} candidate for ${country.code}`);
}

export const criticalSites: readonly CriticalSite[] = (() => {
  const result: CriticalSite[] = [];
  for (const country of countries) {
    const usedHosts = new Set<string>();
    for (let slot = 0; slot < SITE_SLOTS_PER_COUNTRY; slot++) {
      const site = planSite(country, slot, usedHosts, result);
      usedHosts.add(site.hostPlaceCode);
      result.push(site);
    }
  }
  return result;
})();

/** Real access branches are registered before world.ts builds its immutable road index. */
export const siteAccessRoads: readonly Road[] = criticalSites.map((site) => {
  const parent = roads.find((road) => road.code === site.access.roadCode);
  if (!parent) throw new Error(`Missing parent road for ${site.code}`);
  const dx = wrapSourceX(site.access.x - site.x), toX = site.x + dx,
    surfaceLengthM = site.access.lengthM, travel = travelMetrics(surfaceLengthM, "good-road"),
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
  if (site.x < -SOURCE_PRESENTATION_WIDTH / 2 + SITE_BUCKET_SOURCE_UNITS) addToBucket(site, site.x + SOURCE_PRESENTATION_WIDTH);
  if (site.x > SOURCE_PRESENTATION_WIDTH / 2 - SITE_BUCKET_SOURCE_UNITS) addToBucket(site, site.x - SOURCE_PRESENTATION_WIDTH);
}

/** Focus-bounded query; renderer/cache state never creates site identity. */
export function nearbyCriticalSites(x: number, z: number, radiusSourceUnits: number, limit = 24) {
  const span = Math.ceil(radiusSourceUnits / SITE_BUCKET_SOURCE_UNITS),
    bx = Math.floor(x / SITE_BUCKET_SOURCE_UNITS), bz = Math.floor(z / SITE_BUCKET_SOURCE_UNITS), found = new Map<string, CriticalSite>();
  for (let dz = -span; dz <= span; dz++)
    for (let dx = -span; dx <= span; dx++)
      for (const site of buckets.get(`${bx + dx}/${bz + dz}`) ?? [])
        if (sourceDistance(site.x, site.z, x, z) <= radiusSourceUnits) found.set(site.code, site);
  return [...found.values()]
    .sort((a, b) => sourceDistance(a.x, a.z, x, z) - sourceDistance(b.x, b.z, x, z) || a.code.localeCompare(b.code))
    .slice(0, limit);
}

export function siteAcceptanceSummary() {
  const hardest = [...criticalSites].sort((a, b) => b.terrainReliefM - a.terrainReliefM || a.code.localeCompare(b.code))[0];
  return {
    countries: countries.length,
    sites: criticalSites.length,
    ruins: criticalSites.filter((site) => site.kind === "ruin").length,
    criticalPlaces: criticalSites.filter((site) => site.kind === "critical-place").length,
    accessBranches: siteAccessRoads.length,
    coarseBuckets: buckets.size,
    priority9Foundation: "reservation-aware-bounded-site-pad",
    hardestSite: hardest ? { code: hardest.code, reliefM: hardest.terrainReliefM } : null,
  } as const;
}
