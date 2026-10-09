/**
 * Deterministic, bounded walking-route planner (WP-S002-004-008).
 *
 * The planner searches a local east-north tangent grid anchored at the start
 * point. Everything it reads comes from a pluggable TerrainSampler (default: the
 * seeded macro-geography authority) plus explicit road/bridge segments, so the
 * same seed + inputs always give the same route. There is no randomness,
 * wall-clock input or view/LOD dependence, and every tie is broken by cell
 * index.
 *
 * Surface rules:
 * - water is impassable unless a legal bridge (<= 120 m) covers the cell;
 * - slopes above CLIFF_SLOPE are impassable, steep or mountainous ground is
 *   "difficult" terrain, everything else is open ground;
 * - a road corridor is graded (cut and fill), so it ignores slope and highland
 *   penalties and is walked at good-road speed.
 *
 * The grid is an approximation: it uses 16 move directions, so a routed length
 * can exceed the true shortest length by roughly 3%.
 * Searches are bounded by cell and expansion caps; larger separations use
 * coarser cells instead of unbounded work.
 */
import { macroSampleAt } from "./macro-geography.ts";
import {
  enuToPosition,
  greatCircleDistance,
  positionToEnu,
  type CanonicalPosition,
  type LonLat,
} from "./planet.ts";
import {
  DIFFICULT_TERRAIN_WALK_SPEED_MPS,
  FASTEST_WALK_SPEED_MPS,
  GOOD_ROAD_WALK_SPEED_MPS,
  OPEN_GROUND_WALK_SPEED_MPS,
  realSecondsForFantasy,
} from "./travel.ts";

export const ROUTE_CELL_MIN_M = 40;
export const ROUTE_MAX_CELLS = 48_000;
export const ROUTE_MAX_EXPANSIONS = 150_000;
export const ROUTE_MAX_SEPARATION_M = 120_000;
export const CLIFF_SLOPE = 0.7;
export const DIFFICULT_SLOPE = 0.25;
export const HIGHLAND_DIFFICULT = 0.35;
export const BRIDGE_MAX_LENGTH_M = 120;

export type SurfaceSample = {
  water: boolean;
  /** Ground height in metres; only differences between cells are used. */
  heightM: number;
  /** 0..1 mountain/highland intensity; high values are difficult to cross. */
  highland: number;
};
export type TerrainSampler = (position: LonLat) => SurfaceSample;
export type RoadSegment = {
  code?: string;
  from: LonLat;
  to: LonLat;
  /** Water cells inside this corridor are crossable. Only honoured for <= 120 m spans. */
  bridge?: boolean;
};
export type RouteSurface = "road" | "bridge" | "open" | "difficult";
export type RouteRequest = {
  from: LonLat;
  to: LonLat;
  roads?: readonly RoadSegment[];
  terrain?: TerrainSampler;
};
export type RouteResult = {
  found: boolean;
  reason?: string;
  geodesicM: number;
  /** Routed path length in metres (grid-approximate). */
  distanceM: number;
  fantasySeconds: number;
  realSeconds: number;
  /** geodesic / fastest walking speed: the best any walk could possibly do. */
  straightLineFantasySeconds: number;
  detourFactor: number;
  points: LonLat[];
  surfaceM: Record<RouteSurface, number>;
  cellSizeM: number;
  expansions: number;
  attempts: number;
};

export const macroTerrainSampler: TerrainSampler = (position) => {
  const sample = macroSampleAt(position);
  return {
    water: !sample.land,
    heightM: sample.reliefM,
    highland: sample.mountainIntensity,
  };
};

const MOVES: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
  [1, 2],
  [1, -2],
  [-1, 2],
  [-1, -2],
];

const KIND_NAMES: readonly RouteSurface[] = ["road", "bridge", "open", "difficult"];
const FLAG_WATER = 1,
  FLAG_HIGHLAND = 2,
  FLAG_ROAD = 4,
  FLAG_BRIDGE = 8;

type Failure = { found: false; reason: string; expansions: number; cellSizeM: number };
type Success = {
  found: true;
  cells: number[];
  /** kinds[k] is the surface of the edge cells[k-1] -> cells[k]; kinds[0] is unused. */
  kinds: RouteSurface[];
  endRoad: boolean;
  expansions: number;
  cellSizeM: number;
  grid: Grid;
};
type Grid = {
  cell: number;
  i0: number;
  j0: number;
  width: number;
  height: number;
};

function emptyRoute(
  geodesicM: number,
  reason: string,
  cellSizeM: number,
  expansions: number,
  attempts: number,
): RouteResult {
  return {
    found: false,
    reason,
    geodesicM,
    distanceM: 0,
    fantasySeconds: 0,
    realSeconds: 0,
    straightLineFantasySeconds: geodesicM / FASTEST_WALK_SPEED_MPS,
    detourFactor: 0,
    points: [],
    surfaceM: { road: 0, bridge: 0, open: 0, difficult: 0 },
    cellSizeM,
    expansions,
    attempts,
  };
}

class MinHeap {
  private readonly f: number[] = [];
  private readonly id: number[] = [];
  get size() {
    return this.f.length;
  }
  private less(a: number, b: number) {
    return this.f[a] < this.f[b] || (this.f[a] === this.f[b] && this.id[a] < this.id[b]);
  }
  private swap(a: number, b: number) {
    [this.f[a], this.f[b]] = [this.f[b], this.f[a]];
    [this.id[a], this.id[b]] = [this.id[b], this.id[a]];
  }
  push(f: number, id: number) {
    this.f.push(f);
    this.id.push(id);
    let i = this.f.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.id[0],
      lastF = this.f.pop()!,
      lastId = this.id.pop()!;
    if (this.f.length) {
      this.f[0] = lastF;
      this.id[0] = lastId;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < this.f.length && this.less(l, m)) m = l;
        if (r < this.f.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax,
    dy = by - ay,
    len2 = dx * dx + dy * dy,
    t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

type LocalRoad = { ax: number; ay: number; bx: number; by: number; bridge: boolean };

function searchOnce(
  origin: CanonicalPosition,
  bEast: number,
  bNorth: number,
  marginM: number,
  roads: readonly RoadSegment[],
  terrain: TerrainSampler,
): Failure | Success {
  const minE = Math.min(0, bEast) - marginM,
    maxE = Math.max(0, bEast) + marginM,
    minN = Math.min(0, bNorth) - marginM,
    maxN = Math.max(0, bNorth) + marginM,
    cell = Math.max(
      ROUTE_CELL_MIN_M,
      Math.ceil(Math.sqrt(((maxE - minE) * (maxN - minN)) / ROUTE_MAX_CELLS)),
    ),
    i0 = Math.floor(minE / cell),
    j0 = Math.floor(minN / cell),
    width = Math.ceil(maxE / cell) - i0 + 1,
    height = Math.ceil(maxN / cell) - j0 + 1,
    total = width * height,
    grid: Grid = { cell, i0, j0, width, height };

  // Roads are converted to the local frame once per attempt and pre-filtered by box.
  const localRoads: LocalRoad[] = [];
  const corridor = cell * 0.75;
  for (const road of roads) {
    const a = positionToEnu({ ...road.from, elevation: 0 }, origin),
      b = positionToEnu({ ...road.to, elevation: 0 }, origin);
    if (
      Math.max(a.east, b.east) < minE - corridor ||
      Math.min(a.east, b.east) > maxE + corridor ||
      Math.max(a.north, b.north) < minN - corridor ||
      Math.min(a.north, b.north) > maxN + corridor
    )
      continue;
    const bridgeLegal =
      !!road.bridge && Math.hypot(b.east - a.east, b.north - a.north) <= BRIDGE_MAX_LENGTH_M;
    localRoads.push({ ax: a.east, ay: a.north, bx: b.east, by: b.north, bridge: bridgeLegal });
  }

  const sampled = new Uint8Array(total),
    flags = new Uint8Array(total),
    heights = new Float32Array(total);
  const indexOf = (i: number, j: number) => (j - j0) * width + (i - i0);
  const inside = (i: number, j: number) =>
    i >= i0 && i < i0 + width && j >= j0 && j < j0 + height;
  const sample = (i: number, j: number): number => {
    const idx = indexOf(i, j);
    if (sampled[idx]) return idx;
    sampled[idx] = 1;
    const east = i * cell,
      north = j * cell,
      position = enuToPosition({ east, north, up: 0 }, origin),
      surface = terrain({ lon: position.lon, lat: position.lat });
    let flag = 0;
    if (surface.water) flag |= FLAG_WATER;
    if (surface.highland >= HIGHLAND_DIFFICULT) flag |= FLAG_HIGHLAND;
    for (const road of localRoads)
      if (distanceToSegment(east, north, road.ax, road.ay, road.bx, road.by) <= corridor) {
        flag |= FLAG_ROAD;
        if (road.bridge) flag |= FLAG_BRIDGE;
      }
    flags[idx] = flag;
    heights[idx] = surface.heightM;
    return idx;
  };
  const passable = (idx: number) =>
    !(flags[idx] & FLAG_WATER) || !!(flags[idx] & FLAG_BRIDGE);

  const startI = 0,
    startJ = 0,
    endI = Math.max(i0, Math.min(i0 + width - 1, Math.round(bEast / cell))),
    endJ = Math.max(j0, Math.min(j0 + height - 1, Math.round(bNorth / cell)));
  const startIdx = sample(startI, startJ),
    endIdx = sample(endI, endJ);
  if (!passable(startIdx)) return { found: false, reason: "start-in-water", expansions: 0, cellSizeM: cell };
  if (!passable(endIdx)) return { found: false, reason: "destination-in-water", expansions: 0, cellSizeM: cell };

  const fastest = FASTEST_WALK_SPEED_MPS;
  const g = new Float64Array(total).fill(Infinity),
    parent = new Int32Array(total).fill(-1),
    parentKind = new Uint8Array(total),
    closed = new Uint8Array(total);
  const heap = new MinHeap();
  const heuristic = (i: number, j: number) =>
    (Math.hypot((endI - i) * cell, (endJ - j) * cell)) / fastest;
  g[startIdx] = 0;
  heap.push(heuristic(startI, startJ), startIdx);

  let expansions = 0;
  while (heap.size) {
    const current = heap.pop();
    if (closed[current]) continue;
    closed[current] = 1;
    if (current === endIdx) {
      const cells: number[] = [],
        kinds: RouteSurface[] = [];
      for (let at = endIdx; at !== -1; at = parent[at]) {
        cells.push(at);
        kinds.push(KIND_NAMES[parentKind[at]]);
      }
      cells.reverse();
      kinds.reverse();
      return {
        found: true,
        cells,
        kinds,
        endRoad: !!(flags[endIdx] & FLAG_ROAD),
        expansions,
        cellSizeM: cell,
        grid,
      };
    }
    if (++expansions > ROUTE_MAX_EXPANSIONS)
      return { found: false, reason: "search-limit", expansions, cellSizeM: cell };
    const ci = (current % width) + i0,
      cj = Math.floor(current / width) + j0;
    for (const [di, dj] of MOVES) {
      const ni = ci + di,
        nj = cj + dj;
      if (!inside(ni, nj)) continue;
      const next = sample(ni, nj);
      if (closed[next] || !passable(next)) continue;
      // Intermediate cells: keeps diagonal/knight moves from cutting water corners.
      const between: number[] = [],
        crossed: { idx: number; i: number; j: number }[] = [];
      if (Math.abs(di) === 1 && Math.abs(dj) === 1) {
        if (!inside(ci + di, cj) || !inside(ci, cj + dj)) continue;
        between.push(sample(ci + di, cj), sample(ci, cj + dj));
      } else if (Math.abs(di) === 2) {
        const mi = ci + di / 2;
        if (!inside(mi, cj) || !inside(mi, nj)) continue;
        crossed.push({ idx: sample(mi, cj), i: mi, j: cj }, { idx: sample(mi, nj), i: mi, j: nj });
      } else if (Math.abs(dj) === 2) {
        const mj = cj + dj / 2;
        if (!inside(ci, mj) || !inside(ni, mj)) continue;
        crossed.push({ idx: sample(ci, mj), i: ci, j: mj }, { idx: sample(ni, mj), i: ni, j: mj });
      }
      // Knight moves pass over the cells they cross: those are walked, so they count too.
      for (const c of crossed) between.push(c.idx);
      if (!between.every(passable)) continue;

      const length = Math.hypot(di, dj) * cell,
        bothRoad = !!(flags[current] & flags[next] & FLAG_ROAD),
        allRoad = bothRoad && between.every((b) => !!(flags[b] & FLAG_ROAD));
      let slope = Math.abs(heights[next] - heights[current]) / length;
      for (const c of crossed)
        slope = Math.max(
          slope,
          Math.abs(heights[c.idx] - heights[current]) / (Math.hypot(c.i - ci, c.j - cj) * cell),
          Math.abs(heights[next] - heights[c.idx]) / (Math.hypot(ni - c.i, nj - c.j) * cell),
        );
      if (!allRoad && slope > CLIFF_SLOPE) continue;
      const difficult =
        !allRoad &&
        (slope > DIFFICULT_SLOPE ||
          !!(flags[current] & FLAG_HIGHLAND) ||
          !!(flags[next] & FLAG_HIGHLAND) ||
          between.some((b) => !!(flags[b] & FLAG_HIGHLAND)));
      const wet =
        !!(flags[current] & FLAG_WATER) ||
        !!(flags[next] & FLAG_WATER) ||
        between.some((b) => !!(flags[b] & FLAG_WATER));
      const kind = wet ? 1 : allRoad ? 0 : difficult ? 3 : 2;
      const speed =
        kind <= 1
          ? GOOD_ROAD_WALK_SPEED_MPS
          : kind === 3
            ? DIFFICULT_TERRAIN_WALK_SPEED_MPS
            : OPEN_GROUND_WALK_SPEED_MPS;
      const cost = g[current] + length / speed;
      if (cost < g[next]) {
        g[next] = cost;
        parent[next] = current;
        parentKind[next] = kind;
        heap.push(cost + heuristic(ni, nj), next);
      }
    }
  }
  return { found: false, reason: "no-legal-route", expansions, cellSizeM: cell };
}

function simplify(points: { east: number; north: number }[], tolerance: number) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1,
      worstD = tolerance;
    for (let k = a + 1; k < b; k++) {
      const d = distanceToSegment(
        points[k].east,
        points[k].north,
        points[a].east,
        points[a].north,
        points[b].east,
        points[b].north,
      );
      if (d > worstD) {
        worstD = d;
        worst = k;
      }
    }
    if (worst !== -1) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/** Shortest legal walking route between two canonical points. Deterministic and bounded. */
export function planRoute(request: RouteRequest): RouteResult {
  const terrain = request.terrain ?? macroTerrainSampler,
    roads = request.roads ?? [],
    geodesicM = greatCircleDistance(request.from, request.to);
  if (geodesicM > ROUTE_MAX_SEPARATION_M)
    return emptyRoute(geodesicM, "separation-exceeds-local-search", 0, 0, 0);
  const origin: CanonicalPosition = { ...request.from, elevation: 0 },
    b = positionToEnu({ ...request.to, elevation: 0 }, origin);
  if (geodesicM < 1) {
    const result = emptyRoute(geodesicM, "", 0, 0, 0);
    return { ...result, found: true, reason: undefined, points: [request.from, request.to], detourFactor: 1 };
  }

  const margins = [
    Math.max(1_200, 0.4 * geodesicM),
    Math.max(3_000, 1.2 * geodesicM),
    Math.max(8_000, 3 * geodesicM),
  ];
  let outcome: Failure | Success | undefined,
    attempts = 0,
    expansions = 0;
  for (const margin of margins) {
    attempts++;
    outcome = searchOnce(origin, b.east, b.north, margin, roads, terrain);
    expansions += outcome.expansions;
    if (outcome.found || outcome.reason !== "no-legal-route") break;
  }
  if (!outcome || !outcome.found)
    return emptyRoute(geodesicM, outcome?.reason ?? "no-legal-route", outcome?.cellSizeM ?? 0, expansions, attempts);

  const { grid, cells, kinds } = outcome;
  const centres = cells.map((idx) => ({
    east: ((idx % grid.width) + grid.i0) * grid.cell,
    north: (Math.floor(idx / grid.width) + grid.j0) * grid.cell,
  }));
  const pathPoints = [...centres.slice(0, -1), { east: b.east, north: b.north }];
  if (centres.length === 1) pathPoints.unshift(centres[0]);

  const surfaceM: Record<RouteSurface, number> = { road: 0, bridge: 0, open: 0, difficult: 0 };
  const speedOf = (kind: RouteSurface) =>
    kind === "road" || kind === "bridge"
      ? GOOD_ROAD_WALK_SPEED_MPS
      : kind === "difficult"
        ? DIFFICULT_TERRAIN_WALK_SPEED_MPS
        : OPEN_GROUND_WALK_SPEED_MPS;
  let distanceM = 0,
    fantasySeconds = 0;
  for (let k = 1; k < centres.length; k++) {
    const length = Math.hypot(
      centres[k].east - centres[k - 1].east,
      centres[k].north - centres[k - 1].north,
    );
    surfaceM[kinds[k]] += length;
    distanceM += length;
    fantasySeconds += length / speedOf(kinds[k]);
  }
  // Final hop from the last cell centre to the exact destination.
  const last = centres[centres.length - 1],
    tail = Math.hypot(b.east - last.east, b.north - last.north),
    tailKind: RouteSurface = outcome.endRoad ? "road" : "open";
  surfaceM[tailKind] += tail;
  distanceM += tail;
  fantasySeconds += tail / speedOf(tailKind);

  const simplified = simplify(pathPoints, grid.cell * 0.5),
    points: LonLat[] = simplified.map((p, k) =>
      k === 0
        ? { lon: request.from.lon, lat: request.from.lat }
        : k === simplified.length - 1
          ? { lon: request.to.lon, lat: request.to.lat }
          : (({ lon, lat }) => ({ lon, lat }))(
              enuToPosition({ east: p.east, north: p.north, up: 0 }, origin),
            ),
    );
  const straightLineFantasySeconds = geodesicM / FASTEST_WALK_SPEED_MPS;
  return {
    found: true,
    geodesicM,
    distanceM,
    fantasySeconds,
    realSeconds: realSecondsForFantasy(fantasySeconds),
    straightLineFantasySeconds,
    detourFactor: distanceM / geodesicM,
    points,
    surfaceM,
    cellSizeM: grid.cell,
    expansions,
    attempts,
  };
}
