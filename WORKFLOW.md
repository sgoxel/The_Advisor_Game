# The Advisor Game Workflow

## Authority

Use this order when rules conflict:

**Admin > README.md > ROADMAP.md > TODO > issues > code/assets > tests**

`README.md` is product truth. Do not edit it unless Admin explicitly asks.

## Core rule

**Player advises -> AI Character decides -> Simulation validates -> World reacts.**

Simulation owns authoritative game state and outcomes.

## Simple work flow

1. Read `README.md` first.
2. Read `.github/ISSUE_STANDARD.md`.
3. Read the issue and any role-specific standard it names.
4. Complete one eligible issue at a time.
5. Record real checks and evidence only.
6. Hand the issue to the next required role.
7. Tester verifies before closure.

## Text and code files

Use GitHub directly for supported text/code changes.

Examples: `.md`, `.js`, `.html`, `.css`, `.json`, issues, comments, and other UTF-8 text files.

## Images and other binary files — REQUIRED RULE

**Never upload binary files to GitHub with GitHub Blob, Create Blob, base64 upload, binary-upload APIs, Git trees, or similar GitHub binary methods.**

This includes PNG, JPG/JPEG, WEBP, GIF, ZIP, and other binary files.

For every binary file:

1. Put the file in the configured Google Drive folder that mirrors the GitHub repository: `The_Advisor_Game/`.
2. Use the exact repository-relative path and filename.
3. If the same Drive file already exists, update/replace that Drive file. Do not create duplicate filenames.
4. Set the issue to `Repository state: DRIVE_PENDING_ADMIN_PUSH`.
5. Clear the worker claim.
6. Tell Admin `ADMIN ACTION REQUIRED` and give the exact repository-relative paths.
7. Admin commits and pushes the mirrored files to GitHub.
8. After the files are visible in GitHub, verify them and set `Repository state: GITHUB_VERIFIED`.
9. Continue the normal role handoff.

Drive staging is not GitHub completion. Tester must not pass or close repository-changing work while it is `DRIVE_PENDING_ADMIN_PUSH`.

## Repository states

- `NONE`: no repository output is ready yet, or the state does not apply.
- `DRIVE_PENDING_ADMIN_PUSH`: binary files are in the Drive mirror but are not yet verified in GitHub. Workers skip this issue until Admin pushes them.
- `GITHUB_VERIFIED`: required repository files are visible and verified in GitHub.

## Visual creation rule

Only Admin may request or authorize new production artwork.

Texture Artist does not create, redraw, synthesize, or substitute artwork. Texture Artist processes and integrates Admin-provided artwork only.

If required artwork is missing, report the missing Admin input. Do not create a placeholder.

For atlas requests, follow `.github/TEXTURE_ATLAS_STANDARD.md`.

## Final truth rule

Never claim a commit, upload, test, notification, deployment, verification, or release unless it actually happened and evidence exists.