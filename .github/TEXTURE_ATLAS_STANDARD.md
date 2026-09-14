# Texture Atlas Standard

## Authority

**Admin > README.md > ROADMAP.md > TODO > issues > code/assets > tests**

Read the issue before processing or creating an atlas.

## Who may create artwork

Only Admin may request or authorize new production artwork.

Texture Artist may process and integrate Admin-provided artwork, but must not generate, redraw, synthesize, or substitute source artwork.

If required artwork is missing, notify Admin. Do not create a placeholder.

## What an atlas image is

An **atlas image** is one production tile-source sheet for one visual family named by the issue or Admin.

It is not a world map, region map, scene illustration, poster, splash image, UI mockup, infographic, or labeled presentation sheet.

If Admin says `create/draw/generate an atlas image for issue #N`:

1. Read issue `#N`.
2. Identify the exact requested visual family.
3. Create only that family.
4. Do not draw the issue number into the image.

## Top-down meaning

`Top-down atlas` means direct overhead/orthographic game art.

Do not use a horizon, perspective view, or isometric tilt unless the issue explicitly requires it.

## Canonical format

- Master: exact `1000x1000 RGBA PNG`.
- Grid: `10x10`.
- Cell: exact `100x100`.
- Capacity: 100 cells.
- Order: row-major.
- Unused cells: fully transparent.
- Overlay/object families: transparent background around the artwork unless the issue says otherwise.
- Terrain/base families may be opaque where appropriate.

The grid is structural only. Do not draw visible grid lines, borders, coordinates, tile numbers, labels, titles, captions, legends, watermarks, issue numbers, or UI text.

Each occupied cell must be independently sliceable on exact 100-pixel boundaries. Artwork must not accidentally cross into another cell.

Use a multi-cell composition only when the issue explicitly requires it and every occupied cell still has a stable semantic role.

All occupied cells must use coherent scale, lighting, materials, and style.

## Required tool

Production atlas processing must run:

`tools/tile_atlas_tool.py`

Normalize the whole source to 1000x1000 when needed, then slice directly with border trim `0`.

## Output

Target folder:

`textures/tiles/<family>/`

Required outputs:

- `<family>_atlas_1000px.png`
- `<family>_<semantic>_100px.png` for each occupied cell
- `<family>_tiles.manifest.json`
- `<family>_tiles.descriptions.json`

Default semantic IDs are `r00_c00` through `r09_c09`. Metadata may replace them. Duplicate semantic IDs are invalid.

## Binary upload rule — mandatory

**Never upload atlas PNGs or other binary files to GitHub using GitHub Blob, Create Blob, base64 upload, binary-upload APIs, Git trees, or similar GitHub binary methods.**

Instead:

1. Put the master, slices, and other binary outputs in the Google Drive `The_Advisor_Game/` repository mirror.
2. Use exact repository-relative paths and filenames.
3. Update/replace existing Drive files instead of creating duplicate filenames.
4. Set `Repository state: DRIVE_PENDING_ADMIN_PUSH` and clear the worker claim.
5. Tell Admin the exact paths that require commit/push.
6. After Admin pushes them, verify the files in GitHub and set `Repository state: GITHUB_VERIFIED`.

Text metadata may be written directly to GitHub when supported, but do not claim the atlas family is integrated until its required binary files are visible in GitHub.

## Acceptance

- Master is exact 1000x1000 RGBA PNG.
- Required tiles are exact 100x100 RGBA PNG.
- Manifest/descriptions match the outputs.
- Runtime uses the committed family where required.
- GitHub paths are verified after Admin push.
- Tester independently verifies before closure.