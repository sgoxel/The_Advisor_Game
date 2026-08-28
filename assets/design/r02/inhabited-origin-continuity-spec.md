# R02-T19 Inhabited Origin and Terrain Continuity Presentation

Issue: #114
Role owner: Designer
Authority: presentation only; Simulation remains authoritative.

## Purpose

Refine the integrated origin-village, NPC-presence, and multi-region presentation so the starting settlement reads as inhabited and terrain continuation reads as one continuous world rather than stitched rectangular maps.

## Visual rules

- Keep the strategic map visually dominant at every supported viewport.
- Emphasize the origin settlement with spatial composition, paths, clustered buildings, and subtle boundary emphasis rather than a large modal or dashboard takeover.
- Avoid hard rectangular biome/region borders. Prefer overlapping vegetation, terrain-detail variation, roads, waterways, and irregular transition bands that cross region boundaries.
- NPC presence must remain readable at normal gameplay zoom without excessive label clutter. Use a consistent high-contrast marker ring plus role-specific shape/glyph and text label at higher zoom.
- Never rely on color alone for entity or path meaning. Pair color with outline, pattern, shape, dash, glyph, or text.
- Roads use a continuous textured/dashed center treatment through region boundaries. Water uses continuous width/highlight treatment rather than per-region resets.
- Settlement buildings use coherent medieval-fantasy silhouettes and shared material families while retaining enough roof/form variation to avoid copy-paste repetition.

## Zoom behavior

- Far zoom: show settlement massing, major roads/water, forest/elevation silhouettes; hide individual NPC labels.
- Mid zoom: show NPC markers and selected/high-priority role labels; keep building/path hierarchy clear.
- Near zoom: show full visible NPC role labels and stronger path/building detail without covering adjacent entities.

## Responsive behavior

- Desktop: full map canvas remains primary; supporting panels may coexist without covering the origin focal area.
- Tablet: retain map-first composition and priority labels; lower-priority entity labels may collapse.
- Phone portrait/landscape: map remains the largest interactive surface; show compact NPC glyphs and only the selected/high-priority label when density would overlap.

## Accessibility

- Minimum critical marker/text contrast target: WCAG AA where HTML/SVG text is used.
- NPCs use outline + glyph + optional label, not color alone.
- Roads and water differ by both geometry/pattern and color.
- Focus/selection must add an outline or shape change rather than hue-only treatment.
- Decorative texture must not obscure interaction highlights or selected-tile boundaries.

## Performance constraints

- Reuse marker/building geometry and atlas-friendly assets where possible.
- Cull low-priority labels by zoom and viewport density.
- Do not require animated fog, particles, or physically accurate moving shadows for this checkpoint.
- Avoid presentation logic that requires full-detail simulation of off-screen regions.

## Independently testable evidence

Prototype: `assets/design/r02/inhabited-origin-continuity-prototype.svg`

Independent Tester should verify:
1. Prototype is valid vector SVG with accessible title/description.
2. Origin village is visually identifiable as an inhabited settlement, not isolated map markers.
3. Roads/water/vegetation visibly cross the composition without rectangular reset cues.
4. Multiple NPC markers use non-color-only cues and remain distinguishable.
5. Desktop/tablet/phone rules explicitly preserve map primacy and reduce label density rather than shrinking the map behind panels.
6. No element in this design claims or changes Simulation authority or adds direct protagonist/NPC controls.

## Integration boundary

This Designer deliverable defines presentation assets and visual behavior only. Runtime rendering integration, authoritative region/time/world state, navigation, and Simulation behavior remain Coder-owned tasks unless separately scoped by Planner.
