import {
  CANONICAL_PLANET_DIAMETER,
  canonicalFootprintForHalfHeight,
  halfHeightForCanonicalFootprint,
} from "./planet.ts";

export const HANDOFF_LOCAL_FOOTPRINT = 127_420;
export const HANDOFF_GLOBE_FOOTPRINT = 318_550;
export const HANDOFF_LOCAL_HALF_HEIGHT = halfHeightForCanonicalFootprint(HANDOFF_LOCAL_FOOTPRINT);
export const HANDOFF_GLOBE_HALF_HEIGHT = halfHeightForCanonicalFootprint(HANDOFF_GLOBE_FOOTPRINT);
/** Closest zoom: about 2.7 m of half-height, so a 1.7 m character fills about a third of the screen (RPG close-up). */
export const MIN_HALF_HEIGHT = 0.18;
export const SCALE_LADDER = [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
/** Startup and Home use the exact Hero menu stop, above the wheel zoom clamp. */
export const HERO_HALF_HEIGHT = halfHeightForCanonicalFootprint(CANONICAL_PLANET_DIAMETER * SCALE_LADDER[0] / 10000);

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

/** Nearest scale-ladder stop (the denominator of 1/x) for a zoom level. */
export function scaleValueForHalfHeight(halfHeight: number): number {
  const footprint = canonicalFootprintForHalfHeight(halfHeight);
  const diameter = 1_274_200;
  const denominator = Math.max(SCALE_LADDER[0], Math.min(10000, (footprint / diameter) * 10000));
  let best: number = SCALE_LADDER[0];
  for (const candidate of SCALE_LADDER)
    if (Math.abs(Math.log(candidate / denominator)) < Math.abs(Math.log(best / denominator))) best = candidate;
  return best;
}
export function scaleLabelForHalfHeight(halfHeight: number): string {
  return scaleOptionLabel(scaleValueForHalfHeight(halfHeight));
}
/** Close-up stops read as character views; the rest keep the map-scale notation. */
export function scaleOptionLabel(value: number) {
  return value === .2 ? "Hero" : value === .5 ? "Close" : `1/${value}`;
}
