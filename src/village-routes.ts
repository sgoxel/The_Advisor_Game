/**
 * Village-level routing (WP-S002-004-008): neighbouring villages, cached
 * shortest legal routes and the all-pairs 60-fantasy-minute proof.
 *
 * The pure planner lives in routing.ts. This binder is the authority boundary
 * for player-facing village routes. Coarse A* proposes a bounded candidate;
 * that candidate is then validated and re-costed against the same canonical
 * final surface sampled at runtime cell centres. Only a candidate that is
 * illegal in final runtime truth falls back to an A* search whose sampler reads
 * that same final surface. This avoids recomputing world presentation metadata
 * while keeping routing legality identical to collision/traversal authority.
 */
import { roadAt, roads, villages, type Place } from "./geography.ts";
import {
  enuToPosition,
  greatCircleDistance,
  lonLatToFlat,
  positionToEnu,
  type CanonicalPosition,
  type LonLat,
} from "./planet.ts";
import {
  ROUTE_MAX_CELLS,
  ROUTE_MAX_EXPANSIONS,
  macroTerrainSampler,
  planRoute,
  type RoadSegment,
  type RouteResult,
  type RouteSurface,
  type TerrainSampler,
} from "./routing.ts";
import { surfaceAt } from "./surface.ts";
import {
  DIFFICULT_TERRAIN_WALK_SPEED_MPS,
  FASTEST_WALK_SPEED_MPS,
  GOOD_ROAD_WALK_SPEED_MPS,
  OPEN_GROUND_WALK_SPEED_MPS,
  realSecondsForFantasy,
  villagePairProvenByGeodesic,
} from "./travel.ts";
import { CELL_SIZE } from "./world.ts";

export const NEIGHBOUR_LIMIT = 4;
export const NEIGHBOUR_MAX_DISTANCE_M = 60_000;
export const ROUTE_CACHE_LIMIT = 256;
/** Final truth is checked at most this far apart along an accepted candidate. */
export const FINAL_ROUTE_VALIDATION_STEP_M = 300;

export const roadSegments: readonly RoadSegment[] = roads.map((road) => ({
  code: road.code,
  from: road.fromPosition,
  to: road.toPosition,
}));

const villageById = new Map(villages.map((village) => [village.id, village]));
const routeCache = new Map<string, VillageRoute>();
let cacheHits = 0,
  cacheMisses = 0,
  cacheEvictions = 0;

export type VillageRoute = RouteResult & { fromId: string; toId: string };

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Runtime cells are 2x2 source units and sample their centres. Read the composed
 * final surface at that exact centre so routing gets the same elevation,
 * hydrology, grading and traversal truth as cellAt(), without asking biomeAt()
 * to perform a second full surface query.
 */
function finalTraversalState(position: LonLat) {
  const flat = lonLatToFlat(position.lon, position.lat),
    x = Math.floor(flat.x / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2,
    z = Math.floor(flat.z / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2;
  return {
    surface: surfaceAt(x, z),
    road: roadAt(x, z),
  };
}

/**
 * Full final-surface sampler used only as the deterministic repair path when a
 * coarse candidate proves illegal. Water/cliffs and difficult terrain come from
 * the canonical final surface, not a second routing-specific classifier.
 */
export const finalTraversalTerrainSampler: TerrainSampler = (position: LonLat) => {
  const { surface } = finalTraversalState(position);
  return {
    // routing.ts uses `water` as its hard-block bit. This intentionally includes
    // cliffs/other non-walkable final cells as well as authoritative water.
    water: surface.water !== "none" || !surface.walkable,
    heightM: surface.elevation,
    highland: surface.traversal === "difficult" ? 1 : 0,
  };
};

function surfaceForState(traversal: string, onRoad: boolean): RouteSurface {
  // Settlement presentation may mask an underlying road visually. roadAt() is
  // the deterministic road-corridor query used by final surface composition, so
  // it preserves road walking cost without weakening final-surface legality.
  if (onRoad) return "road";
  if (traversal === "difficult") return "difficult";
  return "open";
}

function speedFor(surface: RouteSurface) {
  if (surface === "road" || surface === "bridge") return GOOD_ROAD_WALK_SPEED_MPS;
  if (surface === "difficult") return DIFFICULT_TERRAIN_WALK_SPEED_MPS;
  return OPEN_GROUND_WALK_SPEED_MPS;
}

/**
 * Verify every accepted path interval against final runtime walkability and
 * derive the displayed distance/time from those same final cells. Returning
 * undefined means the coarse candidate crossed a runtime-blocked cell and must
 * be repaired by final-surface A*.
 */
function refineAgainstFinalTraversal(route: RouteResult): RouteResult | undefined {
  if (!route.found || route.points.length < 2) return route;
  const surfaceM: Record<RouteSurface, number> = {
    road: 0,
    bridge: 0,
    open: 0,
    difficult: 0,
  };
  let distanceM = 0,
    fantasySeconds = 0;
  for (let k = 1; k < route.points.length; k++) {
    const a: CanonicalPosition = { ...route.points[k - 1], elevation: 0 },
      b: CanonicalPosition = { ...route.points[k], elevation: 0 },
      delta = positionToEnu(b, a),
      lengthM = greatCircleDistance(a, b),
      steps = Math.max(1, Math.ceil(lengthM / FINAL_ROUTE_VALIDATION_STEP_M)),
      stepM = lengthM / steps;
    for (let step = 0; step < steps; step++) {
      const t = (step + 0.5) / steps,
        sample = enuToPosition(
          { east: delta.east * t, north: delta.north * t, up: 0 },
          a,
        ),
        { surface: finalSurface, road } = finalTraversalState(sample);
      if (!finalSurface.walkable) return undefined;
      const routeSurface = surfaceForState(finalSurface.traversal, Boolean(road));
      surfaceM[routeSurface] += stepM;
      fantasySeconds += stepM / speedFor(routeSurface);
    }
    distanceM += lengthM;
  }
  // Floating-point accumulation may undershoot the exact geodesic/fastest-speed
  // lower bound by a few ulps on a pure-road route. That lower bound is a
  // physical invariant, so clamp to it rather than reporting an impossible
  // faster-than-geodesic walk.
  fantasySeconds = Math.max(fantasySeconds, route.geodesicM / FASTEST_WALK_SPEED_MPS);
  return {
    ...route,
    distanceM,
    fantasySeconds,
    realSeconds: realSecondsForFantasy(fantasySeconds),
    straightLineFantasySeconds: route.geodesicM / FASTEST_WALK_SPEED_MPS,
    detourFactor: distanceM / Math.max(1, route.geodesicM),
    surfaceM,
  };
}

function directSeededRoad(from: Place, to: Place): RouteResult | undefined {
  const road = roads.find(
    (candidate) =>
      (candidate.from === from.id && candidate.to === to.id) ||
      (candidate.from === to.id && candidate.to === from.id),
  );
  if (!road) return undefined;
  const geodesicM = greatCircleDistance(from.canonicalPosition, to.canonicalPosition);
  return {
    found: true,
    geodesicM,
    distanceM: geodesicM,
    fantasySeconds: geodesicM / GOOD_ROAD_WALK_SPEED_MPS,
    realSeconds: realSecondsForFantasy(geodesicM / GOOD_ROAD_WALK_SPEED_MPS),
    straightLineFantasySeconds: geodesicM / FASTEST_WALK_SPEED_MPS,
    detourFactor: 1,
    points: [
      { lon: from.canonicalPosition.lon, lat: from.canonicalPosition.lat },
      { lon: to.canonicalPosition.lon, lat: to.canonicalPosition.lat },
    ],
    surfaceM: { road: geodesicM, bridge: 0, open: 0, difficult: 0 },
    // Non-zero documents that this fast candidate is final-surface sampled, not
    // an unvalidated metadata shortcut.
    cellSizeM: FINAL_ROUTE_VALIDATION_STEP_M,
    expansions: 0,
    attempts: 1,
  };
}

function computeRoute(from: Place, to: Place): RouteResult {
  // A canonical seeded road is the cheapest candidate, but it is accepted only
  // after final runtime surface samples prove it walkable and recost it.
  const direct = directSeededRoad(from, to);
  if (direct) {
    const refined = refineAgainstFinalTraversal(direct);
    if (refined) return refined;
  }

  // Otherwise use the existing deterministic bounded macro search to propose a
  // corridor, then certify that corridor against final runtime truth.
  const coarse = planRoute({
      from: from.canonicalPosition,
      to: to.canonicalPosition,
      roads: roadSegments,
      terrain: macroTerrainSampler,
    }),
    refined = refineAgainstFinalTraversal(coarse);
  if (refined) return refined;

  // Only a genuinely invalid coarse candidate pays for final-surface A*. This
  // remains bounded by routing.ts cell/expansion caps and uses exactly the same
  // sampler as the validation pass.
  const repaired = planRoute({
    from: from.canonicalPosition,
    to: to.canonicalPosition,
    roads: roadSegments,
    terrain: finalTraversalTerrainSampler,
  });
  return refineAgainstFinalTraversal(repaired) ?? repaired;
}

/** Shortest legal walk between two villages. Cached per pair; the cache never changes a result. */
export function routeBetweenVillages(fromId: string, toId: string): VillageRoute {
  const from = villageById.get(fromId),
    to = villageById.get(toId);
  if (!from || !to) throw new RangeError(`Unknown village in route ${fromId} -> ${toId}`);
  const forward = fromId < toId,
    key = pairKey(fromId, toId);
  let cached = routeCache.get(key);
  if (cached) cacheHits++;
  else {
    cacheMisses++;
    const [a, b] = forward ? [from, to] : [to, from],
      route = computeRoute(a, b);
    cached = { ...route, fromId: a.id, toId: b.id };
    routeCache.set(key, cached);
    if (routeCache.size > ROUTE_CACHE_LIMIT) {
      routeCache.delete(routeCache.keys().next().value!);
      cacheEvictions++;
    }
  }
  if (forward) return cached;
  return { ...cached, fromId, toId, points: [...cached.points].reverse() };
}

export function clearVillageRouteCache() {
  routeCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
  cacheEvictions = 0;
}
export const villageRouteCacheSize = () => routeCache.size;
export const villageRouteCacheStats = () => ({
  size: routeCache.size,
  limit: ROUTE_CACHE_LIMIT,
  hits: cacheHits,
  misses: cacheMisses,
  evictions: cacheEvictions,
});

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
 * Checks every unordered village pair against the 60 fantasy-minute minimum.
 * A sound geodesic lower bound is sufficient where it already proves the rule;
 * pairs below that bound are deliberately left for final routing rather than
 * being silently accepted.
 */
export function verifyVillageMinimumWalk(): MinimumWalkReport {
  const report: MinimumWalkReport = {
    villages: villages.length,
    pairs: 0,
    failures: [],
    minGeodesicM: Infinity,
  };
  for (let i = 0; i < villages.length; i++)
    for (let j = i + 1; j < villages.length; j++) {
      const a = villages[i],
        b = villages[j],
        geodesicM = greatCircleDistance(a.canonicalPosition, b.canonicalPosition);
      report.pairs++;
      report.minGeodesicM = Math.min(report.minGeodesicM, geodesicM);
      if (!villagePairProvenByGeodesic(geodesicM))
        report.failures.push({ a: a.id, b: b.id, geodesicM });
    }
  return report;
}

export type RoutingAcceptanceSummary = {
  villageCount: number;
  totalPairs: number;
  lowerBoundProvenPairs: number;
  routedPairs: number;
  minimumProvenOrObservedFantasySeconds: number;
  invalidPairs: number;
  unreachablePairs: number;
  searchBounds: {
    maxCells: number;
    maxExpansions: number;
    finalValidationStepM: number;
  };
  cache: ReturnType<typeof villageRouteCacheStats>;
};

/**
 * Machine-readable exact-runtime acceptance summary required by WP-S002-004-008.
 * It enumerates the actual generated village registry. Sound geodesic proofs do
 * not invoke pathfinding; only pairs that the lower bound cannot prove are
 * refined through the final runtime traversal adapter.
 */
export function routingAcceptanceSummary(): RoutingAcceptanceSummary {
  let lowerBoundProvenPairs = 0,
    routedPairs = 0,
    invalidPairs = 0,
    unreachablePairs = 0,
    minimum = Infinity;
  for (let i = 0; i < villages.length; i++)
    for (let j = i + 1; j < villages.length; j++) {
      const a = villages[i],
        b = villages[j],
        geodesicM = greatCircleDistance(a.canonicalPosition, b.canonicalPosition);
      if (villagePairProvenByGeodesic(geodesicM)) {
        lowerBoundProvenPairs++;
        minimum = Math.min(minimum, geodesicM / FASTEST_WALK_SPEED_MPS);
        continue;
      }
      routedPairs++;
      const route = routeBetweenVillages(a.id, b.id);
      if (!route.found) unreachablePairs++;
      else {
        minimum = Math.min(minimum, route.fantasySeconds);
        if (route.fantasySeconds < 3_600) invalidPairs++;
      }
    }
  const totalPairs = (villages.length * (villages.length - 1)) / 2;
  return {
    villageCount: villages.length,
    totalPairs,
    lowerBoundProvenPairs,
    routedPairs,
    minimumProvenOrObservedFantasySeconds: minimum,
    invalidPairs,
    unreachablePairs,
    searchBounds: {
      maxCells: ROUTE_MAX_CELLS,
      maxExpansions: ROUTE_MAX_EXPANSIONS,
      finalValidationStepM: FINAL_ROUTE_VALIDATION_STEP_M,
    },
    cache: villageRouteCacheStats(),
  };
}
