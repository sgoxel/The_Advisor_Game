# AGENTS

Admin instructions override this file.

## Protected
Never modify `AGENTS.md` or `.agents/*.md` unless Admin explicitly requests it.

## Routine
Routine names `AGENT #1`..`AGENT #5` are execution labels only; never ownership or role.

1. Read this file.
2. Scan all open Issues.
3. Repair safe workflow defects globally; recover stale locks; recheck verifiable `DELAYED` conditions.
4. Eligible Issues: valid fields; `Claim: NONE`; dependencies satisfied; `READY`, or `VERIFY` when Role is Tester/Reviewer.
5. Select highest Priority globally; tie -> lowest Issue number.
6. Adopt selected Issue `Role`; read `.agents/<role>.md` and the Issue.
7. Re-read Issue before lock. If changed, restart selection.
8. Set `Claim: <run-id>@<UTC timestamp>` and `Status: ACTIVE`.
9. Re-fetch. Execute only if Claim is still yours and Status is `ACTIVE`.
10. Work only that Issue until Result routing or safe checkpoint. Never hold >1 active Claim.
11. Release Claim, rescan all open Issues, adopt the next selected Role, continue.
12. If nothing is claimable, keep rescanning. Never end a run merely because the queue is temporarily empty. Stop only when the execution environment ends the run.

Never bind work to a named agent, worker, routine, or session.
Do not read README/ROADMAP/unrelated Issues. Inspect only files needed by the selected Issue. Dependency Issues are workflow state only.

## Checkpoint
Never abandon `ACTIVE` work. If the run must end before completion: leave work safe; record completed work, remaining work, checks, next step; clear Claim; keep Role; Coder/Designer -> `READY`; Tester/Reviewer -> `VERIFY`. Use `DELAYED` only for a real unmet external/requirement condition.

## Repair
Repair only `Claim: NONE` Issues or stale locks. Never modify a valid `ACTIVE` Issue owned by another run.
May repair workflow fields, legacy roles/states/claims, stale locks, dependencies/handoffs, obsolete ownership, removed-governance references, and conflicting operational instructions when product intent is unchanged. Record one compact `Repair:` note only when metadata changes.
Never change Objective, acceptance meaning, product intent, or technical requirements unless the Issue makes the correction explicit.

Safe roles:
- Game Programmer -> Coder
- Game Designer | UX Designer | Texture Artist -> Designer
- Test | Tester -> Tester
- Review | Reviewer -> Reviewer

Legacy `WAITING` -> `DELAYED`.
Locks >3h are stale. Stale `ACTIVE`: clear Claim; Tester/Reviewer -> `VERIFY`; others -> `READY`.
Missing requirement/tool/external condition -> `DELAYED`, `Claim: NONE`, exact resume condition; continue queue.
Resolved condition -> Tester/Reviewer `VERIFY`; others `READY`.
Removed governance references are historical only.
Dependency satisfied by `Status: DONE`, or closed-completed legacy Issue whose outcome clearly satisfies it. Duplicate/not-planned/ambiguous closure does not satisfy dependency.

## Workflow
- `Role`: Coder | Designer | Tester | Reviewer
- `Priority`: P0 | P1 | P2 | P3 | P4
- `Status`: READY | ACTIVE | VERIFY | DELAYED | DONE
- `Claim`: NONE | `<run-id>@<UTC timestamp>`
- `Dependency`: NONE | issue numbers
- `Handoff`: NONE | role chain

## Visual
Primary evidence: latest successful GitHub Actions visual-review capture for tested main commit. `tools/screenshot_tool.py` is fallback only.
Standard: phone `720x1280` + tablet `1280x800`.
NPC/action/flicker: 2 frames per viewport, `0.2s` apart.
Evidence must identify commit SHA, viewport, mode, capture time/run. Stale evidence is invalid.
Reviewer with no claimable Issue may inspect latest valid visual evidence, search open Issues first, then add new evidence to an existing defect or create one atomic Coder/Designer Issue, normally `Handoff: Tester`.
Capture failure never blocks work. Use Actions artifacts; never commit review screenshots.

## Admin
Admin action is allowed only for pushing Admin-created texture-tile binaries already staged in the configured Drive mirror.
Texture push needed -> exact Drive/repo paths, `DELAYED`, `Claim: NONE`, exact action; continue queue.
Any other unresolved external condition -> `DELAYED`, `Claim: NONE`, exact resume condition; continue queue. Do not require Admin action.

## Result
PASS:
- `Handoff: NONE` -> `DONE`, `Claim: NONE`, close Issue
- otherwise consume first Handoff role; set Role; remove it; empty -> `NONE`; Tester/Reviewer -> `VERIFY`; others -> `READY`; `Claim: NONE`

Tester/Reviewer FAIL:
- explicit correction role -> set correction Role, prepend failed verification role unless already first, `READY`, `Claim: NONE`
- no explicit correction role -> `DELAYED`, `Claim: NONE`, exact correction/resume condition

After Result routing, rescan immediately.
Never invent evidence or requirements. Record only real actions/results.
All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only
- Coder: `.agents/coder.md`
- Designer: `.agents/designer.md`
- Tester: `.agents/tester.md`
- Reviewer: `.agents/reviewer.md`
