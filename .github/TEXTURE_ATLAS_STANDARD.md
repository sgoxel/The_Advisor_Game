# TEXTURE_ATLAS_STANDARD

AUTHORITY: Admin > README > ROADMAP > TODO > issues > code/assets > tests.

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
