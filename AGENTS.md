# AGENTS

Admin instructions override this file.

## Routine
1. Read this file and your `.agents/<role>.md` only.
2. Scan open GitHub Issues.
3. Repair workflow metadata when the mapping is explicit.
4. Clear stale claims.
5. Select highest priority; tie -> lowest Issue number.
6. Read fully, re-read before claim; if changed, restart.
7. Set `Claim: <agent-id>@<UTC timestamp>` and `Status: ACTIVE`.
8. Execute only that Issue.

Do not read `README.md`, ROADMAP, or unrelated/old Issues. Repository code/assets/tests may be inspected as needed. Dependency Issues: workflow state only.

## Repair
Workflow metadata only. Never change task meaning, Objective, Scope, constraints, acceptance criteria, or technical requirements.

Safe role mappings:
- Game Programmer -> Coder
- Game Designer | UX Designer | Texture Artist -> Designer
- Test | Tester -> Tester
- Review | Reviewer -> Reviewer

Legacy lane/state fields may be converted only when intended current `Role`/`Status` are explicit. Normalize stale/legacy claims to `NONE`. Infer missing `Handoff` only from explicit issue text.

If the Issue explicitly proves an unresolved Admin/external/capability blocker, set `Status: WAITING`. When resolved: Tester/Reviewer -> `VERIFY`; others -> `READY`.

References to removed legacy governance files are historical only. Do not recreate or require them. If missing content is needed and not stated in the Issue, leave unclaimed and report Planner correction.

## Workflow
- `Role`: Coder | Designer | Tester | Reviewer
- `Priority`: P0 | P1 | P2 | P3 | P4
- `Status`: READY | ACTIVE | VERIFY | WAITING | DONE
- `Claim`: NONE | `<agent-id>@<UTC timestamp>`
- `Dependency`: NONE | issue numbers
- `Handoff`: NONE | next role

Claims older than 3 hours are stale.

Eligible:
- workflow fields valid
- `Role` matches
- `Status: READY`, or `VERIFY` for Tester/Reviewer
- dependencies `DONE`
- `Claim: NONE`

`WAITING` is not eligible.

## Result
PASS/completion:
- `Handoff: NONE` -> `DONE`
- else `Role = Handoff`; Tester/Reviewer -> `VERIFY`; others -> `READY`

Tester/Reviewer FAIL:
- use explicit correction role from the Issue -> `Role` = correction role, `Status: READY`
- if none explicit -> `Status: WAITING` and report Planner correction

Always clear `Claim` after PASS, FAIL, or WAITING transition.

Issues are execution contracts. Do not infer missing product requirements. Record only real actions/evidence.

Never upload binaries directly to GitHub. Use the exact Drive destination defined by the Issue.

All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only
- Coder: `.agents/coder.md`
- Designer: `.agents/designer.md`
- Tester: `.agents/tester.md`
- Reviewer: `.agents/reviewer.md`
