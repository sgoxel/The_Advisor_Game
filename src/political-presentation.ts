/** Small props and people are shown only closer than displayed 1/2. Visibility never evicts their cache. */
export const SETTLEMENT_SMALL_DETAIL_FROM_SCALE = 2;
export const settlementSmallDetailsVisible = (scale: number) => scale > 0 && scale < SETTLEMENT_SMALL_DETAIL_FROM_SCALE;
/** Settlement meshes stay cached while icons own overview presentation. */
export const SETTLEMENT_ICON_FROM_SCALE = 5;
export function politicalScaleDenominator(label:string):number {
  if (label === "Hero") return .2;
  if (label === "Close") return .5;
  const match = /1\/(\d+(?:\.\d+)?)/.exec(label);
  return match ? Number(match[1]) : 10_000;
}

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
