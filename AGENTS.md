# AGENTS

Admin instructions override this file.

## Protected
Agents, including Planner, must never modify, rename, delete, replace, or create substitutes for `AGENTS.md` or `.agents/*.md`.

## Routine
1. Read this file and your `.agents/<role>.md` only.
2. Scan open Issues for your role. Never assign/bind work to a named agent, worker, routine, or session.
3. Self-repair explicit Issue workflow defects before selection.
4. Recover stale locks; recheck verifiable `DELAYED` resume conditions.
5. Skip `DELAYED`, dependency-blocked, invalid, or locked Issues. Select highest priority eligible; tie -> lowest Issue number.
6. Read fully; re-read before lock. If changed, restart selection.
7. Set transient `Claim: <run-id>@<UTC timestamp>` and `Status: ACTIVE`.
8. Execute only that Issue.

Do not read `README.md`, ROADMAP, or unrelated/old Issues. Inspect repository code/assets/tests only as needed. Dependency Issues: workflow state only.

## Self-repair
Any routine may repair an Issue without claiming it when product intent is unchanged. Repair the Issue itself, then rescan.

May repair: workflow fields, legacy role/state/claim formats, stale locks, dependencies/handoffs, obsolete worker ownership, removed-governance references, and operational instructions contradicted by this file.

Never change Objective, acceptance-criteria meaning, product intent, or technical requirements unless the Issue itself makes the correction explicit.

Safe role mappings:
- Game Programmer -> Coder
- Game Designer | UX Designer | Texture Artist -> Designer
- Test | Tester -> Tester
- Review | Reviewer -> Reviewer

Legacy `WAITING` -> `DELAYED`. `Claim` is only a run lock. Locks older than 3 hours are stale. Stale `ACTIVE`: clear `Claim`; Tester/Reviewer -> `VERIFY`; others -> `READY`.

Missing requirement/tool/external condition -> `DELAYED`, `Claim: NONE`, record exact resume condition, continue scanning. When condition is verifiably resolved: Tester/Reviewer -> `VERIFY`; others -> `READY`.

Removed legacy governance references are historical only. Do not recreate/require them.

## Workflow
- `Role`: Coder | Designer | Tester | Reviewer
- `Priority`: P0 | P1 | P2 | P3 | P4
- `Status`: READY | ACTIVE | VERIFY | DELAYED | DONE
- `Claim`: NONE | `<run-id>@<UTC timestamp>`
- `Dependency`: NONE | issue numbers
- `Handoff`: NONE | role chain, e.g. `Reviewer > Tester`

Eligible:
- workflow fields valid
- `Role` matches
- `Status: READY`, or `VERIFY` for Tester/Reviewer
- dependencies `DONE`
- `Claim: NONE`

`DELAYED`, unresolved dependencies, active locks, invalid Issues, and Admin-attention Issues delay only themselves. They never stop the queue. If no eligible Issue exists, end the run cleanly.

## Admin
Admin action is allowed only for pushing Admin-created texture-tile binaries already staged in the configured Drive mirror.

Texture-tile push needed -> stage exact files/paths in Drive, set `DELAYED`, `Claim: NONE`, record exact Admin push action, continue other work. Any routine may verify the push later and resume the Issue.

Any other Admin attention needed -> `DELAYED`, `Claim: NONE`, record exact reason, continue other work. Never stop a routine or queue for Admin.

Never upload texture-tile binaries directly to GitHub.

## Result
PASS:
- `Handoff: NONE` -> `DONE`, `Claim: NONE`, close Issue
- otherwise consume first Handoff role; set `Role`; remove consumed role; empty chain -> `NONE`; Tester/Reviewer -> `VERIFY`; others -> `READY`; `Claim: NONE`

Tester/Reviewer FAIL:
- explicit correction role -> set that `Role`, `Status: READY`, `Claim: NONE`
- no explicit correction role -> `DELAYED`, `Claim: NONE`, record exact correction/resume condition

Never invent evidence or product requirements. Record only real actions/results.

All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only
- Coder: `.agents/coder.md`
- Designer: `.agents/designer.md`
- Tester: `.agents/tester.md`
- Reviewer: `.agents/reviewer.md`
