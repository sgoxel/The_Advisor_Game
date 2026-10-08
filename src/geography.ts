import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
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
const TAU = Math.PI * 2;

function digest(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++)
    value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function addressed(address: string) {
  return digest(`${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/${address}`) / 4294967296;
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

/**
 * Political anchors are deterministic rejection samples inside their parent
 * mainland. The sequence is addressed by seed + semantic slot, never a mutable
 * random stream, and explicitly fails instead of silently reducing counts.
 */
export const countries = continents.flatMap((continent) => {
  const accepted: CanonicalPosition[] = [];
  return Array.from({ length: 10 }, (_, id) => {
    let position: CanonicalPosition | undefined;
    for (let attempt = 0; attempt < 200; attempt++) {
      const prefix = `COUNTRY/${continent.id}/${id}/${attempt}`,
        bearing = TAU * addressed(`${prefix}/bearing`),
        distance = 0.08 + 0.43 * Math.sqrt(addressed(`${prefix}/distance`)),
        candidate = destination(continent.canonicalPosition, bearing, distance),
        macro = macroSampleAt(candidate);
      if (
        macro.domain !== "Mainland" ||
        macro.continentId !== continent.id ||
        macro.reliefM > 55 ||
        accepted.some((other) => macroFeatureDistanceM(candidate, other) < 92_000)
      )
        continue;
      position = candidate;
      break;
    }
    if (!position)
      throw new Error(`Seeded geography could not place country ${continent.id}/${id}`);
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

export const cities: Place[] = (() => {
  const result: Place[] = [],
    allAccepted: CanonicalPosition[] = [];
  for (const country of countries) {
    const localAccepted: CanonicalPosition[] = [];
    for (let city = 0; city < 3; city++) {
      let position: CanonicalPosition | undefined;
      for (let attempt = 0; attempt < 200; attempt++) {
        const prefix = `CITY/${country.continent}/${country.id}/${city}/${attempt}`,
          bearing = TAU * addressed(`${prefix}/bearing`),
          distance = 0.035 + 0.055 * addressed(`${prefix}/distance`),
          candidate = destination(country.canonicalPosition, bearing, distance),
          macro = macroSampleAt(candidate);
        if (
          macro.domain !== "Mainland" ||
          macro.continentId !== country.continent ||
          macro.reliefM > 65 ||
          localAccepted.some((other) => macroFeatureDistanceM(candidate, other) < 33_000) ||
          allAccepted.some((other) => macroFeatureDistanceM(candidate, other) < 25_000)
        )
          continue;
        position = candidate;
        break;
      }
      if (!position)
        throw new Error(`Seeded geography could not place city ${country.continent}/${country.id}/${city}`);
      localAccepted.push(position);
      allAccepted.push(position);
      const id = `${country.continent}/${country.id}/${city}`;
      result.push(
        withPresentation({
          id,
          code: `${country.code}/CITY/${city}`,
          name: `${country.name} ${CITY_NAMES[city]}`,
          canonicalPosition: position,
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

/**
 * Villages remain connected by the prototype straight good-road records, but
 * each row is re-sited from seed inside its city's actual mainland. Longitude
 * step is latitude-adjusted so every adjacent pair stays about six km apart.
 */
export const villages: Place[] = (() => {
  const result: Place[] = [],
    accepted: CanonicalPosition[] = [];
  for (const city of cities) {
    let row: CanonicalPosition[] | undefined;
    for (let attempt = 0; attempt < 96; attempt++) {
      const latOffset = (addressed(`VILLAGE/${city.id}/${attempt}/latitude`) - 0.5) * 0.022,
        lat = Math.max(-1.35, Math.min(1.35, city.canonicalPosition.lat + latOffset)),
        lonStep = 0.00945 / Math.max(0.35, Math.abs(Math.cos(lat))),
        candidates = [-1, 0, 1].map((offset) =>
          canonicalPosition(city.canonicalPosition.lon + offset * lonStep, lat),
        );
      const legal = candidates.every((candidate) => {
        const macro = macroSampleAt(candidate);
        return (
          macro.domain === "Mainland" &&
          macro.continentId === city.continent &&
          macro.reliefM <= 85 &&
          accepted.every((other) => macroFeatureDistanceM(candidate, other) >= 3_900)
        );
      });
      if (legal) {
        row = candidates;
        break;
      }
    }
    if (!row) throw new Error(`Seeded geography could not place village row ${city.id}`);
    row.forEach((position, v) => {
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
    });
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
      minX = Math.min(fromPlace.x, toUnwrappedX),
      maxX = Math.max(fromPlace.x, toUnwrappedX),
      z = fromPlace.z,
      surfaceLengthM = greatCircleDistance(fromPosition, toPosition),
      travel = travelMetrics(surfaceLengthM, "good-road");
    return {
      code: `${city.code}/ROAD/${index}`,
      from: fromPlace.id,
      to: toPlace.id,
      fromX: fromPlace.x,
      toX: toUnwrappedX,
      minX,
      maxX,
      z,
      fromPosition,
      toPosition,
      /** Disposable source/render span. This is not a physical metre value. */
      presentationLengthSourceUnits: Math.abs(dx),
      /** Authoritative spherical route distance in canonical physical metres. */
      surfaceLengthM,
      walkSurface: "good-road" as const,
      walkSpeedMps: travel.speedMps,
      fantasyWalkSeconds: travel.fantasySeconds,
      realWalkSeconds: travel.realSeconds,
    };
  }),
);

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

/**
 * Compatibility scalar for presentation callers: <1 means dry macro land and
 * >1 means water. The geometry itself comes only from macroSampleAt().
 */
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
  return roads.find((road) => {
    if (
      Math.abs(z - road.z) >= 12 ||
      (!localVillageIds.has(road.from) && !localVillageIds.has(road.to))
    )
      return false;
    const relative = wrapSourceX(x - road.fromX),
      extent = road.toX - road.fromX,
      min = Math.min(0, extent) - 8,
      max = Math.max(0, extent) + 8;
    return relative >= min && relative <= max;
  });
}

/** Exposed diagnostics are immutable macro identities, not a second render dataset. */
export const macroGeography = {
  planVersion: WORLD_FOUNDATION_VERSION,
  islands: macroIslands,
  lakes: macroLakes,
  mountainSystems,
} as const;
