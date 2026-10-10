export type PoliticalPresentation = "flat" | "globe" | "transition";

/** Country borders are a Country-and-closer aid; Realm views stay uncluttered. */
export const POLITICAL_BORDER_MAX_SCALE_DENOMINATOR = 1000;
/** City/village labels become eligible at 1/1000 and remain available inward. */
export const POLITICAL_DETAIL_LABEL_MAX_SCALE_DENOMINATOR = 1000;

/**
 * Presentation-only visibility gate for political overlays.
 *
 * Country/place identity and border geometry remain canonical SEED-derived truth.
 * Projection handoff never changes their visibility: political-atlas.ts projects
 * the same canonical anchors through the flat/globe blend. Only map scale decides
 * whether a border or label class is readable enough to show.
 */
export function politicalOverlayOpacity(
  _presentation: PoliticalPresentation,
  _projectionTransition: number,
  scaleDenominator: number,
  maxScaleDenominator: number,
) {
  return scaleDenominator <= maxScaleDenominator ? 1 : 0;
}
