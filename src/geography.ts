import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  greatCircleDistance,
  lonLatToSource,
  normalizeLongitude,
  sourceToLonLat,
  wrapSourceX,
  type CanonicalPosition,
  type LonLat,
} from "./planet.ts";
import {
  MACRO_GEOGRAPHY,
  continentLocalPosition,
  macroDigest,
  macroOffset,
  sampleMacroGeography,
  type MacroContinent,
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

const COUNTRY_NAMES = [
  "Aldermarch",
  "Briarhold",
  "Greyvale",
  "Oakward",
  "Westwatch",
  "Ashbourne",
  "Thornreach",
  "Highmere",
  "Stonefen",
  "Dunvale",
] as const;
const CITY_NAMES = ["Citadel", "Market", "Harbour"] as const;
const VILLAGE_NAMES = ["Briarford", "Oakmere", "Thornfield"] as const;
const PLANET_RADIUS_M = 637_100;
const VILLAGE_SEPARATION_M = 6_000;
const TEMPORARY_VILLAGE_CHAIN_EAST_M = 14_000;
const TEMPORARY_CORRIDOR_SAMPLE_STEP_SOURCE = 7;
const ROAD_BUCKET_SIZE_SOURCE = 2048;
const ROAD_INDEX_STEP_SOURCE = 512;

const hashUnit = (key: string) =>
  macroDigest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/${key}`) / 0xffffffff;
const hashSigned = (key: string) => hashUnit(key) * 2 - 1;

const canonicalPosition = (
  lon: number,
  lat: number,
  elevation = 0,
): CanonicalPosition => ({
  lon: normalizeLongitude(lon),
  lat: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, lat)),
  elevation,
});

const withPresentation = <T extends { canonicalPosition: CanonicalPosition }>(record: T) => {
  const { x, z } = lonLatToSource(
    record.canonicalPosition.lon,
    record.canonicalPosition.lat,
  );
  return { ...record, x, z };
};

/** Canonical macro continents own the presentation centres and visible landmark registry. */
export const continents = MACRO_GEOGRAPHY.continents.map((continent) =>
  withPresentation({
    ...continent,
    mountainSystems: MACRO_GEOGRAPHY.mountainSystems.filter(
      (system) => system.continent === continent.id,
    ),
    islands: MACRO_GEOGRAPHY.islands.filter(
      (island) => island.continent === continent.id,
    ),
  }),
);

function countryPosition(continent: MacroContinent, id: number, accepted: readonly CanonicalPosition[]) {
  for (let attempt = 0; attempt < 128; attempt++) {
    const key = `COUNTRY/${continent.id}/${id}/ATTEMPT/${attempt}`,
      east = hashSigned(`${key}/EAST`) * 0.64,
      north = hashSigned(`${key}/NORTH`) * 0.64,
      candidate = continentLocalPosition(continent, east, north),
      sample = sampleMacroGeography(candidate);
    if (sample.landform !== "Mainland" || sample.continent !== continent.id || sample.landScore < 0.1)
      continue;
    if (accepted.some((other) => greatCircleDistance(candidate, other) < 90_000))
      continue;
    return candidate;
  }
  throw new Error(`Unable to place country ${continent.id}/${id}`);
}

export const countries = MACRO_GEOGRAPHY.continents.flatMap((continent) => {
  const accepted: CanonicalPosition[] = [];
  return Array.from({ length: 10 }, (_, id) => {
    const position = countryPosition(continent, id, accepted);
    accepted.push(position);
    return withPresentation({
      id,
      continent: continent.id,
      code: `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/CONT/${continent.id}/COUNTRY/${id}`,
      name: COUNTRY_NAMES[id],
      canonicalPosition: position,
    });
  });
});

function temporaryVillageCorridorIsMainland(
  candidate: CanonicalPosition,
  continentId: number,
) {
  const cosLat = Math.max(0.2, Math.abs(Math.cos(candidate.lat))),
    start = lonLatToSource(candidate.lon, candidate.lat),
    endCanonical = canonicalPosition(
      candidate.lon + TEMPORARY_VILLAGE_CHAIN_EAST_M / (PLANET_RADIUS_M * cosLat),
      candidate.lat,
    ),
    end = lonLatToSource(endCanonical.lon, endCanonical.lat),
    deltaX = wrapSourceX(end.x - start.x),
    samples = Math.max(
      1,
      Math.ceil(Math.abs(deltaX) / TEMPORARY_CORRIDOR_SAMPLE_STEP_SOURCE),
    );
  for (let i = 0; i <= samples; i++) {
    const x = wrapSourceX(start.x + (deltaX * i) / samples),
      point = sourceToLonLat(x, start.z),
      sample = sampleMacroGeography(point);
    if (
      sample.landform !== "Mainland" ||
      sample.continent !== continentId ||
      sample.landScore < 0.015
    )
      return false;
  }
  return true;
}

function cityPosition(
  country: (typeof countries)[number],
  city: number,
  accepted: readonly CanonicalPosition[],
) {
  for (let attempt = 0; attempt < 64; attempt++) {
    const key = `CITY/${country.continent}/${country.id}/${city}/ATTEMPT/${attempt}`,
      angle = hashUnit(`${key}/ANGLE`) * Math.PI * 2,
      radius = 0.027 + hashUnit(`${key}/RADIUS`) * 0.025,
      candidate = macroOffset(
        country.canonicalPosition,
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
      ),
      sample = sampleMacroGeography(candidate);
    if (
      sample.landform !== "Mainland" ||
      sample.continent !== country.continent ||
      sample.landScore < 0.085 ||
      !temporaryVillageCorridorIsMainland(candidate, country.continent)
    )
      continue;
    if (accepted.some((other) => greatCircleDistance(candidate, other) < 24_000))
      continue;
    return candidate;
  }
  throw new Error(
    `Unable to place city ${country.continent}/${country.id}/${city} with a legal temporary road corridor`,
  );
}

export const cities: Place[] = countries.flatMap((country) => {
  const accepted: CanonicalPosition[] = [];
  return [0, 1, 2].map((city) => {
    const id = `${country.continent}/${country.id}/${city}`,
      position = cityPosition(country, city, accepted);
    accepted.push(position);
    return withPresentation({
      id,
      code: `${country.code}/CITY/${city}`,
      name: `${country.name} ${CITY_NAMES[city]}`,
      canonicalPosition: position,
      kind: "city" as const,
      continent: country.continent,
      country: country.id,
      city,
    });
  });
});

/**
 * WP-S002-004-007 owns organic settlement siting. Until that package replaces
 * this local arrangement, keep the three villages on one seeded city latitude so
 * the existing prototype road renderer remains truthful. The city itself already
 * follows its SEED-owned continent/country position and every step is a canonical
 * 6 km surface displacement, preserving the one-hour fastest-speed lower bound.
 */
export const villages: Place[] = cities.flatMap((city) => {
  const cosLat = Math.max(0.2, Math.abs(Math.cos(city.canonicalPosition.lat))),
    step = VILLAGE_SEPARATION_M / (PLANET_RADIUS_M * cosLat);
  return Array.from({ length: 3 }, (_, v) =>
    withPresentation({
      ...city,
      id: `${city.id}/${v}`,
      code: `${city.code}/VILLAGE/${v}`,
      kind: "village" as const,
      name:
        city.continent === 0 && city.country === 0 && city.city === 0 && v === 0
          ? "Alderwick"
          : `${VILLAGE_NAMES[v]} ${city.continent + 1}.${city.country + 1}.${city.city + 1}`,
      canonicalPosition: canonicalPosition(
        city.canonicalPosition.lon + v * step,
        city.canonicalPosition.lat,
      ),
    }),
  );
});

export const places = [...cities, ...villages];

export const roads = cities.flatMap((city) =>
  [0, 1].map((index) => {
    const fromPlace = villages.find((place) => place.id === `${city.id}/${index}`)!,
      toPlace = villages.find((place) => place.id === `${city.id}/${index + 1}`)!,
      fromPosition = fromPlace.canonicalPosition,
      toPosition = toPlace.canonicalPosition,
      presentationDeltaX = wrapSourceX(toPlace.x - fromPlace.x),
      presentationEndX = fromPlace.x + presentationDeltaX,
      minX = Math.min(fromPlace.x, presentationEndX),
      maxX = Math.max(fromPlace.x, presentationEndX),
      z = fromPlace.z,
      surfaceLengthM = greatCircleDistance(fromPosition, toPosition),
      travel = travelMetrics(surfaceLengthM, "good-road");
    return {
      code: `${city.code}/ROAD/${index}`,
      from: fromPlace.id,
      to: toPlace.id,
      fromX: fromPlace.x,
      presentationDeltaX,
      minX,
      maxX,
      z,
      fromPosition,
      toPosition,
      presentationLengthSourceUnits: Math.hypot(
        presentationDeltaX,
        toPlace.z - fromPlace.z,
      ),
      surfaceLengthM,
      walkSurface: "good-road" as const,
      walkSpeedMps: travel.speedMps,
      fantasyWalkSeconds: travel.fantasySeconds,
      realWalkSeconds: travel.realSeconds,
    };
  }),
);

type Road = (typeof roads)[number];
const roadBuckets = new Map<string, Road[]>();
const roadBucketKey = (x: number, z: number) =>
  `${Math.floor(wrapSourceX(x) / ROAD_BUCKET_SIZE_SOURCE)}/${Math.floor(z / ROAD_BUCKET_SIZE_SOURCE)}`;
for (const road of roads) {
  const steps = Math.max(
    1,
    Math.ceil(Math.abs(road.presentationDeltaX) / ROAD_INDEX_STEP_SOURCE),
  );
  for (let i = 0; i <= steps; i++) {
    const x = wrapSourceX(road.fromX + (road.presentationDeltaX * i) / steps),
      key = roadBucketKey(x, road.z),
      bucket = roadBuckets.get(key) || [];
    if (!bucket.includes(road)) bucket.push(road);
    roadBuckets.set(key, bucket);
  }
}

function nearbyRoads(x: number, z: number): readonly Road[] {
  const wx = wrapSourceX(x),
    bx = Math.floor(wx / ROAD_BUCKET_SIZE_SOURCE),
    bz = Math.floor(z / ROAD_BUCKET_SIZE_SOURCE),
    found = new Map<string, Road>();
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const sampleX = wrapSourceX((bx + dx) * ROAD_BUCKET_SIZE_SOURCE),
        wrappedBucketX = Math.floor(sampleX / ROAD_BUCKET_SIZE_SOURCE),
        bucket = roadBuckets.get(`${wrappedBucketX}/${bz + dz}`) || [];
      for (const road of bucket) found.set(road.code, road);
    }
  return [...found.values()];
}

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

export function continentAtPosition(position: LonLat) {
  const sample = sampleMacroGeography(position),
    owned = sample.continent === null ? undefined : continents[sample.continent];
  if (owned) return owned;
  let result = continents[0],
    distance = greatCircleDistance(position, result.canonicalPosition);
  for (const continent of continents.slice(1)) {
    const candidate = greatCircleDistance(position, continent.canonicalPosition);
    if (candidate < distance) {
      distance = candidate;
      result = continent;
    }
  }
  return result;
}

const buckets = new Map<string, Place[]>();
for (const place of places) {
  const key = `${Math.floor(place.x / 2048)}/${Math.floor(place.z / 2048)}`;
  const bucket = buckets.get(key) || [];
  bucket.push(place);
  buckets.set(key, bucket);
}

const neighbourhoods = new Map<string, readonly Place[]>();
export function nearbyPlaces(x: number, z: number): readonly Place[] {
  const wx = wrapSourceX(x),
    bx = Math.floor(wx / 2048),
    bz = Math.floor(z / 2048),
    key = `${bx}/${bz}`;
  let result = neighbourhoods.get(key);
  if (!result) {
    const found: Place[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const sampleX = wrapSourceX((bx + dx) * 2048),
          wrappedBucketX = Math.floor(sampleX / 2048);
        found.push(...(buckets.get(`${wrappedBucketX}/${bz + dz}`) || []));
      }
    neighbourhoods.set(key, (result = found));
  }
  return result;
}

export function nearestPlace(x: number, z: number): Place | undefined {
  const wx = wrapSourceX(x);
  let result: Place | undefined,
    distance = Infinity;
  for (const place of nearbyPlaces(wx, z)) {
    const d = Math.hypot(wrapSourceX(wx - place.x), z - place.z);
    if (d < distance) {
      distance = d;
      result = place;
    }
  }
  return result;
}

export function continentAt(x: number, z: number) {
  return continentAtPosition(sourceToLonLat(wrapSourceX(x), z));
}

export function continentalEnvelope(x: number, z: number) {
  const sample = sampleMacroGeography(sourceToLonLat(wrapSourceX(x), z));
  if (sample.landform === "Mainland") return Math.max(0, 1 - sample.landScore);
  if (sample.landform === "Island") return 1.05;
  return 1.4 + Math.min(0.6, Math.max(0, -sample.landScore));
}

export function roadAt(x: number, z: number) {
  const wx = wrapSourceX(x);
  return nearbyRoads(wx, z).find((road) => {
    if (Math.abs(z - road.z) >= 12) return false;
    const signedAlong = wrapSourceX(wx - road.fromX),
      direction = Math.sign(road.presentationDeltaX) || 1,
      along = signedAlong * direction,
      length = Math.abs(road.presentationDeltaX);
    return along >= -8 && along <= length + 8;
  });
}
