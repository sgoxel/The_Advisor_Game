# TILE_ATLAS_TOOL

TOOL: `tools/tile_atlas_tool.py`
ROLE: deterministic processing of Admin-provided 4x4 atlas images. TOOL DOES NOT CREATE ARTWORK.

INSTALL:
`python -m pip install -r tools/tile_atlas_tool_requirements.txt`

INPUT:
- Admin-provided atlas image.
- Metadata JSON with exactly 16 row-major cell records.
- Occupied cell requires `semantic_type` and `description`.
- Semantic types must be unique.

CANONICAL_OUTPUT:
- RGBA PNG.
- 1024x1024.
- 4x4 grid.
- 256x256 logical source cells.
- Filename: `<family>_atlas_1024px.png`.

DERIVED_TILE_RULE:
For each occupied 256x256 cell:
1. Crop exact cell.
2. Remove 1 px from top, bottom, left, right.
3. Result = 254x254.
4. Resize to 256x256 with LANCZOS.
5. Save RGBA PNG as `<family>_<semantic-type>_256px.png`.

OUTPUT_SET:
- `<family>_atlas_1024px.png`
- semantic 256x256 PNG tiles
- `<family>_tiles.manifest.json`
- `<family>_tiles.descriptions.json`

NORMALIZATION:
- `fit`: preserve aspect ratio; transparent padding if required.
- `crop`: preserve aspect ratio; center crop.
- `stretch`: direct resize.
- Record original dimensions and selected mode.

CLI:
`python tools/tile_atlas_tool.py <source> --family <family> --metadata <metadata.json> --output <output-dir> --mode <fit|crop|stretch>`

PROJECT_PUBLISH:
`python tools/tile_atlas_tool.py <source> --family <family> --metadata <metadata.json> --project-root <repo-root> --mode <fit|crop|stretch>`

PRODUCTION_RULES:
- Actual `tools/tile_atlas_tool.py` execution is mandatory when available.
- Ad-hoc recreation of its processing is not valid production evidence.
- Exact files emitted by the tool are authoritative derived outputs.
- Do not manually replace or re-slice emitted PNG files.

GITHUB_UPLOAD:
Follow `tools/TILE_ATLAS_GITHUB_PUBLISH.md`.
Upload each PNG separately as one binary blob; collect blob SHAs; then create tree -> commit -> branch ref update.
Do not reject a family because aggregate family size is large.

TEST:
`python -m unittest -v tools/test_tile_atlas_tool.py`

AUTHORITY:
Admin > README > `.github/TEXTURE_ATLAS_STANDARD.md` > `.github/STATIC_TILE_COMPOSITION_STANDARD.md` > issue > code/tests.
