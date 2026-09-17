# AGENTS

Admin instructions override this file.

## Protected
Never modify, rename, delete, replace, or substitute `AGENTS.md` or `.agents/*.md` unless Admin explicitly requests it.

## Routine
1. Read this file and your `.agents/<role>.md` only.
2. Scan all open Issues.
3. Repair safe workflow defects globally; recover stale locks; recheck verifiable `DELAYED` conditions.
4. Filter to your Role.
5. Skip invalid, locked, delayed, or dependency-blocked Issues.
6. Select highest priority; tie -> lowest Issue number.
7. Read fully; re-read before lock. If changed, restart selection.
8. Set `Claim: <run-id>@<UTC timestamp>` and `Status: ACTIVE`.
9. Re-fetch. Execute only if Claim is still yours and Status is `ACTIVE`.
10. Work only that Issue until Result routing or safe checkpoint. Never hold >1 active Claim.
11. After Result routing, rescan and continue with the next eligible Issue.
12. Stop only when no eligible work remains or the run must end.

Never bind work to a named agent, worker, routine, or session.
Do not read `README.md`, ROADMAP, or unrelated/old Issues. Inspect code/assets/tests only as needed. Dependency Issues are workflow state only.

## Stop/checkpoint
Do not abandon `ACTIVE` work.
If the run must end before completion: leave repository/work state safe; record exact completed work, remaining work, checks, and next step; clear Claim; keep same Role; Coder/Designer -> `READY`; Tester/Reviewer -> `VERIFY`. Use `DELAYED` only for a real unmet external/requirement condition.

## Self-repair
Repair only `Claim: NONE` Issues or stale locks. Never modify a valid `ACTIVE` Issue owned by another run.

May repair workflow fields, legacy roles/states/claims, stale locks, dependencies/handoffs, obsolete worker ownership, removed-governance references, and conflicting operational instructions when product intent is unchanged. Record one compact `Repair:` note only when metadata changes.

Never change Objective, acceptance-criteria meaning, product intent, or technical requirements unless the Issue makes the correction explicit.

Safe roles:
- Game Programmer -> Coder
- Game Designer | UX Designer | Texture Artist -> Designer
- Test | Tester -> Tester
- Review | Reviewer -> Reviewer

Legacy `WAITING` -> `DELAYED`.
Locks >3h are stale.
Stale `ACTIVE`: clear Claim; Tester/Reviewer -> `VERIFY`; others -> `READY`.

Missing requirement/tool/external condition -> `DELAYED`, `Claim: NONE`, exact resume condition, continue queue.
Resolved condition -> Tester/Reviewer `VERIFY`; others `READY`.

Removed governance references are historical only. Do not recreate/require them.
Dependency satisfied by `Status: DONE`, or a closed-completed legacy Issue whose recorded outcome clearly satisfies it. Duplicate/not-planned/ambiguous closure does not satisfy dependency.

## Workflow
- `Role`: Coder | Designer | Tester | Reviewer
- `Priority`: P0 | P1 | P2 | P3 | P4
- `Status`: READY | ACTIVE | VERIFY | DELAYED | DONE
- `Claim`: NONE | `<run-id>@<UTC timestamp>`
- `Dependency`: NONE | issue numbers
- `Handoff`: NONE | role chain

Eligible: valid fields; matching Role; `READY`, or `VERIFY` for Tester/Reviewer; dependencies satisfied; `Claim: NONE`.
No eligible Issue -> end cleanly.

## Visual
Primary evidence: latest successful GitHub Actions visual-review capture for the tested main commit. `tools/screenshot_tool.py` is fallback only.

Standard: phone `720x1280` + tablet `1280x800`.
NPC/action/flicker: 2 frames per viewport, `0.2s` apart.
Evidence must identify commit SHA, viewport, mode, and capture time/run. Stale evidence is invalid.

Reviewer with no eligible Reviewer Issue may inspect latest valid visual evidence. Search open Issues first. Existing defect -> add only materially new evidence. New concrete defect -> one atomic Coder or Designer Issue, normally `Handoff: Tester`.

Capture failure never blocks the queue. Use Actions artifacts; never commit review screenshots.

## Admin
Admin action is allowed only for pushing Admin-created texture-tile binaries already staged in the configured Drive mirror.

Texture push needed -> stage exact Drive/repo paths, set `DELAYED`, `Claim: NONE`, record exact push action, continue queue.
Any other unresolved external condition -> `DELAYED`, `Claim: NONE`, exact resume condition, continue queue. Do not require Admin action.

## Result
PASS:
- `Handoff: NONE` -> `DONE`, `Claim: NONE`, close Issue
- otherwise consume first Handoff role; set Role; remove it; empty -> `NONE`; Tester/Reviewer -> `VERIFY`; others -> `READY`; `Claim: NONE`

Tester/Reviewer FAIL:
- explicit correction role -> set correction Role, prepend failed verification role unless already first, `Status: READY`, `Claim: NONE`
- no explicit correction role -> `DELAYED`, `Claim: NONE`, exact correction/resume condition

After Result routing, rescan and continue until stop condition.
Never invent evidence or product requirements. Record only real actions/results.
All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only
- Coder: `.agents/coder.md`
- Designer: `.agents/designer.md`
- Tester: `.agents/tester.md`
- Reviewer: `.agents/reviewer.md`
