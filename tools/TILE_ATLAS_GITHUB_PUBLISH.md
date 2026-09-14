# TILE_ATLAS_GITHUB_PUBLISH

INPUT:
- Exact files emitted by `tools/tile_atlas_tool.py`.

DIRECT PUBLISHING:
- Publish each PNG as an independent binary Git object.
- Publish each JSON as an independent UTF-8 Git object.
- Build the repository tree under `textures/tiles/<family>/`.
- Create the commit only after all required objects are ready.
- Verify all expected repository paths before claiming completion.

RULES:
- Never combine multiple PNG files into one object.
- Never alter Tile Atlas Tool PNG bytes after tool output.
- A failed publishing attempt must not advance the repository branch.

BINARY FALLBACK:
When the Admin-provided atlas already exists but the active GitHub connection cannot publish the binary files, follow `WORKFLOW.md` and `.github/DRIVE_BINARY_FALLBACK.md`.

- Stage the exact approved outputs under `textures/tiles/<family>/` in the configured Drive-synchronized repository tree.
- Set `Repository state: DRIVE_PENDING_ADMIN_PUSH` and clear the worker claim.
- Send `ADMIN ACTION REQUIRED` in the current chat and through the available routine notification surface. Include the issue number and exact repository-relative paths that require Admin commit/push.
- Drive staging and local sync are not GitHub integration.
- Workers skip the pending issue and continue other eligible work while waiting for the Admin push.
- After the Admin push is visible, verify the expected files in GitHub, set `Repository state: GITHUB_VERIFIED`, and continue the normal handoff.

VERIFY:
- Every expected path exists after commit/push.
- Every PNG remains binary PNG.
- Tile dimensions = `100x100`.
- Master dimensions = `1000x1000`.
- Manifest SHA-256 matches source bytes when checked locally.
