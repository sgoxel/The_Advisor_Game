import { compareText } from "./compare-text.ts";
import { wrapSourceX } from "./planet.ts";
import type { Resident, QueryStats } from "./simulation.ts";

export type ResidentQuery = { key: string; placeCode: string; x: number; z: number; radius: number; limit: number; tick: number; actors?: boolean };
export type ResidentQueryJob = ResidentQuery & { kind: "residents"; id: number; shard?: { index: number; count: number } };
export type ResidentQueryResult = { residents: Resident[]; query: QueryStats };
/** The initially coherent world may supply resident facts during later zoom
 * refinement; optional current-view detail must not indefinitely starve a
 * bounded query. Only idle existing workers participate. In-flight shards
 * may finish after navigation so the next request can take their place. */
export function residentDispatchAllowed(
  selectionDirty: boolean, worldReady: boolean,
  idleWorkerCount: number, batchStarted: boolean,
): boolean {
  if (idleWorkerCount === 0) return false;
  if (batchStarted) return true;
  return !selectionDirty && worldReady;
}

/** A cold population query builds the settlement index inside its worker.
 * Sharding it onto several cold terrain workers duplicates that expensive
 * SEED-only construction and competes with urgent terrain. Prefer an idle
 * worker that has already served a resident query; otherwise choose the
 * lowest stable idle ID. One query owns one worker/index, with no new workers. */
export function residentWorkerShardPlan(
  idleWorkerIds: readonly number[], warmedWorkerIds: ReadonlySet<number> = new Set(),
) {
  const idle = [...new Set(idleWorkerIds.filter(id => Number.isInteger(id) && id >= 0))]
    .sort((a, b) => a - b);
  const workerId = idle.find(id => warmedWorkerIds.has(id)) ?? idle[0];
  return workerId === undefined ? [] : [{ workerId, shardIndex: 0, count: 1 }];
}

/** Initial actor queries must return authoritative SEED facts before a cold
 * worker evaluates dozens of individually resolved doors and street routes.
 * Keep the first eight in the same deterministic spatial order; no resident
 * gets a synthetic position or bypasses legal path/surface validation.
 * The non-actor inspector retains its existing fact budget. */
export function residentQueryLimitForView(actors: boolean): number {
  return actors ? 8 : 24;
}

/** After an initial indoor-only result, inspect at most one further eight-person
 * batch for a real outdoor actor. Stop as soon as the first street actor is
 * found after the original quota, or when the eight-actor quota is full.
 * This is a deterministic work bound, not permission to invent actors. */
export function residentActorSearchContinues(evaluated: number, outdoorCount: number, limit: number): boolean {
  return limit > 0 && outdoorCount < limit && evaluated < limit * 2 &&
    (outdoorCount === 0 || evaluated < limit);
}

/** Keep only the actually inspected, grounded actor visible while a new nearby
 * population snapshot is pending. It cannot invent a resident or move one
 * into view; a distant pan, indoor state or blocked ground revokes the hold. */
export function selectedResidentVisibleInView(
  resident: Pick<Resident, "x" | "z" | "grounded" | "indoors"> | undefined,
  view: { x: number; z: number; radius: number } | undefined,
): boolean {
  return !!resident && !!view && resident.grounded && !resident.indoors &&
    Number.isFinite(view.radius) && view.radius >= 0 &&
    Math.hypot(wrapSourceX(resident.x - view.x), resident.z - view.z) <= view.radius;
}

/** A small visible resident must still be individually tappable. Screen-space
 * distances are CSS pixels, independent of device pixel ratio or 3D model LOD.
 * Return null outside a minimum 44px target; nearest projected actor wins. */
export function residentActorPickDistance(
  x: number, y: number,
  feet: { x: number; y: number }, head: { x: number; y: number },
): number | null {
  const cx = (feet.x + head.x) * .5, cy = (feet.y + head.y) * .5,
    height = Math.abs(feet.y - head.y),
    halfWidth = Math.max(22, height * .26 + 4),
    halfHeight = Math.max(22, height * .5 + 4);
  if (![x, y, cx, cy, halfWidth, halfHeight].every(Number.isFinite) ||
      Math.abs(x - cx) > halfWidth || Math.abs(y - cy) > halfHeight) return null;
  return Math.hypot(x - cx, y - cy);
}

/** One in-flight job, latest camera request wins. Stale clock/view results never
 * become a visible snapshot; the next request reuses the worker's warm caches. */
export class ResidentQueryQueue {
  private desired?: ResidentQuery;
  private flight?: ResidentQueryJob;
  private sequence = 0;
  private snapshot?: ResidentQueryJob & ResidentQueryResult;
  private maxAgeTicks: number;
  private sampleIntervalTicks: number;
  constructor(maxAgeTicks: number, sampleIntervalTicks = 0) {
    this.maxAgeTicks = maxAgeTicks;
    this.sampleIntervalTicks = sampleIntervalTicks;
  }
  offer(query: ResidentQuery) {
    if (this.desired?.key === query.key && query.tick >= this.desired.tick &&
      this.sampleIntervalTicks > 0 && Math.floor(query.tick / this.sampleIntervalTicks) === Math.floor(this.desired.tick / this.sampleIntervalTicks)) return;
    this.desired = query;
  }
  clear() { this.desired = undefined; this.snapshot = undefined; }
  get busy() { return !!this.flight; }
  readyFor(key: string | undefined, tick = this.desired?.tick) {
    return !!key && this.snapshot?.key === key && tick !== undefined && Math.abs(tick - this.snapshot.tick) <= this.maxAgeTicks;
  }
  get ready() { return this.readyFor(this.desired?.key); }
  get current() {
    return this.ready ? this.snapshot : undefined;
  }
  take(): ResidentQueryJob | undefined {
    if (this.flight || !this.desired || (this.current?.tick === this.desired.tick)) return;
    return this.flight = { ...this.desired, kind: "residents", id: ++this.sequence };
  }
  complete(id: number, result: ResidentQueryResult, currentTick = this.desired?.tick) {
    if (this.flight?.id !== id) return false;
    const finished = this.flight;
    this.flight = undefined;
    if (finished.key !== this.desired?.key || currentTick === undefined || Math.abs(currentTick - finished.tick) > this.maxAgeTicks) return false;
    this.snapshot = { ...finished, ...result };
    return true;
  }
}

/** Reconstruct the same stable first-N query order regardless of worker completion order. */
export function mergeResidentQueries(results: ResidentQueryResult[], limit: number, rank: (resident: Resident) => number): ResidentQueryResult {
  const residents = results.flatMap(result => result.residents).sort((a, b) =>
    compareText(a.code.slice(0, a.code.lastIndexOf("/RESIDENT/")), b.code.slice(0, b.code.lastIndexOf("/RESIDENT/"))) || rank(a) - rank(b)).slice(0, limit);
  return { residents, query: {
    settlements: Math.max(0, ...results.map(result => result.query.settlements)),
    candidateResidents: results.reduce((sum, result) => sum + result.query.candidateResidents, 0),
    evaluatedResidents: results.reduce((sum, result) => sum + result.query.evaluatedResidents, 0),
    returnedResidents: residents.length,
  } };
}


/** Retain a recent nearby snapshot only while the camera still overlaps its
 * bounded source-space search. The same city name is not a valid nearby query
 * after a long pan to another neighbourhood. */
export function currentResidentSnapshot<T extends { placeCode: string; tick: number; x?: number; z?: number; radius?: number }>(
  current: T | undefined, previous: T | undefined, placeCode: string | undefined, tick: number, maxAgeTicks: number,
  view?: Pick<ResidentQuery, "x" | "z" | "radius">,
): T | undefined {
  const relevant = (snapshot: T | undefined) => !!snapshot &&
    snapshot.placeCode === placeCode && tick >= snapshot.tick && tick - snapshot.tick <= maxAgeTicks &&
    (!view || (snapshot.x !== undefined && snapshot.z !== undefined && snapshot.radius !== undefined &&
      Math.hypot(wrapSourceX(snapshot.x - view.x), snapshot.z - view.z) <= Math.min(snapshot.radius, view.radius) * 0.25));
  return relevant(current) ? current : relevant(previous) ? previous : undefined;
}
