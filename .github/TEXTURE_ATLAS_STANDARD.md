# TEXTURE_ATLAS_STANDARD

AUTHORITY: Admin > README > ROADMAP > TODO > issues > code/assets > tests.

SOURCE:
- Texture Artist uses Admin-provided artwork only.
- Texture Artist MUST NOT generate/redraw/synthesize replacement artwork.
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

ACCEPTANCE:
- Master exact 1000x1000 RGBA.
- Tiles exact 100x100 RGBA.
- Tool manifest matches outputs.
- Runtime uses committed family.
- Tester verifies before closure.
