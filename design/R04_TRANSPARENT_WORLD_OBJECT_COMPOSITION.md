# R04 Transparent World-Object Composition and Anchoring Contract

Issue: #292  
Role owner: Designer  
Authority: README product principle for generalized transparent world-object composition; Admin #290.  
Reuse: canonical atlas rule #281, verified road atlas/export foundations #283/#284, enterable-building visual foundation #251.

## Purpose

Define a reusable presentation contract for transparent local-world objects without allowing image pixels, atlas dimensions, alpha, or DOM/canvas order to become Simulation authority. The same visual language must work over different authoritative terrain and remain coherent with the shallow-isometric / near-isometric local camera.

## Non-negotiable separation of concerns

Presentation may resolve a semantic visual family/type, source cell, visible bounds, anchor and depth treatment. Simulation/world data alone defines stable object/entity identity, authoritative logical position, occupied cells/footprint, blocking/walkability, interaction, ownership, inventory/state, motion and damage.

A `256 x 256` exported PNG is a production source unit, not a declaration that the object occupies exactly one logical tile. A visible sprite may be smaller than one tile, fill several projected tiles, or overhang its authoritative footprint. Missing or replaced art never changes the authoritative object.

## Canonical reusable-asset production rule

When a reusable tile-family atlas is produced, it uses the project-wide `1024 x 1024` transparent RGBA canvas, fixed `4 x 4` grid, and `256 x 256` cells. Only defined semantic cells contain artwork; every unused cell remains fully transparent. Exported tiles remain transparent around the object silhouette unless the semantic family intentionally represents an opaque surface such as a floor.

Terrain-neutral families must not contain baked grass, dirt, forest floor, beach, snow, water, or other unrelated biome rectangles. Their transparent pixels reveal the actual lower terrain layer chosen by the authoritative world.

## Presentation classes

### 1. Terrain overlay / small static prop

Use for objects such as a rock cluster, small well, sign base, field detail, rubble, or other local prop whose visual can be presented from a compact semantic asset.

Presentation guidance:
- Resolve a semantic family/type such as `rock.cluster_small`, `well.stone_round`, or `sign.wood_post`.
- Anchor the visible asset to the Simulation-provided world/tile anchor, normally at the bottom-center or footprint baseline of the object.
- Transparent pixels expose the lower terrain.
- Small visual shadows may remain inside the transparent asset, but they should be restrained and terrain-neutral.
- If Simulation says the prop is non-blocking/non-interactive, the picture cannot make it blocking or interactive. If Simulation says a well or rock is blocking/interactable, that remains true even if the PNG fails to load.

Representative example — stone well:
- Suggested visual source: one transparent 256px semantic tile.
- Example logical footprint: **not specified by Designer**; supplied by Simulation/descriptors.
- Visual silhouette: circular stone rim, short timber/stone upper detail, transparent surrounding area.
- Baseline: bottom-center of the authoritative anchor/footprint.
- Characters may visually pass behind the upper well detail when their projected baseline is behind it, but occupancy still comes only from Simulation.

### 2. Authoritative multi-tile prop

Use for larger static objects such as parked carts/wagons, large rubble piles, market structures, large furniture groups, or similar props whose authoritative footprint may span multiple cells.

Presentation guidance:
- One semantic visual may span the projected area of several authoritative cells; do not repeat one source tile merely because the footprint is multi-tile unless the family is explicitly modular.
- Choose one stable anchor supplied by the descriptor, typically the lower/back or lower-center footprint baseline appropriate to the object orientation.
- Visible wheels, handles, awnings, shafts, roofs, or decorative parts may extend outside the occupied footprint. Overhang is visual only.
- Depth sorting uses the declared baseline/anchor, not the PNG rectangle's top-left corner or full alpha bounds.
- Collision/interaction follows the authoritative footprint, not the cart body alpha or wheel pixels.

Representative example — parked wagon:
- Suggested semantic type: `wagon.parked_side` or orientation-specific equivalent.
- Example visual source may occupy one exported source cell or a composed semantic asset family; source-cell dimensions do not define world footprint.
- Typical visible art may overhang beyond the authoritative occupied cells through shafts, wheels or cargo canopy.
- A moving wagon must not be frozen into this static class merely because it shares the same artwork family; moving/richer behavior belongs to the world-space entity class.

### 3. Tall / overhanging prop

Use for flagpoles, tall signs, trees used as object props, posts, hanging shop signs, wall decorations, or similar objects whose visible height extends well above their occupied base.

Presentation guidance:
- Anchor at the authoritative base tile/footprint baseline.
- The visual may extend upward across several projected tile heights without moving its logical position.
- Depth decisions use the ground/base baseline. A character whose baseline is behind the object may be occluded by the tall visual; a character whose baseline is in front must draw in front where appropriate.
- Tall visual bounds never expand blocking cells by themselves.
- For signs/flags, text or heraldic detail should remain legible but not dominate the local scene at normal gameplay zoom.

Representative example — village flagpole:
- Semantic type: `flagpole.village_standard` or comparable project-original identity.
- Logical base/footprint comes from Simulation.
- Pole and flag extend upward through transparent pixels; no baked ground patch.
- Base shadow remains subtle so the same asset works on compatible terrain types.

### 4. World-space entity visual

Use when an object moves, rotates, carries persistent state, has richer behavior, or otherwise must remain tied to a stable entity rather than a static map decoration. Examples include a moving wagon/cart, movable siege/equipment object, or comparable gameplay entity.

Presentation guidance:
- Resolve visual identity from the same stable Simulation entity.
- Position follows authoritative entity/world coordinates and current state.
- Semantic art may reuse the same family as a parked/static version, but presentation classification follows the descriptor/entity state, not the filename.
- Depth/occlusion uses the entity's current authoritative anchor/baseline.
- Animation remains optional unless separately required; static frames are sufficient for this R04 foundation.

## Connected families — fences and gates

Connected props may expose semantic family/type variants such as straight segments, corners, ends, junctions and gates. The semantic visual system may select the appropriate variant from authoritative descriptor connectivity/state. This does not duplicate the road-specific #283 family and never infers traversal legality from pixels.

Examples:
- `fence.straight_ns`, `fence.corner_ne`, `fence.end_s`
- `gate.closed_ns`, `gate.open_ns`

`gate.open` versus `gate.closed` may be visually distinct, but whether movement is actually permitted is still Simulation truth. Presentation must fail safely if a semantic asset is missing.

## Anchor and depth-sort contract

Use the following visual model unless a later verified implementation contract refines the exact API:

1. **Authoritative anchor:** Simulation/descriptors provide the world/tile anchor and logical footprint.
2. **Visual baseline:** Designer guidance defines where the sprite visually touches the ground relative to that anchor.
3. **Projected depth key:** renderer derives ordering from the authoritative baseline/world position, not DOM insertion order or source-image bounds.
4. **Overhang:** pixels may extend left/right/up/down beyond occupied cells; overhang cannot add collision.
5. **Character composition:** characters/entities and props are depth-sorted by their baselines so a character can pass visually behind or in front of tall/multi-tile art while remaining on the correct authoritative tile.

Recommended layer sequence for the local renderer:

`base terrain -> terrain overlays -> static object ground/base layers -> depth-sorted props/entities/characters -> approved foreground overhang/occlusion -> activity bubbles / dialogue / UI`

This sequence is a presentation contract, not a Simulation update order.

## Representative composition scenes

### Scene A — well over grass and dirt

Place the same transparent well visual over two different authoritative terrain examples. Grass or dirt must remain visible through the transparent area around the well. The asset must not carry a rectangular grass patch. The Simulation-provided well footprint/interaction is identical regardless of the lower terrain artwork.

### Scene B — tall flagpole beside a character

Place a flagpole at its authoritative base and a world-space character on an adjacent authoritative tile. When the character baseline is behind the pole/flag, approved upper visual may occlude part of the character. Move the character to a baseline in front; the character must compose in front without changing either object's logical position.

### Scene C — parked multi-tile wagon

Render a parked wagon from one stable descriptor/anchor over its authoritative footprint. Wheels/cargo/shaft may visually overhang the footprint. Overlay a debug footprint only in development evidence: the visible alpha bounds should clearly differ from the authoritative occupied-cell outline. Removing the wagon PNG must leave the same authoritative footprint/state available to gameplay.

### Scene D — moving wagon using the same family

Use the same recognizable wagon visual family but classify it as a world-space entity. Its stable Simulation identity and current position move; the image is not stamped permanently into the terrain. A static parked visual and moving entity therefore remain coherent without sharing authority semantics.

## Camera, scale and responsive guidance

- The 256px source tile is not rendered as a fixed 256 CSS-pixel object. Final display scale follows projected local-tile/world scale and camera zoom.
- Maintain recognizable silhouette at normal gameplay zoom before adding fine detail.
- Small props should not become oversized icons floating above the map; large props must remain proportionate to doors, characters, roads and building footprints established by #251 and current R04 spatial work.
- On constrained tablet/phone views, preserve object/terrain readability rather than increasing every prop to UI-icon size.
- Tall overhangs should not create excessive clipping or cover fixed HUD/chat surfaces; viewport clipping is presentation behavior and may never relocate authoritative objects.
- Original project silhouettes/materials should stay within the established grounded medieval-fantasy, handcrafted tile-oriented visual family.

## Semantic/art naming guidance

Semantic identities describe the object, not an atlas row/column. Runtime consumers should be able to request identities such as `well.stone_round`, `rock.cluster_small`, `flagpole.village_standard`, `wagon.parked_side`, or `fence.corner_ne` through the verified registry boundary rather than know source crop coordinates.

Exact registry schema and descriptor API remain Coder-owned by #285/#293. Designer evidence intentionally avoids making filenames, paths or source cells authoritative gameplay fields.

## Originality and production constraints

All examples above are original project concepts and generic medieval-fantasy object categories. Do not trace or copy protected game tiles, sprites, layouts, logos or texture sheets. Match the project's established visual language through proportion, material discipline, readability and composition rather than copied artwork.

## Verification checklist for an independent Tester

- The specification covers small/static, multi-tile, tall/overhanging and entity-suitable presentation classes.
- Visual bounds/source-cell size are explicitly separate from authoritative footprint/blocking/interaction.
- Terrain-neutral examples use transparent surroundings with no baked biome rectangle.
- Flagpole/well/wagon examples exercise distinct anchor/footprint/depth needs.
- Connected fence/gate semantics remain compatible with the generic semantic-family approach without duplicating road art.
- Depth guidance supports coherent character-in-front/behind composition using baselines.
- Missing artwork cannot change Simulation truth.
- Responsive/local-camera guidance exists.
- No external protected game asset is copied or referenced as production art.
