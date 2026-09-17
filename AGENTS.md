# AGENTS

Admin instructions override this file.

## Protected
Agents, including Planner, must never modify, rename, delete, replace, or create substitutes for `AGENTS.md` or `.agents/*.md`.

## Routine
1. Read this file and your `.agents/<role>.md` only.
2. Scan all open Issues.
3. Self-repair explicit workflow defects globally; recover stale locks; recheck verifiable `DELAYED` conditions.
4. Filter repaired Issues to your Role.
5. Skip `DELAYED`, dependency-blocked, invalid, or locked Issues. Select highest priority eligible; tie -> lowest Issue number.
6. Read fully; re-read before lock. If changed, restart selection.
7. Set transient `Claim: <run-id>@<UTC timestamp>` and `Status: ACTIVE`.
8. Re-fetch. Execute only if `Claim` still equals your run-id and `Status: ACTIVE`; otherwise rescan.

Never bind work to a named agent, worker, routine, or session.

Do not read `README.md`, ROADMAP, or unrelated/old Issues. Inspect repository code/assets/tests only as needed. Dependency Issues: workflow state only.

## Self-repair
Repair only `Claim: NONE` Issues or stale locks. Never modify a valid `ACTIVE` Issue owned by another run.

May repair workflow fields, legacy roles/states/claims, stale locks, dependencies/handoffs, obsolete worker ownership, removed-governance references, and conflicting operational instructions when product intent is unchanged. Record one compact `Repair:` note only when metadata changes.

Never change Objective, acceptance-criteria meaning, product intent, or technical requirements unless the Issue itself makes the correction explicit.

Safe roles:
- Game Programmer -> Coder
- Game Designer | UX Designer | Texture Artist -> Designer
- Test | Tester -> Tester
- Review | Reviewer -> Reviewer

Legacy `WAITING` -> `DELAYED`. Locks >3h are stale. Stale `ACTIVE`: clear `Claim`; Tester/Reviewer -> `VERIFY`; others -> `READY`.

Missing requirement/tool/external condition -> `DELAYED`, `Claim: NONE`, exact resume condition, continue queue. Resolved: Tester/Reviewer -> `VERIFY`; others -> `READY`.

Removed governance references are historical only. Do not recreate/require them.

Dependency satisfied by `Status: DONE`, or a closed-completed legacy Issue whose recorded outcome clearly satisfies it. Duplicate/not-planned/ambiguous closure does not satisfy dependency; delay only that branch.

## Workflow
- `Role`: Coder | Designer | Tester | Reviewer
- `Priority`: P0 | P1 | P2 | P3 | P4
- `Status`: READY | ACTIVE | VERIFY | DELAYED | DONE
- `Claim`: NONE | `<run-id>@<UTC timestamp>`
- `Dependency`: NONE | issue numbers
- `Handoff`: NONE | role chain, e.g. `Reviewer > Tester`

Eligible: valid fields; matching Role; `READY`, or `VERIFY` for Tester/Reviewer; dependencies satisfied; `Claim: NONE`.

`DELAYED`, unresolved dependencies, active locks, invalid Issues, and Admin-attention Issues delay only themselves. If no eligible Issue exists, end cleanly.

## Visual
`tools/screenshot_tool.py` is a shared verification tool.

Tester may capture/analyze screenshots when visual acceptance is relevant.

Reviewer with no eligible Reviewer Issue may capture the latest playable state, inspect for concrete regressions, then search open Issues. Existing defect -> add only materially new evidence. New defect -> create one atomic self-contained Issue only when correction Role is clear: functional/runtime -> Coder; visual/UI presentation -> Designer; normally `Handoff: Tester`. Never create feature/roadmap Issues from visual audit.

Screenshot/tool failure delays only that audit attempt. Never block the queue. Screenshot binaries go to the configured Drive mirror when durable evidence is needed; never upload binaries directly to GitHub.

## Admin
Admin action is allowed only for pushing Admin-created texture-tile binaries already staged in the configured Drive mirror.

Texture-tile push needed -> stage exact files/paths in Drive, set `DELAYED`, `Claim: NONE`, record exact push action, continue queue. Any routine may verify later and resume.

Any other unresolved external condition -> `DELAYED`, `Claim: NONE`, record exact reason/resume condition, continue queue. Do not require Admin action.

## Result
PASS:
- `Handoff: NONE` -> `DONE`, `Claim: NONE`, close Issue
- otherwise consume first Handoff role; set `Role`; remove it; empty chain -> `NONE`; Tester/Reviewer -> `VERIFY`; others -> `READY`; `Claim: NONE`

Tester/Reviewer FAIL:
- explicit correction role -> set correction `Role`, prepend failed verification role to current `Handoff`, `Status: READY`, `Claim: NONE`
- no explicit correction role -> `DELAYED`, `Claim: NONE`, exact correction/resume condition

Never invent evidence or product requirements. Record only real actions/results.

All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only
- Coder: `.agents/coder.md`
- Designer: `.agents/designer.md`
- Tester: `.agents/tester.md`
- Reviewer: `.agents/reviewer.md`
