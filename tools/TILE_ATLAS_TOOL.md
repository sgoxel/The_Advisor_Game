# Tile Atlas Tool

Use `tools/tile_atlas_tool.py` for production atlas processing.

## Required format

- Master atlas: exact `1000x1000 RGBA PNG`.
- Grid: `10x10`.
- Cell/runtime tile: exact `100x100 RGBA PNG`.
- Order: row-major.
- No visible grid, labels, numbers, or borders in source artwork.
- Normalize the whole source to 1000x1000 before slicing when needed.
- Slice directly with border trim `0`.

## Output

Default target:

`textures/tiles/<family>/`

Outputs:

- `<family>_atlas_1000px.png`
- `<family>_<semantic>_100px.png`
- `<family>_tiles.manifest.json`
- `<family>_tiles.descriptions.json`

Default semantic IDs are `r00_c00` through `r09_c09`.

## Commands

Export to a folder:

`python tools/tile_atlas_tool.py INPUT --family grass --output OUTPUT --mode fit`

Process directly into a checked-out project:

`python tools/tile_atlas_tool.py INPUT --family grass --project-root PROJECT --mode fit`

## Do not use the GitHub publish option for binary files

**Do not use `--github-publish` for PNG or other binary output. Do not use GitHub Blob, Create Blob, base64 upload, Git trees, or similar GitHub binary-upload methods.**

For binary output, copy/stage the exact tool outputs into the Google Drive `The_Advisor_Game/` repository mirror at their exact repository-relative paths. Admin then commits/pushes the mirrored files.

See `WORKFLOW.md` and `.github/DRIVE_BINARY_FALLBACK.md`.

## Verify

- Master is exact 1000x1000 RGBA.
- Every emitted tile is exact 100x100 RGBA.
- Occupied tile count matches the manifest.
- SHA-256 values match the files where checked.
- After Admin push, expected paths exist in GitHub.