/**
 * Village-level routing (WP-S002-004-008): neighbouring villages, cached
 * shortest legal routes and the all-pairs 60-fantasy-minute proof.
 *
 * The pure planner lives in routing.ts. This binder is the authority boundary
 * for player-facing village routes. Coarse A* proposes a bounded candidate;
 * that candidate is then validated and re-costed against the same canonical
 * final surface sampled at runtime cell centres. If authoritative drainage
 * blocks that corridor, the river's own seeded catchment recipe supplies a
 * bounded headwater detour before any local final-surface A* fallback.
 */
import { roadAt, roads, villages, type Place } from "./geography.ts";
import {
  enuToPosition,
  greatCircleDistance,
  lonLatToFlat,
  positionToEnu,
  sourceToLonLat,
  wrapSourceX,
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
import {
  drainageRecipesNear,
  surfaceAt,
  type DrainagePoint,
  type DrainageRecipe,
} from "./surface.ts";
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
export const FINAL_TRAVERSAL_CACHE_LIMIT = 8_192;
/** Final truth is checked at most this far apart along an accepted candidate. */
export const FINAL_ROUTE_VALIDATION_STEP_M = 300;
/** A route may repair a small number of distinct seeded drainage crossings. */
export const FINAL_DRAINAGE_REPAIR_LIMIT = 4;

export const roadSegments: readonly RoadSegment[] = roads.map((road) => ({
  code: road.code,
  from: road.fromPosition,
  to: road.toPosition,
}));

const villageById = new Map(villages.map((village) => [village.id, village]));
const routeCache = new Map<string, VillageRoute>();
type FinalTraversalState = {
  surface: ReturnType<typeof surfaceAt>;
  road: ReturnType<typeof roadAt>;
};
type BlockedRouteSample = {
  segmentIndex: number;
  position: LonLat;
  surface: ReturnType<typeof surfaceAt>;
};
type DrainagePathHit = {
  path: readonly DrainagePoint[];
  width: number;
  segmentIndex: number;
  distance: number;
  t: number;
};
const finalTraversalCache = new Map<string, FinalTraversalState>();
let cacheHits = 0,
  cacheMisses = 0,
  cacheEvictions = 0;

export type VillageRoute = RouteResult & { fromId: string; toId: string };

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Runtime cells are 2x2 source units and sample their centres. Read the composed
 * final surface at that exact centre so routing gets the same elevation,
 * hydrology, grading and traversal truth as cellAt(), without asking biomeAt()
 * to perform a second full surface query. The result is pure SEED-owned state,
 * so a bounded cell cache may reuse it without changing any decision.
 */
function finalTraversalState(position: LonLat): FinalTraversalState {
  const flat = lonLatToFlat(position.lon, position.lat),
    x = Math.floor(flat.x / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2,
    z = Math.floor(flat.z / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2,
    key = `${x}/${z}`,
    cached = finalTraversalCache.get(key);
  if (cached) return cached;
  const value: FinalTraversalState = {
    surface: surfaceAt(x, z),
    road: roadAt(x, z),
  };
  finalTraversalCache.set(key, value);
  if (finalTraversalCache.size > FINAL_TRAVERSAL_CACHE_LIMIT) {
    const first = finalTraversalCache.keys().next().value;
    if (typeof first === "string") finalTraversalCache.delete(first);
  }
  return value;
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
 * undefined means the candidate crossed a runtime-blocked cell.
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

/** Find the exact final-surface sample that caused the same validator to reject a route. */
function firstBlockedFinalSample(route: RouteResult): BlockedRouteSample | undefined {
  if (!route.found || route.points.length < 2) return undefined;
  for (let k = 1; k < route.points.length; k++) {
    const a: CanonicalPosition = { ...route.points[k - 1], elevation: 0 },
      b: CanonicalPosition = { ...route.points[k], elevation: 0 },
      delta = positionToEnu(b, a),
      lengthM = greatCircleDistance(a, b),
      steps = Math.max(1, Math.ceil(lengthM / FINAL_ROUTE_VALIDATION_STEP_M));
    for (let step = 0; step < steps; step++) {
      const t = (step + 0.5) / steps,
        sample = enuToPosition(
          { east: delta.east * t, north: delta.north * t, up: 0 },
          a,
        ),
        { surface } = finalTraversalState(sample);
      if (!surface.walkable)
        return {
          segmentIndex: k,
          position: { lon: sample.lon, lat: sample.lat },
          surface,
        };
    }
  }
  return undefined;
}

function sourceSegmentProjection(
  x: number,
  z: number,
  a: DrainagePoint,
  b: DrainagePoint,
) {
  const dx = wrapSourceX(b.x - a.x),
    dz = b.z - a.z,
    qx = wrapSourceX(x - a.x),
    qz = z - a.z,
    lengthSq = dx * dx + dz * dz,
    t = lengthSq <= 1e-9 ? 0 : Math.max(0, Math.min(1, (qx * dx + qz * dz) / lengthSq));
  return {
    distance: Math.hypot(qx - dx * t, qz - dz * t),
    t,
  };
}

function nearestDrainagePath(
  recipe: DrainageRecipe,
  x: number,
  z: number,
): DrainagePathHit | undefined {
  let best: DrainagePathHit | undefined;
  const paths = [
    { path: recipe.points, width: recipe.width },
    { path: recipe.tributary, width: recipe.width * 0.62 },
  ] as const;
  for (const entry of paths)
    for (let index = 0; index + 1 < entry.path.length; index++) {
      const projection = sourceSegmentProjection(x, z, entry.path[index], entry.path[index + 1]);
      if (!best || projection.distance < best.distance)
        best = { ...entry, segmentIndex: index, ...projection };
    }
  return best;
}

function sideOfSourceSegment(
  point: { x: number; z: number },
  a: DrainagePoint,
  b: DrainagePoint,
) {
  const dx = wrapSourceX(b.x - a.x),
    dz = b.z - a.z,
    qx = wrapSourceX(point.x - a.x),
    qz = point.z - a.z,
    cross = dx * qz - dz * qx;
  return cross < 0 ? -1 : 1;
}

/** Offset one canonical drainage point to a deterministic dry bank side. */
function drainageBankPoint(
  path: readonly DrainagePoint[],
  index: number,
  side: number,
  clearance: number,
): LonLat {
  const point = path[index],
    before = path[Math.max(0, index - 1)],
    after = path[Math.min(path.length - 1, index + 1)];
  let dx = wrapSourceX(after.x - before.x),
    dz = after.z - before.z;
  if (Math.hypot(dx, dz) < 1e-6) {
    const neighbour = index + 1 < path.length ? path[index + 1] : path[index - 1];
    dx = wrapSourceX(neighbour.x - point.x);
    dz = neighbour.z - point.z;
  }
  const length = Math.hypot(dx, dz) || 1,
    perpX = -dz / length,
    perpZ = dx / length;
  return sourceToLonLat(
    wrapSourceX(point.x + perpX * side * clearance),
    point.z + perpZ * side * clearance,
  );
}

/** Offset the exact blocked projection on a drainage segment to one dry bank. */
function projectedDrainageBankPoint(
  path: readonly DrainagePoint[],
  segmentIndex: number,
  t: number,
  side: number,
  clearance: number,
): LonLat {
  const a = path[segmentIndex],
    b = path[segmentIndex + 1],
    dx = wrapSourceX(b.x - a.x),
    dz = b.z - a.z,
    length = Math.hypot(dx, dz) || 1,
    baseX = wrapSourceX(a.x + dx * t),
    baseZ = a.z + dz * t,
    perpX = -dz / length,
    perpZ = dx / length;
  return sourceToLonLat(
    wrapSourceX(baseX + perpX * side * clearance),
    baseZ + perpZ * side * clearance,
  );
}

/** Minimal route shell used only to run the canonical final validator on a segment. */
function routeShell(points: LonLat[]): RouteResult {
  const geodesicM = greatCircleDistance(points[0], points[points.length - 1]);
  return {
    found: true,
    geodesicM,
    distanceM: geodesicM,
    fantasySeconds: geodesicM / OPEN_GROUND_WALK_SPEED_MPS,
    realSeconds: realSecondsForFantasy(geodesicM / OPEN_GROUND_WALK_SPEED_MPS),
    straightLineFantasySeconds: geodesicM / FASTEST_WALK_SPEED_MPS,
    detourFactor: 1,
    points,
    surfaceM: { road: 0, bridge: 0, open: geodesicM, difficult: 0 },
    cellSizeM: FINAL_ROUTE_VALIDATION_STEP_M,
    expansions: 0,
    attempts: 1,
  };
}

/**
 * Connect two nearby deterministic repair waypoints. A straight final-surface
 * segment is preferred; only if that exact segment is blocked do we invoke the
 * normal bounded final-surface planner. This keeps repair cost local and avoids
 * the former 80 km whole-route search.
 */
function localFinalConnector(from: LonLat, to: LonLat): LonLat[] | undefined {
  const direct = routeShell([from, to]);
  if (refineAgainstFinalTraversal(direct)) return [from, to];
  const planned = planRoute({ from, to, terrain: finalTraversalTerrainSampler }),
    refined = refineAgainstFinalTraversal(planned);
  return refined?.found ? refined.points : undefined;
}

/** Join deterministic repair waypoints while certifying every individual leg. */
function stitchFinalWaypoints(waypoints: readonly LonLat[]): LonLat[] | undefined {
  if (waypoints.length < 2) return undefined;
  const result: LonLat[] = [waypoints[0]];
  for (let index = 1; index < waypoints.length; index++) {
    const connector = localFinalConnector(waypoints[index - 1], waypoints[index]);
    if (!connector) return undefined;
    result.push(...connector.slice(1));
  }
  return result;
}

/**
 * Build a certified route from the actual blocked segment endpoint to the exact
 * projected river bank, trace the seeded bank to the head, pass around the head,
 * then return along the opposite bank to the other segment endpoint. Using the
 * blocked projection matters: a downstream recipe vertex can lie beyond a
 * meander and make the splice re-cross the same river before repair even starts.
 */
function drainageBankDetour(
  path: readonly DrainagePoint[],
  segmentIndex: number,
  t: number,
  sideA: number,
  sideB: number,
  clearance: number,
  segmentA: LonLat,
  segmentB: LonLat,
): LonLat[] | undefined {
  const waypoints: LonLat[] = [
    segmentA,
    projectedDrainageBankPoint(path, segmentIndex, t, sideA, clearance),
  ];
  for (let index = segmentIndex; index >= 0; index--)
    waypoints.push(drainageBankPoint(path, index, sideA, clearance));
  waypoints.push(drainageBankPoint(path, 0, sideB, clearance));
  for (let index = 1; index <= segmentIndex; index++)
    waypoints.push(drainageBankPoint(path, index, sideB, clearance));
  waypoints.push(
    projectedDrainageBankPoint(path, segmentIndex, t, sideB, clearance),
    segmentB,
  );
  if (waypoints.some((point) => !finalTraversalState(point).surface.walkable)) return undefined;
  return stitchFinalWaypoints(waypoints);
}

/**
 * Insert deterministic certified bank routes around the exact seeded river
 * crossings that block a candidate. The same catchment may legitimately be
 * crossed more than once by a meandering coarse corridor, so each remaining
 * blocked river sample is repaired in turn up to a fixed bound.
 */
function repairAroundDrainage(route: RouteResult): RouteResult | undefined {
  if (!route.found || route.points.length < 2) return undefined;
  let candidate = route;
  for (let repair = 0; repair < FINAL_DRAINAGE_REPAIR_LIMIT; repair++) {
    const refined = refineAgainstFinalTraversal(candidate);
    if (refined) return refined;
    const blocked = firstBlockedFinalSample(candidate);
    if (
      !blocked ||
      blocked.surface.water !== "river" ||
      !blocked.surface.catchmentCode
    )
      return undefined;

    const blockedSource = lonLatToFlat(blocked.position.lon, blocked.position.lat),
      recipe = drainageRecipesNear(blockedSource.x, blockedSource.z, 2).find(
        (item) => item.code === blocked.surface.catchmentCode,
      );
    if (!recipe) return undefined;
    const hit = nearestDrainagePath(recipe, blockedSource.x, blockedSource.z);
    if (!hit || hit.path.length < 2) return undefined;

    const segmentA = candidate.points[blocked.segmentIndex - 1],
      segmentB = candidate.points[blocked.segmentIndex],
      sourceA = lonLatToFlat(segmentA.lon, segmentA.lat),
      sourceB = lonLatToFlat(segmentB.lon, segmentB.lat),
      localA = hit.path[hit.segmentIndex],
      localB = hit.path[hit.segmentIndex + 1];
    let sideA = sideOfSourceSegment(sourceA, localA, localB),
      sideB = sideOfSourceSegment(sourceB, localA, localB);
    // A rejected segment that samples the river normally emerges on the other
    // side. Near a tangent/endpoint tie, force a deterministic opposite side.
    if (sideA === sideB) sideB = -sideA;

    let nextCandidate: RouteResult | undefined;
    for (const factor of [1, 1.5, 2.1] as const) {
      const clearance = Math.max(30, hit.width * 2.2) * factor,
        inserted = drainageBankDetour(
          hit.path,
          hit.segmentIndex,
          hit.t,
          sideA,
          sideB,
          clearance,
          segmentA,
          segmentB,
        );
      if (!inserted) continue;
      const trial: RouteResult = {
        ...candidate,
        reason: undefined,
        points: [
          ...candidate.points.slice(0, blocked.segmentIndex - 1),
          ...inserted,
          ...candidate.points.slice(blocked.segmentIndex + 1),
        ],
        attempts: candidate.attempts + 1,
      };
      const accepted = refineAgainstFinalTraversal(trial);
      if (accepted) return accepted;
      const trialBlocked = firstBlockedFinalSample(trial);
      if (trialBlocked?.surface.water === "river" && trialBlocked.surface.catchmentCode) {
        nextCandidate = trial;
        break;
      }
    }
    if (!nextCandidate) return undefined;
    candidate = nextCandidate;
  }
  return refineAgainstFinalTraversal(candidate);
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

  // A long distributed river can separate nearby villages while its head lies
  // far outside a rectangular local search margin. Repair that specific seeded
  // catchment first; this is both faster and more authoritative than widening A*.
  const drainageRepair = repairAroundDrainage(coarse);
  if (drainageRepair) return drainageRepair;

  // Non-drainage local blockers still use the original fixed bounded planner.
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
  finalTraversalCache.clear();
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
