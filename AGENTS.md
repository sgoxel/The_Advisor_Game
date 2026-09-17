# AGENTS

Admin instructions override this file.

## Routine
1. Read this file and your `.agents/<role>.md` only.
2. Scan open GitHub Issues.
3. Repair explicit workflow metadata; clear stale claims.
4. Recheck `WAITING` resume conditions when verifiable.
5. Select highest priority eligible Issue; tie -> lowest Issue number.
6. Read fully; re-read before claim. If changed, restart.
7. Set `Claim: <agent-id>@<UTC timestamp>` and `Status: ACTIVE`.
8. Execute only that Issue.

Do not read `README.md`, ROADMAP, or unrelated/old Issues. Inspect repository code/assets/tests only as needed. Dependency Issues: workflow state only.

## Repair
Workflow metadata only. Never change task meaning, Objective, Scope, constraints, acceptance criteria, or technical requirements.

Safe role mappings:
- Game Programmer -> Coder
- Game Designer | UX Designer | Texture Artist -> Designer
- Test | Tester -> Tester
- Review | Reviewer -> Reviewer

Convert legacy lane/state only when intended current state is explicit. Normalize stale/legacy claims to `NONE`. Infer missing `Handoff` only from explicit Issue text.

Explicit unresolved Admin/external/capability blocker -> `WAITING`. If its stated resume condition is verifiably resolved: Tester/Reviewer -> `VERIFY`; others -> `READY`.

Removed legacy governance references are historical only. Do not recreate/require them. If required task information is missing, leave unclaimed and report Planner correction.

## Workflow
- `Role`: Coder | Designer | Tester | Reviewer
- `Priority`: P0 | P1 | P2 | P3 | P4
- `Status`: READY | ACTIVE | VERIFY | WAITING | DONE
- `Claim`: NONE | `<agent-id>@<UTC timestamp>`
- `Dependency`: NONE | issue numbers
- `Handoff`: NONE | role chain, e.g. `Reviewer > Tester`

Claims older than 3 hours are stale.

Eligible:
- workflow fields valid
- `Role` matches
- `Status: READY`, or `VERIFY` for Tester/Reviewer
- dependencies `DONE`
- `Claim: NONE`

`WAITING` is not executable.

## Result
PASS/completion:
- If `Handoff: NONE`: set `DONE`, clear `Claim`, close Issue.
- Else consume first Handoff role: set `Role` to it, remove it from `Handoff`; if chain empty set `Handoff: NONE`; Tester/Reviewer -> `VERIFY`, others -> `READY`; clear `Claim`.

Tester/Reviewer FAIL:
- explicit correction role in Issue -> set that `Role`, `Status: READY`, clear `Claim`
- no explicit correction role -> `WAITING`, clear `Claim`, report Planner correction

Never invent evidence or product requirements. Record only real actions/results.

Never upload binaries directly to GitHub. Use the exact Drive destination defined by the Issue.

All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only
- Coder: `.agents/coder.md`
- Designer: `.agents/designer.md`
- Tester: `.agents/tester.md`
- Reviewer: `.agents/reviewer.md`
