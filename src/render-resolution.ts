/**
 * Adaptive render resolution: draw at the screen's full native pixel ratio, and step the ratio
 * down only when the device cannot hold a smooth frame rate, back up when it has headroom.
 * Pure function of the measured frame time, so it is easy to test and never touches the world.
 */
export const RESOLUTION_STEP = .25;
/** Average frame time above which the resolution drops (below ~40 fps). */
export const SLOW_FRAME_MS = 25;
/** Average frame time below which the resolution may rise again (above ~55 fps). */
export const FAST_FRAME_MS = 18;
/** Seconds of frames averaged between two decisions. */
export const RESOLUTION_DECISION_SECONDS = 2;

/** The next pixel ratio for `averageFrameMs`, between `min(1, nativeRatio)` and `nativeRatio`. */
export function nextPixelRatio(current: number, averageFrameMs: number, nativeRatio: number) {
  const ceiling = Math.max(.5, nativeRatio), floor = Math.min(1, ceiling);
  if (averageFrameMs > SLOW_FRAME_MS) return Math.max(floor, current - RESOLUTION_STEP);
  if (averageFrameMs < FAST_FRAME_MS) return Math.min(ceiling, current + RESOLUTION_STEP);
  return Math.min(ceiling, Math.max(floor, current));
}
