import { compareText } from "./compare-text.ts";
import { wrapSourceX } from "./planet.ts";
import type { Resident, QueryStats } from "./simulation.ts";

/** Camera frame rate must never advance a SEED actor ahead of Simulation time.
 * Clock-tick interpolation is stable on reload, pause, frozen screenshot,
 * worker handoff, and delayed frames; timing never changes the physical route. */
export function residentMotionFraction(
  currentTick: number, sourceTick: number, ticksPerRealSecond: number,
): number {
  if (!Number.isFinite(currentTick) || !Number.isFinite(sourceTick) ||
      !Number.isFinite(ticksPerRealSecond) || ticksPerRealSecond <= 0) return 0;
  return Math.max(0, Math.min(1, (currentTick - sourceTick) / ticksPerRealSecond));
}

export type ResidentQuery = { key: string; placeCode: string; x: number; z: number; radius: number; limit: number; tick: number; actors?: boolean };
export type ResidentQueryJob = ResidentQuery & { kind: "residents"; id: number; shard?: { index: number; count: number }; mainSentEpochMs?: number; routeProbes?: boolean };
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

/** Before first coherent terrain, use one idle worker for the first actual
 * resident query. If a terrain worker is already generating required coverage,
 * that worker remains untouched; otherwise reserve one idle worker AND one
 * admission slot for the first terrain tile. Never preempt the only worker.
 * Renderer readiness still gates actor presentation. */
export function residentColdQueryCanStart(
  selectionDirty: boolean, halfHeight: number,
  idleWorkerCount: number, inUse: number, admissionLimit: number,
  terrainInFlight: number,
): boolean {
  const reserve = terrainInFlight > 0 ? 0 : 1;
  return !selectionDirty && Number.isFinite(halfHeight) && halfHeight < 20 &&
    idleWorkerCount > reserve && admissionLimit - inUse > reserve;
}

/** A precomputed actor result remains unconsumed for presentation until
 * coherent terrain allows actual sprites. Inspector-only results still mark
 * their usual snapshot revision immediately. */
export function residentActorSnapshotMayMarkPresented(actorsVisible: boolean, queryActors: boolean): boolean {
  return actorsVisible || !queryActors;
}

/** Split ordinary cold resident facts across at most two existing idle
 * workers; each owns exactly its own SEED index and legal route checks.
 * Actor queries retain a single worker so progressive real outdoor facts arrive
 * in canonical order, independently of transient worker availability.
 * No new workers or direct actor actions. */
export function residentWorkerShardPlan(
  idleWorkerIds: readonly number[], warmedWorkerIds: ReadonlySet<number> = new Set(),
  prioritizeActors = false,
) {
  const idle = [...new Set(idleWorkerIds.filter(id => Number.isInteger(id) && id >= 0))]
    .sort((a, b) => a - b);
  const warm = idle.filter(id => warmedWorkerIds.has(id));
  const selected = (warm.length ? warm : idle).slice(0, prioritizeActors ? 1 : 2);
  return selected.map((workerId, shardIndex) => ({
    workerId, shardIndex, count: selected.length,
  }));
}

/** Reuse the resident worker's expensive cold index when other workers can
 * still perform terrain jobs. Never withhold the only idle worker from mandatory
 * terrain: fall back to previous LIFO selection if all available are warmed.
 * This only chooses which existing worker gets a job, never what SEED builds. */
export function terrainWorkerIndexAvoidingWarmResident(
  idleWorkerIds: readonly number[], warmResidentWorkerIds: ReadonlySet<number>,
): number {
  for (let i = idleWorkerIds.length - 1; i >= 0; i--)
    if (!warmResidentWorkerIds.has(idleWorkerIds[i])) return i;
  return idleWorkerIds.length - 1;
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

/** Place the world-anchored selected-resident caption away from the inspector
 * in tall viewports. Positioning alone changes; actor and identity stay fixed.
 * No per-frame DOM geometry reads or camera-dependent Simulation behavior. */
export function residentLabelRightOfActor(x: number, width: number, height: number): boolean {
  return x < width - 260 && !(height > width && x >= width * .36);
}

/** The owned-door label is a DOM overlay, not physical geometry. Suppress
 * it anywhere along the original resident's *actual projected body*; checking
 * only head-to-door distance hid the returning 2D resident behind the label
 * while its canonical feet were exactly on the doorway. No actor movement. */
export function ownedDoorLabelClearOfResident(
  door: { x: number; y: number },
  feet: { x: number; y: number },
  head: { x: number; y: number },
  clearancePx = 48,
): boolean {
  const values = [door.x, door.y, feet.x, feet.y, head.x, head.y, clearancePx];
  if (!values.every(Number.isFinite) || clearancePx < 0) return false;
  const dx = head.x - feet.x, dy = head.y - feet.y, lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 0
    ? Math.max(0, Math.min(1, ((door.x - feet.x) * dx + (door.y - feet.y) * dy) / lengthSq))
    : 0;
  return Math.hypot(door.x - feet.x - dx * t, door.y - feet.y - dy * t) > clearancePx;
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

/** Previously validated stationary NPCs may remain in the next actual
 * viewport after a wider pan. Overlap is geometric, not an arbitrary
 * quarter-radius camera-motion threshold or a new Simulation authority.
 * The caller separately checks every NPC's legal ground, unchanged routine,
 * local day and inclusion in the requested view. */
export function residentQueryAreasOverlap(
  previous: Pick<ResidentQuery, "x" | "z" | "radius">,
  current: Pick<ResidentQuery, "x" | "z" | "radius">,
): boolean {
  if (![previous.x, previous.z, previous.radius, current.x, current.z, current.radius].every(Number.isFinite) ||
      previous.radius <= 0 || current.radius <= 0) return false;
  return Math.hypot(wrapSourceX(previous.x - current.x), previous.z - current.z) <=
    previous.radius + current.radius;
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

/** At most two bounded requests: an obsolete in-flight camera query may
 * finish while the latest view uses another already-idle worker. Each query's
 * actor ordering and Simulation validations stay inside its own worker.
 * Responses are accepted only for the current view/clock, never by arrival order. */
export class ResidentQueryQueue {
  private desired?: ResidentQuery;
  private readonly flights = new Map<number, ResidentQueryJob>();
  private sequence = 0;
  private snapshot?: ResidentQueryJob & ResidentQueryResult & { partial?: boolean };
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
  get busy() { return this.flights.size > 0; }
  /** A first fact may update inspection, but cannot complete/release its worker
   * or alter the canonical final batch. Ignore superseded camera/tick messages. */
  acceptsPreview(id: number, currentTick = this.desired?.tick) {
    const flight = this.flights.get(id);
    return !!flight && flight.key === this.desired?.key &&
      currentTick !== undefined && Math.abs(currentTick - flight.tick) <= this.maxAgeTicks;
  }
  readyFor(key: string | undefined, tick = this.desired?.tick) {
    // Partial discoveries may already be rendered; they are not a completed
    // current-view population or a valid 100%-ready indicator.
    return !!key && !this.snapshot?.partial && this.snapshot?.key === key &&
      tick !== undefined && Math.abs(tick - this.snapshot.tick) <= this.maxAgeTicks;
  }
  get ready() { return this.readyFor(this.desired?.key); }
  /** A prior fully validated camera result is eligible only after the
   * renderer confirms overlap and freshness for its current source view. */
  get latest() { return this.snapshot; }
  get current() {
    const snapshot = this.snapshot;
    return snapshot && snapshot.key === this.desired?.key && this.desired &&
      Math.abs(this.desired.tick - snapshot.tick) <= this.maxAgeTicks ? snapshot : undefined;
  }
  take(allowLatestBesideObsolete = false): ResidentQueryJob | undefined {
    if (!this.desired || this.current?.tick === this.desired.tick) return;
    if (this.flights.size >= (allowLatestBesideObsolete ? 2 : 1)) return;
    // Never duplicate a still-computing view; bounded overtaking is only for
    // a different focus, never for a newer tick at the same expensive focus.
    if ([...this.flights.values()].some(job => job.key === this.desired!.key)) return;
    const job: ResidentQueryJob = { ...this.desired, kind: "residents", id: ++this.sequence };
    this.flights.set(job.id, job);
    return job;
  }
  /** Progressive authentic outdoor actors from the current worker only. */
  appendPartial(id: number, residents: readonly Resident[], currentTick = this.desired?.tick) {
    const flight = this.flights.get(id);
    if (!flight?.actors || !this.desired || flight.key !== this.desired.key ||
        currentTick === undefined || Math.abs(currentTick - flight.tick) > this.maxAgeTicks ||
        residents.length === 0) return false;
    const previous = this.snapshot?.id === id ? this.snapshot.residents : [];
    const seen = new Set(previous.map(resident => resident.code));
    const incoming = residents.filter(resident => {
      if (!resident.grounded || resident.indoors || seen.has(resident.code)) return false;
      seen.add(resident.code);
      return true;
    });
    if (!incoming.length) return false;
    const all = [...previous, ...incoming];
    this.snapshot = { ...flight, residents: all, partial: true, query: {
      settlements: 0, candidateResidents: 0, evaluatedResidents: 0, returnedResidents: all.length,
    } };
    return true;
  }
  complete(id: number, result: ResidentQueryResult, currentTick = this.desired?.tick) {
    const finished = this.flights.get(id);
    if (!finished) return false;
    this.flights.delete(id);
    if (finished.key !== this.desired?.key || currentTick === undefined || Math.abs(currentTick - finished.tick) > this.maxAgeTicks) return false;
    this.snapshot = { ...finished, ...result };
    return true;
  }
}

/** Previously validated stationary outdoor actors keep their physical
 * post only within the same original local day and schedule interval.
 * Moving/blocked/indoor facts cannot be reused as stationary scenery. */
export function residentStationaryWithinActivity(
  resident: Pick<Resident, "grounded" | "indoors" | "activity" | "activityStart" | "activityEnd" | "travelProgress" | "route">,
  originalDay: number, currentDay: number, currentLocalSecond: number,
): boolean {
  return originalDay === currentDay &&
    resident.grounded && !resident.indoors &&
    resident.activity !== "commute" && resident.travelProgress === undefined &&
    !resident.route.startsWith("BLOCKED:") &&
    currentLocalSecond >= resident.activityStart &&
    currentLocalSecond < resident.activityEnd;
}

/** Count only actually running resident shards in the shared streaming queue.
 * Planned but not yet submitted shards cannot consume a worker slot. */
export function activeResidentWorkers(batches: Iterable<{ count: number; completed: Set<number>; unsent: Set<number> }>): number {
  let occupied = 0;
  for (const batch of batches) occupied += batch.count - batch.completed.size - batch.unsent.size;
  return occupied;
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
