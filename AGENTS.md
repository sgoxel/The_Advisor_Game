# AGENTS

Admin instructions override this file.

## Routine
1. Read this file and your `.agents/<role>.md` only.
2. Scan open Issues for your role. Never bind work to a named/specific agent.
3. Repair explicit workflow metadata and recover stale locks.
4. Recheck verifiable `WAITING` resume conditions.
5. Ignore blocked, waiting, invalid, or locked Issues. Select highest priority eligible; tie -> lowest Issue number.
6. Read fully; re-read before lock. If changed, restart selection.
7. Set transient `Claim: <run-id>@<UTC timestamp>` and `Status: ACTIVE`.
8. Execute only that Issue.

Do not read `README.md`, ROADMAP, or unrelated/old Issues. Inspect repository code/assets/tests only as needed. Dependency Issues: workflow state only.

## Repair
Workflow metadata only. Never change task meaning, Objective, Scope, constraints, acceptance criteria, or technical requirements.

Safe role mappings:
- Game Programmer -> Coder
- Game Designer | UX Designer | Texture Artist -> Designer
- Test | Tester -> Tester
- Review | Reviewer -> Reviewer

Convert legacy lane/state only when intended current state is explicit. Infer missing `Handoff` only from explicit Issue text.

`Claim` is a temporary lock, never ownership. Locks older than 3 hours are stale. For stale `ACTIVE`: clear `Claim`; Tester/Reviewer -> `VERIFY`; others -> `READY`.

Explicit unresolved Admin/external/capability blocker -> `WAITING`, `Claim: NONE`. When its stated resume condition is verifiably resolved: Tester/Reviewer -> `VERIFY`; others -> `READY`.

Removed legacy governance references are historical only. Do not recreate/require them. Missing required task information -> `WAITING`, `Claim: NONE`, report Planner correction.

## Workflow
- `Role`: Coder | Designer | Tester | Reviewer
- `Priority`: P0 | P1 | P2 | P3 | P4
- `Status`: READY | ACTIVE | VERIFY | WAITING | DONE
- `Claim`: NONE | `<run-id>@<UTC timestamp>`
- `Dependency`: NONE | issue numbers
- `Handoff`: NONE | role chain, e.g. `Reviewer > Tester`

Eligible:
- workflow fields valid
- `Role` matches
- `Status: READY`, or `VERIFY` for Tester/Reviewer
- dependencies `DONE`
- `Claim: NONE`

`WAITING`, unresolved dependencies, active locks, and invalid Issues never block other work. If no eligible Issue exists, end the run cleanly.

## Result
PASS/completion:
- `Handoff: NONE` -> `DONE`, `Claim: NONE`, close Issue
- otherwise consume first Handoff role; set `Role` to it; remove it from chain; empty chain -> `NONE`; Tester/Reviewer -> `VERIFY`; others -> `READY`; `Claim: NONE`

Tester/Reviewer FAIL:
- explicit correction role -> set that `Role`, `Status: READY`, `Claim: NONE`
- no explicit correction role -> `WAITING`, `Claim: NONE`, report Planner correction

Never invent evidence or product requirements. Record only real actions/results.

Never upload binaries directly to GitHub. Use the exact Drive destination defined by the Issue.

All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only
- Coder: `.agents/coder.md`
- Designer: `.agents/designer.md`
- Tester: `.agents/tester.md`
- Reviewer: `.agents/reviewer.md`
