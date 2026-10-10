import {
  cities,
  countries,
  countryAtPosition,
  macroGeography,
  villages,
  type Country,
  type Place,
} from "./geography.ts";
import { climateSampleAt } from "./climate.ts";
import { macroFeatureDistanceM, macroSampleAt } from "./macro-geography.ts";
import {
  CANONICAL_PLANET_RADIUS,
  greatCircleDistance,
  normalizeLongitude,
  type CanonicalPosition,
  type LonLat,
} from "./planet.ts";

const TAU = Math.PI * 2;
const ENVELOPE_SAMPLES = 12;
const CORRIDOR_SAMPLES = 14;
const GATE_BEARINGS = 24;
const GATE_STEP_M = 5_000;
const GATE_MAX_M = 180_000;

export type SettlementWaterContext = "freshwater-lake" | "coast" | "dryland-exception" | "inland";

export type PoliticalSettlementSitePlan = {
  placeId: string;
  placeCode: string;
  countryCode: string;
  kind: Place["kind"];
  centre: CanonicalPosition;
  envelopeRadiusM: number;
  reservedAreaM2: number;
  plotCapacity: number;
  entranceBearingRad: number;
  entrance: CanonicalPosition;
  maximumEnvelopeReliefSpreadM: number;
  maximumPreparedCutFillM: number;
  waterContext: SettlementWaterContext;
  waterDistanceM: number;
};

export type PoliticalAccessLink = {
  id: string;
  countryCode: string;
  fromId: string;
  toId: string;
  waypoints: readonly CanonicalPosition[];
  distanceM: number;
  feasible: boolean;
};

export type PoliticalBorderGateway = {
  id: string;
  countryCode: string;
  neighbourCountryCode: string;
  fromCityId: string;
  inside: CanonicalPosition;
  outside: CanonicalPosition;
  bearingRad: number;
  corridor: readonly CanonicalPosition[];
};

function digest(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

function addressed(address: string) {
  return digest(address) / 4294967296;
}

function position(lon: number, lat: number, elevation = 0): CanonicalPosition {
  return {
    lon: normalizeLongitude(lon),
    lat: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, lat)),
    elevation,
  };
}

function destination(origin: LonLat, bearing: number, distanceM: number): CanonicalPosition {
  const angular = distanceM / CANONICAL_PLANET_RADIUS,
    sinLat =
      Math.sin(origin.lat) * Math.cos(angular) +
      Math.cos(origin.lat) * Math.sin(angular) * Math.cos(bearing),
    lat = Math.asin(Math.max(-1, Math.min(1, sinLat))),
    lon = normalizeLongitude(
      origin.lon +
        Math.atan2(
          Math.sin(bearing) * Math.sin(angular) * Math.cos(origin.lat),
          Math.cos(angular) - Math.sin(origin.lat) * Math.sin(lat),
        ),
    );
  return position(lon, lat);
}

function initialBearing(from: LonLat, to: LonLat) {
  const deltaLon = normalizeLongitude(to.lon - from.lon);
  return Math.atan2(
    Math.sin(deltaLon) * Math.cos(to.lat),
    Math.cos(from.lat) * Math.sin(to.lat) -
      Math.sin(from.lat) * Math.cos(to.lat) * Math.cos(deltaLon),
  );
}

function interpolate(from: LonLat, to: LonLat, t: number) {
  const distanceM = greatCircleDistance(from, to),
    bearing = initialBearing(from, to);
  return destination(from, bearing, distanceM * Math.max(0, Math.min(1, t)));
}

function sameDryOwner(point: LonLat, country: Country, reliefCeiling = 180) {
  const macro = macroSampleAt(point),
    owner = countryAtPosition(point);
  return (
    macro.land &&
    macro.domain !== "Lake" &&
    macro.continentId === country.continent &&
    macro.reliefM <= reliefCeiling &&
    owner?.code === country.code
  );
}

function ringSamples(centre: LonLat, radiusM: number) {
  return Array.from({ length: ENVELOPE_SAMPLES }, (_, index) =>
    destination(centre, (index / ENVELOPE_SAMPLES) * TAU, radiusM),
  );
}

function waterContext(place: Place) {
  const macro = macroSampleAt(place.canonicalPosition),
    lakeDistanceM = macroGeography.lakes
      .filter((lake) => lake.continent === place.continent)
      .reduce(
        (best, lake) =>
          Math.min(
            best,
            Math.max(
              0,
              macroFeatureDistanceM(place.canonicalPosition, lake.center) -
                lake.radiusRad * CANONICAL_PLANET_RADIUS,
            ),
          ),
        Infinity,
      ),
    coastDistanceM = Math.max(0, macro.coastDistanceRad * CANONICAL_PLANET_RADIUS),
    climate = climateSampleAt(place.canonicalPosition, macro.reliefM);
  if (lakeDistanceM <= 80_000)
    return { waterContext: "freshwater-lake" as const, waterDistanceM: lakeDistanceM };
  if (coastDistanceM <= 65_000)
    return { waterContext: "coast" as const, waterDistanceM: coastDistanceM };
  if (
    climate.moisture < 0.42 ||
    climate.terrainClass === "desert" ||
    climate.terrainClass === "dryland" ||
    climate.terrainClass === "dry-woodland"
  )
    return {
      waterContext: "dryland-exception" as const,
      waterDistanceM: Math.min(lakeDistanceM, coastDistanceM),
    };
  return {
    waterContext: "inland" as const,
    waterDistanceM: Math.min(lakeDistanceM, coastDistanceM),
  };
}

function chooseEntrance(place: Place, country: Country, envelopeRadiusM: number) {
  const start = TAU * addressed(`${place.code}/SITE/ENTRANCE`),
    distanceM = envelopeRadiusM + (place.kind === "city" ? 260 : 140),
    centreRelief = macroSampleAt(place.canonicalPosition).reliefM;
  for (let attempt = 0; attempt < 24; attempt++) {
    const bearing = normalizeLongitude(start + (attempt / 24) * TAU),
      candidate = destination(place.canonicalPosition, bearing, distanceM),
      midpoint = destination(place.canonicalPosition, bearing, distanceM * 0.5),
      candidateRelief = macroSampleAt(candidate).reliefM;
    if (
      sameDryOwner(candidate, country, 180) &&
      sameDryOwner(midpoint, country, 180) &&
      Math.abs(candidateRelief - centreRelief) <= (place.kind === "city" ? 70 : 55)
    )
      return { bearing, candidate };
  }
  return undefined;
}

function buildSitePlan(place: Place): PoliticalSettlementSitePlan | undefined {
  const country = countries.find(
    (candidate) => candidate.continent === place.continent && candidate.id === place.country,
  );
  if (!country || countryAtPosition(place.canonicalPosition)?.code !== country.code) return undefined;
  const centreMacro = macroSampleAt(place.canonicalPosition),
    radiusOptions = place.kind === "city" ? [420, 360, 300, 240] : [240, 200, 170, 140],
    reliefLimit = place.kind === "city" ? 46 : 34,
    minimumPlots = place.kind === "city" ? 180 : 48,
    nominalPlotArea = place.kind === "city" ? 700 : 900;
  for (const envelopeRadiusM of radiusOptions) {
    const samples = [
        ...ringSamples(place.canonicalPosition, envelopeRadiusM),
        ...ringSamples(place.canonicalPosition, envelopeRadiusM * 0.56),
      ],
      reliefs = samples.map((sample) => macroSampleAt(sample).reliefM),
      reliefSpread = Math.max(...reliefs, centreMacro.reliefM) - Math.min(...reliefs, centreMacro.reliefM),
      reservedAreaM2 = Math.PI * envelopeRadiusM * envelopeRadiusM,
      plotCapacity = Math.floor((reservedAreaM2 * 0.7) / nominalPlotArea);
    if (
      reliefSpread > reliefLimit ||
      plotCapacity < minimumPlots ||
      samples.some((sample) => !sameDryOwner(sample, country, 180))
    )
      continue;
    const entrance = chooseEntrance(place, country, envelopeRadiusM);
    if (!entrance) continue;
    const water = waterContext(place);
    return {
      placeId: place.id,
      placeCode: place.code,
      countryCode: country.code,
      kind: place.kind,
      centre: place.canonicalPosition,
      envelopeRadiusM,
      reservedAreaM2,
      plotCapacity,
      entranceBearingRad: entrance.bearing,
      entrance: entrance.candidate,
      maximumEnvelopeReliefSpreadM: reliefSpread,
      // Surface preparation is deliberately bounded and cannot imply a cavern/tunnel.
      maximumPreparedCutFillM: Math.min(place.kind === "city" ? 8 : 6, Math.max(1, reliefSpread * 0.35)),
      ...water,
    };
  }
  return undefined;
}

function segmentLegal(from: LonLat, to: LonLat, country: Country, samples = CORRIDOR_SAMPLES) {
  for (let index = 0; index <= samples; index++)
    if (!sameDryOwner(interpolate(from, to, index / samples), country, 220)) return false;
  return true;
}

function corridor(from: Place, to: Place, country: Country): readonly CanonicalPosition[] | undefined {
  if (segmentLegal(from.canonicalPosition, to.canonicalPosition, country))
    return [from.canonicalPosition, to.canonicalPosition];

  const distanceM = greatCircleDistance(from.canonicalPosition, to.canonicalPosition),
    midpoint = interpolate(from.canonicalPosition, to.canonicalPosition, 0.5),
    phase = TAU * addressed(`${country.code}/ACCESS/${from.code}/${to.code}`),
    detours = [
      Math.min(90_000, Math.max(4_000, distanceM * 0.1)),
      Math.min(90_000, Math.max(8_000, distanceM * 0.2)),
      Math.min(90_000, Math.max(12_000, distanceM * 0.3)),
    ];
  for (const detourM of detours)
    for (let attempt = 0; attempt < 24; attempt++) {
      const waypoint = destination(midpoint, phase + (attempt / 24) * TAU, detourM);
      if (
        sameDryOwner(waypoint, country, 220) &&
        segmentLegal(from.canonicalPosition, waypoint, country, 10) &&
        segmentLegal(waypoint, to.canonicalPosition, country, 10)
      )
        return [from.canonicalPosition, waypoint, to.canonicalPosition];
    }
  return undefined;
}

function link(from: Place, to: Place, country: Country): PoliticalAccessLink {
  const waypoints = corridor(from, to, country),
    distanceM = waypoints
      ? waypoints.slice(1).reduce(
          (sum, point, index) => sum + greatCircleDistance(waypoints[index], point),
          0,
        )
      : Infinity;
  return {
    id: `${country.code}/ACCESS/${from.id}/${to.id}`,
    countryCode: country.code,
    fromId: from.id,
    toId: to.id,
    waypoints: waypoints ?? [],
    distanceM,
    feasible: Boolean(waypoints),
  };
}

function gateway(country: Country, city: Place): PoliticalBorderGateway | undefined {
  const phase = TAU * addressed(`${country.code}/GATE/PHASE`);
  for (let bearingIndex = 0; bearingIndex < GATE_BEARINGS; bearingIndex++) {
    const bearing = phase + (bearingIndex / GATE_BEARINGS) * TAU;
    let previous = city.canonicalPosition;
    for (let distanceM = GATE_STEP_M; distanceM <= GATE_MAX_M; distanceM += GATE_STEP_M) {
      const point = destination(city.canonicalPosition, bearing, distanceM),
        macro = macroSampleAt(point),
        owner = countryAtPosition(point);
      if (!macro.land || macro.continentId !== country.continent || !owner) break;
      if (owner.code === country.code) {
        previous = point;
        continue;
      }
      if (!segmentLegal(city.canonicalPosition, previous, country, 16)) break;
      return {
        id: `${country.code}/GATE/${owner.code}`,
        countryCode: country.code,
        neighbourCountryCode: owner.code,
        fromCityId: city.id,
        inside: previous,
        outside: point,
        bearingRad: bearing,
        corridor: [city.canonicalPosition, previous],
      };
    }
  }
  return undefined;
}

export const politicalSettlementSitePlans = [...cities, ...villages]
  .map(buildSitePlan)
  .filter((plan): plan is PoliticalSettlementSitePlan => Boolean(plan));

export const politicalSettlementSiteById = new Map(
  politicalSettlementSitePlans.map((plan) => [plan.placeId, plan] as const),
);

export const politicalAccessLinks: PoliticalAccessLink[] = [];
export const politicalBorderGateways: PoliticalBorderGateway[] = [];
for (const country of countries) {
  const countryCities = cities
    .filter((city) => city.continent === country.continent && city.country === country.id)
    .sort((a, b) => a.city - b.city || a.id.localeCompare(b.id));
  const backbone = countryCities[0];
  if (!backbone) continue;
  for (const city of countryCities.slice(1)) politicalAccessLinks.push(link(city, backbone, country));
  for (const village of villages.filter(
    (candidate) => candidate.continent === country.continent && candidate.country === country.id,
  )) {
    const parentId = village.id.slice(0, village.id.lastIndexOf("/")),
      parent = countryCities.find((city) => city.id === parentId);
    if (parent) politicalAccessLinks.push(link(village, parent, country));
  }
  const reservedGateway = gateway(country, backbone);
  if (reservedGateway) politicalBorderGateways.push(reservedGateway);
}

export const politicalSettlementAccessSummary = {
  sites: politicalSettlementSitePlans.length,
  expectedSites: cities.length + villages.length,
  links: politicalAccessLinks.length,
  feasibleLinks: politicalAccessLinks.filter((candidate) => candidate.feasible).length,
  countries: countries.length,
  borderGateways: politicalBorderGateways.length,
  freshwaterOrCoastalSites: politicalSettlementSitePlans.filter(
    (site) => site.waterContext === "freshwater-lake" || site.waterContext === "coast",
  ).length,
  drylandExceptions: politicalSettlementSitePlans.filter(
    (site) => site.waterContext === "dryland-exception",
  ).length,
} as const;

/**
 * A compact immutable debug surface for tests/atlas inspection. It is derived only
 * from canonical SEED geography and never changes political ownership or routes.
 */
export function politicalSettlementAccessFingerprint() {
  return [
    ...politicalSettlementSitePlans.map(
      (site) =>
        `${site.placeCode}:${site.envelopeRadiusM}:${site.plotCapacity}:${site.waterContext}:${site.entrance.lon.toFixed(6)},${site.entrance.lat.toFixed(6)}`,
    ),
    ...politicalAccessLinks.map(
      (candidate) =>
        `${candidate.id}:${candidate.feasible ? 1 : 0}:${candidate.waypoints
          .map((point) => `${point.lon.toFixed(6)},${point.lat.toFixed(6)}`)
          .join(";")}`,
    ),
    ...politicalBorderGateways.map(
      (candidate) => `${candidate.id}:${candidate.inside.lon.toFixed(6)},${candidate.inside.lat.toFixed(6)}`,
    ),
  ].join("|");
}
