# 4x4 Tile Atlas Tool

Small deterministic utility for Texture Artist atlas post-processing.

It does **not** create artwork. It converts a generated source image into the repository's canonical atlas geometry and produces border-safe derived tiles.

## Install

```bash
python -m pip install -r tools/tile_atlas_tool_requirements.txt
```

## GUI

```bash
python tools/tile_atlas_tool.py --gui
```

Running the script without arguments also opens the GUI.

## CLI

```bash
python tools/tile_atlas_tool.py generated.png --family grass --output textures/tiles/grass --mode fit
```

Normalization modes:

- `fit`: preserves source aspect ratio and adds transparent padding where necessary.
- `crop`: preserves aspect ratio, fills 1024x1024, and center-crops overflow.
- `stretch`: directly resizes to 1024x1024; use only when distortion is acceptable.

The retained canonical master is always exact 1024x1024 RGBA PNG.

## Border-safe derived tile policy

Every canonical 256x256 cell is processed identically, whether a visible separator/grid line exists or not:

1. Crop the exact 256x256 cell from the canonical atlas.
2. Remove exactly 1 pixel from the top, bottom, left, and right edges.
3. The remaining image is exactly 254x254.
4. Resize that 254x254 image back to exactly 256x256 using LANCZOS resampling.
5. Save the result as the derived 256x256 RGBA PNG tile.

This deterministic policy prevents an accidental one-pixel atlas separator at a cell boundary from surviving into the derived tile without requiring unreliable border detection. The retained canonical atlas itself is not modified by this operation.

The manifest records this border-processing policy for auditability.

## Semantic names and descriptions

Optional JSON can provide up to 16 semantic cells in row-major order:

```json
{
  "tiles": [
    {"semantic_type": "oak_broadleaf", "description": "Broad mature oak tree."},
    {"semantic_type": "spruce_evergreen", "description": "Dense evergreen spruce."}
  ]
}
```

Use it with:

```bash
python tools/tile_atlas_tool.py generated.png -f tree -o textures/tiles/tree --semantics tree_cells.json
```

Unspecified cells receive deterministic `tile_00` ... `tile_15` names. Fully transparent cells are skipped by default but remain represented in metadata. Use `--include-transparent` to emit them as PNG files too.

## Output

For family `tree`, the tool creates:

- `tree_atlas_1024px.png`
- `tree_<semantic-type>_256px.png` for emitted cells
- `tree_tiles.manifest.json`
- `tree_tiles.descriptions.json`

The manifest records atlas geometry, border-processing policy, row/column coordinates, filenames, transparency state and SHA-256 hashes.

## Project use

For Texture Artist work, `.github/TEXTURE_ATLAS_STANDARD.md` and the issue contract remain authoritative. This utility is the deterministic normalization/slicing step after artwork generation; it does not make a non-compliant source image production-ready by itself.
