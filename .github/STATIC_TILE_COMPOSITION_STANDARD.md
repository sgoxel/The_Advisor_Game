# Static 100x100 Tile Composition Standard

## Authority and purpose

This operational standard implements the Admin/README performance invariant for world presentation.

**NPCs are the only normal independently dynamic world-image exception.** Every other visible world graphic must be flattened into the logical tile background before presentation.

This is presentation HOW only. Simulation remains authoritative for terrain, walkability, collision, road topology, building footprints, object identity, ownership, state, interactions and outcomes.

## Runtime tile contract

- Each logical world tile has an exact **100 x 100 px RGBA static presentation composite**.
- The 100 x 100 size is the runtime composition size, not the asset-authoring size.
- Terrain/base imagery is painted first.
- Every applicable non-NPC visual is alpha-composited onto that same tile image.
- Examples include roads, paths, buildings, walls, floors, roofs, trees, vegetation, furniture, props, resources, ruins, caves, static effects and other non-NPC world artwork.
- A grass tile containing a tree is presented as one 100 x 100 composite: grass base first, transparent tree pixels second.
- A road over dirt is one 100 x 100 composite: dirt base first, transparent road pixels second.
- A building occupying several logical tiles is decomposed into tile-local pieces; each covered logical tile receives its own final 100 x 100 composite.

## Asset source contract

Reusable visual families still follow `.github/TEXTURE_ATLAS_STANDARD.md`:

1. Author one transparent 1024 x 1024 RGBA PNG master atlas.
2. Use the fixed 4 x 4 grid of 256 x 256 cells.
3. Leave unused cells fully transparent.
4. Export occupied cells as deterministic exact 256 x 256 PNG slices.
5. At runtime, scale the selected 256 x 256 PNG slice into the destination 100 x 100 tile composite and alpha-composite it over the existing base.

The 256 x 256 PNG is a reusable source asset. It is **not** a separate runtime image object.

## Layer prohibition

Except for NPC presentation, runtime code must not retain separate world-image layers for static/non-NPC artwork.

Prohibited for non-NPC world visuals:

- one canvas per road/building/object family;
- one DOM/image element per tree, building, prop or other object;
- persistent road/building/object overlay canvases;
- vector/debug drawing layers used as production presentation;
- SVG/vector runtime art;
- per-object sprite layers that merely duplicate static world content;
- re-drawing all static objects every animation frame when authoritative state is unchanged.

The production world presentation target is:

**static background tile composites + dynamic NPC presentation**.

UI panels, menus and non-world UI are not world-image layers and are outside this rule.

## NPC exception

NPCs may retain independently dynamic world-space PNG presentation because they move frequently and must interpolate smoothly without rebuilding static terrain for every animation sub-frame.

NPC movement/state remains Simulation-backed. NPC activity bubbles or interaction UI are UI/presentation aids and do not make other world artwork eligible for independent layers.

## Non-NPC moving entities

If a non-NPC Simulation entity changes logical tile (for example an animal/creature or another world object), its visual state must be represented by invalidating/recompositing the affected old/new logical tile composites rather than creating a permanent independent world-image layer, unless the Admin explicitly grants a named exception.

## Cache and memory rule

The project must **not** allocate one giant 10000 x 10000 texture merely because a region is 100 x 100 logical tiles and each logical composition is 100 x 100 px.

Use sparse/bounded tile composition:

- compose only tiles that need static overlays or are being materialized;
- use a bounded cache/LRU or equivalent lifecycle;
- flush completed 100 x 100 composites into the renderer's existing background upload path;
- discard/reuse composition scratch canvases when safe;
- rebuild only invalidated tiles after a static world change.

The renderer may store/upload the flattened region in an implementation-specific GPU-safe representation. The invariant is that every logical tile's static pixels are resolved through one 100 x 100 composite before presentation, not that all tile composites must remain as 10,000 simultaneous canvas objects.

## Deterministic composition order

Use a deterministic, documented order. The normal order is:

1. authoritative terrain/base;
2. terrain transition/path/road overlay;
3. static structure/building/interior overlay;
4. vegetation/tree/object/prop overlay;
5. other explicitly static presentation effects.

Within one category, stable semantic identity/order must determine composition. Render timing must not change the final pixels for the same authoritative static state.

## Invalidation

A tile composite is invalidated only when presentation-relevant static inputs for that tile change, including:

- terrain/base type or visual variant;
- road/path topology or semantic variant;
- construction/destruction/building state that changes static pixels;
- tree/vegetation/object/prop placement or static appearance;
- a non-NPC entity entering/leaving/changing the tile when that entity is represented through tile composition;
- asset-family revision requiring recomposition.

Camera movement, zoom, NPC interpolation and unrelated UI updates do not invalidate static tile pixels.

## Multi-tile objects

Large buildings/objects may keep multi-tile authoritative Simulation footprints, but presentation must be tile-local:

- the source family may contain multiple semantic PNG parts;
- each footprint cell selects the appropriate transparent part;
- each part is composited into the corresponding 100 x 100 destination tile;
- no separate giant building sprite/layer remains over the background.

## Runtime migration requirement

Legacy static presentation layers must be removed from the runtime load path and deleted once superseded. This includes separate road, building, generic world-object and vector/debug presentation overlays.

A compatibility path may detach/remove stale DOM canvases created by an older hot-loaded build, but must not recreate them.

## Texture Artist handoff rule

Texture Artist must design transparent non-terrain assets so they can be composited over arbitrary compatible terrain. A tree/prop/building/road source tile must not bake an unrelated opaque terrain background into the source PNG unless the issue explicitly defines a complete base-terrain tile family.

Texture Artist handoff must record:

- atlas/master path;
- semantic cell mapping;
- transparent slice paths;
- intended 100 x 100 runtime composition role/order;
- required footprint mapping for multi-tile assets.

## Game Programmer acceptance gate

A non-NPC visual integration is incomplete if it creates or preserves a separate static world layer instead of using the 100 x 100 composition path.

The integration must:

- register/load PNG source assets;
- map authoritative world descriptors to tile-local semantic artwork;
- composite into 100 x 100 RGBA tile output;
- update only affected background tiles;
- preserve Simulation truth;
- leave NPC dynamic presentation intact.

## Tester verification gate

Tester must independently verify:

- final logical composition unit is exactly 100 x 100 RGBA;
- terrain appears below transparent overlays;
- roads/buildings/trees/objects are not duplicated in separate world-image layers;
- no legacy static overlay canvas is active;
- NPCs remain visible and independently dynamic;
- camera pan/zoom does not trigger per-object layer churn or disappearance;
- a static input change invalidates only the affected tile set where practical;
- multi-tile structures remain visually contiguous;
- no Simulation authority moved into pixels.

Any new/corrected non-NPC integration that retains an independent static layer must FAIL unless the Admin explicitly grants a named exception.