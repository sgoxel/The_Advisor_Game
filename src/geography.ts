import { climateSampleAt } from "./climate.ts";
import { COARSE_GEOGRAPHY_VERSION as WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import {
  CANONICAL_PLANET_RADIUS,
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
import { defineContinuityCorridor } from "./continuity-corridor.ts";
import { freshwaterAccessAt, naturalSurfaceAt, SETTLEMENT_WATER_RESERVE_SOURCE, freshwaterHabitatCandidate, drainageCoarseSegments } from "./hydrology.ts";

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
const MIN_CITIES_PER_COUNTRY = 3;
const MAX_CITIES_PER_COUNTRY = 4;
const MIN_VILLAGES_PER_CITY = 3;
const MAX_VILLAGES_PER_CITY = 4;
const CULTURE_STEMS = [
  ["Alder", "Briar", "Oak", "Thorn", "Grey", "Mere", "Stone", "Willow", "Falcon", "Hearth", "Raven", "Ash"],
  ["Gold", "Rose", "Iron", "Sun", "Dawn", "High", "Red", "White", "Wind", "Crown", "Silver", "North"],
  ["Moss", "Pine", "Ember", "Sable", "Lake", "Long", "East", "West", "Frost", "Wolf", "Star", "Black"],
] as const;
const CITY_ENDINGS = [
  "haven", "gate", "hold", "watch", "reach", "bridge", "crest", "court", "spire", "ford", "mere", "cross",
] as const;
const VILLAGE_ENDINGS = [
  "wick", "ford", "mere", "field", "brook", "stead", "hollow", "den", "wood", "well", "ham", "croft", "thorpe", "lea", "combe", "fold",
] as const;
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
function seededSettlementName(
  kind: "city" | "village",
  address: string,
  continent: number,
  used: Set<string>,
) {
  const stems = CULTURE_STEMS[continent % CULTURE_STEMS.length],
    endings = kind === "city" ? CITY_ENDINGS : VILLAGE_ENDINGS,
    reserved = new Set(COUNTRY_NAMES.map((name) => name.toLowerCase()));
  for (let attempt = 0; attempt < 96; attempt++) {
    const stem = stems[Math.floor(addressed(`${address}/NAME/${attempt}/STEM`) * stems.length)],
      ending = endings[Math.floor(addressed(`${address}/NAME/${attempt}/ENDING`) * endings.length)],
      name = `${stem}${ending}`,
      key = name.toLowerCase();
    if (used.has(key) || reserved.has(key)) continue;
    used.add(key);
    return name;
  }
  throw new Error(`Seeded geography could not create unique ${kind} name for ${address}`);
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
function initialBearing(from: LonLat, to: LonLat) {
  const deltaLon = normalizeLongitude(to.lon - from.lon);
  return Math.atan2(
    Math.sin(deltaLon) * Math.cos(to.lat),
    Math.cos(from.lat) * Math.sin(to.lat) -
      Math.sin(from.lat) * Math.cos(to.lat) * Math.cos(deltaLon),
  );
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

function countryRegistryCountsForSeed(seed: string) {
  const perContinent = continents.map(
    (continent) => 10 + Math.floor(addressedFor(seed, `COUNTRY_COUNT/${continent.id}`) * 3),
  );
  return {
    perContinent,
    countries: perContinent.reduce((sum, count) => sum + count, 0),
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
 * Canonical settlement-site guard. This WP reserves land-connected settlements on
 * the seeded mainland so every accepted city/village can reach its country backbone
 * without inventing a ferry or filling water. Island transport remains transport-
 * network scope. All wetness here comes from macro geography; no prototype river or
 * source-presentation coordinate is allowed to decide settlement validity.
 */
function locallyDrySettlementSite(position: LonLat, maxReliefM: number) {
  const macro = macroSampleAt(position);
  const source = lonLatToSource(position.lon, position.lat),
    natural = naturalSurfaceAt(source.x, source.z);
  return (
    macro.land &&
    macro.domain === "Mainland" &&
    macro.reliefM <= maxReliefM &&
    macro.coastDistanceRad * CANONICAL_PLANET_RADIUS >= 3_000 &&
    natural.water.kind === "none" &&
    natural.walkable &&
    freshwaterAccessAt(position).sourceDistance >= SETTLEMENT_WATER_RESERVE_SOURCE
  );
}

/**
 * Country anchors are selected by deterministic farthest-candidate sampling over
 * each full seeded mainland footprint. They are not a centre cluster, ring, grid,
 * or mutable random stream.
 */
function buildCountries(): Country[] {
  const result: Country[] = [],
    counts = countryRegistryCountsForSeed(WORLD_SEED).perContinent;
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

/** A generated city must have a direct dry same-country reserve to its country backbone. */
function cityBackboneConnectionFits(from: LonLat, to: LonLat, country: Country) {
  const distanceRad = greatCircleDistance(from, to) / CANONICAL_PLANET_RADIUS,
    bearing = initialBearing(from, to),
    samples = 24;
  for (let index = 0; index <= samples; index++) {
    const point = destination(from, bearing, distanceRad * (index / samples)),
      macro = macroSampleAt(point);
    if (
      !macro.land ||
      macro.domain === "Lake" ||
      macro.continentId !== country.continent ||
      countryAtPosition(point)?.code !== country.code
    )
      return false;
  }
  return true;
}

/**
 * Generation-time settlement acceptance. A canonical settlement anchor is only
 * accepted when its minimum usable footprint and at least one approach beyond
 * that footprint remain dry, low-relief and inside the same political owner.
 * This prevents later building/road systems from repairing a fundamentally bad
 * site with hidden land fill or border-crossing entrances.
 */
function settlementEnvelopeFits(
  position: LonLat,
  country: Country,
  kind: Place["kind"],
) {
  const radiusM = kind === "city" ? 240 : 170,
    reliefLimit = kind === "city" ? 46 : 34,
    centreRelief = macroSampleAt(position).reliefM,
    reliefs = [centreRelief];
  for (let index = 0; index < 12; index++) {
    const sample = destination(
        position,
        (index / 12) * TAU,
        radiusM / CANONICAL_PLANET_RADIUS,
      ),
      owner = countryAtPosition(sample),
      relief = macroSampleAt(sample).reliefM;
    if (
      owner?.code !== country.code ||
      !locallyDrySettlementSite(sample, 180)
    )
      return false;
    reliefs.push(relief);
  }
  if (Math.max(...reliefs) - Math.min(...reliefs) > reliefLimit) return false;

  const start = TAU * addressed(
      `${country.code}/${kind.toUpperCase()}/ENVELOPE/${position.lon.toFixed(8)}/${position.lat.toFixed(8)}`,
    ),
    approachDistanceM = radiusM + (kind === "city" ? 260 : 140);
  for (let attempt = 0; attempt < 24; attempt++) {
    const bearing = start + (attempt / 24) * TAU,
      approach = destination(
        position,
        bearing,
        approachDistanceM / CANONICAL_PLANET_RADIUS,
      ),
      midpoint = destination(
        position,
        bearing,
        (approachDistanceM * 0.5) / CANONICAL_PLANET_RADIUS,
      );
    if (
      countryAtPosition(approach)?.code === country.code &&
      countryAtPosition(midpoint)?.code === country.code &&
      locallyDrySettlementSite(approach, 180) &&
      locallyDrySettlementSite(midpoint, 180) &&
      Math.abs(macroSampleAt(approach).reliefM - centreRelief) <=
        (kind === "city" ? 70 : 55)
    )
      return true;
  }
  return false;
}

function countryCenteredCandidate(country: Country, address: string, attempt: number) {
  const bearing = TAU * addressed(`${address}/${attempt}/bearing`),
    distanceM = 6_000 + 92_000 * Math.sqrt(addressed(`${address}/${attempt}/distance`));
  return destination(country.canonicalPosition, bearing, distanceM / CANONICAL_PLANET_RADIUS);
}

/**
 * Coarse capacity is sampled from the country's own usable land. It is derived
 * acceleration data used only to decide how many minimum-plus settlements the
 * current SEED can support; it never depends on camera, visit order or renderer.
 */
const countryHabitatCapacity = new Map<string, number>();
function habitatCapacityForCountry(country: Country) {
  let cached = countryHabitatCapacity.get(country.code);
  if (cached !== undefined) return cached;
  let viable = 0,
    fresh = 0,
    arable = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = countryCenteredCandidate(country, `${country.code}/CAPACITY`, attempt);
    if (
      countryAtPosition(candidate)?.code !== country.code ||
      !locallyDrySettlementSite(candidate, 120)
    )
      continue;
    viable++;
    const water = freshwaterAccessAt(candidate),
      climate = climateSampleAt(candidate);
    if (water.nearby) fresh++;
    if (climate.moisture >= 0.18 && climate.moisture <= 0.78) arable++;
  }
  cached = viable + fresh * 0.55 + arable * 0.3;
  countryHabitatCapacity.set(country.code, cached);
  return cached;
}

function cityTargetForCountry(country: Country) {
  const capacity = habitatCapacityForCountry(country),
    supportsExtra = capacity >= 11,
    seededExtra = addressed(`${country.code}/CITY_TARGET`) >= 0.34;
  return Math.min(
    MAX_CITIES_PER_COUNTRY,
    MIN_CITIES_PER_COUNTRY + (supportsExtra && seededExtra ? 1 : 0),
  );
}

function villageTargetForSite(position: LonLat, country: Country, cityIndex: number) {
  const water = freshwaterAccessAt(position),
    climate = climateSampleAt(position),
    countryCapacity = habitatCapacityForCountry(country),
    supportsExtra = water.nearby || (climate.moisture >= 0.22 && countryCapacity >= 10),
    seededExtra = addressed(`${country.code}/CITY/${cityIndex}/VILLAGE_TARGET`) >= 0.48;
  return Math.min(
    MAX_VILLAGES_PER_CITY,
    MIN_VILLAGES_PER_CITY + (supportsExtra && seededExtra ? 1 : 0),
  );
}

function interiorOwnershipScore(position: LonLat, country: Country) {
  let owned = 0;
  for (let index = 0; index < 8; index++) {
    const sample = destination(
      position,
      (index / 8) * TAU,
      12_000 / CANONICAL_PLANET_RADIUS,
    );
    if (countryAtPosition(sample)?.code === country.code) owned++;
  }
  return owned / 8;
}

function cityCandidate(country: Country, city: number, attempt: number) {
  if (attempt % 3 === 0) {
    const candidate = freshwaterHabitatCandidate(
      countryWaterSegments.get(country.code) || [],
      `CITY/${country.continent}/${country.id}/${city}/${attempt}`,
    );
    if (candidate) return { ...candidate, elevation: 0 };
  }
  if (attempt % 3 === 1)
    return countryCenteredCandidate(
      country,
      `CITY/${country.continent}/${country.id}/${city}`,
      attempt,
    );
  return continentCandidate(
    continents[country.continent],
    `CITY/${country.continent}/${country.id}/${city}`,
    attempt,
  );
}

// A one-time coarse ownership index; hydrology was defined before these countries.
const countryWaterSegments = new Map<string, (typeof drainageCoarseSegments)[number][]>();
for (const segment of drainageCoarseSegments) {
  const midpoint = sourceToLonLat(
      segment.ax + wrapSourceX(segment.bx - segment.ax) / 2,
      (segment.az + segment.bz) / 2,
    ),
    owner = countryAtPosition(midpoint);
  if (!owner) continue;
  const list = countryWaterSegments.get(owner.code) || [];
  list.push(segment);
  countryWaterSegments.set(owner.code, list);
}

const plannedVillagePositions = new Map<string, CanonicalPosition[]>();
const reservedVillagePositions: CanonicalPosition[] = [];
function planVillagePositions(
  city: Pick<Place, "id" | "canonicalPosition" | "continent" | "country" | "city">,
  country: Country,
  reserved: readonly CanonicalPosition[],
  targetCount: number,
): CanonicalPosition[] | null {
  const selected: CanonicalPosition[] = [],
    accepted = [...reserved],
    waterSegments = countryWaterSegments.get(country.code) || [];
  for (let v = 0; v < targetCount; v++) {
    let position: CanonicalPosition | undefined;
    let dryException: CanonicalPosition | undefined;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 360; attempt++) {
      const prefix = `VILLAGE/${city.id}/${v}/${attempt}`,
        bearing = TAU * addressed(`${prefix}/bearing`),
        distanceM = 6_000 + 72_000 * Math.sqrt(addressed(`${prefix}/distance`)),
        waterCandidate =
          attempt % 3 !== 2 ? freshwaterHabitatCandidate(waterSegments, prefix) : undefined,
        candidate = waterCandidate
          ? { ...waterCandidate, elevation: 0 }
          : destination(city.canonicalPosition, bearing, distanceM / CANONICAL_PLANET_RADIUS),
        owner = countryAtPosition(candidate),
        parentDistanceM = macroFeatureDistanceM(candidate, city.canonicalPosition);
      if (
        !owner ||
        owner.code !== country.code ||
        parentDistanceM < 6_000 ||
        accepted.some((other) => macroFeatureDistanceM(candidate, other) < 6_000) ||
        !locallyDrySettlementSite(candidate, 95)
      )
        continue;
      const water = freshwaterAccessAt(candidate),
        climate = climateSampleAt(candidate),
        separation = accepted.length
          ? Math.min(...accepted.map((other) => macroFeatureDistanceM(candidate, other)))
          : parentDistanceM,
        habitatBonus =
          (water.nearby ? 32_000 : 0) +
          (climate.moisture >= 0.18 && climate.moisture <= 0.78 ? 8_000 : 0),
        coverageBonus = Math.min(55_000, separation),
        parentAffinity = Math.max(0, 28_000 - parentDistanceM) * 0.12,
        score =
          coverageBonus +
          habitatBonus +
          parentAffinity +
          4_000 * addressed(`${prefix}/rank`);
      if (
        water.nearby &&
        score > bestScore &&
        settlementEnvelopeFits(candidate, country, "village")
      ) {
        position = candidate;
        bestScore = score;
      }
      if (
        water.arid &&
        !water.nearby &&
        water.distanceM <= 8_000 &&
        !dryException &&
        settlementEnvelopeFits(candidate, country, "village")
      )
        dryException = candidate;
    }
    // Arid city regions may retain one exposed dry-region village with an
    // existing water source within 8 km. Ordinary sites still prefer 4 km.
    if (
      v === targetCount - 1 &&
      climateSampleAt(city.canonicalPosition).moisture < 0.2 &&
      dryException
    )
      position = dryException;
    position ??= dryException;
    if (!position) return null;
    accepted.push(position);
    selected.push(position);
  }
  return selected;
}

export const cities: Place[] = (() => {
  const result: Place[] = [],
    allAccepted: CanonicalPosition[] = [],
    usedNames = new Set<string>();
  for (const country of countries) {
    const localAccepted: CanonicalPosition[] = [],
      targetCities = cityTargetForCountry(country);
    for (let city = 0; city < targetCities; city++) {
      let best: CanonicalPosition | undefined;
      const candidates: { position: CanonicalPosition; score: number; attempt: number }[] = [];
      for (let attempt = 0; attempt < 280; attempt++) {
        const candidate = cityCandidate(country, city, attempt),
          owner = countryAtPosition(candidate);
        if (
          !owner ||
          owner.code !== country.code ||
          allAccepted.some((other) => macroFeatureDistanceM(candidate, other) < 18_000) ||
          !locallyDrySettlementSite(candidate, 90) ||
          (city > 0 &&
            localAccepted[0] &&
            !cityBackboneConnectionFits(candidate, localAccepted[0], country))
        )
          continue;
        const separation = localAccepted.length
            ? Math.min(...localAccepted.map((other) => macroFeatureDistanceM(candidate, other)))
            : 26_000,
          water = freshwaterAccessAt(candidate),
          climate = climateSampleAt(candidate),
          habitatBonus =
            (water.nearby ? 36_000 : 0) +
            (climate.moisture >= 0.18 && climate.moisture <= 0.78 ? 10_000 : 0),
          interiorBonus = interiorOwnershipScore(candidate, country) * 30_000,
          score =
            Math.min(85_000, separation) +
            habitatBonus +
            interiorBonus +
            5_000 * addressed(`CITY/${country.code}/${city}/${attempt}/rank`);
        candidates.push({ position: candidate, score, attempt });
      }
      const plannedId = `${country.continent}/${country.id}/${city}`;
      let layoutTrials = 0;
      for (const candidate of candidates.sort((a, b) => b.score - a.score || a.attempt - b.attempt)) {
        if (!settlementEnvelopeFits(candidate.position, country, "city")) continue;
        if (layoutTrials++ >= 28) break;
        const targetVillages = villageTargetForSite(candidate.position, country, city),
          children = planVillagePositions(
            {
              id: plannedId,
              canonicalPosition: candidate.position,
              continent: country.continent,
              country: country.id,
              city,
            },
            country,
            reservedVillagePositions,
            targetVillages,
          );
        if (!children) continue;
        best = candidate.position;
        plannedVillagePositions.set(plannedId, children);
        reservedVillagePositions.push(...children);
        break;
      }
      if (!best)
        throw new Error(`Seeded geography could not place city ${country.continent}/${country.id}/${city}`);
      localAccepted.push(best);
      allAccepted.push(best);
      const id = `${country.continent}/${country.id}/${city}`,
        code = `${country.code}/CITY/${city}`,
        name = seededSettlementName("city", code, country.continent, usedNames);
      result.push(
        withPresentation({
          id,
          code,
          name,
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

/** Villages use country-wide habitat/coverage candidates; parent city is identity, not a radius cap. */
export const villages: Place[] = (() => {
  const result: Place[] = [],
    accepted: CanonicalPosition[] = [],
    usedNames = new Set<string>(["alderwick"]);
  for (const city of cities) {
    const positions = plannedVillagePositions.get(city.id) || [];
    for (let v = 0; v < positions.length; v++) {
      const position = positions[v];
      accepted.push(position);
      const code = `${city.code}/VILLAGE/${v}`,
        name =
          city.continent === 0 && city.country === 0 && city.city === 0 && v === 0
            ? "Alderwick"
            : seededSettlementName("village", code, city.continent, usedNames);
      result.push(
        withPresentation({
          ...city,
          id: `${city.id}/${v}`,
          code,
          kind: "village" as const,
          name,
          canonicalPosition: position,
        }),
      );
    }
  }
  return result;
})();

/**
 * Active-world counts are the authoritative generated registries. Alternate-seed
 * values are deterministic coarse forecasts used only by tests/tools that compare
 * seed variability without rebuilding the whole module graph.
 */
export function politicalRegistryCountsForSeed(seed: string) {
  const { perContinent, countries: countryCount } = countryRegistryCountsForSeed(seed);
  if (seed === WORLD_SEED)
    return {
      continents: continents.length,
      perContinent,
      countries: countryCount,
      cities: cities.length,
      villages: villages.length,
    } as const;
  let cityCount = 0,
    villageCount = 0;
  for (let continent = 0; continent < perContinent.length; continent++)
    for (let country = 0; country < perContinent[continent]; country++) {
      const extraCity =
          addressedFor(seed, `FORECAST/${continent}/${country}/CITY_TARGET`) >= 0.58 ? 1 : 0,
        targetCities = MIN_CITIES_PER_COUNTRY + extraCity;
      cityCount += targetCities;
      for (let city = 0; city < targetCities; city++)
        villageCount +=
          MIN_VILLAGES_PER_CITY +
          (addressedFor(seed, `FORECAST/${continent}/${country}/${city}/VILLAGE_TARGET`) >=
          0.62
            ? 1
            : 0);
    }
  return {
    continents: continents.length,
    perContinent,
    countries: countryCount,
    cities: cityCount,
    villages: villageCount,
  } as const;
}

export const places = [...cities, ...villages];

export const roads = cities.flatMap((city) => {
  const children = villages.filter((place) => place.id.startsWith(`${city.id}/`));
  return children.slice(0, -1).map((fromPlace, index) => {
    const toPlace = children[index + 1],
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
      centerline: undefined as readonly { x: number; z: number; position: LonLat }[] | undefined,
    };
  });
});

export type Road = (typeof roads)[number];
export const continuityCorridor = defineContinuityCorridor(villages, roads[0]);
if (continuityCorridor.road) roads.push(continuityCorridor.road);

export function roadDistanceAt(x: number, z: number, road: Road) {
  if (road.centerline) {
    const px = road.fromX + wrapSourceX(x - road.fromX);
    let distance = Infinity;
    for (let i = 0; i < road.centerline.length - 1; i++) {
      const a = road.centerline[i],
        b = road.centerline[i + 1],
        vx = b.x - a.x,
        vz = b.z - a.z,
        length = vx * vx + vz * vz,
        t =
          length === 0
            ? 0
            : Math.max(0, Math.min(1, ((px - a.x) * vx + (z - a.z) * vz) / length));
      distance = Math.min(distance, Math.hypot(px - a.x - vx * t, z - a.z - vz * t));
    }
    return distance;
  }
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
  for (const x of [
    place.x - SOURCE_PRESENTATION_WIDTH,
    place.x,
    place.x + SOURCE_PRESENTATION_WIDTH,
  ]) {
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
        for (const place of buckets.get(`${bx + dx}/${bz + dz}`) || [])
          found.set(place.id, place);
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
          result.push({
            ax: a.x,
            az: a.z,
            bx: b.x,
            bz: b.z,
            countries: [left, right],
          });
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
