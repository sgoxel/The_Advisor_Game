# Atlas Binary Publication Rule

This file name is retained for compatibility, but **direct GitHub binary publication is not allowed by project workflow**.

## Do not use GitHub binary upload methods

For atlas PNGs and all other binary files:

**Do not use GitHub Blob, Create Blob, base64 upload, binary-upload APIs, Git trees, `--github-publish`, or similar GitHub binary methods.**

## Required flow

Input: exact files emitted by `tools/tile_atlas_tool.py`.

1. Keep the tool outputs unchanged unless a governing standard requires another processing step.
2. Put the exact binary outputs in the Google Drive `The_Advisor_Game/` repository mirror.
3. Use the exact repository path `textures/tiles/<family>/` and exact filenames.
4. If the same Drive file already exists, update/replace it. Do not create duplicate filenames.
5. Set `Repository state: DRIVE_PENDING_ADMIN_PUSH`.
6. Clear the worker claim.
7. Send `ADMIN ACTION REQUIRED` with the issue number and exact repository-relative paths.
8. Admin commits and pushes the mirrored files to GitHub.
9. Verify every expected file in GitHub.
10. Set `Repository state: GITHUB_VERIFIED` and continue the normal handoff.

Drive staging or local sync is not GitHub completion.

## Verify after Admin push

- Every expected path exists in GitHub.
- Every PNG remains a valid PNG.
- Tile dimensions are exact `100x100`.
- Master dimensions are exact `1000x1000`.
- Manifest SHA-256 values match source bytes where checked.

See `WORKFLOW.md`, `.github/DRIVE_BINARY_FALLBACK.md`, and `.github/TEXTURE_ATLAS_STANDARD.md`.