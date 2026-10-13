import { WORLD_FOUNDATION_VERSION, WORLD_SEED } from "./config.ts";
import { macroSampleAt } from "./macro-geography.ts";
import {
  CANONICAL_PLANET_RADIUS,
  canonicalCell,
  cubeFaceToUnit,
  greatCircleDistance,
  type CubeCell,
  type LonLat,
  unitToLonLat,
} from "./planet.ts";
import {
  CANONICAL_GENERATOR_VERSION,
  canonicalCellCenter,
  canonicalCellNeighbors,
} from "./spatial-authority.ts";

/**
 * WP-S003-002-001 continuity authority.
 *
 * These values are definition/query limits, not presentation budgets. Device,
 * viewport, renderer, LOD, worker count, wall clock and cache residency never
 * enter any canonical recipe decision.
 */
export const CONTINUITY_LIMITS = Object.freeze({
  regionLevel: 7,
  boundaryCandidates: 7,
  terrainDependencyRegions: 5,
  roadSearchExpansions: 192,
  roadRegionLimit: 48,
  cacheEntries: 128,
  coordinateQuantizationRad: 1e-10,
  profileQuantizationM: 0.01,
  roadHalfWidthM: 4.5,
});

export type ContinuitySide = "west" | "east" | "south" | "north";
export type ContinuityRegionRecipe = {
  id: string;
  cell: CubeCell;
  center: LonLat;
  definitionDigest: string;
  dependencies: readonly string[];
  domain: string;
  reliefM: number;
};
export type ContinuityBoundary = {
  id: string;
  ownerId: string;
  otherId: string;
  ownerSide: ContinuitySide;
  from: LonLat;
  to: LonLat;
};
export type ContinuityPort = {
  id: string;
  boundaryId: string;
  featureId: string;
  slot: number;
  candidate: number;
  t: number;
  position: LonLat;
  domain: string;
  reliefM: number;
  coastDistanceM: number;
  widthM: number;
  maxGrade: number;
  fallback: boolean;
};
export type ContinuityRoadRecipe = {
  featureId: string;
  version: string;
  campaignRevision: string;
  foundationDigest: string;
  stateDigest: string;
  regions: readonly string[];
  points: readonly LonLat[];
  ports: readonly ContinuityPort[];
  searchExpansions: number;
  fallback: boolean;
};
export type ContinuityMetrics = {
  definitionQueries: number;
  roadQueries: number;
  remoteQueries: number;
  cacheHits: number;
  cacheMisses: number;
  cacheEntries: number;
  cacheEvictions: number;
  candidateChecks: number;
  searchExpansions: number;
  maxSearchExpansions: number;
  maxDependencies: number;
  recipeBytesEstimated: number;
  queryBytesEstimated: number;
  presentationBytes: number;
  materializedPresentationResources: number;
};

type SearchNode = {
  cell: CubeCell;
  cost: number;
  score: number;
  previous?: string;
};

const metricState = {
  definitionQueries: 0,
  roadQueries: 0,
  remoteQueries: 0,
  cacheHits: 0,
  cacheMisses: 0,
  cacheEvictions: 0,
  candidateChecks: 0,
  searchExpansions: 0,
  maxSearchExpansions: 0,
  maxDependencies: 0,
  queryBytesEstimated: 0,
};
const roadCache = new Map<string, ContinuityRoadRecipe>();

function digestNumber(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++)
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}
function digest(text: string): string {
  return digestNumber(text).toString(16).padStart(8, "0");
}
function sample(domain: string, ...parts: readonly (string | number)[]): number {
  return (
    digestNumber(
      [WORLD_SEED, WORLD_FOUNDATION_VERSION, "CONTINUITY", domain, ...parts].join("/"),
    ) / 4294967296
  );
}
function quantize(value: number, quantum: number) {
  return Math.round(value / quantum) * quantum;
}
function quantizedPosition(position: LonLat): LonLat {
  return {
    lon: quantize(position.lon, CONTINUITY_LIMITS.coordinateQuantizationRad),
    lat: quantize(position.lat, CONTINUITY_LIMITS.coordinateQuantizationRad),
  };
}
function coordinateKey(position: LonLat) {
  const q = quantizedPosition(position);
  return `${q.lon.toFixed(10)}/${q.lat.toFixed(10)}`;
}

export function continuityRegionAt(position: LonLat): CubeCell {
  return canonicalCell(
    position.lon,
    position.lat,
    CONTINUITY_LIMITS.regionLevel,
    WORLD_SEED,
    CANONICAL_GENERATOR_VERSION,
  );
}

function cellEdge(cell: CubeCell, side: ContinuitySide): [LonLat, LonLat] {
  const count = 2 ** cell.level,
    u0 = (cell.u / count) * 2 - 1,
    u1 = ((cell.u + 1) / count) * 2 - 1,
    v0 = (cell.v / count) * 2 - 1,
    v1 = ((cell.v + 1) / count) * 2 - 1;
  if (side === "west")
    return [unitToLonLat(cubeFaceToUnit(cell.face, u0, v0)), unitToLonLat(cubeFaceToUnit(cell.face, u0, v1))];
  if (side === "east")
    return [unitToLonLat(cubeFaceToUnit(cell.face, u1, v0)), unitToLonLat(cubeFaceToUnit(cell.face, u1, v1))];
  if (side === "south")
    return [unitToLonLat(cubeFaceToUnit(cell.face, u0, v0)), unitToLonLat(cubeFaceToUnit(cell.face, u1, v0))];
  return [unitToLonLat(cubeFaceToUnit(cell.face, u0, v1)), unitToLonLat(cubeFaceToUnit(cell.face, u1, v1))];
}

/**
 * One orientation-independent boundary identity. The lexicographically lower
 * canonical cell owns the record; its local edge direction defines t=0..1.
 */
export function continuityBoundary(a: CubeCell, b: CubeCell): ContinuityBoundary {
  if (a.level !== b.level) throw new RangeError("Continuity boundary cells must share a level");
  const [owner, other] = a.id < b.id ? [a, b] : [b, a],
    neighbours = canonicalCellNeighbors(owner, WORLD_SEED, CANONICAL_GENERATOR_VERSION),
    side = (Object.keys(neighbours) as ContinuitySide[]).find(
      (candidate) => neighbours[candidate].id === other.id,
    );
  if (!side)
    throw new RangeError(`Continuity cells are not edge neighbours: ${a.id} <> ${b.id}`);
  const [from, to] = cellEdge(owner, side),
    pair = [owner.id, other.id].sort().join("|");
  return {
    id: `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/CONTINUITY/EDGE/${digest(pair)}`,
    ownerId: owner.id,
    otherId: other.id,
    ownerSide: side,
    from: quantizedPosition(from),
    to: quantizedPosition(to),
  };
}

function slerp(a: LonLat, b: LonLat, t: number): LonLat {
  const toVector = (position: LonLat) => {
      const c = Math.cos(position.lat);
      return [c * Math.sin(position.lon), Math.sin(position.lat), c * Math.cos(position.lon)] as const;
    },
    av = toVector(a),
    bv = toVector(b),
    dot = Math.max(-1, Math.min(1, av[0] * bv[0] + av[1] * bv[1] + av[2] * bv[2])),
    angle = Math.acos(dot);
  if (angle < 1e-10) return quantizedPosition(a);
  const sin = Math.sin(angle),
    wa = Math.sin((1 - t) * angle) / sin,
    wb = Math.sin(t * angle) / sin,
    x = av[0] * wa + bv[0] * wb,
    y = av[1] * wa + bv[1] * wb,
    z = av[2] * wa + bv[2] * wb,
    length = Math.hypot(x, y, z) || 1;
  return quantizedPosition(unitToLonLat([x / length, y / length, z / length]));
}

export function continuityRegionRecipe(cell: CubeCell): ContinuityRegionRecipe {
  metricState.definitionQueries++;
  const center = canonicalCellCenter(cell),
    terrain = macroSampleAt(center),
    neighbours = canonicalCellNeighbors(cell, WORLD_SEED, CANONICAL_GENERATOR_VERSION),
    dependencies = [cell.id, neighbours.west.id, neighbours.east.id, neighbours.south.id, neighbours.north.id];
  metricState.maxDependencies = Math.max(metricState.maxDependencies, dependencies.length);
  const definitionDigest = digest(
    [
      cell.id,
      terrain.code,
      terrain.domain,
      Math.round(terrain.reliefM * 100),
      ...dependencies.slice(1).sort(),
    ].join("|"),
  );
  return {
    id: `${cell.id}/CONTINUITY`,
    cell,
    center,
    definitionDigest,
    dependencies,
    domain: terrain.domain,
    reliefM: quantize(terrain.reliefM, CONTINUITY_LIMITS.profileQuantizationM),
  };
}

function boundaryPosition(boundary: ContinuityBoundary, t: number) {
  return slerp(boundary.from, boundary.to, t);
}

/**
 * Ordered, finite candidate set. The first legal candidate wins. Candidate
 * variation is deliberately not a fixed midpoint and is domain-separated from
 * terrain/scatter/building randomness.
 */
export function continuityRoadPort(
  boundary: ContinuityBoundary,
  featureId: string,
  slot = 0,
): ContinuityPort {
  let fallback:
    | { candidate: number; t: number; position: LonLat; domain: string; reliefM: number; coastDistanceM: number; penalty: number }
    | undefined;
  for (let candidate = 0; candidate < CONTINUITY_LIMITS.boundaryCandidates; candidate++) {
    metricState.candidateChecks++;
    const t = quantize(0.12 + sample("ROAD_PORT", boundary.id, featureId, slot, candidate) * 0.76, 1 / 65535),
      position = boundaryPosition(boundary, t),
      terrain = macroSampleAt(position),
      coastDistanceM = terrain.coastDistanceRad * CANONICAL_PLANET_RADIUS,
      legal = terrain.land && terrain.domain !== "Lake" && terrain.reliefM <= 520,
      penalty =
        (terrain.land ? 0 : 1_000_000) +
        (terrain.domain === "Lake" ? 500_000 : 0) +
        terrain.reliefM * 25 +
        Math.max(0, 1200 - coastDistanceM) * 12;
    const current = {
      candidate,
      t,
      position,
      domain: terrain.domain,
      reliefM: terrain.reliefM,
      coastDistanceM,
      penalty,
    };
    if (!fallback || current.penalty < fallback.penalty || (current.penalty === fallback.penalty && candidate < fallback.candidate))
      fallback = current;
    if (legal) {
      const widthM = quantize(7 + sample("ROAD_WIDTH", boundary.id, featureId, slot) * 4, 0.1);
      return {
        id: `${boundary.id}/ROAD/${digest(`${featureId}/${slot}`)}`,
        boundaryId: boundary.id,
        featureId,
        slot,
        candidate,
        t,
        position,
        domain: terrain.domain,
        reliefM: quantize(terrain.reliefM, CONTINUITY_LIMITS.profileQuantizationM),
        coastDistanceM: quantize(coastDistanceM, CONTINUITY_LIMITS.profileQuantizationM),
        widthM,
        maxGrade: 0.08,
        fallback: false,
      };
    }
  }
  if (!fallback) throw new Error("Continuity road candidate enumeration failed");
  return {
    id: `${boundary.id}/ROAD/${digest(`${featureId}/${slot}`)}`,
    boundaryId: boundary.id,
    featureId,
    slot,
    candidate: fallback.candidate,
    t: fallback.t,
    position: fallback.position,
    domain: fallback.domain,
    reliefM: quantize(fallback.reliefM, CONTINUITY_LIMITS.profileQuantizationM),
    coastDistanceM: quantize(fallback.coastDistanceM, CONTINUITY_LIMITS.profileQuantizationM),
    widthM: quantize(7 + sample("ROAD_WIDTH", boundary.id, featureId, slot) * 4, 0.1),
    maxGrade: 0.08,
    fallback: true,
  };
}

function terrainCost(cell: CubeCell) {
  const terrain = macroSampleAt(canonicalCellCenter(cell));
  return (
    (terrain.land ? 0 : 180_000) +
    (terrain.domain === "Lake" ? 220_000 : 0) +
    Math.max(0, terrain.reliefM) * 18
  );
}

function reconstructPath(nodes: Map<string, SearchNode>, targetId: string): CubeCell[] {
  const result: CubeCell[] = [];
  let id: string | undefined = targetId;
  while (id) {
    const node = nodes.get(id);
    if (!node) break;
    result.push(node.cell);
    id = node.previous;
  }
  return result.reverse();
}

/** Bounded A* over coarse continuity cells only. It never requests fine meshes. */
function regionPath(from: CubeCell, to: CubeCell) {
  if (from.id === to.id) return { cells: [from], expansions: 0, fallback: false };
  const target = canonicalCellCenter(to),
    nodes = new Map<string, SearchNode>(),
    open = new Set<string>();
  nodes.set(from.id, {
    cell: from,
    cost: 0,
    score: greatCircleDistance(canonicalCellCenter(from), target),
  });
  open.add(from.id);
  let expansions = 0;
  while (open.size && expansions < CONTINUITY_LIMITS.roadSearchExpansions) {
    const currentId = [...open].sort((a, b) => {
        const na = nodes.get(a)!, nb = nodes.get(b)!;
        return na.score - nb.score || a.localeCompare(b);
      })[0],
      current = nodes.get(currentId)!;
    open.delete(currentId);
    expansions++;
    if (currentId === to.id) {
      const cells = reconstructPath(nodes, currentId);
      if (cells.length <= CONTINUITY_LIMITS.roadRegionLimit)
        return { cells, expansions, fallback: false };
      break;
    }
    const neighbours = Object.values(
      canonicalCellNeighbors(current.cell, WORLD_SEED, CANONICAL_GENERATOR_VERSION),
    );
    for (const next of neighbours) {
      const step = greatCircleDistance(canonicalCellCenter(current.cell), canonicalCellCenter(next)),
        nextCost = current.cost + step + terrainCost(next),
        previous = nodes.get(next.id);
      if (previous && previous.cost <= nextCost) continue;
      nodes.set(next.id, {
        cell: next,
        cost: nextCost,
        score: nextCost + greatCircleDistance(canonicalCellCenter(next), target),
        previous: currentId,
      });
      open.add(next.id);
    }
  }
  // Canonical bounded repair: progressively sample the same great-circle recipe.
  // It is deterministic and capped; it never recursively materializes neighbours.
  const fromCenter = canonicalCellCenter(from),
    toCenter = canonicalCellCenter(to),
    cells: CubeCell[] = [from];
  for (let index = 1; index <= CONTINUITY_LIMITS.roadRegionLimit * 2; index++) {
    const t = index / (CONTINUITY_LIMITS.roadRegionLimit * 2),
      cell = continuityRegionAt(slerp(fromCenter, toCenter, t));
    if (cells.at(-1)!.id !== cell.id) cells.push(cell);
    if (cell.id === to.id) break;
  }
  if (cells.at(-1)!.id !== to.id) cells.push(to);
  return { cells: cells.slice(0, CONTINUITY_LIMITS.roadRegionLimit), expansions, fallback: true };
}

function cacheKey(featureId: string, from: LonLat, to: LonLat, campaignRevision: string) {
  const a = coordinateKey(from), b = coordinateKey(to), pair = a < b ? `${a}|${b}` : `${b}|${a}`;
  return `${WORLD_SEED}/${WORLD_FOUNDATION_VERSION}/ROAD/${featureId}/${pair}/REV/${campaignRevision}`;
}
function cachePut(key: string, value: ContinuityRoadRecipe) {
  if (roadCache.has(key)) roadCache.delete(key);
  roadCache.set(key, value);
  while (roadCache.size > CONTINUITY_LIMITS.cacheEntries) {
    const oldest = roadCache.keys().next().value as string | undefined;
    if (!oldest) break;
    roadCache.delete(oldest);
    metricState.cacheEvictions++;
  }
}

/**
 * Compact road definition/evaluation. Reversing request order changes only the
 * returned point order; shared identity, ports and digests stay identical.
 */
export function continuityRoadRecipe(
  featureId: string,
  from: LonLat,
  to: LonLat,
  campaignRevision = "INITIAL",
): ContinuityRoadRecipe {
  metricState.roadQueries++;
  const key = cacheKey(featureId, from, to, campaignRevision),
    cached = roadCache.get(key);
  if (cached) {
    metricState.cacheHits++;
    roadCache.delete(key);
    roadCache.set(key, cached);
    const forward = coordinateKey(from) <= coordinateKey(to);
    return forward
      ? cached
      : { ...cached, regions: [...cached.regions].reverse(), points: [...cached.points].reverse(), ports: [...cached.ports].reverse() };
  }
  metricState.cacheMisses++;
  const forward = coordinateKey(from) <= coordinateKey(to),
    start = forward ? quantizedPosition(from) : quantizedPosition(to),
    end = forward ? quantizedPosition(to) : quantizedPosition(from),
    startCell = continuityRegionAt(start),
    endCell = continuityRegionAt(end),
    path = regionPath(startCell, endCell),
    ports: ContinuityPort[] = [];
  for (let index = 0; index < path.cells.length - 1; index++) {
    try {
      const boundary = continuityBoundary(path.cells[index], path.cells[index + 1]);
      ports.push(continuityRoadPort(boundary, featureId, index));
    } catch {
      // Canonical repair paths can meet at a corner. A bounded A* path is normally
      // edge-adjacent; if repair produced a diagonal step, no fake port is emitted.
    }
  }
  const foundationDigest = digest(
      [
        WORLD_SEED,
        WORLD_FOUNDATION_VERSION,
        featureId,
        ...path.cells.map((cell) => cell.id),
        ...ports.map((port) => `${port.id}:${port.candidate}:${port.t.toFixed(8)}`),
      ].join("|"),
    ),
    stateDigest = digest(`${foundationDigest}|${campaignRevision}`),
    canonical: ContinuityRoadRecipe = Object.freeze({
      featureId,
      version: WORLD_FOUNDATION_VERSION,
      campaignRevision,
      foundationDigest,
      stateDigest,
      regions: Object.freeze(path.cells.map((cell) => cell.id)),
      points: Object.freeze([start, ...ports.map((port) => port.position), end]),
      ports: Object.freeze(ports),
      searchExpansions: path.expansions,
      fallback: path.fallback || ports.some((port) => port.fallback),
    });
  metricState.searchExpansions += path.expansions;
  metricState.maxSearchExpansions = Math.max(metricState.maxSearchExpansions, path.expansions);
  metricState.queryBytesEstimated +=
    canonical.regions.length * 32 + canonical.points.length * 16 + canonical.ports.length * 96;
  cachePut(key, canonical);
  return forward
    ? canonical
    : { ...canonical, regions: [...canonical.regions].reverse(), points: [...canonical.points].reverse(), ports: [...canonical.ports].reverse() };
}

/** Remote fact query: evaluates definitions only and never creates presentation resources. */
export function continuityRemoteRoadQuery(
  featureId: string,
  from: LonLat,
  to: LonLat,
  campaignRevision = "INITIAL",
) {
  metricState.remoteQueries++;
  return continuityRoadRecipe(featureId, from, to, campaignRevision);
}

export function clearContinuityRecipeCache() {
  roadCache.clear();
}

export function continuityMetrics(): ContinuityMetrics {
  const recipeBytesEstimated = [...roadCache.values()].reduce(
    (sum, recipe) => sum + recipe.regions.length * 32 + recipe.points.length * 16 + recipe.ports.length * 96,
    0,
  );
  return {
    ...metricState,
    cacheEntries: roadCache.size,
    recipeBytesEstimated,
    // Definition/query memory is explicitly separate from presentation memory.
    queryBytesEstimated: metricState.queryBytesEstimated,
    presentationBytes: 0,
    materializedPresentationResources: 0,
  };
}
