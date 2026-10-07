import { WORLD_SEED, WALK_SPEED_MPS, VILLAGE_SPACING_M } from "./config.ts";
import {
  greatCircleDistance,
  sourceToLonLat,
  type CanonicalPosition,
  type LonLat,
} from "./planet.ts";

/** x/z are transitional source/render coordinates; canonicalPosition is world truth. */
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

const canonicalPosition = (x: number, z: number): CanonicalPosition => ({
  ...sourceToLonLat(x, z),
  elevation: 0,
});

export const continents = [
  { id: 0, name: "Eldermere", x: 0, z: 6500 },
  { id: 1, name: "Westreach", x: -80000, z: 6500 },
  { id: 2, name: "Dawnlands", x: 80000, z: 6500 },
].map((continent) => ({
  ...continent,
  canonicalPosition: canonicalPosition(continent.x, continent.z),
}));

export const countries = continents.flatMap((continent) =>
  Array.from({ length: 10 }, (_, id) => {
    const slot = (id + 2) % 10,
      x = continent.x + ((slot % 5) - 2) * 7000,
      z = Math.floor(slot / 5) * 13000;
    return {
      id,
      continent: continent.id,
      code: `${WORLD_SEED}/CONT/${continent.id}/COUNTRY/${id}`,
      name: [
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
      ][id],
      x,
      z,
      canonicalPosition: canonicalPosition(x, z),
    };
  }),
);

export const cities: Place[] = countries.flatMap((country) =>
  [
    [0, -600],
    [-2400, 2000],
    [2400, 2000],
  ].map(([dx, dz], city) => {
    const id = `${country.continent}/${country.id}/${city}`,
      x = country.x + dx,
      z = country.z + dz;
    return {
      id,
      code: `${country.code}/CITY/${city}`,
      name: `${country.name} ${["Citadel", "Market", "Harbour"][city]}`,
      x,
      z,
      canonicalPosition: canonicalPosition(x, z),
      kind: "city" as const,
      continent: country.continent,
      country: country.id,
      city,
    };
  }),
);

export const villages: Place[] = cities.flatMap((city) =>
  Array.from({ length: 3 }, (_, v) => {
    const x = city.x + v * VILLAGE_SPACING_M,
      z = city.z + 600;
    return {
      ...city,
      id: `${city.id}/${v}`,
      code: `${city.code}/VILLAGE/${v}`,
      kind: "village" as const,
      name:
        city.continent === 0 && city.country === 0 && city.city === 0 && v === 0
          ? "Alderwick"
          : `${["Briarford", "Oakmere", "Thornfield"][v]} ${city.continent + 1}.${city.country + 1}.${city.city + 1}`,
      x,
      z,
      canonicalPosition: canonicalPosition(x, z),
    };
  }),
);

export const places = [...cities, ...villages];

export const roads = cities.flatMap((city) =>
  [0, 1].map((index) => {
    const minX = city.x + index * VILLAGE_SPACING_M,
      maxX = city.x + (index + 1) * VILLAGE_SPACING_M,
      z = city.z + 600,
      fromPosition = canonicalPosition(minX, z),
      toPosition = canonicalPosition(maxX, z);
    return {
      code: `${city.code}/ROAD/${index}`,
      from: `${city.id}/${index}`,
      to: `${city.id}/${index + 1}`,
      minX,
      maxX,
      z,
      fromPosition,
      toPosition,
      /** Transitional source-route span retained for current local rendering. */
      length: VILLAGE_SPACING_M,
      /** Authoritative spherical distance of the current endpoints. */
      surfaceLengthM: greatCircleDistance(fromPosition, toPosition),
      walkSeconds: VILLAGE_SPACING_M / WALK_SPEED_MPS,
      fantasyWalkSeconds: (VILLAGE_SPACING_M / WALK_SPEED_MPS) * 24,
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

/** Canonical nearest-continent lookup; independent of antimeridian presentation. */
export function continentAtPosition(position: LonLat) {
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

// Immutable source/render spatial buckets avoid scanning all settlements at every
// terrain sample. They are a presentation acceleration structure, never identity.
const buckets = new Map<string, Place[]>();
for (const place of places) {
  const key = `${Math.floor(place.x / 2048)}/${Math.floor(place.z / 2048)}`;
  const bucket = buckets.get(key) || [];
  bucket.push(place);
  buckets.set(key, bucket);
}

// Neighbourhood lists are immutable too: build each once, then reuse it.
const neighbourhoods = new Map<string, readonly Place[]>();
export function nearbyPlaces(x: number, z: number): readonly Place[] {
  const bx = Math.floor(x / 2048),
    bz = Math.floor(z / 2048),
    key = `${bx}/${bz}`;
  let result = neighbourhoods.get(key);
  if (!result) {
    const found: Place[] = [];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        found.push(...(buckets.get(`${bx + dx}/${bz + dz}`) || []));
    neighbourhoods.set(key, (result = found));
  }
  return result;
}

/** Transitional source/render lookup used by local terrain generation. */
export function nearestPlace(x: number, z: number): Place | undefined {
  let result: Place | undefined,
    distance = Infinity;
  for (const place of nearbyPlaces(x, z)) {
    const d = Math.hypot(x - place.x, z - place.z);
    if (d < distance) {
      distance = d;
      result = place;
    }
  }
  return result;
}

/** Transitional source/render lookup used by the current local terrain envelope. */
export function continentAt(x: number, z: number) {
  let result = continents[0];
  for (const c of continents)
    if (Math.hypot(x - c.x, z - c.z) < Math.hypot(x - result.x, z - result.z))
      result = c;
  return result;
}

export function continentalEnvelope(x: number, z: number) {
  const c = continentAt(x, z),
    nx = (x - c.x) / (27000 + c.id * 3000),
    nz = (z - c.z) / (25000 + (c.id % 2) * 2500);
  const angle = Math.atan2(nz, nx);
  const outline =
    1 +
    0.09 * Math.sin(angle * 3 + c.id * 1.3) +
    0.05 * Math.cos(angle * 5 - c.id);
  return Math.hypot(nx, nz) / outline;
}

/** Transitional source/render road hit test; road identity is its seed code. */
export function roadAt(x: number, z: number) {
  // City groups are far apart; nearby villages identify only relevant roads.
  const local = nearbyPlaces(x, z).filter(
    (p) =>
      p.kind === "village" &&
      Math.abs(z - p.z) < 12 &&
      x >= p.x - 420 &&
      x <= p.x + 840,
  );
  if (!local.length) return undefined;
  return roads.find(
    (r) =>
      Math.abs(z - r.z) < 12 &&
      x >= r.minX - 8 &&
      x <= r.maxX + 8 &&
      local.some((p) =>
        p.id.startsWith(r.from.slice(0, r.from.lastIndexOf("/")) + "/"),
      ),
  );
}
