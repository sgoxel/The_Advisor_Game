# 4x4 Tile Atlas Tool

Small deterministic utility for Texture Artist atlas post-processing and project publishing.

It does **not** create artwork. It converts a generated source image into the repository's canonical atlas geometry, collects fixed per-cell presentation metadata, creates border-safe derived tiles, and can publish the complete family into a checked-out project tree.

## Install

```bash
python -m pip install -r tools/tile_atlas_tool_requirements.txt
```

## GUI

```bash
python tools/tile_atlas_tool.py --gui
```

Running the script without arguments also opens the GUI.

The GUI workflow is:

1. Load a generated atlas/image.
2. The complete source is normalized to exact `1024 x 1024 RGBA` before slicing. Square AI outputs such as `960 x 960` or `1280 x 1280` are automatically normalized.
3. Click each of the 16 cells in the 4x4 preview.
4. Enter fixed metadata for every occupied cell.
5. Validate metadata.
6. Either export to a normal folder or select the checked-out project root and choose **Publish to Project**.

## Required per-cell metadata

Occupied cells require:

- `semantic_type`: stable lowercase machine ID used in filenames/runtime lookup;
- `description`: short human-readable explanation of what is visually present.

Optional presentation metadata:

- `display_name`: human-readable label;
- `category`: broad visual category such as `terrain`, `vegetation`, `building`, or `prop`;
- `runtime_usage`: presentation/composition hint such as `terrain/base` or `vegetation/static-overlay`.

A cell may be marked `unused`. For project publishing, an unused cell must also be fully transparent in the canonical atlas.

Metadata is presentation/provenance information only. It does not create Simulation truth.

## Fixed metadata file format

The GUI can save and reload metadata JSON so the same atlas contract can be reused later.

```json
{
  "version": 2,
  "family": "grass",
  "cells": [
    {
      "row": 0,
      "col": 0,
      "semantic_type": "lush_meadow",
      "display_name": "Lush Meadow",
      "description": "Dense healthy village grass with small white flowers.",
      "category": "terrain",
      "runtime_usage": "terrain/base",
      "unused": false
    }
  ]
}
```

Exactly 16 cell records are maintained in row-major order.

Validation rejects:

- missing semantic type on occupied cells;
- missing description on occupied cells;
- duplicate semantic types;
- unstable/invalid family or semantic IDs;
- project publishing when an explicitly unused cell is not fully transparent;
- invalid project roots.

## Normalization modes

- `fit`: preserves source aspect ratio and adds transparent padding where necessary.
- `crop`: preserves aspect ratio, fills 1024x1024, and center-crops overflow.
- `stretch`: directly resizes to 1024x1024; use only when distortion is acceptable.

The retained canonical master is always exact `1024 x 1024 RGBA PNG`.

## Border-safe derived tile policy

Every canonical 256x256 cell is processed identically, whether a visible separator/grid line exists or not:

1. Crop the 256x256 cell from the canonical atlas.
2. Remove exactly 1 pixel from the top, bottom, left, and right edges.
3. The remaining image is exactly 254x254.
4. Resize that 254x254 image back to exactly 256x256 using LANCZOS resampling.
5. Save the result as the derived 256x256 RGBA PNG tile.

This is an explicit Admin-directed override for the derived-tile export path. The retained canonical atlas itself is never modified by the edge operation.

## Output schema

For family `grass`, the tool writes:

- `grass_atlas_1024px.png`
- `grass_<semantic-type>_256px.png` for each occupied cell
- `grass_tiles.manifest.json`
- `grass_tiles.descriptions.json`

Schema version is currently `2`.

The manifest records:

- family;
- canonical atlas filename, geometry, SHA-256 and original source dimensions;
- normalization mode and whether normalization was required;
- derived-tile border policy;
- row/column;
- semantic `type` plus compatibility `semantic_type`;
- optional display name/category/runtime usage;
- filename;
- SHA-256 for each emitted PNG.

The descriptions file records the corresponding human-readable description and presentation metadata for each emitted tile.

## Publish to Project

Choose the repository root in the GUI and press **Publish to Project**.

The tool validates that the selected directory contains `README.md` and `.github`, then writes the family to the fixed project location:

```text
textures/tiles/<family>/
```

Example:

```text
textures/tiles/grass/
    grass_atlas_1024px.png
    grass_lush_meadow_256px.png
    grass_clover_patch_256px.png
    ...
    grass_tiles.manifest.json
    grass_tiles.descriptions.json
```

Before publishing a family, stale derived PNG files matching that same family prefix are removed from that family directory so renamed/removed semantic cells do not remain as orphan runtime assets.

The tool updates only the checked-out local project tree. Normal Git/version-control review and publication remain separate.

## CLI

CLI use requires a metadata JSON so project-consumable output never depends on automatic placeholder names.

Export to a folder:

```bash
python tools/tile_atlas_tool.py generated.png \
  --family grass \
  --metadata grass_atlas_metadata.json \
  --output textures/tiles/grass \
  --mode fit
```

Publish to a checked-out project:

```bash
python tools/tile_atlas_tool.py generated.png \
  --family grass \
  --metadata grass_atlas_metadata.json \
  --project-root /path/to/The_Advisor_Game \
  --mode fit
```

`--semantics` remains accepted as a compatibility alias for `--metadata`.

## Tests

From the `tools` directory:

```bash
python -m unittest -v test_tile_atlas_tool.py
```

The regression suite covers `960 x 960` and `1280 x 1280` normalization, 1-pixel border removal, duplicate semantic detection, fixed project publishing path, and schema output.

## Project use

For Texture Artist work, `.github/TEXTURE_ATLAS_STANDARD.md`, `.github/STATIC_TILE_COMPOSITION_STANDARD.md`, and the active issue contract remain authoritative beneath explicit Admin direction. This utility is the deterministic metadata/normalization/publishing boundary after artwork generation; it does not make visually invalid artwork production-ready by itself.
