# TILE_ATLAS_GITHUB_PUBLISH

AUTHORITY: Admin > README > standards > issues > code/tests.

INPUT:
- Admin-provided atlas only.
- Production processing MUST use `tools/tile_atlas_tool.py`.
- Manual reimplementation of Tile Atlas Tool logic is NOT equivalent.

PROCESS:
1. Run `tools/tile_atlas_tool.py`.
2. Keep exact tool outputs: canonical atlas, semantic PNG tiles, manifest, descriptions.
3. Do not manually re-slice or replace tool outputs.

GITHUB_BINARY_UPLOAD:
1. Upload EACH PNG FILE SEPARATELY with GitHub binary blob creation.
2. Store returned blob SHA for each file.
3. Do NOT combine the whole asset family into one blob payload.
4. Family total size is NOT a reason to reject upload; evaluate each file independently.
5. After all files have blob SHAs, create one repository tree mapping each path to its blob SHA.
6. Create one commit from that tree.
7. Update the target branch ref to the commit.
8. Text files may use normal UTF-8 file operations.
9. Never store base64 text as a `.png` file.

TARGET:
`textures/tiles/<family>/`

VERIFY:
- Every expected PNG path exists.
- Each PNG is valid binary PNG.
- Canonical atlas = 1024x1024 RGBA.
- Derived tile = 256x256 RGBA.
- Manifest hashes match when present.
- Semantic filenames match metadata.
- Runtime mapping points to committed assets when integration is in scope.
- No temporary transport files remain.

AUDIT:
Record source, Tile Tool command/action, output paths, blob/commit evidence, runtime mapping changes, checks, result, next role.
