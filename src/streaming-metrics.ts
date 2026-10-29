/** On-demand diagnostic samples only. Never feed timing values into SEED or Simulation. */
export type TimingSummary = {
  samples: number;
  latest: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
};

/** Fixed-size ring: no unbounded history or per-frame sorting/allocation. */
export class BoundedTimingSamples {
  private readonly values: Float64Array;
  private next = 0;
  private count = 0;
  private last: number | null = null;

  constructor(capacity = 300) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10_000)
      throw new RangeError("Timing sample capacity must be 1..10000");
    this.values = new Float64Array(capacity);
  }

  record(milliseconds: number | null | undefined): void {
    if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.values[this.next] = milliseconds;
    this.next = (this.next + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
    this.last = milliseconds;
  }

  get samples(): number { return this.count; }

  /** Sort only when diagnostics are requested, never in the render loop. */
  summary(): TimingSummary {
    if (this.count === 0)
      return { samples: 0, latest: null, p50: null, p95: null, p99: null };
    const sorted = Array.from(this.values.subarray(0, this.count)).sort((a, b) => a - b);
    const quantile = (fraction: number) => sorted[Math.max(0, Math.ceil(fraction * this.count) - 1)];
    return { samples: this.count, latest: this.last, p50: quantile(.5), p95: quantile(.95), p99: quantile(.99) };
  }
}


/** Separate fixed-size worker-stage samples by canonical job kind.
 * Mixed coverage/detail p95 cannot identify a hot stage or comparable workload.
 * These timings never affect SEED, Simulation decisions, queues or tile output. */
export class TileWorkerPhaseSamples {
  readonly coverage = {
    baseMs: new BoundedTimingSamples(), groundRefinementMs: new BoundedTimingSamples(),
    decorationMs: new BoundedTimingSamples(), totalMs: new BoundedTimingSamples(),
    naturalMs: new BoundedTimingSamples(), surfaceRefinementMs: new BoundedTimingSamples(),
  };
  readonly detail = {
    baseMs: new BoundedTimingSamples(), groundRefinementMs: new BoundedTimingSamples(),
    decorationMs: new BoundedTimingSamples(), totalMs: new BoundedTimingSamples(),
    naturalMs: new BoundedTimingSamples(), surfaceRefinementMs: new BoundedTimingSamples(),
  };
  record(kind: string | undefined, phase?: {
    baseMs?: number; groundRefinementMs?: number; decorationMs?: number; totalMs?: number;
    naturalMs?: number; surfaceRefinementMs?: number;
  }): void {
    if (!phase || (kind !== "coverage" && kind !== "detail")) return;
    const sample = kind === "detail" ? this.detail : this.coverage;
    sample.baseMs.record(phase.baseMs);
    sample.groundRefinementMs.record(phase.groundRefinementMs);
    sample.decorationMs.record(phase.decorationMs);
    sample.totalMs.record(phase.totalMs);
    sample.naturalMs.record(phase.naturalMs);
    sample.surfaceRefinementMs.record(phase.surfaceRefinementMs);
  }
  summary() {
    const from = (samples: typeof this.coverage) => ({
      baseMs: samples.baseMs.summary(),
      groundRefinementMs: samples.groundRefinementMs.summary(),
      decorationMs: samples.decorationMs.summary(),
      totalMs: samples.totalMs.summary(),
      naturalMs: samples.naturalMs.summary(),
      surfaceRefinementMs: samples.surfaceRefinementMs.summary(),
    });
    return { coverage: from(this.coverage), detail: from(this.detail) };
  }
}

/**
 * Observation-only resident query phases. Keys are canonical requested views;
 * clock and wall-time samples never participate in SEED or Simulation decisions.
 * Up to two queries may overlap; request IDs prevent stale completions stealing a newer sample.
 */
export class ResidentQueryPhaseSamples {
  // Exact count-based diagnosis of one cold resident batch, not an extra
  // timer and not a world/gameplay input. The latest per-query count is
  // kept separately from the first cold query for reproduction.
  private firstColdRouteProbes: import("./simulation.ts").ResidentRouteProbeCounts | null = null;
  private lastRouteProbes: import("./simulation.ts").ResidentRouteProbeCounts | null = null;
  readonly offerToDispatchMs = new BoundedTimingSamples();
  readonly dispatchToResponseMs = new BoundedTimingSamples();
  readonly acceptedResponseMs = new BoundedTimingSamples();
  readonly staleResponseMs = new BoundedTimingSamples();
  readonly workerPreparationWallMs = new BoundedTimingSamples();
  readonly workerQueryWallMs = new BoundedTimingSamples();
  readonly workerIndexBuildWallMs = new BoundedTimingSamples();
  readonly workerNonIndexQueryWallMs = new BoundedTimingSamples();
  readonly workerCandidateLookupWallMs = new BoundedTimingSamples();
  readonly workerResidentFoundationWallMs = new BoundedTimingSamples();
  readonly workerResidentDoorWallMs = new BoundedTimingSamples();
  readonly workerResidentScheduleWallMs = new BoundedTimingSamples();
  readonly workerResidentOvernightRiskWallMs = new BoundedTimingSamples();
  readonly workerResidentOvernightStopsWallMs = new BoundedTimingSamples();
  readonly workerResidentOvernightRoutesWallMs = new BoundedTimingSamples();
  readonly workerResidentGroundingWallMs = new BoundedTimingSamples();
  readonly coldWorkerQueryWallMs = new BoundedTimingSamples();
  readonly warmWorkerQueryWallMs = new BoundedTimingSamples();
  // Per-shard transport observations: do not confuse message scheduling or
  // structured-clone delivery with canonical resident evaluation time.
  readonly mainSendToWorkerMs = new BoundedTimingSamples();
  readonly workerReceiveToSendMs = new BoundedTimingSamples();
  readonly workerSendToMainMs = new BoundedTimingSamples();
  readonly mainSendToResponseMs = new BoundedTimingSamples();
  readonly mainSendToStartNoticeMs = new BoundedTimingSamples();
  readonly mainTransportOutsideWorkerMs = new BoundedTimingSamples();
  // Cross-context epochs may not share a valid order in clock-controlled
  // browser captures. Never discard valid local-clock spans with them.
  private invalidCrossClockSamples = 0;
  private lastSignedCrossClockMs: { mainToWorker: number; workerToMain: number } | null = null;
  private offered?: { key: string; at: number };
  private readonly active = new Map<number, { key: string; at: number; offeredAt?: number }>();
  private accepted = 0;
  private staleViewOrCleared = 0;
  private staleTick = 0;
  private firstAcceptedViewMs: number | null = null;

  offer(key: string, at: number): void {
    if (!key || !Number.isFinite(at) || at < 0) return;
    if (!this.offered || this.offered.key !== key) this.offered = { key, at };
  }

  clearPending(): void { this.offered = undefined; }

  /** The first worker-start notification is read on the main clock. Its
   * delivery can delay observation, so this is an UPPER BOUND on queueing,
   * never a pure measure of worker admission time. */
  recordStartNotice(mainSentEpochMs?: number, mainNoticeEpochMs?: number) {
    if (typeof mainSentEpochMs === "number" && typeof mainNoticeEpochMs === "number" &&
        Number.isFinite(mainSentEpochMs) && Number.isFinite(mainNoticeEpochMs) &&
        mainSentEpochMs >= 0 && mainNoticeEpochMs >= mainSentEpochMs)
      this.mainSendToStartNoticeMs.record(mainNoticeEpochMs - mainSentEpochMs);
  }

  /** Shared performance time origins allow cross-thread epochs to be compared.
   * Missing/out-of-order clocks produce no sample, never a synthetic zero.
   * A shard is observed at its actual send/receive boundaries, not at the
   * earlier admission/dispatch decision or a later merged-batch acceptance. */
  recordTransport(
    timing?: { mainSentEpochMs?: number; workerReceiveEpochMs?: number; workerSendEpochMs?: number },
    mainReceivedEpochMs?: number,
  ): void {
    if (!timing) return;
    const { mainSentEpochMs: sent, workerReceiveEpochMs: arrived, workerSendEpochMs: replied } = timing;
    if (sent === undefined || arrived === undefined || replied === undefined || mainReceivedEpochMs === undefined ||
        ![sent, arrived, replied, mainReceivedEpochMs].every(Number.isFinite) ||
        sent < 0 || arrived < 0 || replied < 0 || mainReceivedEpochMs < 0) return;
    // The worker's own clock always measures actual worker execution; the
    // main clock always measures send-to-response. Never lose either because
    // an external test clock offsets the separate performance origins.
    if (replied >= arrived) this.workerReceiveToSendMs.record(replied - arrived);
    if (mainReceivedEpochMs >= sent) this.mainSendToResponseMs.record(mainReceivedEpochMs - sent);
    // Same-clock durations cancel any constant cross-context epoch offset.
    // Total queue+delivery overhead is measurable, but it cannot assign the
    // two parts individually or infer physical-device performance.
    if (replied >= arrived && mainReceivedEpochMs >= sent &&
        mainReceivedEpochMs - sent >= replied - arrived)
      this.mainTransportOutsideWorkerMs.record((mainReceivedEpochMs - sent) - (replied - arrived));
    this.lastSignedCrossClockMs = { mainToWorker: arrived - sent, workerToMain: mainReceivedEpochMs - replied };
    // A cross-clock interval is a measured latency only if *all* event
    // boundaries are ordered; negative intervals must not turn into zeros.
    if (arrived >= sent && replied >= arrived && mainReceivedEpochMs >= replied) {
      this.mainSendToWorkerMs.record(arrived - sent);
      this.workerSendToMainMs.record(mainReceivedEpochMs - replied);
    } else this.invalidCrossClockSamples++;
  }

  dispatch(id: number, key: string, at: number): void {
    if (!Number.isInteger(id) || !key || !Number.isFinite(at) || at < 0) return;
    const offeredAt = this.offered?.key === key ? this.offered.at : undefined;
    if (offeredAt !== undefined) this.offerToDispatchMs.record(at - offeredAt);
    this.active.set(id, { key, at, offeredAt });
  }

  complete(
    id: number, accepted: boolean, at: number,
    workerPhases?: { preparationMs?: number; queryMs?: number; indexBuildMs?: number;
      candidateLookupMs?: number; foundationMs?: number; doorMs?: number; scheduleMs?: number; overnightRiskMs?: number; overnightStopsMs?: number; overnightRoutesMs?: number; groundingMs?: number;
      routeProbes?: import("./simulation.ts").ResidentRouteProbeCounts },
    wasWarm = false,
  ): void {
    const active = this.active.get(id);
    if (!active || !Number.isFinite(at) || at < active.at) return;
    this.active.delete(id);
    const elapsed = at - active.at;
    this.dispatchToResponseMs.record(elapsed);
    this.workerPreparationWallMs.record(workerPhases?.preparationMs);
    this.workerQueryWallMs.record(workerPhases?.queryMs);
    this.workerIndexBuildWallMs.record(workerPhases?.indexBuildMs);
    // Candidate lookup includes spatial index construction; do not add it to
    // workerIndexBuildWallMs when interpreting per-query wall-clock totals.
    this.workerCandidateLookupWallMs.record(workerPhases?.candidateLookupMs);
    this.workerResidentFoundationWallMs.record(workerPhases?.foundationMs);
    this.workerResidentDoorWallMs.record(workerPhases?.doorMs);
    this.workerResidentScheduleWallMs.record(workerPhases?.scheduleMs);
    this.workerResidentOvernightRiskWallMs.record(workerPhases?.overnightRiskMs);
    this.workerResidentOvernightStopsWallMs.record(workerPhases?.overnightStopsMs);
    this.workerResidentOvernightRoutesWallMs.record(workerPhases?.overnightRoutesMs);
    this.workerResidentGroundingWallMs.record(workerPhases?.groundingMs);
    if (workerPhases?.routeProbes) {
      this.lastRouteProbes = { ...workerPhases.routeProbes };
      if (!wasWarm && !this.firstColdRouteProbes)
        this.firstColdRouteProbes = { ...workerPhases.routeProbes };
    }
    // Includes canonical resident evaluation and any non-index query work.
    if (workerPhases?.queryMs !== undefined && workerPhases.indexBuildMs !== undefined)
      this.workerNonIndexQueryWallMs.record(Math.max(0, workerPhases.queryMs - workerPhases.indexBuildMs));
    (wasWarm ? this.warmWorkerQueryWallMs : this.coldWorkerQueryWallMs).record(workerPhases?.queryMs);
    if (accepted) {
      this.acceptedResponseMs.record(elapsed);
      this.accepted++;
      if (this.firstAcceptedViewMs === null && active.offeredAt !== undefined)
        this.firstAcceptedViewMs = at - active.offeredAt;
      if (this.offered?.key === active.key) this.offered = undefined;
    } else {
      this.staleResponseMs.record(elapsed);
      if (!this.offered || this.offered.key !== active.key) this.staleViewOrCleared++;
      else this.staleTick++;
    }
  }

  summary() {
    return {
      offerToDispatchMs: this.offerToDispatchMs.summary(),
      dispatchToResponseMs: this.dispatchToResponseMs.summary(),
      acceptedResponseMs: this.acceptedResponseMs.summary(),
      staleResponseMs: this.staleResponseMs.summary(),
      workerPreparationWallMs: this.workerPreparationWallMs.summary(),
      workerQueryWallMs: this.workerQueryWallMs.summary(),
      workerIndexBuildWallMs: this.workerIndexBuildWallMs.summary(),
      workerNonIndexQueryWallMs: this.workerNonIndexQueryWallMs.summary(),
      workerCandidateLookupWallMs: this.workerCandidateLookupWallMs.summary(),
      workerResidentFoundationWallMs: this.workerResidentFoundationWallMs.summary(),
      workerResidentDoorWallMs: this.workerResidentDoorWallMs.summary(),
      workerResidentScheduleWallMs: this.workerResidentScheduleWallMs.summary(),
      workerResidentOvernightRiskWallMs: this.workerResidentOvernightRiskWallMs.summary(),
      workerResidentOvernightStopsWallMs: this.workerResidentOvernightStopsWallMs.summary(),
      workerResidentOvernightRoutesWallMs: this.workerResidentOvernightRoutesWallMs.summary(),
      workerResidentGroundingWallMs: this.workerResidentGroundingWallMs.summary(),
      firstColdRouteProbes: this.firstColdRouteProbes,
      lastRouteProbes: this.lastRouteProbes,
      coldWorkerQueryWallMs: this.coldWorkerQueryWallMs.summary(),
      warmWorkerQueryWallMs: this.warmWorkerQueryWallMs.summary(),
      mainSendToWorkerMs: this.mainSendToWorkerMs.summary(),
      workerReceiveToSendMs: this.workerReceiveToSendMs.summary(),
      workerSendToMainMs: this.workerSendToMainMs.summary(),
      mainSendToResponseMs: this.mainSendToResponseMs.summary(),
      mainSendToStartNoticeMs: this.mainSendToStartNoticeMs.summary(),
      mainTransportOutsideWorkerMs: this.mainTransportOutsideWorkerMs.summary(),
      invalidCrossClockSamples: this.invalidCrossClockSamples,
      lastSignedCrossClockMs: this.lastSignedCrossClockMs,
      accepted: this.accepted,
      staleViewOrCleared: this.staleViewOrCleared,
      staleTick: this.staleTick,
      firstAcceptedViewMs: this.firstAcceptedViewMs,
    };
  }
}
