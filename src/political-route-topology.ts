import {
  cities,
  countries,
  countryAtPosition,
  villages,
  type Country,
  type Place,
} from "./geography.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  politicalAccessLinks,
  politicalBorderGateways,
  type PoliticalBorderGateway,
} from "./political-settlement-access.ts";
import {
  CANONICAL_PLANET_RADIUS,
  greatCircleDistance,
  normalizeLongitude,
  type CanonicalPosition,
  type LonLat,
} from "./planet.ts";

/**
 * Deterministic high-level walking topology built only from accepted political
 * settlement access plus canonical country ownership. This module never grants
 * traversal: village-routes.ts still certifies every returned leg against the
 * composed final water/cliff/walkability surface.
 */

const TAU = Math.PI * 2;
const DERIVED_GATE_BEARINGS = 72;
const DERIVED_GATE_STEP_M = 5_000;
const DERIVED_GATE_MAX_M = 180_000;

const placeById = new Map([...cities, ...villages].map((place) => [place.id, place] as const));
const accessByFromId = new Map(
  politicalAccessLinks
    .filter((link) => link.feasible)
    .map((link) => [link.fromId, link] as const),
);
const countryByPlaceKey = new Map(
  countries.map((country) => [`${country.continent}/${country.id}`, country] as const),
);
const countryByCode = new Map(countries.map((country) => [country.code, country] as const));
const backboneByCountryCode = new Map(
  countries.map((country) => {
    const backbone = cities.find(
      (city) =>
        city.continent === country.continent && city.country === country.id && city.city === 0,
    );
    return [country.code, backbone] as const;
  }),
);
const settlementsByCountryCode = new Map(
  countries.map((country) => [
    country.code,
    [...cities, ...villages].filter(
      (place) => place.continent === country.continent && place.country === country.id,
    ),
  ] as const),
);

type GatewayStep = {
  gateway: PoliticalBorderGateway;
  fromCountryCode: string;
  toCountryCode: string;
};

const reservedGatewayAdjacency = new Map<string, GatewayStep[]>();
const derivedGatewayCache = new Map<string, GatewayStep[]>();
const gatewayBackboneCache = new Map<string, readonly LonLat[] | null>();

function addGatewayStep(adjacency: Map<string, GatewayStep[]>, step: GatewayStep) {
  const bucket = adjacency.get(step.fromCountryCode) ?? [];
  if (
    !bucket.some(
      (candidate) =>
        candidate.toCountryCode === step.toCountryCode && candidate.gateway.id === step.gateway.id,
    )
  )
    bucket.push(step);
  bucket.sort(
    (a, b) =>
      a.toCountryCode.localeCompare(b.toCountryCode) || a.gateway.id.localeCompare(b.gateway.id),
  );
  adjacency.set(step.fromCountryCode, bucket);
}
for (const gateway of politicalBorderGateways) {
  addGatewayStep(reservedGatewayAdjacency, {
    gateway,
    fromCountryCode: gateway.countryCode,
    toCountryCode: gateway.neighbourCountryCode,
  });
  addGatewayStep(reservedGatewayAdjacency, {
    gateway,
    fromCountryCode: gateway.neighbourCountryCode,
    toCountryCode: gateway.countryCode,
  });
}

function digest(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++)
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

function addressed(address: string) {
  return digest(address) / 4294967296;
}

function position(lon: number, lat: number): CanonicalPosition {
  return {
    lon: normalizeLongitude(lon),
    lat: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, lat)),
    elevation: 0,
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
  return destination(from, initialBearing(from, to), greatCircleDistance(from, to) * t);
}

function sameOwnedDryLand(point: LonLat, country: Country) {
  const macro = macroSampleAt(point),
    owner = countryAtPosition(point);
  return (
    macro.land &&
    macro.domain !== "Lake" &&
    macro.continentId === country.continent &&
    owner?.code === country.code
  );
}

function ownedDrySegment(from: LonLat, to: LonLat, country: Country) {
  for (let index = 0; index <= 18; index++)
    if (!sameOwnedDryLand(interpolate(from, to, index / 18), country)) return false;
  return true;
}

/**
 * The single presentation gateway reserved for every country is not guaranteed
 * to connect the whole political graph. For routing fallback only, discover all
 * radially visible dry neighbour borders from that country's canonical backbone.
 * The scan order is seed-addressed through country.code and fully bounded.
 */
function derivedGatewaySteps(countryCode: string): readonly GatewayStep[] {
  const cached = derivedGatewayCache.get(countryCode);
  if (cached) return cached;
  const country = countryByCode.get(countryCode),
    backbone = backboneByCountryCode.get(countryCode),
    result: GatewayStep[] = [];
  if (!country || !backbone) {
    derivedGatewayCache.set(countryCode, result);
    return result;
  }
  const phase = TAU * addressed(`${country.code}/ROUTE-GATE/PHASE`),
    seenNeighbours = new Set<string>();
  for (let bearingIndex = 0; bearingIndex < DERIVED_GATE_BEARINGS; bearingIndex++) {
    const bearing = phase + (bearingIndex / DERIVED_GATE_BEARINGS) * TAU;
    let previous = backbone.canonicalPosition;
    for (
      let distanceM = DERIVED_GATE_STEP_M;
      distanceM <= DERIVED_GATE_MAX_M;
      distanceM += DERIVED_GATE_STEP_M
    ) {
      const point = destination(backbone.canonicalPosition, bearing, distanceM),
        macro = macroSampleAt(point),
        owner = countryAtPosition(point);
      if (!macro.land || macro.continentId !== country.continent || !owner) break;
      if (owner.code === country.code) {
        previous = point;
        continue;
      }
      if (
        seenNeighbours.has(owner.code) ||
        !ownedDrySegment(backbone.canonicalPosition, previous, country)
      )
        break;
      seenNeighbours.add(owner.code);
      const gateway: PoliticalBorderGateway = {
        id: `${country.code}/ROUTE-GATE/${owner.code}`,
        countryCode: country.code,
        neighbourCountryCode: owner.code,
        fromCityId: backbone.id,
        inside: previous,
        outside: point,
        bearingRad: bearing,
        corridor: [backbone.canonicalPosition, previous],
      };
      result.push({
        gateway,
        fromCountryCode: country.code,
        toCountryCode: owner.code,
      });
      break;
    }
  }
  result.sort(
    (a, b) =>
      a.toCountryCode.localeCompare(b.toCountryCode) || a.gateway.id.localeCompare(b.gateway.id),
  );
  derivedGatewayCache.set(countryCode, result);
  return result;
}

function samePoint(a: LonLat, b: LonLat) {
  return Math.abs(a.lon - b.lon) <= 1e-12 && Math.abs(a.lat - b.lat) <= 1e-12;
}

function appendUnique(points: LonLat[], additions: readonly LonLat[]) {
  for (const point of additions) {
    const canonical = { lon: point.lon, lat: point.lat };
    if (!points.length || !samePoint(points[points.length - 1], canonical)) points.push(canonical);
  }
}

function countryCodeFor(place: Place) {
  return countryByPlaceKey.get(`${place.continent}/${place.country}`)?.code;
}

/** Follow accepted settlement access links until the country's city-0 backbone. */
function settlementToBackbone(place: Place): LonLat[] | undefined {
  const points: LonLat[] = [
    { lon: place.canonicalPosition.lon, lat: place.canonicalPosition.lat },
  ];
  let current = place;
  for (let hop = 0; hop < 4; hop++) {
    if (current.kind === "city" && current.city === 0) return points;
    const access = accessByFromId.get(current.id);
    if (!access) return undefined;
    appendUnique(points, access.waypoints);
    const next = placeById.get(access.toId);
    if (!next) return undefined;
    current = next;
  }
  return current.kind === "city" && current.city === 0 ? points : undefined;
}

function gatewayBackboneKey(countryCode: string, gatewayPoint: LonLat) {
  return `${countryCode}/${gatewayPoint.lon.toPrecision(15)}/${gatewayPoint.lat.toPrecision(15)}`;
}

/**
 * Connect a border sample to its owning country's accepted settlement topology.
 * The result is macro dry/owned only; final water/cliff legality is still checked
 * later by village-routes.ts. Failed probes are cached too so graph search can
 * skip an unusable gateway rather than selecting it and abandoning the route.
 */
function gatewayToBackbone(countryCode: string, gatewayPoint: LonLat): readonly LonLat[] | undefined {
  const key = gatewayBackboneKey(countryCode, gatewayPoint),
    cached = gatewayBackboneCache.get(key);
  if (cached !== undefined) return cached ?? undefined;
  const country = countryByCode.get(countryCode),
    backbone = backboneByCountryCode.get(countryCode);
  if (!country || !backbone || !sameOwnedDryLand(gatewayPoint, country)) {
    gatewayBackboneCache.set(key, null);
    return undefined;
  }
  if (ownedDrySegment(gatewayPoint, backbone.canonicalPosition, country)) {
    const direct = [
      { lon: gatewayPoint.lon, lat: gatewayPoint.lat },
      { lon: backbone.canonicalPosition.lon, lat: backbone.canonicalPosition.lat },
    ] as const;
    gatewayBackboneCache.set(key, direct);
    return direct;
  }

  const candidates = [...(settlementsByCountryCode.get(countryCode) ?? [])].sort((a, b) => {
    const distanceA = greatCircleDistance(gatewayPoint, a.canonicalPosition),
      distanceB = greatCircleDistance(gatewayPoint, b.canonicalPosition);
    return distanceA - distanceB || a.id.localeCompare(b.id);
  });
  for (const candidate of candidates) {
    if (!ownedDrySegment(gatewayPoint, candidate.canonicalPosition, country)) continue;
    const access = settlementToBackbone(candidate);
    if (!access) continue;
    const result: LonLat[] = [{ lon: gatewayPoint.lon, lat: gatewayPoint.lat }];
    appendUnique(result, access);
    gatewayBackboneCache.set(key, result);
    return result;
  }
  gatewayBackboneCache.set(key, null);
  return undefined;
}

function usableGatewayStep(step: GatewayStep) {
  const { gateway } = step;
  return step.fromCountryCode === gateway.countryCode
    ? Boolean(gatewayToBackbone(step.toCountryCode, gateway.outside))
    : Boolean(gatewayToBackbone(step.fromCountryCode, gateway.outside));
}

function reconstructGatewayPath(
  parent: ReadonlyMap<string, GatewayStep>,
  fromCountryCode: string,
  toCountryCode: string,
) {
  const reversed: GatewayStep[] = [];
  let current = toCountryCode;
  while (current !== fromCountryCode) {
    const edge = parent.get(current);
    if (!edge) return undefined;
    reversed.push(edge);
    current = edge.fromCountryCode;
  }
  return reversed.reverse();
}

function searchGatewayPath(
  fromCountryCode: string,
  toCountryCode: string,
  includeDerived: boolean,
): GatewayStep[] | undefined {
  const queue = [fromCountryCode],
    visited = new Set([fromCountryCode]),
    parent = new Map<string, GatewayStep>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const countryCode = queue[cursor],
      candidates = [
        ...(reservedGatewayAdjacency.get(countryCode) ?? []),
        ...(includeDerived ? derivedGatewaySteps(countryCode) : []),
      ]
        .filter(usableGatewayStep)
        .sort(
          (a, b) =>
            a.toCountryCode.localeCompare(b.toCountryCode) ||
            a.gateway.id.localeCompare(b.gateway.id),
        );
    for (const step of candidates) {
      if (visited.has(step.toCountryCode)) continue;
      visited.add(step.toCountryCode);
      parent.set(step.toCountryCode, step);
      if (step.toCountryCode === toCountryCode)
        return reconstructGatewayPath(parent, fromCountryCode, toCountryCode);
      queue.push(step.toCountryCode);
    }
  }
  return undefined;
}

/** Prefer usable reserved gateways; derive extra dry ownership crossings only if disconnected. */
function gatewayPath(fromCountryCode: string, toCountryCode: string): GatewayStep[] | undefined {
  if (fromCountryCode === toCountryCode) return [];
  return (
    searchGatewayPath(fromCountryCode, toCountryCode, false) ??
    searchGatewayPath(fromCountryCode, toCountryCode, true)
  );
}

/**
 * Return SEED-owned high-level waypoints from a settlement to another settlement.
 * Access links reach each country backbone; gateway edges cross only canonical dry
 * borders. Both sides of a selected gateway must already connect to accepted
 * country access topology before the graph may use that edge.
 */
export function politicalRouteWaypoints(from: Place, to: Place): LonLat[] | undefined {
  if (from.continent !== to.continent) return undefined;
  const fromCountryCode = countryCodeFor(from),
    toCountryCode = countryCodeFor(to),
    fromAccess = settlementToBackbone(from),
    toAccess = settlementToBackbone(to);
  if (!fromCountryCode || !toCountryCode || !fromAccess || !toAccess) return undefined;

  const result: LonLat[] = [];
  appendUnique(result, fromAccess);
  if (fromCountryCode !== toCountryCode) {
    const gatewaySteps = gatewayPath(fromCountryCode, toCountryCode);
    if (!gatewaySteps) return undefined;
    for (const step of gatewaySteps) {
      const gateway = step.gateway;
      if (step.fromCountryCode === gateway.countryCode) {
        appendUnique(result, gateway.corridor);
        appendUnique(result, [gateway.outside]);
        const nextAccess = gatewayToBackbone(step.toCountryCode, gateway.outside);
        if (!nextAccess) return undefined;
        appendUnique(result, nextAccess);
      } else {
        const sourceAccess = gatewayToBackbone(step.fromCountryCode, gateway.outside);
        if (!sourceAccess) return undefined;
        appendUnique(result, [...sourceAccess].reverse());
        appendUnique(result, [gateway.inside]);
        appendUnique(result, [...gateway.corridor].reverse());
      }
    }
  }
  appendUnique(result, [...toAccess].reverse());
  return result.length >= 2 ? result : undefined;
}
