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
const GRID_MAX_ALONG = 48;
const GRID_MAX_LATERAL = 28;
const GRID_MIN_STEP_M = 8_000;
const GRID_MAX_STEP_M = 18_000;

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
      maximumPreparedCutFillM: Math.min(
        place.kind === "city" ? 8 : 6,
        Math.max(1, reliefSpread * 0.35),
      ),
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

function layeredCorridor(
  from: Place,
  to: Place,
  country: Country,
  distanceM: number,
  phase: number,
): readonly CanonicalPosition[] | undefined {
  type State = { point: CanonicalPosition; costM: number; path: CanonicalPosition[] };
  const fractions = [0.2, 0.4, 0.6, 0.8],
    radii = [
      Math.min(120_000, Math.max(5_000, distanceM * 0.08)),
      Math.min(120_000, Math.max(10_000, distanceM * 0.16)),
      Math.min(120_000, Math.max(18_000, distanceM * 0.28)),
    ],
    uniqueRadii = [...new Set(radii.map((value) => Math.round(value)))],
    layers = fractions.map((fraction, layerIndex) => {
      const anchor = interpolate(from.canonicalPosition, to.canonicalPosition, fraction),
        candidates: CanonicalPosition[] = [];
      if (sameDryOwner(anchor, country, 220)) candidates.push(anchor);
      for (const radiusM of uniqueRadii)
        for (let bearingIndex = 0; bearingIndex < 16; bearingIndex++) {
          const candidate = destination(
            anchor,
            phase + layerIndex * 0.173 + (bearingIndex / 16) * TAU,
            radiusM,
          );
          if (sameDryOwner(candidate, country, 220)) candidates.push(candidate);
        }
      return candidates;
    });

  let states: State[] = [
    { point: from.canonicalPosition, costM: 0, path: [from.canonicalPosition] },
  ];
  for (const layer of layers) {
    const next: State[] = [];
    for (const candidate of layer) {
      let best: State | undefined;
      for (const state of states) {
        if (!segmentLegal(state.point, candidate, country, 10)) continue;
        const costM = state.costM + greatCircleDistance(state.point, candidate);
        if (!best || costM < best.costM)
          best = { point: candidate, costM, path: [...state.path, candidate] };
      }
      if (best) next.push(best);
    }
    if (!next.length) return undefined;
    states = next;
  }

  let best: State | undefined;
  for (const state of states) {
    if (!segmentLegal(state.point, to.canonicalPosition, country, 10)) continue;
    const costM = state.costM + greatCircleDistance(state.point, to.canonicalPosition);
    if (!best || costM < best.costM)
      best = {
        point: to.canonicalPosition,
        costM,
        path: [...state.path, to.canonicalPosition],
      };
  }
  return best?.path;
}

/**
 * Last-resort political access proof. It searches a deterministic, finite strip
 * around the direct geodesic rather than guessing a handful of waypoints. Every
 * node and every edge still uses the same dry-land, relief and country-ownership
 * predicates, so the search can discover a winding legal corridor without ever
 * weakening acceptance or becoming a second road authority.
 */
function coarseGridCorridor(
  from: Place,
  to: Place,
  country: Country,
  distanceM: number,
  phase: number,
): readonly CanonicalPosition[] | undefined {
  const directBearing = initialBearing(from.canonicalPosition, to.canonicalPosition),
    stepM = Math.min(
      GRID_MAX_STEP_M,
      Math.max(GRID_MIN_STEP_M, distanceM / GRID_MAX_ALONG),
    ),
    alongSteps = Math.min(GRID_MAX_ALONG, Math.max(2, Math.ceil(distanceM / stepM))),
    lateralSpanM = Math.min(240_000, Math.max(72_000, distanceM * 0.8)),
    lateralSteps = Math.min(GRID_MAX_LATERAL, Math.max(2, Math.ceil(lateralSpanM / stepM))),
    width = lateralSteps * 2 + 1,
    nodeCount = (alongSteps + 1) * width,
    centreRow = lateralSteps,
    startIndex = centreRow,
    goalIndex = alongSteps * width + centreRow,
    points = new Array<CanonicalPosition | undefined>(nodeCount),
    legal = new Uint8Array(nodeCount),
    distance = new Float64Array(nodeCount),
    parent = new Int32Array(nodeCount),
    visited = new Uint8Array(nodeCount);
  distance.fill(Infinity);
  parent.fill(-1);

  const pointAt = (along: number, row: number) => {
    const index = along * width + row,
      existing = points[index];
    if (existing) return existing;
    let point: CanonicalPosition;
    if (along === 0 && row === centreRow) point = from.canonicalPosition;
    else if (along === alongSteps && row === centreRow) point = to.canonicalPosition;
    else {
      const centre = interpolate(
          from.canonicalPosition,
          to.canonicalPosition,
          along / alongSteps,
        ),
        offsetM = (row - centreRow) * stepM,
        side = offsetM < 0 ? -1 : 1,
        jitter = (addressed(`${country.code}/GRID/${from.code}/${to.code}/${along}/${row}`) - 0.5) *
          Math.min(stepM * 0.16, 1_800);
      point = destination(
        centre,
        directBearing + side * Math.PI * 0.5 + phase * 0.015,
        Math.max(0, Math.abs(offsetM) + jitter),
      );
    }
    points[index] = point;
    legal[index] = sameDryOwner(point, country, 220) ? 1 : 0;
    return point;
  };

  for (let along = 0; along <= alongSteps; along++)
    for (let row = 0; row < width; row++) pointAt(along, row);
  legal[startIndex] = 1;
  legal[goalIndex] = 1;
  distance[startIndex] = 0;

  const neighbourOffsets = [
    [1, 0],
    [1, -1],
    [1, 1],
    [0, -1],
    [0, 1],
    [-1, 0],
    [-1, -1],
    [-1, 1],
  ] as const;

  for (let expansion = 0; expansion < nodeCount; expansion++) {
    let current = -1,
      bestScore = Infinity;
    for (let index = 0; index < nodeCount; index++) {
      if (visited[index] || !legal[index] || !Number.isFinite(distance[index])) continue;
      const along = Math.floor(index / width),
        row = index % width,
        point = points[index]!,
        heuristic = greatCircleDistance(point, to.canonicalPosition),
        centreBias = Math.abs(row - centreRow) * stepM * 0.0001,
        score = distance[index] + heuristic + centreBias;
      if (score < bestScore || (score === bestScore && index < current)) {
        bestScore = score;
        current = index;
      }
    }
    if (current < 0) break;
    if (current === goalIndex) break;
    visited[current] = 1;
    const currentAlong = Math.floor(current / width),
      currentRow = current % width,
      currentPoint = points[current]!;
    for (const [da, dr] of neighbourOffsets) {
      const along = currentAlong + da,
        row = currentRow + dr;
      if (along < 0 || along > alongSteps || row < 0 || row >= width) continue;
      const next = along * width + row;
      if (!legal[next] || visited[next]) continue;
      const nextPoint = points[next]!;
      if (!segmentLegal(currentPoint, nextPoint, country, 8)) continue;
      const candidateDistance = distance[current] + greatCircleDistance(currentPoint, nextPoint);
      if (
        candidateDistance < distance[next] ||
        (candidateDistance === distance[next] && current < parent[next])
      ) {
        distance[next] = candidateDistance;
        parent[next] = current;
      }
    }
  }

  if (!Number.isFinite(distance[goalIndex])) return undefined;
  const reversed: CanonicalPosition[] = [];
  for (let cursor = goalIndex; cursor >= 0; cursor = parent[cursor]) {
    reversed.push(points[cursor]!);
    if (cursor === startIndex) break;
  }
  if (reversed[reversed.length - 1] !== from.canonicalPosition) return undefined;
  const path = reversed.reverse();

  const compressed: CanonicalPosition[] = [path[0]];
  let anchor = 0;
  while (anchor < path.length - 1) {
    let next = path.length - 1;
    while (
      next > anchor + 1 &&
      !segmentLegal(path[anchor], path[next], country, Math.max(8, (next - anchor) * 4))
    )
      next--;
    compressed.push(path[next]);
    anchor = next;
  }
  return compressed;
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

  for (const via of cities
    .filter(
      (candidate) =>
        candidate.continent === country.continent &&
        candidate.country === country.id &&
        candidate.id !== from.id &&
        candidate.id !== to.id,
    )
    .sort((a, b) => a.id.localeCompare(b.id)))
    if (
      segmentLegal(from.canonicalPosition, via.canonicalPosition, country, 12) &&
      segmentLegal(via.canonicalPosition, to.canonicalPosition, country, 12)
    )
      return [from.canonicalPosition, via.canonicalPosition, to.canonicalPosition];

  return (
    layeredCorridor(from, to, country, distanceM, phase) ??
    coarseGridCorridor(from, to, country, distanceM, phase)
  );
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
      (candidate) =>
        `${candidate.id}:${candidate.inside.lon.toFixed(6)},${candidate.inside.lat.toFixed(6)}`,
    ),
  ].join("|");
}
