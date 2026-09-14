# Binary staging fallback

GitHub is authoritative. Google Drive is only an approved staging bridge when an Admin-provided binary asset exists but the active GitHub connector cannot directly publish its bytes.

## Required fallback flow

1. Complete all permitted validation and deterministic processing for the existing Admin-provided asset.
2. Stage the exact issue-required files in the configured Google Drive `The_Advisor_Game` repository-sync folder at their exact repository-relative paths.
3. Preserve approved-tool outputs without post-processing changes unless the governing asset standard explicitly requires them.
4. Set the issue `Repository state: DRIVE_PENDING_ADMIN_PUSH`.
5. Clear the active worker claim; a worker must not hold an issue claim while waiting for Admin's manual Git action.
6. Send `ADMIN ACTION REQUIRED` in the current chat with the issue number and exact repository-relative paths requiring commit/push.
7. Trigger the available worker/routine notification surface for the same Admin action. If no notification surface exists in the active execution, record that limitation truthfully and do not claim the notification was sent.
8. Admin allows Drive sync to update the local repository working tree, reviews the intended changes, commits them, and pushes them to GitHub.
9. Workers skip the pending issue and continue other eligible work until the Admin push becomes visible on GitHub.
10. The responsible role then verifies the expected GitHub paths and changes `Repository state` to `GITHUB_VERIFIED` before continuing normal handoff.

## Non-completion rule

Drive staging, Drive upload success, local sync success, or creation of a local Git working-tree file is **not** GitHub integration. Repository integration may be claimed only after GitHub verification.

Tester must not pass or close repository-changing work whose `Repository state` is `DRIVE_PENDING_ADMIN_PUSH`.

See `WORKFLOW.md` for the project-wide workflow and `.github/ISSUE_STANDARD.md` for issue lifecycle rules.
