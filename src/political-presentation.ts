export type PoliticalPresentation = "flat" | "globe" | "transition";

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Presentation-only continuity envelope for political overlays.
 *
 * Country/place identity and border geometry remain canonical SEED-derived truth.
 * Projection handoff may only fade their DOM/SVG presentation; it must never make
 * them pop off merely because the renderer entered the globe/local blend band.
 */
export function politicalOverlayOpacity(
  presentation: PoliticalPresentation,
  projectionTransition: number,
  scaleDenominator: number,
  maxScaleDenominator: number,
) {
  if (scaleDenominator > maxScaleDenominator || presentation === "globe") return 0;
  if (presentation === "flat") return 1;
  const transition = clamp01(projectionTransition);
  // Retain full local readability through the start of handoff, then fade over
  // most of the blend. Near the globe endpoint the layer is already invisible,
  // so entering the final globe state cannot create a perceptual pop.
  return 1 - smoothstep(0.12, 0.92, transition);
}
