# The Advisor Game Workflow

## Authority
GitHub remains the authoritative workspace and audit record. Google Drive is permitted only as a binary-file staging and handoff fallback when the active GitHub connector cannot directly publish a required local or chat-produced binary asset.

Drive is never authoritative project state. A file that exists only in Drive or in the synchronized local repository is not considered integrated into GitHub until the corresponding GitHub path is verified after commit/push.

## Normal path
Admin-provided asset -> Texture Artist validation/processing -> GitHub commit -> GitHub verification -> Tester.

## Binary publishing fallback
When direct GitHub binary upload is unavailable but the Admin-provided asset exists:

1. Texture Artist completes all permitted validation and deterministic processing.
2. Stage the resulting files in the configured Google Drive `The_Advisor_Game` repository-sync folder using their exact repository-relative paths.
3. Preserve the canonical atlas, emitted slices, manifests/descriptions, and other issue-required files exactly as produced by approved tooling.
4. Do not claim that Drive staging is a GitHub commit, GitHub upload, repository integration, or completed handoff.
5. Set the issue `Repository state` to `DRIVE_PENDING_ADMIN_PUSH`.
6. Clear the worker claim. A worker must not keep a claim while waiting for Admin to perform the manual Git operation.
7. Emit an explicit `ADMIN ACTION REQUIRED` warning in the current chat identifying the issue and exact repository-relative paths that require manual commit/push.
8. Trigger the available worker/routine notification surface for the same Admin action. If no notification surface is available in the active execution, record that limitation truthfully in the issue audit and do not claim a notification was sent.
9. Admin allows Drive sync to place the files in the local Git working tree, reviews the intended changes, commits them, and pushes them to GitHub.
10. Until the push is visible in GitHub, workers skip the pending issue and continue other eligible work according to normal role order. `DRIVE_PENDING_ADMIN_PUSH` is not a worker-blocking claim state.
11. After the Admin push is visible, the responsible role verifies the expected GitHub paths and relevant bytes/metadata, changes `Repository state` to `GITHUB_VERIFIED`, and continues the normal role handoff.
12. Tester must not pass or close repository-changing work while its repository state is `DRIVE_PENDING_ADMIN_PUSH`.

A connector limitation is not equivalent to missing Admin artwork and must not cause a Texture Artist task to stop when this approved staging path is available.

## Repository-state meanings

- `NONE`: no repository-changing output has yet been produced, or repository state is not applicable to the current step.
- `DRIVE_PENDING_ADMIN_PUSH`: required repository files were staged through the approved Drive-synchronized working-tree path, but the corresponding GitHub commit/push has not yet been verified.
- `GITHUB_VERIFIED`: the expected repository paths are visible in GitHub and have been verified sufficiently for the next role handoff.

`DRIVE_PENDING_ADMIN_PUSH` must never be represented as `GITHUB_VERIFIED` merely because Google Drive sync completed locally.

## Admin manual Git action
The fallback assumes the configured Google Drive folder is synchronized into the Admin's local Git repository working tree. Admin remains responsible for reviewing `git status`/diff as appropriate, committing only the intended files, and pushing them to GitHub. Workers must never claim that Admin performed these steps until GitHub evidence exists.

## Text and code
Text/code changes should be written directly to GitHub when the connector supports them. Drive fallback is primarily for binary assets that cannot be passed directly to the GitHub connector from the active session.

## Visual creation boundary
Only Admin may request or authorize creation of new production imagery. Texture Artist integrates Admin-provided artwork and must not generate, redraw, synthesize, procedurally create, or substitute replacement artwork.

When Admin explicitly requests an **ATLAS IMAGE**, the request must be interpreted according to `.github/TEXTURE_ATLAS_STANDARD.md` before any image is created or processed. `Create/draw/generate atlas image for issue #N` means: read issue `#N`, identify its exact visual family, and create only the canonical tile-source sheet for that family. It never means a world map, region map, illustrated scene, poster, splash image, UI mockup, infographic, or labeled presentation graphic. The issue number is context only and must not appear inside the artwork.
