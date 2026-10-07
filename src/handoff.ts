import {
  canonicalFootprintForHalfHeight,
  halfHeightForCanonicalFootprint,
} from "./planet.ts";

export const HANDOFF_LOCAL_FOOTPRINT = 127_420;
export const HANDOFF_GLOBE_FOOTPRINT = 318_550;
export const HANDOFF_LOCAL_HALF_HEIGHT = halfHeightForCanonicalFootprint(HANDOFF_LOCAL_FOOTPRINT);
export const HANDOFF_GLOBE_HALF_HEIGHT = halfHeightForCanonicalFootprint(HANDOFF_GLOBE_FOOTPRINT);
export const SCALE_LADDER = [10, 20, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

/**
 * The local mesh is authoritative at the inner anchor, but it becomes a coarse,
 * disposable LOD very quickly as the footprint grows. Let the already-prepared
 * globe surface take visual ownership early enough that those coarse mesh seams
 * cannot dominate the handoff. 0.998 deliberately stays below the runtime's
 * full-globe threshold; only the canonical 1/2500 anchor returns exactly 1.
 */
const VISUAL_BLEND_POWER = 10;
const ALMOST_GLOBE = 0.998;

/** Presentation-only globe blend derived solely from continuous zoom. */
export function projectionTransitionForHalfHeight(halfHeight: number): number {
  if (halfHeight <= HANDOFF_LOCAL_HALF_HEIGHT) return 0;
  if (halfHeight >= HANDOFF_GLOBE_HALF_HEIGHT) return 1;
  const a = Math.log(HANDOFF_LOCAL_HALF_HEIGHT);
  const b = Math.log(HANDOFF_GLOBE_HALF_HEIGHT);
  const t = Math.max(0, Math.min(1, (Math.log(halfHeight) - a) / (b - a)));
  return Math.min(ALMOST_GLOBE, 1 - (1 - t) ** VISUAL_BLEND_POWER);
}

/** Reversible easing: changing the target mid-transition simply changes direction. */
export function advanceProjectionTransition(current: number, target: number, dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return current;
  const factor = 1 - Math.exp(-dt / 0.16);
  const next = current + (target - current) * factor;
  return Math.abs(target - next) < 0.001 ? target : next;
}

export function scaleLabelForHalfHeight(halfHeight: number): string {
  const footprint = canonicalFootprintForHalfHeight(halfHeight);
  const diameter = 1_274_200;
  const denominator = Math.max(10, Math.min(10000, (footprint / diameter) * 10000));
  let best: number = SCALE_LADDER[0];
  for (const candidate of SCALE_LADDER)
    if (Math.abs(Math.log(candidate / denominator)) < Math.abs(Math.log(best / denominator))) best = candidate;
  return `1/${best}`;
}
