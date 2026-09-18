# AGENTS

Admin overrides this file.

## Protected
Never modify `AGENTS.md` or `.agents/*.md` unless Admin explicitly requests it.

## Workers
`AGENT #1`..`AGENT #5` are labels only; never ownership or fixed Role.

## Loop
1. Read this file.
2. Scan all open Issues; repair safe workflow defects, stale locks, and verifiable `DELAYED` conditions.
3. Eligible: valid fields; `Claim: NONE`; dependencies satisfied; `READY`, or `VERIFY` for Tester/Reviewer.
4. Select highest Priority globally; tie -> lowest Issue number.
5. Adopt Issue `Role`; read `.agents/<role>.md` + selected Issue only.
6. Re-read Issue; changed -> restart selection.
7. Set `Claim: <run-id>@<UTC timestamp>` + `Status: ACTIVE`; wait random 2-8s; re-fetch; continue only if Claim is yours and Status `ACTIVE`.
8. Before every material repo/Issue write after locking, re-fetch and confirm ownership. Lost Claim -> stop touching that Issue; rescan.
9. Work only that Issue until Result routing or safe checkpoint. Never hold >1 active Claim.
10. Release Claim; rescan immediately; continue.
11. No claimable Issue -> run Visual Idle Audit once if needed, then rescan with backoff 30s -> 60s -> 120s cap. Never end merely because the queue is empty; continue until the execution environment ends the run.

Never bind work to a named worker/session. Do not read README/ROADMAP/unrelated Issues. Inspect only files required by the selected Issue. Dependency Issues are workflow state only.

## Checkpoint
Never abandon `ACTIVE` work. If the run must end mid-Issue: leave work safe; record done/remaining/checks/next step; clear Claim; keep Role; Coder/Designer -> `READY`; Tester/Reviewer -> `VERIFY`. Use `DELAYED` only for a real unmet external/requirement condition.

## Repair
Repair only `Claim: NONE` or stale locks. Never alter a valid `ACTIVE` Issue owned by another run.
May repair workflow fields, legacy roles/states/claims, stale locks, dependencies/handoffs, obsolete ownership, removed-governance references, and conflicting operational instructions when product intent is unchanged. Add one compact `Repair:` note only when metadata changes.
Never change Objective, acceptance meaning, product intent, or technical requirements unless the Issue explicitly defines the correction.

Aliases: Game Programmer -> Coder; Game Designer | UX Designer | Texture Artist -> Designer; Test | Tester -> Tester; Review | Reviewer -> Reviewer.
`WAITING` -> `DELAYED`. Locks >3h are stale. Stale `ACTIVE`: clear Claim; Tester/Reviewer -> `VERIFY`; others -> `READY`.
Missing requirement/tool/external condition -> `DELAYED`, `Claim: NONE`, exact resume condition; continue queue.
Resolved condition -> Tester/Reviewer `VERIFY`; others `READY`.
Dependency satisfied by `Status: DONE`, or closed-completed legacy Issue whose outcome clearly satisfies it. Duplicate/not-planned/ambiguous closure does not satisfy dependency.

## Workflow
- `Role`: Coder | Designer | Tester | Reviewer
- `Priority`: P0 | P1 | P2 | P3 | P4
- `Status`: READY | ACTIVE | VERIFY | DELAYED | DONE
- `Claim`: NONE | `<run-id>@<UTC timestamp>`
- `Dependency`: NONE | issue numbers
- `Handoff`: NONE | role chain

## Result
Before routing, re-fetch and confirm Claim ownership.
PASS:
- `Handoff: NONE` -> `DONE`, `Claim: NONE`, close Issue
- else consume first Handoff role; set Role; remove it; empty -> `NONE`; Tester/Reviewer -> `VERIFY`; others -> `READY`; `Claim: NONE`

Tester/Reviewer FAIL:
- explicit correction role -> set correction Role; prepend failed verification role unless already first; `READY`; `Claim: NONE`
- no explicit correction role -> `DELAYED`; `Claim: NONE`; exact correction/resume condition

After routing, rescan immediately.

## Visual
Primary evidence: latest successful Actions visual-review artifact for current tested `main`. Fallback: `tools/screenshot_tool.py`.
Standard: phone `720x1280` + tablet `1280x800`. NPC/action/flicker: 2 frames/view, `0.2s` apart. Evidence must match commit and identify viewport/mode/run/time; stale evidence invalid.

### Visual Idle Audit
When no Issue is claimable, any worker may act as Reviewer and must use the idle time for a fresh visual QA pass.
1. Run `tools/screenshot_tool.py` against the latest current-main/public build using the repository-supported capture flow. If fresh capture is unavailable, use the latest valid current-main visual evidence instead.
2. Inspect the newest screenshots for concrete bugs or worthwhile visual/UX improvements. Record commit/build, viewport, mode, run/time when available.
3. Search all open Issues for the same or substantially similar finding before creating anything.
4. Existing finding -> add only genuinely new evidence when useful. New concrete finding -> open one small atomic Coder/Designer bug-fix or improvement Issue, normally `Handoff: Tester`, with factual screenshot evidence, observation/reproduction details, acceptance criteria, and valid workflow fields.
5. Do not create duplicate, speculative, unsupported, roadmap/feature-expansion, or cosmetic-only Issues.
6. If a tracking visual-review Issue/run exists, comment with `Visual-Audit: <run-id>` plus the concise result so the same evidence is not audited repeatedly.
Capture/audit failure never blocks queue. Never commit review screenshots. Never invent evidence.

## Admin
Only mandatory Admin execution step: push Admin-created texture-tile binaries already staged in configured Drive mirror.
Texture push -> exact Drive/repo paths; `DELAYED`; `Claim: NONE`; exact action; continue queue.
Other external blockers -> `DELAYED`; `Claim: NONE`; exact resume condition; continue queue. Do not require Admin action.

Never invent evidence or requirements. Record only real actions/results. All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only
- Coder: `.agents/coder.md`
- Designer: `.agents/designer.md`
- Tester: `.agents/tester.md`
- Reviewer: `.agents/reviewer.md`
