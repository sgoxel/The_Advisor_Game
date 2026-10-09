/**
 * Village-level routing (WP-S002-004-008): neighbouring villages, cached
 * shortest legal routes and the all-pairs 60-fantasy-minute proof. The pure
 * planner lives in routing.ts; this module only binds it to the seeded
 * settlements and prototype roads.
 */
import { roads, villages, type Place } from "./geography.ts";
import { greatCircleDistance } from "./planet.ts";
import { planRoute, type RoadSegment, type RouteResult } from "./routing.ts";
import { villagePairProvenByGeodesic } from "./travel.ts";

export const NEIGHBOUR_LIMIT = 4;
export const NEIGHBOUR_MAX_DISTANCE_M = 60_000;
const ROUTE_CACHE_LIMIT = 256;

export const roadSegments: readonly RoadSegment[] = roads.map((road) => ({
  code: road.code,
  from: road.fromPosition,
  to: road.toPosition,
}));

const villageById = new Map(villages.map((village) => [village.id, village]));
const routeCache = new Map<string, VillageRoute>();

export type VillageRoute = RouteResult & { fromId: string; toId: string };

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Shortest legal walk between two villages. Cached per pair; the cache never changes a result. */
export function routeBetweenVillages(fromId: string, toId: string): VillageRoute {
  const from = villageById.get(fromId),
    to = villageById.get(toId);
  if (!from || !to) throw new RangeError(`Unknown village in route ${fromId} -> ${toId}`);
  // Routes are computed in a canonical direction so A->B and B->A are one cached answer.
  const forward = fromId < toId,
    key = pairKey(fromId, toId);
  let cached = routeCache.get(key);
  if (!cached) {
    const [a, b] = forward ? [from, to] : [to, from],
      route = planRoute({
        from: a.canonicalPosition,
        to: b.canonicalPosition,
        roads: roadSegments,
      });
    cached = { ...route, fromId: a.id, toId: b.id };
    routeCache.set(key, cached);
    if (routeCache.size > ROUTE_CACHE_LIMIT) routeCache.delete(routeCache.keys().next().value!);
  }
  if (forward) return cached;
  return { ...cached, fromId, toId, points: [...cached.points].reverse() };
}

export const clearVillageRouteCache = () => routeCache.clear();
export const villageRouteCacheSize = () => routeCache.size;

/** Nearest villages by geodesic distance (stable tie-break on id), excluding the village itself. */
export function neighbouringVillages(
  id: string,
  limit = NEIGHBOUR_LIMIT,
  maxDistanceM = NEIGHBOUR_MAX_DISTANCE_M,
): { place: Place; geodesicM: number }[] {
  const origin = villageById.get(id);
  if (!origin) return [];
  return villages
    .filter((village) => village.id !== id)
    .map((place) => ({
      place,
      geodesicM: greatCircleDistance(origin.canonicalPosition, place.canonicalPosition),
    }))
    .filter((entry) => entry.geodesicM <= maxDistanceM)
    .sort((x, y) => x.geodesicM - y.geodesicM || (x.place.id < y.place.id ? -1 : 1))
    .slice(0, limit);
}

export type MinimumWalkReport = {
  villages: number;
  pairs: number;
  failures: { a: string; b: string; geodesicM: number }[];
  minGeodesicM: number;
};

/**
 * Checks every unordered village pair against the 60 fantasy-minute minimum. The
 * straight-line distance is enough: no walk is faster than 1 m/s, so a geodesic of
 * at least 3,600 m can never take under 3,600 s. No pathfinding is involved.
 */
export function verifyVillageMinimumWalk(): MinimumWalkReport {
  const report: MinimumWalkReport = { villages: villages.length, pairs: 0, failures: [], minGeodesicM: Infinity };
  for (let i = 0; i < villages.length; i++)
    for (let j = i + 1; j < villages.length; j++) {
      const a = villages[i],
        b = villages[j],
        geodesicM = greatCircleDistance(a.canonicalPosition, b.canonicalPosition);
      report.pairs++;
      report.minGeodesicM = Math.min(report.minGeodesicM, geodesicM);
      if (!villagePairProvenByGeodesic(geodesicM)) report.failures.push({ a: a.id, b: b.id, geodesicM });
    }
  return report;
}
