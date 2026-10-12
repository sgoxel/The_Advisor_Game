import { cities, countries, villages, type Place } from "./geography.ts";
import {
  politicalAccessLinks,
  politicalBorderGateways,
  type PoliticalBorderGateway,
} from "./political-settlement-access.ts";
import type { LonLat } from "./planet.ts";

/**
 * Deterministic high-level walking topology built only from already accepted
 * political settlement access and dry border-gateway facts. This module does
 * not make any traversal decision itself; village-routes.ts must still certify
 * every returned leg against the canonical final surface.
 */

const placeById = new Map([...cities, ...villages].map((place) => [place.id, place] as const));
const accessByFromId = new Map(
  politicalAccessLinks
    .filter((link) => link.feasible)
    .map((link) => [link.fromId, link] as const),
);
const countryByPlaceKey = new Map(
  countries.map((country) => [`${country.continent}/${country.id}`, country] as const),
);
const backboneByCountryCode = new Map(
  countries.map((country) => {
    const backbone = cities.find(
      (city) =>
        city.continent === country.continent && city.country === country.id && city.city === 0,
    );
    return [country.code, backbone] as const;
  }),
);

type GatewayStep = {
  gateway: PoliticalBorderGateway;
  fromCountryCode: string;
  toCountryCode: string;
};

const gatewayAdjacency = new Map<string, GatewayStep[]>();
function addGatewayStep(step: GatewayStep) {
  const bucket = gatewayAdjacency.get(step.fromCountryCode) ?? [];
  bucket.push(step);
  bucket.sort(
    (a, b) =>
      a.toCountryCode.localeCompare(b.toCountryCode) || a.gateway.id.localeCompare(b.gateway.id),
  );
  gatewayAdjacency.set(step.fromCountryCode, bucket);
}
for (const gateway of politicalBorderGateways) {
  addGatewayStep({
    gateway,
    fromCountryCode: gateway.countryCode,
    toCountryCode: gateway.neighbourCountryCode,
  });
  addGatewayStep({
    gateway,
    fromCountryCode: gateway.neighbourCountryCode,
    toCountryCode: gateway.countryCode,
  });
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

/** Stable BFS over the undirected graph of reserved canonical border gateways. */
function gatewayPath(fromCountryCode: string, toCountryCode: string): GatewayStep[] | undefined {
  if (fromCountryCode === toCountryCode) return [];
  const queue = [fromCountryCode],
    visited = new Set([fromCountryCode]),
    parent = new Map<string, GatewayStep>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const countryCode = queue[cursor];
    for (const step of gatewayAdjacency.get(countryCode) ?? []) {
      if (visited.has(step.toCountryCode)) continue;
      visited.add(step.toCountryCode);
      parent.set(step.toCountryCode, step);
      if (step.toCountryCode === toCountryCode) {
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
      queue.push(step.toCountryCode);
    }
  }
  return undefined;
}

/**
 * Return SEED-owned high-level waypoints from a settlement to another settlement.
 * Access links reach each country backbone; gateway edges cross only reserved dry
 * borders. Incoming gateway-to-backbone legs are left as geometric waypoints and
 * are later solved/certified by the bounded final-surface router.
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
      const gateway = step.gateway,
        nextBackbone = backboneByCountryCode.get(step.toCountryCode);
      if (!nextBackbone) return undefined;
      if (step.fromCountryCode === gateway.countryCode) {
        appendUnique(result, gateway.corridor);
        appendUnique(result, [gateway.outside, nextBackbone.canonicalPosition]);
      } else {
        appendUnique(result, [gateway.outside, gateway.inside]);
        appendUnique(result, [...gateway.corridor].reverse());
      }
    }
  }
  appendUnique(result, [...toAccess].reverse());
  return result.length >= 2 ? result : undefined;
}
