# Binary File Rule

GitHub is the authoritative project record. Google Drive `The_Advisor_Game/` is the required mirror/staging path for binary files.

## Never upload binaries with GitHub APIs

**Do not use GitHub Blob, Create Blob, base64 upload, binary-upload APIs, Git trees, or similar GitHub binary methods for PNG, JPG/JPEG, WEBP, GIF, ZIP, or other binary files.**

## Required binary flow

1. Finish permitted processing of the Admin-provided binary.
2. Put the exact output files in the Google Drive `The_Advisor_Game/` mirror.
3. Use the exact repository-relative paths and filenames.
4. If a file already exists in Drive, update/replace that file. Do not create duplicate filenames.
5. Set `Repository state: DRIVE_PENDING_ADMIN_PUSH`.
6. Clear the worker claim.
7. Send `ADMIN ACTION REQUIRED` with the issue number and exact repository-relative paths.
8. Workers skip this issue until Admin commits and pushes the mirrored files.
9. After the files appear in GitHub, verify them and set `Repository state: GITHUB_VERIFIED`.
10. Continue the normal handoff.

## Completion rule

Drive upload, Drive sync, or a local working-tree file is **not** GitHub integration.

Tester must not pass or close repository-changing work while it is `DRIVE_PENDING_ADMIN_PUSH`.

See `WORKFLOW.md` and `.github/ISSUE_STANDARD.md`.