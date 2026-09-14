# TEXTURE_ATLAS_STANDARD

AUTHORITY: Admin > README > ROADMAP > TODO > issues > code/assets > tests.

ATLAS_IMAGE_DEFINITION:
- **ATLAS IMAGE** means one production tile-source sheet for the single coherent visual family named by the governing issue or explicit Admin request.
- An ATLAS IMAGE is **not** a world map, region map, scene illustration, poster, splash screen, concept-art sheet, UI mockup, infographic, or labeled presentation image.
- When Admin says `create`, `draw`, or `generate an atlas image for issue #N`, first read issue `#N`, identify the exact requested visual family, and create only that family as the atlas source sheet. The issue number is lookup/context metadata and MUST NOT be drawn into the image.
- Unless an explicit higher-authority instruction says otherwise, the canonical ATLAS IMAGE target is one exact `1000x1000 RGBA PNG` interpreted as a `10x10` grid of exact `100x100` cells.
- The grid is structural, not decorative. The image itself MUST NOT contain visible grid lines, cell borders, coordinates, row/column labels, tile numbers, titles, captions, legends, compass roses, decorative frames, watermarks, issue numbers, or UI text.
- Each occupied cell MUST remain a valid independently sliceable tile when cut exactly on the 100-pixel cell boundaries. Artwork MUST NOT accidentally cross into neighboring cells.
- A multi-cell composition is allowed only when the governing issue explicitly requires one and every occupied cell has a stable semantic role after slicing.
- Unused cells MUST be fully transparent.
- Overlay/object families such as trees, vegetation, roads, paths, structures, props, and transition pieces use transparent background around the intended artwork unless the governing issue explicitly requires an opaque base. Terrain/base families may be opaque where appropriate.
- `Top-down atlas` or `top-down view atlas` means direct overhead/orthographic game-art presentation with no horizon and no perspective or isometric camera tilt, unless the governing issue explicitly requests a different projection.
- All occupied cells in one atlas must share coherent scale, lighting direction, material language, and art style appropriate to the requested family.
- Atlas content MUST stay within the requested family. Do not fill cells with unrelated world scenery merely to occupy the sheet.

SOURCE:
- Only Admin may request or authorize creation of new visual source images, including atlas images, standalone sprites, replacement artwork, textures, and other production imagery.
- Texture Artist uses Admin-provided artwork only.
- Texture Artist MUST NOT generate, redraw, synthesize, procedurally create, request image generation for, or substitute replacement artwork.
- Missing required artwork is an Admin-provided-input condition and never permission for a worker to manufacture placeholders or alternate source art.
- Production atlas processing MUST execute `tools/tile_atlas_tool.py`.

CANONICAL_FORMAT:
- Atlas: `1000x1000 RGBA PNG`.
- Grid: `10x10`.
- Cell: `100x100`.
- Capacity: 100 tiles.
- Ordering: row-major.
- Source artwork needs no borders/numbers/labels.
- Normalize source to 1000x1000 before slicing.
- Slice directly; border trim = 0.

OUTPUT:
- `<family>_atlas_1000px.png`.
- `<family>_<semantic>_100px.png` per occupied cell.
- `<family>_tiles.manifest.json`.
- `<family>_tiles.descriptions.json`.
- Target: `textures/tiles/<family>/`.

SEMANTICS:
- Default stable IDs: `r00_c00` ... `r09_c09`.
- Metadata may replace default IDs/descriptions.
- Duplicate semantic IDs are invalid.

GITHUB:
- EACH PNG = separate binary Git blob.
- Collect blob SHAs.
- One tree -> one commit -> branch ref update.
- Text JSON = separate UTF-8 Git blob or equivalent text-safe operation.
- Never use aggregate family size as per-file upload failure reason.
- If direct binary publishing is unavailable for an existing Admin-provided asset, follow `WORKFLOW.md` and `.github/DRIVE_BINARY_FALLBACK.md`; do not stop the integration solely because of connector capability.
- Fallback staging is not repository completion. Verify the final files in GitHub before Tester handoff.

ACCEPTANCE:
- Master exact 1000x1000 RGBA.
- Tiles exact 100x100 RGBA.
- Tool manifest matches outputs.
- Runtime uses committed family.
- Tester verifies before closure.
