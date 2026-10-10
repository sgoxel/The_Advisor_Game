/**
 * Village-level routing (WP-S002-004-008): neighbouring villages, cached
 * shortest legal routes and the all-pairs 60-fantasy-minute proof. The pure
 * planner lives in routing.ts; this module only binds it to the seeded
 * settlements and road presentation facts.
 */
import { roads, villages, type Place } from "./geography.ts";
import { surfaceAt as naturalSurfaceAt } from "./hydrology.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  SOURCE_PRESENTATION_RADIUS,
  greatCircleDistance,
  lonLatToSource,
  sourceToLonLat,
  wrapSourceX,
} from "./planet.ts";
import { planRoute, type RoadSegment, type RouteResult } from "./routing.ts";
import { FASTEST_WALK_SPEED_MPS, villagePairProvenByGeodesic } from "./travel.ts";

export const NEIGHBOUR_LIMIT = 4;
export const NEIGHBOUR_MAX_DISTANCE_M = 60_000;
const ROUTE_CACHE_LIMIT = 256;
const CORRIDOR_PROOF_CACHE_LIMIT = 2048;
const NEIGHBOUR_PROOF_MAX_GAP_SOURCE = 32;
const NEIGHBOUR_PROOF_CLEARANCE_SOURCE = 20;

export const roadSegments: readonly RoadSegment[] = roads.map((road) => ({
  code: road.code,
  from: road.fromPosition,
  to: road.toPosition,
}));

const villageById = new Map(villages.map((village) => [village.id, village]));
const routeCache = new Map<string, VillageRoute>();
const neighbourCache = new Map<string, readonly { place: Place; geodesicM: number }[]>();
const corridorProofCache = new Map<string, boolean>();
const roadNeighbourIds = new Map<string, Set<string>>();
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const directRoadByPair = new Map(roads.map((road) => [pairKey(road.from, road.to), road] as const));
for (const road of roads) {
  const from = roadNeighbourIds.get(road.from) || new Set<string>(),
    to = roadNeighbourIds.get(road.to) || new Set<string>();
  from.add(road.to);
  to.add(road.from);
  roadNeighbourIds.set(road.from, from);
  roadNeighbourIds.set(road.to, to);
}

export type VillageRoute = RouteResult & { fromId: string; toId: string };

/**
 * An ordinary seeded road directly joins its two village centres, is generated
 * only after the whole connector is conservatively proven dry, is graded by the
 * final surface authority, and uses the globally fastest walking surface. The
 * direct geodesic road therefore reaches the absolute lower bound
 * (geodesic / FASTEST_WALK_SPEED_MPS), so no A* path can legally improve it.
 */
function directRoadRoute(from: Place, to: Place, key: string): VillageRoute | undefined {
  const road = directRoadByPair.get(key);
  if (!road) return undefined;
  const distanceM = road.surfaceLengthM,
    fantasySeconds = road.fantasyWalkSeconds;
  return {
    found: true,
    geodesicM: distanceM,
    distanceM,
    fantasySeconds,
    realSeconds: road.realWalkSeconds,
    straightLineFantasySeconds: distanceM / FASTEST_WALK_SPEED_MPS,
    detourFactor: 1,
    points: [
      { lon: from.canonicalPosition.lon, lat: from.canonicalPosition.lat },
      { lon: to.canonicalPosition.lon, lat: to.canonicalPosition.lat },
    ],
    surfaceM: { road: distanceM, bridge: 0, open: 0, difficult: 0 },
    cellSizeM: 0,
    expansions: 0,
    attempts: 0,
    fromId: from.id,
    toId: to.id,
  };
}

/** Shortest legal walk between two villages. Cached per pair; the cache never changes a result. */
export function routeBetweenVillages(fromId: string, toId: string): VillageRoute {
  const from = villageById.get(fromId),
    to = villageById.get(toId);
  if (!from || !to) throw new RangeError(`Unknown village in route ${fromId} -> ${toId}`);
  const forward = fromId < toId,
    key = pairKey(fromId, toId);
  let cached = routeCache.get(key);
  if (!cached) {
    const [a, b] = forward ? [from, to] : [to, from];
    cached = directRoadRoute(a, b, key);
    if (!cached) {
      const route = planRoute({
        from: a.canonicalPosition,
        to: b.canonicalPosition,
        roads: roadSegments,
      });
      cached = { ...route, fromId: a.id, toId: b.id };
    }
    routeCache.set(key, cached);
    if (routeCache.size > ROUTE_CACHE_LIMIT) routeCache.delete(routeCache.keys().next().value!);
  }
  if (forward) return cached;
  return { ...cached, fromId, toId, points: [...cached.points].reverse() };
}

export const clearVillageRouteCache = () => {
  routeCache.clear();
  neighbourCache.clear();
  corridorProofCache.clear();
};
export const villageRouteCacheSize = () => routeCache.size;

function rememberCorridorProof(key: string, value: boolean) {
  corridorProofCache.set(key, value);
  if (corridorProofCache.size > CORRIDOR_PROOF_CACHE_LIMIT)
    corridorProofCache.delete(corridorProofCache.keys().next().value!);
  return value;
}

/**
 * Cheap deterministic proof used only to choose plausible walking neighbours.
 * It does not replace A*: actual non-road route distance/cost still comes from
 * planRoute(). Direct seeded roads use the exact lower-bound proof above.
 *
 * Samples are at most 32 source units apart and each sample stays >20 units from
 * freshwater and the coast. Distance-to-water/coast is 1-Lipschitz, so every
 * point between samples retains >4 source units of dry clearance. Natural cliff
 * samples are also rejected. This prevents neighbour discovery from launching
 * many synchronous A* searches merely to discover obvious river/strait blockers.
 * The symmetric proof is cached with a fixed cap because A->B and B->A inspect
 * the same canonical corridor; caching changes cost only, never the result.
 */
function naturalWalkingCorridorProven(from: Place, to: Place) {
  const key = pairKey(from.id, to.id),
    cached = corridorProofCache.get(key);
  if (cached !== undefined) return cached;

  const a = lonLatToSource(from.canonicalPosition.lon, from.canonicalPosition.lat),
    b = lonLatToSource(to.canonicalPosition.lon, to.canonicalPosition.lat),
    dx = wrapSourceX(b.x - a.x),
    dz = b.z - a.z,
    length = Math.hypot(dx, dz),
    steps = Math.max(2, Math.ceil(length / NEIGHBOUR_PROOF_MAX_GAP_SOURCE));
  for (let step = 0; step <= steps; step++) {
    const t = step / steps,
      x = wrapSourceX(a.x + dx * t),
      z = a.z + dz * t,
      macro = macroSampleAt(sourceToLonLat(x, z)),
      surface = naturalSurfaceAt(x, z);
    if (
      !macro.land ||
      surface.water !== "none" ||
      surface.cliff ||
      surface.freshwaterDistance <= NEIGHBOUR_PROOF_CLEARANCE_SOURCE ||
      macro.coastDistanceRad * SOURCE_PRESENTATION_RADIUS <= NEIGHBOUR_PROOF_CLEARANCE_SOURCE
    )
      return rememberCorridorProof(key, false);
  }
  return rememberCorridorProof(key, true);
}

/**
 * Nearest villages with a deterministic dry walking-corridor proof. Seeded road
 * neighbours are always eligible because settlement generation already proves
 * those ordinary road connectors dry and the final surface grades their cut/fill.
 * Other candidates must pass the bounded natural corridor proof above. A* stays
 * the authoritative route solver for selected non-road neighbours.
 */
export function neighbouringVillages(
  id: string,
  limit = NEIGHBOUR_LIMIT,
  maxDistanceM = NEIGHBOUR_MAX_DISTANCE_M,
): { place: Place; geodesicM: number }[] {
  const origin = villageById.get(id);
  if (!origin) return [];
  const cacheKey = `${id}/${limit}/${maxDistanceM}`,
    cached = neighbourCache.get(cacheKey);
  if (cached) return [...cached];

  const roadNeighbours = roadNeighbourIds.get(id),
    candidates = villages
      .filter((village) => village.id !== id)
      .map((place) => ({
        place,
        geodesicM: greatCircleDistance(origin.canonicalPosition, place.canonicalPosition),
      }))
      .filter((entry) => entry.geodesicM <= maxDistanceM)
      .sort((x, y) => x.geodesicM - y.geodesicM || (x.place.id < y.place.id ? -1 : 1)),
    result: { place: Place; geodesicM: number }[] = [];
  for (const entry of candidates) {
    if (
      !roadNeighbours?.has(entry.place.id) &&
      !naturalWalkingCorridorProven(origin, entry.place)
    )
      continue;
    result.push(entry);
    if (result.length >= limit) break;
  }
  neighbourCache.set(cacheKey, result);
  return [...result];
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
