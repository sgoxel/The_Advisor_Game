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

  record(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
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
