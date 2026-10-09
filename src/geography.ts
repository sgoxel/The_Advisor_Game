import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  CANONICAL_PLANET_RADIUS,
  SOURCE_PRESENTATION_RADIUS,
  SOURCE_PRESENTATION_WIDTH,
  greatCircleDistance,
  lonLatToSource,
  normalizeLongitude,
  sourceToLonLat,
  wrapSourceX,
  type CanonicalPosition,
  type LonLat,
} from "./planet.ts";
import {
  MACRO_PLAN,
  macroFeatureDistanceM,
  macroSampleAt,
  mountainSystems,
  macroIslands,
  macroLakes,
} from "./macro-geography.ts";
import { travelMetrics } from "./travel.ts";

/** x/z are derived source/render coordinates; canonicalPosition is world truth. */
export type Place = {
  id: string;
  code: string;
  name: string;
  x: number;
  z: number;
  canonicalPosition: CanonicalPosition;
  kind: "city" | "village";
  continent: number;
  country: number;
  city: number;
};

export type Country = {
  id: number;
  continent: number;
  code: string;
  name: string;
  x: number;
  z: number;
  canonicalPosition: CanonicalPosition;
};

export type PoliticalBorderSegment = {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  countries: readonly [string, string];
};

const COUNTRY_NAMES = [
  "Aldermarch", "Briarhold", "Greyvale", "Oakward", "Westwatch", "Ashbourne",
  "Thornreach", "Highmere", "Stonefen", "Dunvale", "Redwater", "Merewatch",
  "Goldmere", "Northreach", "Rosefen", "Ironvale", "Willowmark", "Highward",
  "Sunmere", "Greywatch", "Falconreach", "Dawnmark", "Ravenmere", "Eastvale",
  "Mossward", "Silverfen", "Hearthmarch", "Pinewatch", "Crownhold", "Longmere",
  "Embervale", "Whitefen", "Kingsward", "Sablemarch", "Windreach", "Lakehold",
] as const;
const CITY_NAMES = ["Citadel", "Market", "Harbour"] as const;
const VILLAGE_NAMES = ["Briarford", "Oakmere", "Thornfield"] as const;
const TAU = Math.PI * 2;

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function addressedFor(seed: string, address: string) {
  return digest(`${seed}/${WORLD_FOUNDATION_VERSION}/${address}`) / 4294967296;
}
function addressed(address: string) {
  return addressedFor(WORLD_SEED, address);
}
function canonicalPosition(lon: number, lat: number, elevation = 0): CanonicalPosition {
  return {
    lon: normalizeLongitude(lon),
    lat: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, lat)),
    elevation,
  };
}
function destination(origin: LonLat, bearing: number, distance: number): CanonicalPosition {
  const sinLat =
      Math.sin(origin.lat) * Math.cos(distance) +
      Math.cos(origin.lat) * Math.sin(distance) * Math.cos(bearing),
    lat = Math.asin(Math.max(-1, Math.min(1, sinLat))),
    lon = normalizeLongitude(
      origin.lon +
        Math.atan2(
          Math.sin(bearing) * Math.sin(distance) * Math.cos(origin.lat),
          Math.cos(distance) - Math.sin(origin.lat) * Math.sin(lat),
        ),
    );
  return canonicalPosition(lon, lat);
}
const withPresentation = <T extends { canonicalPosition: CanonicalPosition }>(record: T) => {
  const { x, z } = lonLatToSource(
    record.canonicalPosition.lon,
    record.canonicalPosition.lat,
  );
  return { ...record, x, z };
};

/** Continent labels/anchors are views of the same seed-derived macro recipes as terrain. */
export const continents = MACRO_PLAN.continents.map((continent) =>
  withPresentation({
    id: continent.id,
    name: continent.name,
    code: continent.code,
    canonicalPosition: canonicalPosition(continent.center.lon, continent.center.lat),
    majorRadiusRad: continent.majorRadiusRad,
    minorRadiusRad: continent.minorRadiusRad,
    orientationRad: continent.orientationRad,
  }),
);

/** Seed-addressed counts are minima, not fixed maxima. */
export function politicalRegistryCountsForSeed(seed: string) {
  const perContinent = continents.map(
    (continent) => 10 + Math.floor(addressedFor(seed, `COUNTRY_COUNT/${continent.id}`) * 3),
  );
  const countryCount = perContinent.reduce((sum, count) => sum + count, 0);
  return {
    continents: continents.length,
    perContinent,
    countries: countryCount,
    cities: countryCount * CITY_NAMES.length,
    villages: countryCount * CITY_NAMES.length * VILLAGE_NAMES.length,
  } as const;
}

function continentCandidate(
  continent: (typeof continents)[number],
  address: string,
  attempt: number,
): CanonicalPosition {
  const radius = Math.sqrt(addressed(`${address}/${attempt}/radius`)),
    angle = TAU * addressed(`${address}/${attempt}/angle`),
    u = Math.cos(angle) * radius * continent.majorRadiusRad * 1.12,
    v = Math.sin(angle) * radius * continent.minorRadiusRad * 1.12,
    c = Math.cos(continent.orientationRad),
    s = Math.sin(continent.orientationRad),
    east = u * c - v * s,
    north = u * s + v * c,
    cosLat = Math.max(0.25, Math.abs(Math.cos(continent.canonicalPosition.lat)));
  return canonicalPosition(
    continent.canonicalPosition.lon + east / cosLat,
    continent.canonicalPosition.lat + north,
  );
}

/**
 * Transitional settlement-site guard for the current local terrain prototype.
 * Political ownership still comes exclusively from countryAtPosition(). Until the
 * hydrology WP replaces the old source-domain river, placement simply rejects its
 * known wet corridor and a narrow coastal margin instead of filling water under a
 * city or village.
 */
function locallyDrySettlementSite(position: LonLat, maxReliefM: number) {
  const macro = macroSampleAt(position);
  if (!macro.land || macro.reliefM > maxReliefM) return false;
  if (macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS < 42) return false;
  const { x, z } = lonLatToSource(position.lon, position.lat),
    prototypeRiverX = 125 + 42 * Math.sin(z / 150) + 18 * Math.sin(z / 57);
  return Math.abs(wrapSourceX(x - prototypeRiverX)) > 52;
}

/**
 * Country anchors are selected by deterministic farthest-candidate sampling over
 * each full seeded mainland footprint. They are not a centre cluster, ring, grid,
 * or mutable random stream.
 */
function buildCountries(): Country[] {
  const result: Country[] = [],
    counts = politicalRegistryCountsForSeed(WORLD_SEED).perContinent;
  for (const continent of continents) {
    const accepted: CanonicalPosition[] = [];
    for (let id = 0; id < counts[continent.id]; id++) {
      let best: CanonicalPosition | undefined,
        bestScore = -Infinity;
      for (let attempt = 0; attempt < 144; attempt++) {
        const candidate = continentCandidate(continent, `COUNTRY/${continent.id}/${id}`, attempt),
          macro = macroSampleAt(candidate);
        if (
          !macro.land ||
          macro.domain !== "Mainland" ||
          macro.continentId !== continent.id ||
          macro.reliefM > 110
        )
          continue;
        const separation = accepted.length
          ? Math.min(...accepted.map((other) => macroFeatureDistanceM(candidate, other)))
          : 80_000 + 240_000 * addressed(`COUNTRY/${continent.id}/${id}/${attempt}/first`),
          coastBonus = Math.max(0, Math.min(90_000, macro.coastDistanceRad * CANONICAL_PLANET_RADIUS)),
          jitter = 0.92 + 0.16 * addressed(`COUNTRY/${continent.id}/${id}/${attempt}/rank`),
          score = (separation + coastBonus * 0.18) * jitter;
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
      if (!best)
        throw new Error(`Seeded geography could not place country ${continent.id}/${id}`);
      accepted.push(best);
      const globalNameIndex = continent.id * 12 + id;
      result.push(
        withPresentation({
          id,
          continent: continent.id,
          code: `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/CONT/${continent.id}/COUNTRY/${id}`,
          name: COUNTRY_NAMES[globalNameIndex % COUNTRY_NAMES.length],
          canonicalPosition: best,
        }),
      );
    }
  }
  return result;
}

export const countries = buildCountries();

function politicalWarp(position: LonLat, country: Country) {
  const phaseA = TAU * addressed(`${country.code}/BOUNDARY/A`),
    phaseB = TAU * addressed(`${country.code}/BOUNDARY/B`),
    wave =
      Math.sin(position.lon * 7 + position.lat * 3 + phaseA) +
      0.65 * Math.cos(position.lat * 11 - position.lon * 4 + phaseB) +
      0.35 * Math.sin((position.lon + position.lat) * 17 + phaseA - phaseB);
  return 1 + wave * 0.045;
}

/**
 * Complete political partition. Every canonical land coordinate is owned by one
 * country in its macro continent. The wavy weighted Voronoi score is presentation-
 * independent and creates irregular shared borders without separate border truth.
 */
export function countryAtPosition(position: LonLat): Country | undefined {
  const macro = macroSampleAt(position);
  if (!macro.land) return undefined;
  let winner: Country | undefined,
    best = Infinity;
  for (const country of countries) {
    if (country.continent !== macro.continentId) continue;
    const distance = greatCircleDistance(position, country.canonicalPosition),
      reliefBias = 1 + Math.min(0.04, Math.max(0, macro.reliefM) / 5000),
      score = distance * politicalWarp(position, country) * reliefBias;
    if (score < best || (score === best && country.code < (winner?.code || "~"))) {
      best = score;
      winner = country;
    }
  }
  return winner;
}

function cityCandidate(country: Country, city: number, attempt: number) {
  const continent = continents[country.continent];
  return continentCandidate(continent, `CITY/${country.continent}/${country.id}/${city}`, attempt);
}

export const cities: Place[] = (() => {
  const result: Place[] = [],
    allAccepted: CanonicalPosition[] = [];
  for (const country of countries) {
    const localAccepted: CanonicalPosition[] = [];
    for (let city = 0; city < CITY_NAMES.length; city++) {
      let best: CanonicalPosition | undefined,
        bestScore = -Infinity;
      for (let attempt = 0; attempt < 220; attempt++) {
        const candidate = cityCandidate(country, city, attempt),
          owner = countryAtPosition(candidate);
        if (
          !owner ||
          owner.code !== country.code ||
          !locallyDrySettlementSite(candidate, 90) ||
          allAccepted.some((other) => macroFeatureDistanceM(candidate, other) < 18_000)
        )
          continue;
        const separation = localAccepted.length
          ? Math.min(...localAccepted.map((other) => macroFeatureDistanceM(candidate, other)))
          : macroFeatureDistanceM(candidate, country.canonicalPosition),
          score = separation * (0.9 + 0.2 * addressed(`CITY/${country.code}/${city}/${attempt}/rank`));
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      if (!best)
        throw new Error(`Seeded geography could not place city ${country.continent}/${country.id}/${city}`);
      localAccepted.push(best);
      allAccepted.push(best);
      const id = `${country.continent}/${country.id}/${city}`;
      result.push(
        withPresentation({
          id,
          code: `${country.code}/CITY/${city}`,
          name: `${country.name} ${CITY_NAMES[city]}`,
          canonicalPosition: best,
          kind: "city" as const,
          continent: country.continent,
          country: country.id,
          city,
        }),
      );
    }
  }
  return result;
})();

/** Villages are irregular SEED-addressed radial candidates, never a fixed row. */
export const villages: Place[] = (() => {
  const result: Place[] = [],
    accepted: CanonicalPosition[] = [];
  for (const city of cities) {
    for (let v = 0; v < VILLAGE_NAMES.length; v++) {
      let position: CanonicalPosition | undefined;
      for (let attempt = 0; attempt < 280; attempt++) {
        const prefix = `VILLAGE/${city.id}/${v}/${attempt}`,
          bearing = TAU * addressed(`${prefix}/bearing`),
          distanceM = 7_000 + 16_000 * addressed(`${prefix}/distance`),
          candidate = destination(city.canonicalPosition, bearing, distanceM / CANONICAL_PLANET_RADIUS),
          owner = countryAtPosition(candidate);
        if (
          !owner ||
          owner.continent !== city.continent ||
          owner.id !== city.country ||
          !locallyDrySettlementSite(candidate, 95) ||
          accepted.some((other) => macroFeatureDistanceM(candidate, other) < 6_000)
        )
          continue;
        position = candidate;
        break;
      }
      if (!position) throw new Error(`Seeded geography could not place village ${city.id}/${v}`);
      accepted.push(position);
      result.push(
        withPresentation({
          ...city,
          id: `${city.id}/${v}`,
          code: `${city.code}/VILLAGE/${v}`,
          kind: "village" as const,
          name:
            city.continent === 0 && city.country === 0 && city.city === 0 && v === 0
              ? "Alderwick"
              : `${VILLAGE_NAMES[v]} ${city.continent + 1}.${city.country + 1}.${city.city + 1}`,
          canonicalPosition: position,
        }),
      );
    }
  }
  return result;
})();

export const places = [...cities, ...villages];

export const roads = cities.flatMap((city) =>
  [0, 1].map((index) => {
    const fromPlace = villages.find((place) => place.id === `${city.id}/${index}`)!,
      toPlace = villages.find((place) => place.id === `${city.id}/${index + 1}`)!,
      fromPosition = fromPlace.canonicalPosition,
      toPosition = toPlace.canonicalPosition,
      dx = wrapSourceX(toPlace.x - fromPlace.x),
      toUnwrappedX = fromPlace.x + dx,
      fromZ = fromPlace.z,
      toZ = toPlace.z,
      minX = Math.min(fromPlace.x, toUnwrappedX),
      maxX = Math.max(fromPlace.x, toUnwrappedX),
      minZ = Math.min(fromZ, toZ),
      maxZ = Math.max(fromZ, toZ),
      surfaceLengthM = greatCircleDistance(fromPosition, toPosition),
      travel = travelMetrics(surfaceLengthM, "good-road");
    return {
      code: `${city.code}/ROAD/${index}`,
      from: fromPlace.id,
      to: toPlace.id,
      fromX: fromPlace.x,
      toX: toUnwrappedX,
      fromZ,
      toZ,
      minX,
      maxX,
      minZ,
      maxZ,
      /** Compatibility centreline coordinate retained for diagnostics only. */
      z: (fromZ + toZ) / 2,
      fromPosition,
      toPosition,
      presentationLengthSourceUnits: Math.hypot(dx, toZ - fromZ),
      surfaceLengthM,
      walkSurface: "good-road" as const,
      walkSpeedMps: travel.speedMps,
      fantasyWalkSeconds: travel.fantasySeconds,
      realWalkSeconds: travel.realSeconds,
    };
  }),
);

export type Road = (typeof roads)[number];

export function roadDistanceAt(x: number, z: number, road: Road) {
  const px = road.fromX + wrapSourceX(x - road.fromX),
    vx = road.toX - road.fromX,
    vz = road.toZ - road.fromZ,
    lengthSq = vx * vx + vz * vz;
  if (!lengthSq) return Math.hypot(px - road.fromX, z - road.fromZ);
  const t = Math.max(
      0,
      Math.min(1, ((px - road.fromX) * vx + (z - road.fromZ) * vz) / lengthSq),
    ),
    qx = road.fromX + vx * t,
    qz = road.fromZ + vz * t;
  return Math.hypot(px - qx, z - qz);
}

/** Canonical nearest-place lookup; independent of wrap and source-plane edges. */
export function nearestPlaceAt(position: LonLat): Place | undefined {
  let result: Place | undefined,
    distance = Infinity;
  for (const place of places) {
    const candidate = greatCircleDistance(position, place.canonicalPosition);
    if (candidate < distance) {
      distance = candidate;
      result = place;
    }
  }
  return result;
}

/** The macro authority owns continent affiliation even for its islands and nearby sea. */
export function continentAtPosition(position: LonLat) {
  return continents[macroSampleAt(position).continentId];
}

// Immutable source/render spatial buckets avoid scanning every settlement at every
// terrain sample. Seam-shifted aliases are presentation acceleration only.
const buckets = new Map<string, Place[]>();
for (const place of places)
  for (const x of [place.x - SOURCE_PRESENTATION_WIDTH, place.x, place.x + SOURCE_PRESENTATION_WIDTH]) {
    const key = `${Math.floor(x / 2048)}/${Math.floor(place.z / 2048)}`,
      bucket = buckets.get(key) || [];
    bucket.push(place);
    buckets.set(key, bucket);
  }

const neighbourhoods = new Map<string, readonly Place[]>();
export function nearbyPlaces(x: number, z: number): readonly Place[] {
  const bx = Math.floor(x / 2048),
    bz = Math.floor(z / 2048),
    key = `${bx}/${bz}`;
  let result = neighbourhoods.get(key);
  if (!result) {
    const found = new Map<string, Place>();
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        for (const place of buckets.get(`${bx + dx}/${bz + dz}`) || []) found.set(place.id, place);
    result = [...found.values()];
    neighbourhoods.set(key, result);
  }
  return result;
}

/** Transitional source/render lookup used by local terrain generation. */
export function nearestPlace(x: number, z: number): Place | undefined {
  let result: Place | undefined,
    distance = Infinity;
  for (const place of nearbyPlaces(x, z)) {
    const d = Math.hypot(wrapSourceX(x - place.x), z - place.z);
    if (d < distance) {
      distance = d;
      result = place;
    }
  }
  return result;
}

export function continentAt(x: number, z: number) {
  return continentAtPosition(sourceToLonLat(x, z));
}

export function countryAt(x: number, z: number) {
  return countryAtPosition(sourceToLonLat(x, z));
}

/** Compatibility scalar for presentation callers: <1 means dry macro land and >1 means water. */
export function continentalEnvelope(x: number, z: number) {
  const sample = macroSampleAt(sourceToLonLat(x, z));
  if (sample.land) return Math.max(0.5, 1 - Math.max(0.02, sample.coastDistanceRad) * 5);
  return Math.min(1.5, 1 + Math.max(0.02, -sample.coastDistanceRad) * 5);
}

/** Transitional source/render road hit test; road identity is its seed code. */
export function roadAt(x: number, z: number) {
  const localVillageIds = new Set(
    nearbyPlaces(x, z)
      .filter((place) => place.kind === "village")
      .map((place) => place.id),
  );
  if (!localVillageIds.size) return undefined;
  return roads.find(
    (road) =>
      (localVillageIds.has(road.from) || localVillageIds.has(road.to)) &&
      roadDistanceAt(x, z, road) < 12,
  );
}

function borderOwner(x: number, z: number) {
  return countryAt(x, z)?.code;
}
function borderCrossing(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  ownerA: string,
  ownerB: string,
) {
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 7; i++) {
    const t = (lo + hi) / 2,
      owner = borderOwner(ax + (bx - ax) * t, az + (bz - az) * t);
    if (owner === ownerA) lo = t;
    else hi = t;
  }
  const t = (lo + hi) / 2;
  return {
    x: ax + (bx - ax) * t,
    z: az + (bz - az) * t,
    pair: ownerA < ownerB ? `${ownerA}|${ownerB}` : `${ownerB}|${ownerA}`,
  };
}

/**
 * Bounded local presentation of the canonical country classifier. Marching-cell
 * crossings are recomputed only when the view changes by the caller; they are not
 * separate political truth and never affect ownership.
 */
export function politicalBorderSegments(
  centerX: number,
  centerZ: number,
  halfHeight: number,
  aspect: number,
  columns = 34,
  rows = 24,
): PoliticalBorderSegment[] {
  const halfWidth = halfHeight * aspect,
    minX = centerX - halfWidth * 1.18,
    maxX = centerX + halfWidth * 1.18,
    minZ = centerZ - halfHeight * 1.18,
    maxZ = centerZ + halfHeight * 1.18,
    dx = (maxX - minX) / columns,
    dz = (maxZ - minZ) / rows,
    owner = Array.from({ length: rows + 1 }, (_, rz) =>
      Array.from({ length: columns + 1 }, (_, rx) =>
        borderOwner(minX + rx * dx, minZ + rz * dz),
      ),
    ),
    result: PoliticalBorderSegment[] = [];
  for (let rz = 0; rz < rows; rz++)
    for (let rx = 0; rx < columns; rx++) {
      const x0 = minX + rx * dx,
        x1 = x0 + dx,
        z0 = minZ + rz * dz,
        z1 = z0 + dz,
        corners = [
          { x: x0, z: z0, owner: owner[rz][rx] },
          { x: x1, z: z0, owner: owner[rz][rx + 1] },
          { x: x1, z: z1, owner: owner[rz + 1][rx + 1] },
          { x: x0, z: z1, owner: owner[rz + 1][rx] },
        ],
        groups = new Map<string, { x: number; z: number }[]>();
      for (let edge = 0; edge < 4; edge++) {
        const a = corners[edge],
          b = corners[(edge + 1) % 4];
        if (!a.owner || !b.owner || a.owner === b.owner) continue;
        const crossing = borderCrossing(a.x, a.z, b.x, b.z, a.owner, b.owner),
          list = groups.get(crossing.pair) || [];
        list.push(crossing);
        groups.set(crossing.pair, list);
      }
      for (const [pair, points] of groups) {
        if (points.length < 2) continue;
        const [left, right] = pair.split("|");
        for (let i = 1; i < points.length; i += 2) {
          const a = points[i - 1],
            b = points[i];
          result.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, countries: [left, right] });
        }
      }
    }
  return result;
}

/** Exposed diagnostics are immutable macro identities, not a second render dataset. */
export const macroGeography = {
  planVersion: WORLD_FOUNDATION_VERSION,
  islands: macroIslands,
  lakes: macroLakes,
  mountainSystems,
} as const;
