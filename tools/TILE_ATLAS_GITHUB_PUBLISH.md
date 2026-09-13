# TILE_ATLAS_GITHUB_PUBLISH

INPUT:
- Exact files emitted by `tools/tile_atlas_tool.py`.
- GitHub token from environment only.

ALGORITHM:
1. Read target branch ref.
2. Read parent commit and base tree.
3. For EACH PNG independently: read bytes -> base64 -> POST Git blob -> store blob SHA.
4. For EACH JSON independently: UTF-8 -> POST Git blob -> store blob SHA.
5. Build tree entries `textures/tiles/<family>/<filename>` from stored blob SHAs.
6. POST one tree using current base tree.
7. POST one commit using current branch commit as parent.
8. PATCH target branch ref to new commit.

RULES:
- Never combine multiple PNG files into one blob payload.
- Family aggregate size is irrelevant to per-file blob upload.
- Never save base64 text as `.png`.
- Never alter Tile Atlas Tool PNG bytes after tool output.
- Failed upload MUST NOT advance branch ref.

VERIFY:
- Every expected path exists after commit.
- Every PNG remains binary PNG.
- Tile dimensions = `100x100`.
- Master dimensions = `1000x1000`.
- Manifest SHA-256 matches source bytes when checked locally.
