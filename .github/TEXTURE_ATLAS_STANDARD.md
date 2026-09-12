# Texture Artist PNG Atlas Standard

## Authority and scope

This operational standard implements the README visual-asset and canonical tile-atlas invariants for Texture Artist work.

It applies to all new or corrected runtime visual assets produced by the Texture Artist role unless the Admin explicitly overrides it for a named asset.

README product truth remains authoritative.

This file defines the mandatory production HOW for reusable visual families, PNG sprites, tile atlases, semantic tile metadata, application integration, and verification.

The standard is intended to make visual production:

- repeatable;
- deterministic;
- auditable;
- suitable for automated Routine workers;
- usable by Game Programmer without manually interpreting artwork;
- independently verifiable by Tester.

---

# 1. Hard production-format rule

Texture Artist runtime visual deliverables must be PNG.

## Allowed

- RGBA PNG master atlases;
- RGBA PNG tile slices;
- standalone PNG sprites;
- JSON manifests;
- JSON semantic-description metadata;
- Markdown production/audit documentation where required.

## Prohibited as completed runtime artwork

The following must not be accepted as completed Texture Artist production output:

- SVG;
- vector-only artwork;
- HTML canvas drawing instructions;
- CSS drawings;
- JSON vector paths;
- placeholder geometry;
- text descriptions instead of required artwork;
- procedural mockups pretending to be final PNG art.

SVG/vector-only production output must never be handed to Tester as completed visual work.

Existing SVG output does not satisfy a new/corrected PNG asset acceptance criterion.

It must be regenerated as compliant PNG before visual verification.

Standalone sprites that do not require a reusable tile family are also PNG-only at the dimensions defined by their issue/runtime contract.

---

# 2. Reusable visual-family rule

A reusable tile-based visual family must normally be produced as one coherent atlas rather than as unrelated individually generated images.

Examples include:

- trees;
- roads;
- paths;
- terrain transitions;
- grass variants;
- soil/mud;
- water;
- farm fields;
- walls;
- fences;
- roof parts;
- building parts;
- furniture families;
- props;
- vegetation;
- rocks;
- ruins;
- environmental decoration.

The purpose of generating one atlas is to maintain consistency across the family in:

- palette;
- rendering style;
- perspective;
- lighting;
- visual density;
- scale;
- material language;
- edge treatment;
- detail level.

---

# 3. Canonical reusable tile-family atlas

Every reusable tile-based visual family must have one retained canonical master atlas.

The canonical atlas requirements are:

- File format: PNG.
- Color mode: RGBA.
- Exact master width: `1024 px`.
- Exact master height: `1024 px`.
- Grid: `4 columns x 4 rows`.
- Exact cell width: `256 px`.
- Exact cell height: `256 px`.
- Total cells: `16`.
- Cell indexing: zero-based row/column in metadata.
- Default semantic ordering: left-to-right, top-to-bottom.
- No visible grid lines.
- No labels.
- No numbers.
- No captions.
- No cell borders.
- No debug marks.
- No watermark.
- No UI elements.
- No artwork may intentionally cross a cell boundary.

The retained master filename must use:

`<family>_atlas_1024px.png`

Example:

`tree_atlas_1024px.png`

The canonical master must remain in the repository so that production provenance and deterministic slicing remain auditable.

---

# 4. Transparent-background rule

Where the visual family is intended to be composited over an existing terrain/base tile, the atlas background must use alpha transparency.

Transparent source families may include:

- trees;
- bushes;
- road/path overlays;
- fences;
- props;
- furniture;
- building-local parts;
- roof components;
- decorative environmental elements.

Background pixels outside the intended artwork must remain transparent.

Unused cells must be fully transparent:

`alpha = 0`

across the complete unused `256 x 256` cell.

Do not bake unrelated opaque terrain into a transparent overlay family merely to mimic the final game result.

Runtime composition owns the base + overlay combination.

---

# 5. Plan semantic cells before production

Before generating a reusable atlas, define the intended semantic cell map.

Use row-major ordering unless an existing compatible family contract requires another stable order.

Example:

| Row | Col | Semantic tile |
| --- | --- | --- |
| 0 | 0 | oak_broadleaf |
| 0 | 1 | spruce_evergreen |
| 0 | 2 | willow_drooping |
| 0 | 3 | cherry_blossom |
| 1 | 0 | apple_fruit |
| 1 | 1 | birch_yellow |
| 1 | 2 | maple_green |
| 1 | 3 | pine_windswept |
| 2 | 0 | sapling_light |
| 2 | 1 | elder_gnarled |
| 2 | 2 | oak_autumn |
| 2 | 3 | blossom_white |
| 3 | 0 | bushy_multi_stem |
| 3 | 1 | poplar_columnar |
| 3 | 2 | spruce_snow |
| 3 | 3 | dead_leafless |

Different families may use different semantic names.

The grid dimensions do not change.

---

# 6. Image-generation workflow

When image-generation capability is available, Texture Artist must actively use it for visual-production work that requires new artwork.

A Routine worker must not treat the absence of a one-step PNG upload/generation shortcut as proof that visual production is impossible.

The normal reusable-family workflow is:

1. define the semantic cell map;
2. generate one coherent 4 x 4 family image;
3. preserve transparency where required;
4. create one canonical exact `1024 x 1024` RGBA master atlas;
5. inspect the canonical master;
6. slice the master deterministically;
7. create structural metadata;
8. create semantic-description metadata;
9. validate the PNG output;
10. commit the complete family;
11. hand the family to the next responsible role.

Generation instructions should state, as applicable:

- game-ready medieval-fantasy visual style;
- consistency with existing game art;
- one coherent atlas;
- 4 x 4 composition;
- one semantic variant per cell;
- transparent background where required;
- no labels;
- no text;
- no grid lines;
- no cell borders;
- no watermarks;
- no UI;
- consistent perspective;
- consistent scale;
- consistent lighting;
- consistent palette;
- consistent material language;
- each item contained inside its intended cell.

---

# 7. Canonical normalization rule

Image-generation systems are not required to return the requested exact pixel dimensions on the first generation.

A source image that is visually valid but is not exactly `1024 x 1024` must not cause the Texture Artist to abandon the task.

Instead, the accepted source image must be converted once into the canonical atlas.

Required workflow:

1. load the generated source as RGBA;
2. normalize the complete source image to exact `1024 x 1024`;
3. save the result as the retained canonical master:
   `<family>_atlas_1024px.png`;
4. perform all deterministic slicing from that retained canonical master;
5. record normalization truthfully in the issue Audit.

Example:

Generated source:

`1254 x 1254 RGBA`

Canonical retained atlas:

`1024 x 1024 RGBA`

Final grid:

`4 x 4`

Final cells:

`256 x 256`

Normalization occurs once at the complete-atlas level.

Do not independently resize or regenerate individual final tile slices.

---

# 8. Normalization acceptance gate

Normalization is allowed only when the generated source already represents the intended coherent atlas composition.

Before accepting a normalized source, inspect that:

- the intended 4 x 4 layout is recognizable;
- each visual item belongs to the intended semantic cell;
- no important artwork is materially lost by normalization;
- items remain inside their intended cells;
- the visual style remains coherent;
- transparency is preserved;
- the atlas remains usable after conversion.

If normalization causes material corruption, regenerate the source atlas instead of accepting a damaged master.

---

# 9. Deterministic slicing

Every final tile must be exported from the retained canonical atlas by exact pixel crop only.

For cell:

`row`
`col`

use:

`left = col * 256`

`top = row * 256`

`right = left + 256`

`bottom = top + 256`

The resulting image must be:

`256 x 256 px`

and PNG.

## Slicing prohibitions

During slicing, do not:

- resize;
- resample;
- redraw;
- regenerate;
- stretch;
- crop inside the cell;
- shift artwork;
- alter aspect ratio;
- apply per-tile color correction;
- apply effects that cause the tile to diverge from its atlas cell.

The slice must be pixel-identical to its corresponding region of the retained canonical atlas.

---

# 10. Stable tile filenames

Each final sliced tile must use:

`<family>_<semantic-type>_256px.png`

Examples:

`tree_oak_broadleaf_256px.png`

`tree_spruce_evergreen_256px.png`

`tree_dead_leafless_256px.png`

Semantic filenames must remain stable once integrated unless a migration issue explicitly changes them.

Do not use meaningless filenames such as:

- tile01.png
- output3.png
- image_final2.png
- generated_7.png

when a stable semantic identity is available.

---

# 11. Mandatory family repository layout

Unless a specific issue defines another repository location, a reusable visual family should use:

`textures/tiles/<family>/`

Example:

`textures/tiles/tree/`

The family directory contains:

```text
textures/tiles/tree/
    tree_atlas_1024px.png
    tree_oak_broadleaf_256px.png
    tree_spruce_evergreen_256px.png
    ...
    tree_dead_leafless_256px.png
    tree_tiles.manifest.json
    tree_tiles.descriptions.json
