# Static 100x100 Tile Composition Standard

## Authority and purpose

This operational standard implements the Admin/README performance invariant for world presentation.

Authority remains:

**Admin > README.md > ROADMAP.md > TODO > issues > code/assets > tests.**

README product truth remains authoritative. Explicit Admin direction overrides this operational standard.

**NPCs are the only normal independently dynamic world-image exception.** Every other visible world graphic must be flattened into the logical tile background before presentation.

This file defines presentation HOW only. Simulation remains authoritative for terrain, walkability, collision, road topology, building footprints, object identity, ownership, state, interactions and outcomes.

## Admin-only visual source rule

All new visual source images, including reusable 4x4 atlases, standalone sprites and replacement artwork, are created only when explicitly ordered by Admin.

Texture Artist must not generate, redraw, synthesize, procedurally create, request image generation for, or substitute new artwork.

Texture Artist is responsible for:

- inspecting the repository for newly added Admin-provided visual assets;
- validating those assets against current project standards;
- using the approved Tile Atlas Tool and metadata workflow where applicable;
- registering and integrating compliant assets into the latest application version;
- mapping visual assets to the correct runtime composition role;
- removing or superseding obsolete presentation paths when required by the issue;
- recording evidence and handing completed integration to Tester.

If required artwork is absent, Texture Artist records that the Admin-provided source asset is not yet present and continues with other eligible work according to normal worker routing. Missing artwork never grants permission to create placeholder or substitute imagery.

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

Reusable visual families follow `.github/TEXTURE_ATLAS_STANDARD.md`.

For Admin-provided reusable atlases:

1. The accepted family is normalized to one retained exact `1024 x 1024 RGBA PNG` canonical master when needed.
2. The canonical grid is fixed at `4 x 4`, with `256 x 256` logical source cells.
3. Unused cells remain fully transparent where the family requires transparency.
4. Derived runtime-source tiles are produced through the approved Tile Atlas Tool using the current Admin-defined edge-safe policy: crop the canonical 256 x 256 cell, remove exactly 1 px from every edge, then resize the remaining 254 x 254 image back to exact 256 x 256 using LANCZOS.
5. Runtime scales the selected 256 x 256 PNG into the destination 100 x 100 logical tile composite and alpha-composites it over the existing base.

The retained canonical atlas itself is not modified by the per-tile edge-safe operation.

The 256 x 256 PNG is a reusable source asset. It is **not** a separate persistent runtime world-image object.

## Tile Atlas Tool and GitHub publication requirement

When a non-NPC static family originates from an Admin-provided reusable 4 x 4 atlas, the 256 x 256 source PNGs consumed by this composition standard must come from an actual execution of `tools/tile_atlas_tool.py` when that repository tool is available.

A manually reproduced slicing/resizing script is not equivalent production evidence merely because its output appears similar.

When the Tile Atlas Tool outputs are published through the connected GitHub API, PNG files must use GitHub's binary Git-data path:

**binary blob -> repository tree -> commit -> branch ref update**

Ordinary UTF-8 text-file operations are not the PNG binary publication path. If the connected GitHub surface exposes binary blob creation plus tree, commit and branch-ref operations, those operations must be used for the exact Tile Atlas Tool output PNGs.

Runtime composition must reference the committed semantic PNG family and metadata. Temporary transport/staging files, textual substitutes, manually re-sliced replacements, or placeholder imagery are not valid runtime source assets.

Operational summary: `tools/TILE_ATLAS_GITHUB_PUBLISH.md`.

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

NPC movement/state remains Simulation-backed. NPC activity bubbles or interaction UI are UI/presentation aids only and do not make other world artwork eligible for independent layers.

## Non-NPC moving entities

If a non-NPC Simulation entity changes logical tile, its visual state must be represented by invalidating/recompositing the affected old/new logical tile composites rather than creating a permanent independent world-image layer, unless Admin explicitly grants a named exception.

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

Within one category, stable semantic identity/order must determine composition. Render timing must not change final pixels for the same authoritative static state.

## Invalidation

A tile composite is invalidated only when presentation-relevant static inputs for that tile change, including:

- terrain/base type or visual variant;
- road/path topology or semantic variant;
- construction/destruction/building state that changes static pixels;
- tree/vegetation/object/prop placement or static appearance;
- a non-NPC entity entering/leaving/changing the tile when represented through tile composition;
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

## Texture Artist integration and handoff rule

Texture Artist does not author imagery. For Admin-provided visual assets, Texture Artist must:

- detect newly added or changed texture families in the project;
- verify atlas/master, slices and metadata against `.github/TEXTURE_ATLAS_STANDARD.md`;
- verify transparent non-terrain assets can be composited over arbitrary compatible terrain and do not bake unrelated opaque terrain unless explicitly intended as base terrain;
- identify intended deterministic 100 x 100 runtime composition role/order;
- identify required footprint mapping for multi-tile assets;
- integrate/register the assets into the latest application version when that integration is within the issue scope;
- remove obsolete mappings or presentation paths superseded by the new asset family;
- record exact paths, semantic mapping and checks in the issue Audit.

Texture Artist handoff must record:

- Admin-provided atlas/master or sprite path;
- actual Tile Atlas Tool invocation for reusable atlas families;
- semantic cell mapping;
- derived slice paths where applicable;
- manifest/descriptions paths where applicable;
- intended 100 x 100 runtime composition role/order;
- required footprint mapping for multi-tile assets;
- runtime files/mappings changed;
- Git commit SHA when assets were published through GitHub;
- checks actually performed;
- next role.

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

- only Admin-provided visual source assets were used;
- reusable atlas-derived PNGs came from actual `tools/tile_atlas_tool.py` processing;
- committed PNGs and metadata correspond to the intended tool outputs;
- final logical composition unit is exactly 100 x 100 RGBA;
- terrain appears below transparent overlays;
- roads/buildings/trees/objects are not duplicated in separate world-image layers;
- no legacy static overlay canvas is active;
- NPCs remain visible and independently dynamic;
- camera pan/zoom does not trigger per-object layer churn or disappearance;
- a static input change invalidates only the affected tile set where practical;
- multi-tile structures remain visually contiguous;
- atlas metadata and semantic mapping match actual files;
- no Simulation authority moved into pixels.

Any new/corrected non-NPC integration that retains an independent static layer must FAIL unless Admin explicitly grants a named exception.
