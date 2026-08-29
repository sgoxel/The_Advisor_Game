# R04 Enterable Building and Interior Visual Foundation

Issue: #251  
Role owner: Designer  
Phase: R04  
Authority: current README plus Admin #249.  
Authority boundary: building identity, type, world position, footprint, entrance, rooms when Simulation-defined, occupancy, collision, campaign state, SEED and movement legality remain Simulation-owned. This document defines presentation and implementation-facing visual constraints only.

## Goal

Make an accessible starter-village building read as one physical place in the same living world before, during and after entry. The player should understand where the door is, where the character can stand, how rooms connect and what is occluding the interior without switching to a disconnected menu scene or a duplicate interior map.

The target visual family is an original classic handcrafted tile-RPG / shallow-isometric 2D/2.5D presentation. It should preserve the settlement readability established by `R04_STARTER_VILLAGE_VISUAL_READABILITY.md` while adding interior legibility at character scale.

## Non-negotiable continuity rules

1. **One building identity.** Exterior shell, doorway, revealed interior and interaction props are views/refinements of the same authoritative building descriptor.
2. **One spatial footprint.** Presentation does not move, rotate or resize the authoritative footprint to make an interior fit.
3. **One entrance connection.** The visible exterior path reaches the authoritative entrance, and that same entrance visually connects to interior walkable floor.
4. **Solid boundaries read as solid.** Wall art must not visually invite passage where Simulation says movement is blocked.
5. **Interior walkable space reads at character scale.** Doors, room openings, beds, tables, counters and work areas must leave believable clearance for a world-space character sprite.
6. **Occlusion is presentation only.** Roof/upper-wall reveal may hide, cut away, fade or become transparent, but cannot change occupancy or building state by itself.
7. **No disconnected duplicate.** Entering does not teleport presentation to an unrelated room layout with a second copy of the resident/building.

## Tile and character scale contract

Use logical tiles as the alignment unit. Exact pixel size is renderer-dependent; proportions below are visual constraints, not Simulation dimensions.

- One standing world character occupies one authoritative logical position/tile even if the sprite visually overlaps neighboring pixels.
- Primary doors should read as approximately one logical tile of usable passage unless the authoritative structure defines a wider entrance.
- Interior circulation should preserve at least one logical tile of readable clear route where a route exists.
- Major furniture should visually occupy only the area it logically blocks or represents; decorative overhang may not make a walkable tile look impassable.
- A representative ordinary starter home remains at least 10 x 10 logical tiles and at least two rooms, as required by README.
- Walls should be visually thinner than the room they enclose. Avoid oversized wall art that consumes the apparent interior.
- Character sprites should remain clearly smaller than a room and clearly larger than tiny map-marker iconography.

## Material and shape family

Use a compact original medieval-fantasy material vocabulary shared with exterior village presentation:

- timber framing and warm plaster for ordinary homes and shops;
- stone bases/hearths for weight and grounding;
- timber plank, packed-earth or simple stone interior floors according to building role;
- shingle, thatch or timber roof families with clear silhouettes;
- muted natural cloth/leather/wood/iron accents for furniture and work props;
- warmer interior value/light accents around hearths, beds and counters, without turning lighting into gameplay truth.

Avoid photorealistic textures, modern UI-card furniture, excessively detailed object clutter or copied layouts/artwork from an existing game.

## Exterior-to-interior layer model

Recommended visual stack for an accessible building:

1. authoritative terrain / road / yard presentation;
2. floor/foundation footprint inside the authoritative building footprint;
3. low structural base and lower walls;
4. interior floor zones and room dividers;
5. role-appropriate furniture/fixtures/interaction anchors;
6. characters and low interaction cues;
7. upper walls / roof occlusion layer;
8. character-attached dialogue/activity feedback and accessibility-critical overlays.

When the player/observed character is outside, the roof may be mostly opaque. When an authoritative character enters or the camera needs to expose the occupied interior, layer 7 transitions to a reveal state while layers 2-6 remain in the same world coordinates.

## Roof and upper-wall reveal states

The presentation system should support three conceptual states; implementation may blend between them.

### Exterior readable

- Roof silhouette is fully readable.
- Door remains visible and connected to the exterior path.
- Interior props are mostly hidden except through windows/open doors if desired.

### Entry transition

- Roof and high wall faces begin to fade/cut away only after the relevant interior becomes spatially relevant.
- Transition should not flash, move the building or pop characters to a second coordinate system.
- Door threshold remains visible so exterior/interior continuity is obvious.

### Interior readable

- Roof over occupied/relevant room area is hidden, cut away or strongly faded.
- Lower wall edges remain visible enough to communicate collision boundaries.
- Interior floor, room division, resident sprite, furniture and exit door remain readable.
- Adjacent buildings stay visually distinct; revealing one interior must not erase unrelated structures.

For narrow screens, a slightly stronger fade/cutaway is acceptable to preserve character readability, but the same authoritative geometry remains underneath.

## Representative starter-home composition

Prototype evidence: `design/prototypes/R04_ENTERABLE_BUILDING_INTERIOR_FOUNDATION.svg`, left panel.

The prototype uses a 10 x 10 logical footprint with two rooms and an entrance on the south edge. It is a visual composition example only; actual generated room descriptors remain authoritative when available.

### Living / hearth room

- Main entrance opens into a central clear circulation zone.
- Small table and seating sit off the clear entry route.
- Hearth is against a wall, visually solid and not placed in the doorway.
- A room opening connects to the sleeping/storage room.

### Sleeping / storage room

- Bed and storage sit against perimeter walls.
- A one-tile-equivalent clear approach remains visually obvious.
- The room does not become a decorative sealed box.

### Readability target

At normal zoom the player should be able to identify: exterior wall line, entrance, two-room division, walkable floor, major props, resident sprite and the route back outside without opening a separate floor-plan UI.

## Representative service-building composition

Prototype evidence: `design/prototypes/R04_ENTERABLE_BUILDING_INTERIOR_FOUNDATION.svg`, right panel.

The example represents a small inn/service building. Actual building type and dimensions must come from authoritative descriptors.

- Road-facing entrance leads to a readable public floor area.
- Counter/service line is visually distinct but does not block the only route.
- Table/seating clusters leave circulation channels.
- Back work/storage room is separated by a wall/opening.
- Service/work anchor is visually plausible near the counter/back room.
- An NPC behind a counter remains in the same authoritative world space rather than becoming a dialogue-only portrait token.

The same composition principles apply to bakery, workshop, hall, guard post and other accessible service structures with role-appropriate substitutions.

## Prop and interaction-anchor rules

Props communicate building function but never invent authoritative inventory or availability.

- **Beds:** sleeping-location cue; no implication that a bed is usable unless interaction state says so.
- **Tables/chairs:** social/domestic cue; keep clear routes.
- **Counters:** service/work boundary; align to the service zone, not the entrance.
- **Hearth/forge:** strong solid fixture cue; do not place in circulation.
- **Crates/shelves/storage:** compact wall-side groups; avoid maze-like clutter.
- **Workstations:** show profession/function only when compatible with authoritative building role.

If exact prop state is not authoritative, use neutral set dressing rather than text or iconography claiming stock, ownership, production, quests or resources.

## Door and path readability

- Exterior road/path should visually terminate at or pass directly to the authoritative entrance tile/edge.
- Door sill/threshold is a high-contrast continuity cue between exterior and interior floor.
- Open/closed visual state may only reflect authoritative or safely derived presentation state; it cannot silently change legality.
- When interior is revealed, the doorway should remain visible as the exit route.
- Never use a decorative facade door on a different edge from the authoritative entrance.

## Wall and collision readability

- Lower wall/foundation edge remains visible during interior reveal.
- Solid wall faces should have enough value/edge contrast to distinguish them from walkable floor.
- Door/opening gaps should be visually unambiguous.
- Furniture that is not a blocker should not look like a full-height wall.
- Collision/debug overlays, if used in development, stay separate from final visual treatment and never become authority.

## World-space character compatibility

This task does not define final character sprites (#252), but building scale must support them.

- Character feet/base anchor aligns to authoritative tile/position.
- Head/body may visually overlap neighboring pixels for readability.
- Door clear height/width and room spacing should visually accommodate the sprite without implying the character clips through walls.
- Activity/dialogue bubbles anchor above the character and should render above revealed roof/wall layers.
- Character depth ordering follows world position and deterministic presentation rules; it must not move Simulation location.

## Responsive behavior

### Desktop

- Preserve exterior + revealed interior context together when practical.
- Retain furniture/type cues and lower-wall boundaries.
- Roof reveal may be localized to occupied/relevant rooms.

### Tablet

- Reduce minor prop detail first.
- Keep doors, wall boundaries, room openings, major furniture and character silhouettes.
- Avoid expanding overlays over the map merely to show interior detail.

### Phone portrait / landscape

- Favor stronger roof fade/cutaway and simpler prop silhouettes.
- Preserve at least entrance, room division, clear floor path, resident sprite and exit route.
- Fine wall texture, small decor and nonessential shadows may disappear.
- No horizontal page overflow or new fixed panel is required for entry.

## Performance guidance

- Prefer reusable tiles/sprites/atlases or low-cost canvas primitives over per-building high-resolution full-scene textures.
- Materialize/reveal detailed interiors only when spatially relevant; off-screen or distant buildings may use exterior silhouettes.
- Culling/reveal state may reduce presentation work but must not delete authoritative building/NPC state.
- Do not require animation for R04 acceptance.
- Cache presentation assets by visual family where practical; do not generate unique heavy textures for every building identity.

## Accessibility and inspection

- Building inspection should continue to expose the authoritative building identity/type where available.
- Interior reveal must not trap keyboard focus or require hover-only interaction.
- Door/entrance and selected-building cues should remain perceivable when roof is faded.
- Do not encode building function only by color; combine silhouette, prop family or accessible label.
- Reduced-motion preference may replace reveal animation with an immediate coherent state change.

## Implementation contract for #253

Coder implementation must consume authoritative building identity, footprint, entrance, room descriptors where available, world coordinates and persistent state. It should refine the same living-world representation rather than create a second interior scene.

Minimum implementation evidence should show:

- one representative starter home (>=10 x 10, >=2 rooms) entered from its authoritative exterior door;
- one representative service building entered from its authoritative exterior door;
- walls/solid structures block movement while valid door/opening cells permit passage;
- interior floor, room separation and major props remain within the authoritative footprint;
- entering/exiting retains the same building/NPC identities and campaign state;
- roof/upper-wall reveal exposes occupied interior without mutating Simulation;
- exterior road/path alignment remains intact;
- desktop/tablet/phone views preserve character + interior readability;
- save/load or leave/return does not create a duplicate building/interior identity.

## Independent verification checklist

A Tester different from the Designer must verify the exact committed candidate against #251:

- the visual contract does not change SEED, footprints, entrances, occupancy or movement authority;
- the starter-home prototype visibly demonstrates a >=10 x 10 two-room, door-connected, character-scale composition;
- the service-building prototype demonstrates public/service/back-room zoning with clear circulation;
- walls, doors, floors, rooms, major props and reveal states are visually distinguishable;
- roof/upper-wall reveal preserves lower collision-boundary readability;
- exterior/interior continuity is explicit and no disconnected duplicate-scene model is prescribed;
- world-space character and activity-bubble layering is supported without presentation inventing location;
- desktop/tablet/phone simplification rules preserve the essential spatial cues;
- asset/performance guidance is bounded and animation is not required;
- all prototype visuals are original schematic design evidence and do not copy protected artwork.
