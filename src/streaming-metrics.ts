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

/**
 * Observation-only resident query phases. Keys are canonical requested views;
 * clock and wall-time samples never participate in SEED or Simulation decisions.
 * Exactly one worker query can be in flight; latest camera offer wins.
 */
export class ResidentQueryPhaseSamples {
  readonly offerToDispatchMs = new BoundedTimingSamples();
  readonly dispatchToResponseMs = new BoundedTimingSamples();
  readonly acceptedResponseMs = new BoundedTimingSamples();
  readonly staleResponseMs = new BoundedTimingSamples();
  readonly workerPreparationWallMs = new BoundedTimingSamples();
  readonly workerQueryWallMs = new BoundedTimingSamples();
  readonly workerIndexBuildWallMs = new BoundedTimingSamples();
  readonly workerNonIndexQueryWallMs = new BoundedTimingSamples();
  readonly coldWorkerQueryWallMs = new BoundedTimingSamples();
  readonly warmWorkerQueryWallMs = new BoundedTimingSamples();
  private offered?: { key: string; at: number };
  private active?: { id: number; key: string; at: number; offeredAt?: number };
  private accepted = 0;
  private staleViewOrCleared = 0;
  private staleTick = 0;
  private firstAcceptedViewMs: number | null = null;

  offer(key: string, at: number): void {
    if (!key || !Number.isFinite(at) || at < 0) return;
    if (!this.offered || this.offered.key !== key) this.offered = { key, at };
  }

  clearPending(): void { this.offered = undefined; }

  dispatch(id: number, key: string, at: number): void {
    if (!Number.isInteger(id) || !key || !Number.isFinite(at) || at < 0) return;
    const offeredAt = this.offered?.key === key ? this.offered.at : undefined;
    if (offeredAt !== undefined) this.offerToDispatchMs.record(at - offeredAt);
    this.active = { id, key, at, offeredAt };
  }

  complete(
    id: number, accepted: boolean, at: number,
    workerPhases?: { preparationMs?: number; queryMs?: number; indexBuildMs?: number },
    wasWarm = false,
  ): void {
    if (!this.active || this.active.id !== id || !Number.isFinite(at) || at < this.active.at) return;
    const elapsed = at - this.active.at;
    this.dispatchToResponseMs.record(elapsed);
    this.workerPreparationWallMs.record(workerPhases?.preparationMs);
    this.workerQueryWallMs.record(workerPhases?.queryMs);
    this.workerIndexBuildWallMs.record(workerPhases?.indexBuildMs);
    // Includes canonical resident evaluation and any non-index query work.
    if (workerPhases?.queryMs !== undefined && workerPhases.indexBuildMs !== undefined)
      this.workerNonIndexQueryWallMs.record(Math.max(0, workerPhases.queryMs - workerPhases.indexBuildMs));
    (wasWarm ? this.warmWorkerQueryWallMs : this.coldWorkerQueryWallMs).record(workerPhases?.queryMs);
    if (accepted) {
      this.acceptedResponseMs.record(elapsed);
      this.accepted++;
      if (this.firstAcceptedViewMs === null && this.active.offeredAt !== undefined)
        this.firstAcceptedViewMs = at - this.active.offeredAt;
      if (this.offered?.key === this.active.key) this.offered = undefined;
    } else {
      this.staleResponseMs.record(elapsed);
      if (!this.offered || this.offered.key !== this.active.key) this.staleViewOrCleared++;
      else this.staleTick++;
    }
    this.active = undefined;
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
      coldWorkerQueryWallMs: this.coldWorkerQueryWallMs.summary(),
      warmWorkerQueryWallMs: this.warmWorkerQueryWallMs.summary(),
      accepted: this.accepted,
      staleViewOrCleared: this.staleViewOrCleared,
      staleTick: this.staleTick,
      firstAcceptedViewMs: this.firstAcceptedViewMs,
    };
  }
}
