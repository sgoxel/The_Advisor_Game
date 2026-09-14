# The Advisor Game Workflow

## Authority
GitHub remains the authoritative workspace and audit record. Google Drive is permitted only as a binary-file staging and handoff fallback when the active GitHub connector cannot directly publish a required local or chat-produced binary asset.

## Normal path
Admin-provided asset -> Texture Artist validation/processing -> GitHub commit -> GitHub verification -> Tester.

## Binary publishing fallback
When direct GitHub binary upload is unavailable but the Admin-provided asset exists:

1. Texture Artist completes all permitted validation and processing.
2. Stage the resulting binary files in the configured Google Drive `The_Advisor_Game` repository-sync folder using their exact repository-relative paths.
3. Preserve the canonical atlas, emitted slices, manifests/descriptions, and other issue-required files exactly as produced by the approved tooling.
4. Continue the repository sync/commit/push workflow.
5. Verify that the staged files actually appear in GitHub before claiming repository integration is complete.
6. Record both the staging paths and final GitHub evidence in the issue audit.

Drive staging is not completion and is never authoritative project state. A connector limitation is not equivalent to missing Admin artwork and must not cause a Texture Artist task to stop when an approved staging path is available.

## Text and code
Text/code changes should be written directly to GitHub when the connector supports them. Drive fallback is primarily for binary assets that cannot be passed directly to the GitHub connector from the active session.

## Visual creation boundary
Only Admin may request or authorize creation of new production imagery. Texture Artist integrates Admin-provided artwork and must not generate, redraw, synthesize, procedurally create, or substitute replacement artwork.
