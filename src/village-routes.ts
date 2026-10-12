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
import { politicalRouteWaypoints } from "./political-route-topology.ts";
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
  ROUTE_CELL_MIN_M,
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
/** A route may repair a bounded number of distinct seeded drainage crossings. */
export const FINAL_DRAINAGE_REPAIR_LIMIT = 8;
/** Political fallback legs stay below the ordinary local planner's search envelope. */
export const POLITICAL_TOPOLOGY_LEG_MAX_M = 60_000;

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
  stepIndex: number;
  steps: number;
  t: number;
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
    // Keep canonical height available for diagnostics/cost reporting. Final repair
    // explicitly tells routing.ts that passability is already owned by this surface.
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
          stepIndex: step,
          steps,
          t,
          position: { lon: sample.lon, lat: sample.lat },
          surface,
        };
    }
  }
  return undefined;
}

/**
 * Return dry samples immediately before and after the blocked run on the same
 * simplified segment. This keeps a drainage repair local to the actual crossing
 * rather than reconnecting from endpoints that may be kilometres away or on the
 * wrong side of another meander.
 */
function localDryApproaches(
  route: RouteResult,
  blocked: BlockedRouteSample,
): readonly [LonLat, LonLat] | undefined {
  const a: CanonicalPosition = { ...route.points[blocked.segmentIndex - 1], elevation: 0 },
    b: CanonicalPosition = { ...route.points[blocked.segmentIndex], elevation: 0 },
    delta = positionToEnu(b, a),
    atStep = (step: number): LonLat => {
      const t = (step + 0.5) / blocked.steps,
        point = enuToPosition(
          { east: delta.east * t, north: delta.north * t, up: 0 },
          a,
        );
      return { lon: point.lon, lat: point.lat };
    };
  let before: LonLat | undefined,
    after: LonLat | undefined;
  for (let step = blocked.stepIndex - 1; step >= 0; step--) {
    const point = atStep(step);
    if (finalTraversalState(point).surface.walkable) {
      before = point;
      break;
    }
  }
  if (!before && finalTraversalState(a).surface.walkable)
    before = { lon: a.lon, lat: a.lat };
  for (let step = blocked.stepIndex + 1; step < blocked.steps; step++) {
    const point = atStep(step);
    if (finalTraversalState(point).surface.walkable) {
      after = point;
      break;
    }
  }
  if (!after && finalTraversalState(b).surface.walkable)
    after = { lon: b.lon, lat: b.lat };
  return before && after ? [before, after] : undefined;
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

/**
 * Route around the rounded start of a river instead of connecting its two head
 * bank points directly through the channel. The cap is upstream of the first
 * drainage segment and is derived only from that canonical segment and the
 * deterministic clearance chosen for this repair.
 */
function drainageHeadCapPoints(
  path: readonly DrainagePoint[],
  sideA: number,
  sideB: number,
  clearance: number,
): LonLat[] {
  const head = path[0],
    next = path[1],
    dx = wrapSourceX(next.x - head.x),
    dz = next.z - head.z,
    length = Math.hypot(dx, dz) || 1,
    tangentX = dx / length,
    tangentZ = dz / length,
    perpX = -tangentZ,
    perpZ = tangentX,
    upstream = clearance * 2.35,
    shoulder = clearance * 1.12,
    make = (side: number, upstreamFactor = 1) =>
      sourceToLonLat(
        wrapSourceX(
          head.x - tangentX * upstream * upstreamFactor + perpX * side * shoulder,
        ),
        head.z - tangentZ * upstream * upstreamFactor + perpZ * side * shoulder,
      );
  return [
    make(sideA, 0.76),
    sourceToLonLat(
      wrapSourceX(head.x - tangentX * upstream),
      head.z - tangentZ * upstream,
    ),
    make(sideB, 0.76),
  ];
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
  const planned = planRoute({
      from,
      to,
      terrain: finalTraversalTerrainSampler,
      authoritativeTraversal: true,
    }),
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
 * Last-resort local connectivity proof for a seeded drainage detour. The search
 * envelope is the compact ENU bounds of the already-derived dry bank/head guide,
 * not a symmetric whole-route margin. This preserves 40 m detail whenever the
 * bounded envelope fits the normal route-cell budget, which is important for
 * narrow dry components beside winding headwaters.
 */
function localFinalComponentConnector(
  from: LonLat,
  to: LonLat,
  guide: readonly LonLat[],
): LonLat[] | undefined {
  const origin: CanonicalPosition = { ...from, elevation: 0 },
    destination = positionToEnu({ ...to, elevation: 0 }, origin),
    guideEnu = guide.map((point) => positionToEnu({ ...point, elevation: 0 }, origin)),
    paddingM = 800,
    minE = Math.min(0, destination.east, ...guideEnu.map((point) => point.east)) - paddingM,
    maxE = Math.max(0, destination.east, ...guideEnu.map((point) => point.east)) + paddingM,
    minN = Math.min(0, destination.north, ...guideEnu.map((point) => point.north)) - paddingM,
    maxN = Math.max(0, destination.north, ...guideEnu.map((point) => point.north)) + paddingM;

  let cell = Math.max(
      ROUTE_CELL_MIN_M,
      Math.ceil(Math.sqrt(((maxE - minE) * (maxN - minN)) / ROUTE_MAX_CELLS)),
    ),
    i0 = 0,
    i1 = 0,
    j0 = 0,
    j1 = 0,
    width = 0,
    height = 0,
    total = ROUTE_MAX_CELLS + 1;
  while (total > ROUTE_MAX_CELLS) {
    i0 = Math.floor(minE / cell);
    i1 = Math.ceil(maxE / cell);
    j0 = Math.floor(minN / cell);
    j1 = Math.ceil(maxN / cell);
    width = i1 - i0 + 1;
    height = j1 - j0 + 1;
    total = width * height;
    if (total > ROUTE_MAX_CELLS) cell++;
  }

  const indexOf = (i: number, j: number) => (j - j0) * width + (i - i0),
    inside = (i: number, j: number) => i >= i0 && i <= i1 && j >= j0 && j <= j1,
    pointAt = (i: number, j: number): LonLat => {
      const point = enuToPosition({ east: i * cell, north: j * cell, up: 0 }, origin);
      return { lon: point.lon, lat: point.lat };
    },
    sampled = new Uint8Array(total),
    passable = new Uint8Array(total),
    isPassable = (i: number, j: number) => {
      if (!inside(i, j)) return false;
      const index = indexOf(i, j);
      if (!sampled[index]) {
        sampled[index] = 1;
        passable[index] = finalTraversalState(pointAt(i, j)).surface.walkable ? 1 : 0;
      }
      return passable[index] === 1;
    },
    startI = 0,
    startJ = 0,
    endI = Math.max(i0, Math.min(i1, Math.round(destination.east / cell))),
    endJ = Math.max(j0, Math.min(j1, Math.round(destination.north / cell)));
  if (!isPassable(startI, startJ) || !isPassable(endI, endJ)) return undefined;

  const parent = new Int32Array(total).fill(-1),
    visited = new Uint8Array(total),
    queue = new Int32Array(total),
    start = indexOf(startI, startJ),
    target = indexOf(endI, endJ),
    moves = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ] as const;
  let head = 0,
    tail = 0,
    expansions = 0;
  queue[tail++] = start;
  visited[start] = 1;
  while (head < tail && expansions < Math.min(ROUTE_MAX_EXPANSIONS, total)) {
    const current = queue[head++];
    if (current === target) break;
    expansions++;
    const ci = (current % width) + i0,
      cj = Math.floor(current / width) + j0;
    for (const [di, dj] of moves) {
      const ni = ci + di,
        nj = cj + dj;
      if (!inside(ni, nj) || !isPassable(ni, nj)) continue;
      if (di !== 0 && dj !== 0 && (!isPassable(ci + di, cj) || !isPassable(ci, cj + dj)))
        continue;
      const next = indexOf(ni, nj);
      if (visited[next]) continue;
      visited[next] = 1;
      parent[next] = current;
      queue[tail++] = next;
    }
  }
  if (!visited[target]) return undefined;

  const cells: number[] = [];
  for (let current = target; current !== -1; current = parent[current]) {
    cells.push(current);
    if (current === start) break;
  }
  if (cells[cells.length - 1] !== start) return undefined;
  cells.reverse();
  const points: LonLat[] = [{ lon: from.lon, lat: from.lat }];
  for (let index = 1; index < cells.length; index++) {
    const current = cells[index],
      i = (current % width) + i0,
      j = Math.floor(current / width) + j0;
    points.push(pointAt(i, j));
  }
  points.push({ lon: to.lon, lat: to.lat });
  const refined = refineAgainstFinalTraversal(routeShell(points));
  return refined?.found ? refined.points : undefined;
}
/** Political legs get the same seeded drainage repair before bounded final A*. */
function politicalFinalConnector(from: LonLat, to: LonLat): LonLat[] | undefined {
  const direct = routeShell([from, to]);
  if (refineAgainstFinalTraversal(direct)) return [from, to];
  const drainageRepair = repairAroundDrainage(direct);
  if (drainageRepair?.found) return drainageRepair.points;
  const planned = planRoute({
      from,
      to,
      terrain: finalTraversalTerrainSampler,
      authoritativeTraversal: true,
    }),
    refined = refineAgainstFinalTraversal(planned);
  return refined?.found ? refined.points : undefined;
}

function stitchPoliticalWaypoints(waypoints: readonly LonLat[]): LonLat[] | undefined {
  if (waypoints.length < 2) return undefined;
  const result: LonLat[] = [waypoints[0]];
  for (let index = 1; index < waypoints.length; index++) {
    const connector = politicalFinalConnector(waypoints[index - 1], waypoints[index]);
    if (!connector) return undefined;
    result.push(...connector.slice(1));
  }
  return result;
}

/** Keep every political topology leg within the ordinary bounded final planner. */
function boundedTopologyWaypoints(waypoints: readonly LonLat[]): LonLat[] {
  if (waypoints.length < 2) return [...waypoints];
  const result: LonLat[] = [waypoints[0]];
  for (let index = 1; index < waypoints.length; index++) {
    const a: CanonicalPosition = { ...waypoints[index - 1], elevation: 0 },
      b: CanonicalPosition = { ...waypoints[index], elevation: 0 },
      lengthM = greatCircleDistance(a, b),
      parts = Math.max(1, Math.ceil(lengthM / POLITICAL_TOPOLOGY_LEG_MAX_M)),
      delta = positionToEnu(b, a);
    for (let part = 1; part < parts; part++) {
      const t = part / parts,
        point = enuToPosition(
          { east: delta.east * t, north: delta.north * t, up: 0 },
          a,
        );
      result.push({ lon: point.lon, lat: point.lat });
    }
    result.push(waypoints[index]);
  }
  return result;
}

/**
 * Use accepted SEED-owned settlement/backbone/gateway topology only as a set of
 * high-level anchors. Every bounded leg is still solved and certified against
 * the canonical final surface, so political metadata can never make water or a
 * cliff walkable by declaration.
 */
function repairViaPoliticalTopology(from: Place, to: Place): RouteResult | undefined {
  const topology = politicalRouteWaypoints(from, to);
  if (!topology) return undefined;
  const bounded = boundedTopologyWaypoints(topology),
    stitched = stitchPoliticalWaypoints(bounded);
  if (!stitched) return undefined;
  const candidate = routeShell(stitched);
  candidate.attempts += Math.max(1, bounded.length - 1);
  return refineAgainstFinalTraversal(candidate);
}

/**
 * Build a certified route from local dry approach samples to the exact projected
 * river bank, trace the seeded bank to the head, pass around the head, then
 * return along the opposite bank. Keeping the splice local prevents a repair
 * connector from re-crossing the same meander before the detour even starts.
 */
const DRAINAGE_ADAPTIVE_CLEARANCE_FACTORS = [1, 1.35, 1.8, 2.4, 3.2, 4.2, 5.5, 7] as const;

/** Append one point only when the entire connector from the prior point is final-surface legal. */
function appendCertifiedDrainagePoint(result: LonLat[], candidate: LonLat): boolean {
  if (!finalTraversalState(candidate).surface.walkable) return false;
  const connector = localFinalConnector(result[result.length - 1], candidate);
  if (!connector) return false;
  result.push(...connector.slice(1));
  return true;
}

/**
 * Increase the offset monotonically along a bank until both the candidate point
 * and the segment leading to it are certified by canonical final traversal.
 * Returning the chosen factor index lets the next point start no closer to the
 * channel, preventing a meander from folding a nominal bank line back through
 * the same river.
 */
function appendAdaptiveDrainagePoint(
  result: LonLat[],
  makePoint: (clearance: number) => LonLat,
  baseClearance: number,
  floorFactorIndex: number,
): number {
  for (
    let factorIndex = floorFactorIndex;
    factorIndex < DRAINAGE_ADAPTIVE_CLEARANCE_FACTORS.length;
    factorIndex++
  ) {
    const candidate = makePoint(
      baseClearance * DRAINAGE_ADAPTIVE_CLEARANCE_FACTORS[factorIndex],
    );
    if (appendCertifiedDrainagePoint(result, candidate)) return factorIndex;
  }
  return -1;
}

/**
 * Catchment-local fallback for a bank trace whose uniform offset folds through
 * a river meander. It follows the same seeded drainage path but increases
 * clearance only where final traversal proves it necessary. Every point and
 * every connector segment is certified as it is appended; no global search
 * envelope or passability rule is widened.
 */
function adaptiveDrainageBankDetour(
  path: readonly DrainagePoint[],
  segmentIndex: number,
  t: number,
  sideA: number,
  sideB: number,
  baseClearance: number,
  approachA: LonLat,
  approachB: LonLat,
): LonLat[] | undefined {
  const result: LonLat[] = [{ lon: approachA.lon, lat: approachA.lat }];
  let factorIndex = appendAdaptiveDrainagePoint(
    result,
    (clearance) => projectedDrainageBankPoint(path, segmentIndex, t, sideA, clearance),
    baseClearance,
    0,
  );
  if (factorIndex < 0) return undefined;

  for (let index = segmentIndex; index >= 0; index--) {
    factorIndex = appendAdaptiveDrainagePoint(
      result,
      (clearance) => drainageBankPoint(path, index, sideA, clearance),
      baseClearance,
      factorIndex,
    );
    if (factorIndex < 0) return undefined;
  }

  // Cross the rounded head as one coherent seeded construction. If any point or
  // segment fails, retry the complete cap farther upstream rather than retaining
  // a partial cap assembled at inconsistent offsets.
  let capAccepted = false;
  for (
    let capFactorIndex = factorIndex;
    capFactorIndex < DRAINAGE_ADAPTIVE_CLEARANCE_FACTORS.length;
    capFactorIndex++
  ) {
    const checkpoint = result.length,
      clearance = baseClearance * DRAINAGE_ADAPTIVE_CLEARANCE_FACTORS[capFactorIndex],
      capPoints = drainageHeadCapPoints(path, sideA, sideB, clearance);
    let accepted = true;
    for (const point of capPoints)
      if (!appendCertifiedDrainagePoint(result, point)) {
        accepted = false;
        break;
      }
    if (accepted) {
      factorIndex = capFactorIndex;
      capAccepted = true;
      break;
    }
    result.length = checkpoint;
  }
  if (!capAccepted) return undefined;

  factorIndex = appendAdaptiveDrainagePoint(
    result,
    (clearance) => drainageBankPoint(path, 0, sideB, clearance),
    baseClearance,
    factorIndex,
  );
  if (factorIndex < 0) return undefined;
  for (let index = 1; index <= segmentIndex; index++) {
    factorIndex = appendAdaptiveDrainagePoint(
      result,
      (clearance) => drainageBankPoint(path, index, sideB, clearance),
      baseClearance,
      factorIndex,
    );
    if (factorIndex < 0) return undefined;
  }
  factorIndex = appendAdaptiveDrainagePoint(
    result,
    (clearance) => projectedDrainageBankPoint(path, segmentIndex, t, sideB',
    baseClearance,
    factorIndex,
  );
  if (factorIndex < 0 || !appendCertifiedDrainagePoint(result, approachB)) return undefined;

  const refined = refineAgainstFinalTraversal(routeShell(result));
  return refined?.found ? refined.points : undefined;
}

/**
 * Build a certified route from local dry approach samples to the exact projected
 * river bank, trace the seeded bank to the head, pass around the head, then
 * return along the opposite bank. Prefer the compact uniform guide; if a meander
 * makes any guide point/segment illegal, use the adaptive catchment-local trace.
 */
function drainageBankDetour(
  path: readonly DrainagePoint[],
  segmentIndex: number,
  t: number,
  sideA: number,
  sideB: number,
  clearance: number,
  approachA: LonLat,
  approachB: LonLat,
): LonLat[] | undefined {
  const waypoints: LonLat[] = [
    approachA,
    projectedDrainageBankPoint(path, segmentIndex, t, sideA, clearance),
  ];
  for (let index = segmentIndex; index >= 0; index--)
    waypoints.push(drainageBankPoint(path, index, sideA, clearance));
  waypoints.push(...drainageHeadCapPoints(path, sideA, sideB',
  waypoints.push(drainageBankPoint(path, 0, sideB, clearance));
  for (let index = 1; index <= segmentIndex; index++)
    waypoints.push(drainageBankPoint(path, index, sideB, clearance));
  waypoints.push(
    projectedDrainageBankPoint(path, segmentIndex, t, sideB, clearance),
    approachB,
  );

  if (!waypoints.some((point) => !finalTraversalState(point).surface.walkable)) {
    const stitched = stitchFinalWaypoints(waypoints);
    if (stitched) return stitched;
  }
  return adaptiveDrainageBankDetour(
    path,
    segmentIndex,
    t,
    sideA,
    side B,
    clearance,
    approachA,
    approachB,
  );
}

/**
 * Insert deterministic certified bank routes around the exact seeded drainage
 * crossings that block a candidate. The same catchment may legitimately be
 * crossed more than once by a meandering corridor, so each remaining blocked
 * river/lake sample is repaired in turn up to a fixed bound.
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
      (blocked.surface.water !== "river" && blocked.surface.water !== "lake") ||
      !blocked.surface.catchmentCode
    )
      return undefined;

    const approaches = localDryApproaches(candidate, blocked);
    if (!approaches) return undefined;
    const [approachA, approachB] = approaches,
      blockedSource = lonLatToFlat(blocked.position.lon, blocked.position.lat),
      recipe = drainageRecipesNear(blockedSource.x, blockedSource.z, 2).find(
        (item) => item.code === blocked.surface.catchmentCode,
      );
    if (!recipe) return undefined;
    const hit = nearestDrainagePath(recipe, blockedSource.x, blockedSource.z);
    if (!hit || hit.path.length < 2) return undefined;

    const sourceA = lonLatToFlat(approachA.lon, approachA.lat),
      sourceB = lonLatToFlat(approachB.lon, approachB.lat),
      localA = hit.path[hit.segmentIndex],
      localB = hit.path[hit.segmentIndex + 1];
    let sideA = sideOfSourceSegment(sourceA, localA, localB),
      sideB = sideOfSourceSegment(sourceB, localA, localB);
    // A rejected segment that samples drainage normally emerges on the other
    // side. Near a tangent/endpoint tie, force a deterministic opposite side.
    if (sideA === sideB) sideB = -sideA;

    let nextCandidate: RouteResult | undefined;
    const lakeClearance =
      blocked.surface.water === "lake" && recipe.lake ? recipe.lake.radius * 1.8 : 0;
    for (const factor of [1, 1.35, 1.8] as const) {
      const clearance = Math.max(30, hit.width * 2.2, lakeClearance) * factor,
        inserted = drainageBankDetour(
          hit.path,
          hit.segmentIndex,
          hit.t,
          sideA,
          sideB,
          clearance,
          approachA,
          approachB,
        );
      if (!inserted) continue;
      const trial: RouteResult = {
        ...candidate,
        reason: undefined,
        points: [
          ...candidate.points.slice(0, blocked.segmentIndex),
          ...inserted,
          ...candidate.points.slice(blocked.segmentIndex),
        ],
        attempts: candidate.attempts + 1,
      };
      const accepted = refineAgainstFinalTraversal(trial);
      if (accepted) return accepted;
      const trialBlocked = firstBlockedFinalSample(trial);
      if (
        trialBlocked &&
        (trialBlocked.surface.water === "river" || trialBlocked.surface.water === "lake") &&
        trialBlocked.surface.catchmentCode
      ) {
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
  // corridor, then certify that corridor against final runtime truth. A failed
  // coarse search is not a refined route; it must continue into final repair.
  const coarse = planRoute({
    from: from.canonicalPosition,
    to: to.canonicalPosition,
    roads: roadSegments,
    terrain: macroTerrainSampler,
  });
  if (coarse.found) {
    const refined = refineAgainstFinalTraversal(coarse);
    if (refined) return refined;
  }

  // A long distributed river can separate nearby villages while its head lies
  // far outside a rectangular local search margin. If the macro planner found a
  // corridor, repair that exact corridor. If macro search itself was blocked,
  // use the direct geodesic only as a diagnostic/repair candidate; it is never
  // accepted unless every inserted point later passes final traversal truth.
  const drainageCandidate = coarse.found
      ? coarse
      : routeShell([
          { lon: from.canonicalPosition.lon, lat: from.canonicalPosition.lat },
          { lon: to.canonicalPosition.lon, lat: to.canonicalPosition.lat },
        ]),
    drainageRepair = repairAroundDrainage(drainageCandidate);
  if (drainageRepair) return drainageRepair;

  // Political topology is a last-resort cross-country fallback only when the
  // ordinary macro planner could not produce any corridor. This avoids paying
  // country-graph work for routes that already have a local deterministic shape.
  if (!coarse.found && from.continent === to.continent && from.country !== to.country) {
    const politicalRepair = repairViaPoliticalTopology(from, to);
    if (politicalRepair) return politicalRepair;
  }

  // Non-drainage local blockers still use the original fixed bounded planner.
  const repaired = planRoute({
    from: from.canonicalPosition,
    to: to.canonicalPosition,
    roads: roadSegments,
    terrain: finalTraversalTerrainSampler,
    authoritativeTraversal: true,
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
