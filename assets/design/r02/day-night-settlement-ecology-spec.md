# R02 Day/Night, Settlement Diversity and Ecology Presentation

Issue: #128
Role owner: Designer
Authority: presentation only; Simulation remains authoritative.

## Purpose

Define a coherent map-first presentation for the authoritative R02 day/night state, deterministic settlement/environment diversity and Simulation-backed ecology without turning visual state into gameplay truth or adding direct-control affordances.

## Authoritative inputs this design consumes

- `Game.GameTime.phase` / `daylight` are Simulation-owned. The presentation must visibly distinguish the 05:00 dawn/daylight transition and the 22:00 darkness/night transition without redefining those boundaries.
- Settlement categories are Simulation-owned: village, town, city, fortified-town and castle.
- Environment composition is Simulation-owned and may include forest, hills, mountains, streams, lakes/rivers and coasts plus road/bridge continuity.
- Ecology identity/location/state is Simulation-owned. Presentation may depict domestic, wild and original fantasy categories, but must not invent creature existence, position, behavior or authority.

## Day/night visual language

### Dawn / 05:00 transition

- Use a low-angle warm horizon lift, reduced but recovering ambient brightness and a clearly visible `DAWN` icon/text treatment where time status is shown.
- Terrain, roads, water, buildings, NPCs and ecology markers remain readable during the transition; do not wash out selection/focus outlines.
- Dawn meaning is communicated with both luminance change and a sun-rise glyph/text cue, not color alone.

### Daylight

- Preserve current terrain readability and the strategic map as the dominant surface.
- Keep contrast sufficient for roads, settlement silhouettes, NPC/creature markers, selection and focus states.
- Decorative lighting must not alter Simulation values or obscure map geometry.

### Night / 22:00 transition

- Darken ambient scene luminance while maintaining readable silhouettes, roads, water and interaction boundaries.
- Use a moon/night glyph plus explicit `NIGHT` text where time status is shown; darkness is not communicated by hue alone.
- Important gameplay-relevant markers use outline/shape/glyph treatment so they remain distinguishable under reduced brightness.
- Physically accurate moving shadows, dynamic global illumination, volumetric fog and particles are not required for this checkpoint.

## Settlement visual hierarchy

Settlement type must be distinguishable by massing, silhouette and structural cues in addition to material/color:

- **Village** — small clustered homes, one modest civic/market landmark, open edges and rural paths.
- **Town** — denser clustered blocks, market/workshop rhythm and stronger primary roads.
- **City** — multiple dense districts, stronger civic center silhouette and broader road hierarchy.
- **Fortified town** — town massing plus visible wall/gate perimeter cue.
- **Castle** — keep/tower silhouette plus wall/gatehouse/service-yard cues; visually distinct from a fortified town.

Water, bridges, roads, forest and elevation transitions remain continuous with the previously approved R02 region-continuity language. Avoid rectangular region framing.

## Ecology visual hierarchy

- **Domestic/farm** — compact rounded marker base plus stable species glyph; cluster near settlement/farm context when Simulation places them there.
- **Wild** — angular/footprint marker treatment; lower visual priority than protagonist/NPC/selected gameplay targets.
- **Fantasy animal-like** — diamond/animal glyph combination.
- **Fantasy humanoid** — hexagonal marker plus humanoid glyph.
- **Monstrous** — heavier triangular marker plus warning-notch silhouette.
- **Supernatural** — ring/star marker with broken/dashed perimeter.
- Category/species meaning must never depend on fill color alone. Every category receives a distinct shape/glyph/pattern combination.
- Labels are density-controlled by zoom and relevance. Rendering must not materialize or label off-screen ecology merely for presentation.

## Zoom and density behavior

- **Far zoom** — settlement massing, main roads/water, day/night state and only significant ecology clusters/important markers; individual creature labels hidden.
- **Mid zoom** — selected/relevant creature markers and settlement-type cues visible; limited labels for important entities.
- **Near zoom** — full relevant species/role labels permitted when they do not overlap critical map information.

## Responsive behavior

- **Desktop** — map remains the dominant area; compact time/status strip and ecology legend may coexist without covering the active settlement/region.
- **Tablet** — collapse legend detail first; retain day/night cue, selected entity label and settlement readability.
- **Phone portrait** — map remains the largest interactive surface; use icon/shape-first markers, one selected/relevant label, and compact time phase badge.
- **Phone landscape** — preserve horizontal map width; move secondary legend/help into collapsible presentation rather than shrinking the map.
- No viewport may require horizontal page scrolling for these presentation elements.

## Accessibility

- Use text/glyph/shape/outline/pattern alongside color for time phase, settlement type and ecology category.
- Critical HTML/SVG text and markers target WCAG AA contrast where practical against their immediate background.
- Selection/focus adds a visible outline/shape change rather than hue-only emphasis.
- Night mode must preserve readable focus rings, selected tile boundaries and essential labels.
- Decorative icons are hidden from assistive technology when redundant; meaningful status text remains available.

## Performance constraints

- Prefer palette/ambient overlays and reusable marker/building geometry over per-entity lighting effects.
- Cull labels and low-priority ecology markers by zoom/relevance/viewport density.
- Reuse icon/marker atlases or vector primitives where possible.
- Do not require animated fog, particles, volumetric light or physically accurate moving shadows.
- Do not render/materialize inactive unbounded-world detail solely to support presentation.

## Independently testable evidence

Prototype: `assets/design/r02/day-night-settlement-ecology-prototype.svg`

Independent Tester should verify:

1. The prototype is vector SVG with accessible title/description.
2. 05:00 dawn and 22:00 night are explicitly represented with both luminance and non-color text/glyph cues.
3. Village, town, city, fortified-town and castle are distinguishable by silhouette/massing cues rather than color alone.
4. Domestic, wild, animal-like fantasy, humanoid fantasy, monstrous and supernatural ecology examples use distinct non-color marker shapes/glyphs.
5. Map remains the dominant visual surface and the responsive rules explicitly preserve map primacy on desktop/tablet/phone portrait/landscape.
6. Night presentation preserves readable outlines/labels and does not require moving physical shadows.
7. The design states and demonstrates that time, settlement and ecology truth come from Simulation and that no direct protagonist/NPC/creature control is introduced.

## Integration boundary

This checkpoint defines presentation assets and behavior guidance only. Runtime rendering integration, authoritative time/calendar state, settlement/ecology generation, entity behavior, persistence and Simulation rules remain Coder-owned unless separately scoped by Planner.
