/** On-demand S005 first-graph-answer timings only; never gameplay authority. */
export const SITE_ROUTE_MEASURED_SCALES = ["1/20", "1/50", "1/100", "1/250"] as const;
export const SITE_ROUTE_TIMING_LIMIT = 32;
type Sample = {
  readonly scale: string;
  readonly calculationMs: number;
  readonly ready: boolean;
  displayFrameMs: number | null;
};

function p95(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

/** Per-session, capped history; call only on explicit route requests. */
export function createSiteRouteTimings() {
  const samples = new Map<string, Sample[]>(
    SITE_ROUTE_MEASURED_SCALES.map(scale => [scale, []]),
  );
  return Object.freeze({
    record(scale: string, calculationMs: number, ready: boolean): Sample | null {
      const list = samples.get(scale);
      if (!list || !Number.isFinite(calculationMs) || calculationMs < 0) return null;
      const sample: Sample = { scale, calculationMs, ready, displayFrameMs: null };
      list.push(sample);
      if (list.length > SITE_ROUTE_TIMING_LIMIT) list.shift();
      return sample;
    },
    markFrame(sample: Sample | null, elapsedMs: number, scaleAtFrame: string) {
      // A zoom change before the display opportunity cannot count under the
      // original request scale. Keep the graph calculation sample only.
      if (sample && sample.scale === scaleAtFrame && Number.isFinite(elapsedMs) &&
          elapsedMs >= sample.calculationMs)
        sample.displayFrameMs = elapsedMs;
    },
    snapshot() {
      return Object.freeze(Object.fromEntries(SITE_ROUTE_MEASURED_SCALES.map(scale => {
        const list = samples.get(scale)!,
          frames = list.flatMap(sample => sample.displayFrameMs === null ? [] : [sample.displayFrameMs]);
        return [scale, Object.freeze({
          samples: list.length,
          ready: list.filter(sample => sample.ready).length,
          unavailable: list.filter(sample => !sample.ready).length,
          displayOpportunities: frames.length,
          calculationP95Ms: p95(list.map(sample => sample.calculationMs)),
          displayFrameOpportunityP95Ms: p95(frames),
        })];
      })));
    },
  });
}
