# Texture Artist PNG Atlas Standard

## Authority and scope

This operational standard implements the README **Canonical Tile Atlas** invariant for Texture Artist work. It applies to all new or corrected runtime visual assets produced by the Texture Artist role unless the Admin explicitly overrides it for a named asset.

README product truth remains authoritative. This file defines the required production HOW.

## Hard production-format rule

- Runtime visual deliverables produced by Texture Artist must be **PNG**.
- **SVG is prohibited** for Texture Artist production output. Do not create, commit, hand off, integrate, or accept `.svg` files as game-art deliverables.
- Do not substitute SVG, HTML canvas instructions, CSS drawings, JSON vector paths, placeholder geometry, or text descriptions when the task requires artwork.
- Existing SVG output does not satisfy an asset acceptance criterion and must be regenerated as compliant PNG before Tester verification.
- Standalone sprites that do not need a tile family are also PNG-only, at the dimensions defined by their issue/runtime contract.

## Canonical reusable tile-family atlas

Every reusable tile-based visual family must be produced from one canonical master atlas:

- File format: PNG with alpha channel (RGBA).
- Exact master size: **1024 x 1024 px**.
- Exact grid: **4 columns x 4 rows**.
- Exact cell size: **256 x 256 px**.
- Total cells: 16.
- Background outside intended artwork must be transparent where the family requires transparency.
- Every unused cell must be **fully transparent (alpha = 0)** across the complete 256 x 256 cell.
- Do not draw grid lines, labels, numbers, captions, guides, cell borders, debug marks, or semantic text into the atlas.
- Do not place artwork across cell boundaries.

The master atlas must be retained in the repository as `<family>_atlas_1024px.png` so production provenance remains auditable.

## Plan the cells before image generation

Before generating the image, define the semantic cell map. Fill cells left-to-right, then top-to-bottom unless an existing family manifest establishes a compatible order.

Example matching the established road family:

| Row | Col | Semantic tile |
| --- | --- | --- |
| 0 | 0 | straight_vertical |
| 0 | 1 | straight_horizontal |
| 0 | 2 | cross |
| 0 | 3 | turn_ne |
| 1 | 0 | turn_es |
| 1 | 1 | turn_sw |
| 1 | 2 | turn_wn |
| 1 | 3 | t_junction |
| 2-3 | 0-3 | unused / fully transparent unless the issue defines additional variants |

A family may use a different semantic set, but the grid/dimensions never change.

## Image generation requirements

When image-generation capability is available, Texture Artist should generate the complete coherent family as the **single 1024 x 1024 PNG master atlas** rather than independently generating unrelated tiles. This is required to maximize palette, perspective, material, lighting, line/detail, and scale consistency across the family.

The generation instruction must state, as applicable:

- game-ready medieval-fantasy visual style consistent with the existing game;
- exact 1024 x 1024 output;
- fixed 4 x 4 composition of 256 x 256 cells;
- transparent unused cells;
- no text, labels, grid lines, cell borders, watermarks, UI, or debug marks;
- consistent top-down / isometric presentation required by the target family;
- consistent scale, palette, material language, edge alignment, lighting convention, and visual density;
- each occupied cell contains only the semantic tile assigned to that cell.

If the available image tool cannot produce or preserve a compliant PNG, **do not fall back to SVG** and do not mark the visual-production task complete. Record the tooling limitation truthfully and route/create the smallest tooling or integration issue required by current issue-governance rules.

## Deterministic slicing

After the master PNG is accepted for slicing, each occupied cell must be exported by exact pixel crop only:

`left = col * 256`
`top = row * 256`
`right = left + 256`
`bottom = top + 256`

Rules:

- Slice size must be exactly **256 x 256 px PNG**.
- Do not resize, resample, redraw, regenerate, stretch, crop inside the cell, or alter aspect ratio during slicing.
- Do not apply per-slice color correction or effects that make slices diverge from the master atlas.
- Preserve alpha exactly except for a documented lossless PNG optimization that does not alter pixels.
- Stable naming: `<family>_<semantic-type>_256px.png`.

## Manifest

Each atlas family must have a JSON manifest. Follow the established road manifest shape:

```json
{
  "version": 1,
  "family": "road",
  "atlas": {
    "filename": "road_atlas_1024px.png",
    "width": 1024,
    "height": 1024,
    "columns": 4,
    "rows": 4,
    "cellSize": 256
  },
  "tiles": [
    {
      "row": 0,
      "col": 0,
      "type": "straight_vertical",
      "filename": "road_straight_vertical_256px.png",
      "sha256": "..."
    }
  ]
}
```

The manifest must truthfully map every occupied cell to its semantic type and exact slice filename. Record SHA-256 for final slices when the project tooling can compute it. Do not list unused transparent cells as runtime tiles unless a runtime contract explicitly requires them.

## Runtime integration

- Runtime registry/loader references must point to the final PNG slices or the explicitly supported PNG atlas path.
- Artwork is presentation only. It must not become authority for walkability, collision, route semantics, profession, building identity, NPC identity, resources, or Simulation state.
- A visual family is not complete merely because files exist; integration issues must verify the intended PNG is actually selected/rendered where required.

### Mandatory 100x100 static composition

Except for NPC world sprites, PNG slices are **source artwork, not independent runtime image objects**.

All roads, paths, terrain transitions, buildings, walls, floors, roofs, trees, vegetation, furniture, props, resources, ruins and other non-NPC world artwork must follow `.github/STATIC_TILE_COMPOSITION_STANDARD.md`:

1. The logical terrain/base is resolved first.
2. The selected transparent 256 x 256 PNG slice is scaled into an exact 100 x 100 logical-tile composition surface.
3. Transparent pixels reveal the already-resolved base terrain. Example: a transparent tree tile is painted over grass to create one grass+tree 100 x 100 tile image.
4. The completed 100 x 100 RGBA result is flushed through the shared background presentation path.
5. The PNG slice must not remain as a separate road/building/tree/object canvas, DOM element or per-object runtime sprite.

For multi-tile buildings/objects, Texture Artist must provide tile-local semantic parts. Each covered world tile receives its appropriate transparent source part and is flattened independently into that tile's 100 x 100 runtime composite.

Do not bake unrelated opaque terrain into transparent object families merely to mimic the final composite. The runtime composition stage owns base+overlay combination.

## Texture Artist handoff gate

Texture Artist may hand an asset issue to Tester only when all applicable items are true:

1. No required deliverable is SVG/vector-only.
2. The canonical master atlas exists as an exact 1024 x 1024 PNG for reusable tile families.
3. Required cells contain the requested semantic variants and unused cells are fully transparent.
4. Every exported tile is an exact 256 x 256 PNG crop from the master.
5. Stable filenames and manifest mappings are present.
6. Art style, scale, edge continuity/seams, transparency, and family consistency were actually inspected to the extent available.
7. Required runtime registration/integration owned by the issue is complete.
8. Every non-NPC runtime integration identifies its 100 x 100 static composition role/order and does not require an independent static world-image layer.
9. Audit records the atlas path, occupied cell map, slice paths, manifest path, actual checks, limitations, 100 x 100 composition usage, and next verification step.

Any failure keeps/returns the issue to **Texture Artist / READY** (or the smallest responsible correction role under current issue routing). It must not receive a visual PASS.

## Tester verification gate

Tester must independently verify, as applicable:

- PNG file signatures/format rather than extension alone;
- exact 1024 x 1024 master dimensions;
- 4 x 4 / 256 x 256 cell geometry;
- fully transparent unused cells;
- exact 256 x 256 slice dimensions;
- slice-to-atlas pixel identity and row/column mapping;
- stable semantic filenames/manifest entries;
- visible seams, edge continuity, scale and style at representative gameplay zooms;
- correct runtime selection/rendering;
- absence of SVG production assets in the family;
- for non-NPC world art, correct alpha composition into the exact 100 x 100 logical tile and absence of a separate persistent static presentation layer.

Tester must FAIL any new/corrected Texture Artist deliverable that uses SVG or bypasses either the PNG atlas pipeline or the 100 x 100 static composition pipeline without an explicit Admin override.

## Reference implementation

`textures/tiles/road/road_tiles.manifest.json` is the existing semantic/grid reference for the atlas structure and sliced PNG naming. New families should preserve this deterministic model while using the semantic tile types appropriate to their own issue.