# R01 Strategic Map Visual Hierarchy Specification

Issue: #65 / R01-T08  
Owner: Graphic Designer Worker  
Integration target: #66 (Coder Worker)

## Purpose

Refine the current v155 strategic map as the primary living-world surface while preserving the simulation boundary. This specification is presentation guidance only: it does not create authoritative locations, resources, people, outcomes, movement, or campaign state.

## Visual hierarchy

1. **World geometry first.** Terrain and elevation occupy the strongest continuous visual layer. Keep texture contrast moderate so roads, settlements, location cues, and inspection states remain readable.
2. **Travel structure second.** Roads and paths use a light/dark paired edge treatment rather than color alone. At normal zoom they should read as continuous routes without becoming brighter than the selected/current-location cue.
3. **Settlements and landmarks third.** Give settlement footprints a subtle neutral outline/grounding shadow plus a small shape marker at low zoom. Settlement importance must be conveyed by size/silhouette as well as hue.
4. **Autonomous protagonist/current location fourth.** Use the `current-location` symbol from `strategic-map-symbols.svg`: a ring + diamond + center dot. It identifies where the protagonist currently is; it is not a destination button and must never visually suggest click-to-command movement.
5. **Inspection state fifth.** Use the `inspection` symbol: four corner brackets around the inspected tile/object. Pair it with persistent inspection text/panel content on touch layouts. Hover may supplement inspection but must never be the only source of information.
6. **UI chrome last.** Top/bottom controls should remain visually quieter than the map. Prefer translucent dark surfaces and compact controls; avoid expanding dashboard panels over the world unless the user explicitly opens them.

## Elevation and terrain

- Preserve organic elevation boundaries from #59; do not reintroduce rounded plate styling.
- Exposed walls should be darker than top terrain and separated by luminance/edge direction, not a saturated terrain-specific color.
- Use relief highlights sparingly. Roads crossing elevation changes must retain continuous silhouette.
- Avoid heavy outlines around every tile. Grid/debug overlays are optional technical views, not the default visual hierarchy.

## Roads, water, settlements

- Roads: paired outer/inner strokes or equivalent geometry. Recommended minimum apparent width at normal desktop zoom: 3 px outer / 1.5 px inner; on high-density/touch presentation preserve equivalent perceptual width.
- Water: distinguish from land with value, surface texture, and shoreline edge, not blue hue alone.
- Settlements: combine footprint/structure silhouette with a neutral outline. At reduced zoom, allow a small geometric settlement marker rather than relying on tiny building texture detail.

## Protagonist and location semantics

- Current protagonist location: ring + diamond + center point. Recommended screen-space target is 28–34 px on desktop/tablet and at least 36 px visual diameter on phone.
- The marker must not pulse like a command target, use a waypoint arrow, or display imperative wording such as “move here”.
- If a path is shown before autonomous resolution, render it as a dashed/non-binding preview and label it as advisory/preview state in the runtime integration.

## Selection and inspection

- Selection/inspection uses corner brackets plus a small panel/text label. Do not encode selected state solely by recoloring a tile.
- Keyboard focus on map-adjacent controls must have a visible outline at least 2 px thick with clear offset.
- Touch inspection must be reachable with a single tap and remain visible after pointer hover ends.
- Avoid permanent full-tile opaque overlays that hide terrain or world objects.

## Minimap relationship

- Minimap viewport uses a rectangular outline with contrasting inner/outer edge so it survives mixed terrain colors.
- Current protagonist location uses the same diamond/ring visual language at simplified scale.
- Minimap symbols are orientation/context aids only; they do not independently establish simulation truth.

## Responsive behavior

### Desktop
- Map remains dominant between compact top and bottom ribbons.
- Inspection information may coexist beside character/dialog/minimap panels, but must not reduce the map to a secondary dashboard region.

### Tablet
- Preserve map-first layout. Collapse low-priority labels before reducing map interaction area.
- Maintain at least 44 px interactive targets for touch-facing controls.

### Phone portrait
- Map remains the primary visible surface. Bottom panels use the existing tab/overlay pattern rather than permanently consuming most of the viewport.
- Current-location and inspection symbols must remain legible without hover.

### Phone landscape
- Keep top chrome shallow and bottom panel footprint compact. Do not cover the protagonist/current inspection with fixed UI where avoidable.

## Accessibility

- Every important map state has at least two cues: shape/geometry plus contrast/text/state.
- Do not depend on red/green or any hue pair to distinguish state.
- Hover is supplementary only.
- Maintain visible keyboard focus for controls and persistent inspection for touch.
- Decorative motion should respect reduced-motion preferences; current-location identity does not require animation.

## Performance and asset policy

- Prefer CSS/canvas geometry and compact SVG symbols over additional raster overlays.
- `strategic-map-symbols.svg` contains genuine vector paths/shapes only and no embedded image payload.
- Do not duplicate the existing multi-megabyte terrain textures for UI states.
- Keep marker effects screen-space simple: no blur stacks, particle effects, or continuous animation is required for R01.

## Coder integration notes for #66

The Coder may implement these cues in the existing canvas/UI runtime without changing simulation semantics. Recommended integration order:

1. Current-location symbol/geometry.
2. Inspection corner-bracket state with persistent touch-visible information.
3. Road/settlement silhouette hierarchy.
4. Minimap matching location/viewport language.
5. Responsive/focus refinements.

Runtime integration must preserve camera pan/zoom, seeded map generation, localization, minimap behavior, and the removal of direct protagonist movement control from #64. If a requirement cannot be integrated without changing Planner-owned scope or simulation behavior, request Planner revision rather than expanding this design specification.
