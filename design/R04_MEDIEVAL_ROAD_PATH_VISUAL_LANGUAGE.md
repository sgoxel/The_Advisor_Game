# R04 Medieval Road and Path Visual Language

Issue: #276  
Role owner: Designer  
Phase: R04  
Authority boundary: route existence, connectivity, logical road/path tiles, entrances, terrain walkability, bridges, slopes, occupancy and pathfinding remain Simulation-backed. This document defines presentation only.

## Goal

At normal gameplay zoom, the authoritative movement network must read immediately as believable medieval-fantasy roads, village streets and footpaths rather than wide tan debug strips, ladder/rail shapes or repeated square cutouts. Roads should clarify how the starter village is organized and how buildings connect without becoming the dominant visual object in the scene.

This visual language extends the accepted `R04_STARTER_VILLAGE_VISUAL_READABILITY.md` contract. It must reveal the authoritative route graph; it must never invent, delete, reconnect or reroute that graph.

## Core visual principles

1. **Continuous ground surface, not a rail object.** A road/path tile is visually a worn ground surface. It must not contain regularly repeated square holes, rungs, sleepers, rails or alternating cutouts that can be mistaken for a ladder, fence or debug overlay.
2. **Connectivity first.** The visible shape of each route tile is derived only from its authoritative connected neighbors and terrain context. A straight segment looks straight; a corner turns; a junction visibly branches.
3. **Soft irregular edges, stable centerline.** The centerline/connectivity remains clear while edges use restrained irregularity, grass intrusion, stones or wheel wear. Decorative variation never changes the apparent legal connection.
4. **Hierarchy without false authority.** Primary village roads are broader/stronger than secondary paths, but presentation hierarchy cannot imply a route where no authoritative connection exists.
5. **Entrances are destinations, not interruptions.** Roads/paths visually meet authoritative building entrances cleanly. A doorway transition must not look blocked by curb-like strips or decorative stones.
6. **Same-world scale.** Width, edge detail and texture frequency must be coherent with logical tiles, world-space character sprites, doors, building footprints, rooms and props.

## Route families

### Primary village road / street

Use for authoritative primary/local-road cells where the runtime exposes such a category or where an existing route is explicitly styled as the settlement's main road.

- Readable packed earth / worn dirt / compacted gravel family.
- Visual width: approximately **70-82% of the logical tile width** on an orthographic/top-down tile, or an equivalent projected footprint in shallow/near-isometric view.
- Keep a continuous central traveled zone.
- Optional restrained wheel-rut pair or central wear variation may span several tiles, but never form a high-frequency repeating pattern.
- Edge stones are sparse and irregular; they are not a continuous modern curb.
- Near market/hall/service frontage, compacted surface may become slightly broader or more stone-rich only if it remains within authoritative route/adjacent presentation allowances and does not imply new walkable cells.

### Secondary path / footpath

Use for authoritative smaller paths or presentation-distinguishable local connectors.

- Narrower worn earth/grass-break family.
- Visual width: approximately **38-55% of the logical tile width**.
- Softer edges and more visible surrounding terrain intrusion.
- No wheel-rut requirement.
- May use sparse stepping stones only as decoration on an already-authoritative path; stones must not visually create a new diagonal/branch.

### Shared fallback

If authoritative state does not distinguish road class, render one coherent packed-earth route family rather than guessing a road hierarchy from building importance, NPC use or screen position. Presentation may add low-amplitude cosmetic variation but must not classify Simulation state.

## Connectivity tile grammar

Use a connectivity mask derived from authoritative neighboring route cells. `N/E/S/W` below means a real logical route connection in that direction.

| Connectivity | Visual prototype | Requirement |
| --- | --- | --- |
| `N+S` | vertical continuous surface | no lateral branch cue |
| `E+W` | horizontal continuous surface | no vertical branch cue |
| `N+E`, `E+S`, `S+W`, `W+N` | rounded/soft 90-degree turn | inside corner stays filled; outside edge remains readable |
| `N+E+S`, `E+S+W`, `S+W+N`, `W+N+E` | T-junction | all three authoritative arms visibly meet one center surface |
| `N+E+S+W` | crossroads | one continuous shared center, no square hole in the middle |
| single connection | ending / threshold | taper or settle naturally without pointing toward a nonexistent continuation |
| no cardinal connection | isolated authoritative route tile | compact worn patch; do not fabricate a branch |

### Text prototype — filled surface logic

These diagrams describe *connectivity*, not literal pixel art. `#` is filled traveled surface and `.` is surrounding terrain.

Straight:

```text
..###..
..###..
..###..
..###..
..###..
```

Turn:

```text
..###..
..###..
..#####
..#####
..#####
```

T-junction:

```text
..###..
..###..
#######
#######
#######
```

Crossroads:

```text
..###..
..###..
#######
#######
..###..
```

The central rule is a **filled connected surface**. Never punch periodic square voids into the surface to signal topology.

## Diagonal and projected presentation

Authoritative movement/connectivity remains logical-tile based even when the camera uses shallow-isometric/near-isometric projection.

- Project the same connected surface into the selected camera transform; do not create a second screen-space route graph.
- Apparent road width should remain visually stable across diagonal/projected directions. Avoid diagonal segments becoming nearly twice as thick as cardinal segments.
- Corners and junctions should use a shared projected ground plane; avoid stacked strips whose overlap suggests bridges or impossible depth.
- Layering at crossings follows authoritative elevation/bridge state. An ordinary same-level crossroads is one continuous surface, not one strip visually passing over another.

If diagonal logical connections are supported later, they require explicit authoritative connectivity. Presentation must not infer diagonals merely because two cardinal road cells touch at a corner.

## Edge and material treatment

### Ground blending

A road edge should transition into surrounding terrain through **low-frequency irregularity**, not through repeated holes.

Recommended components:

- 1-2 small edge notches per several tiles, seeded from stable tile coordinates for presentation repeatability;
- sparse tufts/grass intrusion at the outer edge;
- occasional small stone clusters;
- subtle value/texture breakup inside the traveled surface;
- restrained darker/lighter wear near turns, junctions and entrances.

Constraints:

- Decorative edge intrusion must not erase the connected centerline.
- Random presentation variation must be stable for equivalent tile coordinates/route style and must not depend on render order or device frame timing.
- Keep texture frequency low enough that zoomed-out roads read as connected settlement structure rather than noise.

### Terrain-specific transitions

- **Grass/open ground:** soft worn-earth edge with sparse grass intrusion.
- **Forest edge:** slightly darker/leaf-litter edge may appear where authoritative terrain is forest-compatible; do not visually open blocked forest.
- **Stone/civic frontage:** limited packed-gravel/stone apron can soften the road-to-building transition, but it cannot imply a second plaza route outside authoritative walkability.
- **Mud/wet ground:** optional darker/saturated wear where authoritative environment supports it; visual mud alone cannot change movement cost.
- **Snow/seasonal cover later:** retain the connected route silhouette through tracks/edge contrast; do not make the route visually disappear if it remains authoritative.

## Building entrance transitions

Every authoritative entrance should have a visually obvious, unobstructed relationship to its connected road/path.

- Carry the route surface up to the authoritative entrance edge/tile.
- Narrowing from primary road to a short entrance path is allowed only where authoritative connected path/entrance geometry supports it.
- At tavern/shop/hall/market fronts, a small worn threshold/apron may communicate use, but it stays presentation-only and must not create fake side connections.
- Door thresholds should visually sit above/at the road edge rather than be covered by a road overlay.
- Road edge stones/grass must give way at the entrance opening so the doorway does not appear barricaded.
- Large building footprints remain visually dominant over the road where structurally appropriate; the road does not paint through walls.

## Intersections and gathering spaces

- T-junctions/crossroads use one filled shared center.
- Increase local surface breadth only modestly; avoid giant tan squares that visually swallow nearby buildings.
- Market/gathering-area presentation may use stone/dirt variation around an authoritative junction when supported by the existing terrain/settlement presentation, but must not turn non-route tiles into apparent streets.
- Preserve sightlines to building entrances, world-space sprites, selection cues and activity/dialogue bubbles.

## Bridges, slopes and constrained passages

This specification does not create these route states; it only defines presentation when authoritative data requires them.

### Bridge

- Bridge deck is a distinct continuous surface aligned to the authoritative route and crossing.
- Banks/abutments visually explain entry/exit.
- Water remains visible beside/below the deck where projection permits.
- Do not render ordinary road tiles as floating boards; bridge structure appears only for authoritative bridge/crossing state.

### Slope / elevation transition

- Keep the route centerline continuous through the slope.
- Use edge/shading/elevation cues rather than staircase-like repeated square cutouts.
- The apparent climb direction follows authoritative elevation, never decorative screen-space ordering.

### Gate / narrow passage

- Route narrows coherently to the legal passage without creating an apparent dead end.
- Guard posts, walls or props must not visually occupy the only authoritative route opening.

## Scale relationship

At normal gameplay zoom:

- A character world-space sprite should read as a person standing *on* the road, not as a token wider than the street or a tiny marker on a giant strip.
- A primary road should plausibly support two characters passing/standing with visual breathing room while logical occupancy remains authoritative per tile.
- A secondary path may visually support single-file travel without becoming hairline-thin.
- Building doors/entrances should remain approximately commensurate with character scale and visibly connect to the route.

Presentation scale may clamp across camera zoom to preserve readability, but road/path rendering must remain world-anchored rather than HUD-sized.

## Visual hierarchy in the village

Roads support settlement readability; they do not dominate it.

At normal zoom, preferred salience order is:

1. protagonist/gameplay-relevant characters and interaction cues;
2. readable building/landmark silhouettes and entrances;
3. primary route connectivity;
4. secondary paths;
5. terrain texture/decorative road detail.

Primary roads should be distinguishable from grass/open terrain by value/material contrast, but avoid maximum-saturation or high-contrast outlines around every edge. Junctions must not become the strongest rectangles in the scene.

## Rendering/layering contract

Recommended presentation order where compatible with the existing renderer:

1. authoritative terrain base;
2. road/path base surface derived from route connectivity;
3. low-amplitude road edge/material decoration;
4. low building-yard/field treatments;
5. building bodies/walls/roofs and bridge structure where applicable;
6. entrance/threshold accents;
7. selection/path-preview accessibility cues;
8. protagonist/NPC world-space sprites;
9. activity/dialogue bubbles and other accessibility-critical feedback.

A route overlay must never cover characters, wall boundaries, door interaction cues or accessibility focus state.

## Responsive behavior

### Desktop / wide tablet

- Preserve full material treatment at normal zoom.
- Small stones/edge tufts may remain visible when they do not alias into noise.

### Tablet / phone

- Preserve route family, width, topology and entrance continuity first.
- Drop tiny stones, small ruts and edge micro-detail before reducing the connected surface.
- Do not replace roads with thick high-contrast UI lines.
- Avoid any road presentation layer creating page-level horizontal overflow or intercepting map touch interaction.

### Zoomed out

- Collapse to a simplified continuous road/path silhouette with primary-vs-secondary distinction where authoritative.
- Junction topology and settlement connective structure must remain readable.
- Remove microdetail before altering width/connectivity.

### Zoomed in

- May reveal stable edge stones, wheel wear, puddles/leaf-litter or threshold detail when appropriate.
- Detail remains non-authoritative and cannot imply blocked/passable state that conflicts with Simulation.

## Performance guidance

- Prefer tile-connectivity masks, atlas regions, cached canvas primitives or similarly bounded presentation techniques.
- A small finite topology family (straight, four corners, four T-junctions, cross, ends/fallback plus optional class variants) is sufficient.
- Coordinate-stable cosmetic variants may be selected by a lightweight hash; do not allocate/update random decoration every frame.
- Avoid per-frame DOM elements for individual road stones/ruts.
- Culling may omit decorative detail outside the viewport but cannot alter authoritative route existence or connectivity.
- Mobile reduction should lower decoration complexity, not change the route graph.

## Accessibility and interaction

- Roads must remain distinguishable primarily through shape/value/material, not color alone.
- Selected path/route previews must remain separable from the base road art using outline, pattern, marker or other accessible state treatment.
- Road rendering is pointer-transparent unless an existing authoritative map interaction explicitly targets a route tile.
- Do not use text, icons or repeated symbols on every route tile as the normal road texture.

## Explicit anti-patterns

Reject the following visual outcomes:

- repeated square cutouts or holes inside every road tile;
- two parallel hard strips plus repeated crossbars (rail/ladder reading);
- one oversized tan rectangle for each connected route cell with hard unblended seams;
- junction centers with empty square holes;
- road overlays visually continuing through solid building walls;
- decorative paths that connect buildings absent from authoritative route state;
- screen-space line networks detached from logical tile positions;
- high-frequency pebble/checker patterns that dominate at normal zoom;
- phone mode replacing world roads with HUD-like lines;
- presentation randomness that changes route appearance every redraw.

## Implementation contract for #277

The Coder should consume the existing authoritative road/path/topology data and map each visible route tile to presentation derived from its real connectivity and existing route class when one exists.

Minimum implementation evidence should demonstrate:

- primary road and smaller path are visually distinct **only where authoritative data supports that distinction**, otherwise a coherent fallback is used;
- straight, turn, T-junction, crossroads, ending and building-entrance examples render as filled continuous ground surfaces;
- no repeated square-hole/ladder/rail pattern remains at normal gameplay zoom;
- road/path visual bounds and character/building scale are coherent;
- entrance continuity remains visible without painting through building walls;
- grass/terrain edges transition naturally without changing walkability;
- representative bridge/slope/constrained-passage handling does not invent crossings when such authoritative states are available;
- changing viewport/device/render order does not alter authoritative route identity/connectivity or mutate Simulation state;
- desktop/tablet/phone and zoomed-out views preserve topology while reducing decorative detail;
- implementation remains bounded for the active 100 x 100 region.

## Independent verification checklist

A Tester different from the Designer must verify on an exact committed candidate that:

- #276 acceptance criteria are represented by concrete, implementable rules;
- the grammar covers straight segments, all turn orientations, T-junctions, crossroads, endings/continuations and entrance transitions;
- the design eliminates ladder/rail/debug-strip and repeated-square-hole readings;
- widths/material/detail are coherent with character sprites, doors, building footprints and logical tile scale;
- edge blending, intersections and shallow/near-isometric projection rules do not invent route topology;
- bridge/slope/constrained-passage guidance remains subordinate to authoritative state;
- village readability and #243 visual hierarchy are preserved;
- desktop/tablet/phone, accessibility and bounded-performance guidance is actionable;
- no runtime, Simulation, route generation, pathfinding, README, ROADMAP or TODO authority was modified by the Designer candidate.
