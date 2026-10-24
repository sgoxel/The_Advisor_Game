import { compareText } from "./compare-text.ts";
import type { Resident, QueryStats } from "./simulation.ts";

export type ResidentQuery = { key: string; placeCode: string; x: number; z: number; radius: number; limit: number; tick: number };
export type ResidentQueryJob = ResidentQuery & { kind: "residents"; id: number; shard?: { index: number; count: number } };
export type ResidentQueryResult = { residents: Resident[]; query: QueryStats };
/** A completed coarse viewport is sufficient for first resident facts on a multi-worker
 * device. Keep the sole worker for terrain until detail is prepared. Once a batch
 * has started, finish dispatching its shards even if the camera moves so the
 * bounded query can retire and the newest request can replace stale results. */
export function residentDispatchAllowed(
  selectionDirty: boolean, coverageComplete: boolean, detailReady: boolean,
  idleWorkerCount: number, workerCount: number, batchStarted: boolean,
): boolean {
  if (idleWorkerCount === 0) return false;
  if (batchStarted) return true;
  return !selectionDirty && coverageComplete && (detailReady || workerCount > 1);
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


/** A fresh snapshot keeps its world positions during a pan inside the same
 * settlement. A different settlement or stale realm tick cannot be reused. */
export function currentResidentSnapshot<T extends { placeCode: string; tick: number }>(
  current: T | undefined, previous: T | undefined, placeCode: string | undefined, tick: number, maxAgeTicks: number,
): T | undefined {
  const snapshot = current ?? previous;
  return snapshot && snapshot.placeCode === placeCode && tick >= snapshot.tick && tick - snapshot.tick <= maxAgeTicks ? snapshot : undefined;
}
