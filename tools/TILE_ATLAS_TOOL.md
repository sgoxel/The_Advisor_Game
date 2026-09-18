# Tile Atlas Tool

Use `tools/tile_atlas_tool.py` for production atlas processing. The canonical production contract is `.github/TEXTURE_ATLAS_STANDARD.md`.

## Required format

- Master atlas: exact `1000x1000 RGBA PNG`.
- Grid: `10x10`.
- Cell/runtime tile: exact `100x100 RGBA PNG`.
- Order: row-major.
- Border trim: `0`.
- No visible grid, labels, numbers, or borders in source artwork.
- Normalize/repack the logical source grid into the canonical 1000x1000 master before output.

## Output

Default target:

`textures/tiles/<family>/`

Outputs:

- `<family>_atlas_1000px.png`
- `<family>_<semantic>_100px.png`
- `<family>_tiles.manifest.json`
- `<family>_tiles.descriptions.json`
- `<family>_atlas.qa.json`

Default semantic IDs are `r00_c00` through `r09_c09`.

## Commands

Export locally:

`python tools/tile_atlas_tool.py INPUT --family grass --output OUTPUT`

Stage exact outputs into the configured Google Drive repository mirror:

`python tools/tile_atlas_tool.py INPUT --family grass --output OUTPUT --stage-drive-root DRIVE_MIRROR`

Use `--stage-prefix` only when the repository-relative destination differs from `textures/tiles/<family>`.

## Binary publication

Workers do not publish PNG or other binary outputs through GitHub APIs. Stage the exact tool outputs in the configured Google Drive `The_Advisor_Game/` repository mirror at their repository-relative paths. Admin performs the GitHub binary push. After that push, verify the expected GitHub paths and hashes.

Canonical atlas geometry and binary publication rules are defined by `.github/TEXTURE_ATLAS_STANDARD.md`. Agent operating behavior is defined by `AGENTS.md` and the applicable `.agents/<role>.md`. Task Issues may add task-specific requirements but do not replace the canonical atlas standard.

## Verify

- Master is exact 1000x1000 RGBA.
- Grid is exactly 10x10 and ordering is row-major.
- Every emitted runtime tile is exact 100x100 RGBA with trim 0.
- Occupied tile count matches the manifest.
- SHA-256 values match the files where checked.
- Drive staging preserves exact repository-relative paths and bytes.
- No worker-facing GitHub binary publication option exists.
- After Admin push, expected paths exist in GitHub.
