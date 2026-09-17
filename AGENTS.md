# AGENTS

Admin instructions override this file.

## Routine
1. Read this file and your `.agents/<role>.md` only.
2. Scan open GitHub Issues.
3. Repair workflow metadata when the correct mapping is explicit.
4. Clear stale claims.
5. Select the highest-priority eligible Issue; tie -> lowest Issue number.
6. Read it fully, then re-read before claim. If state changed, restart.
7. Set `Claim: <agent-id>@<UTC timestamp>` and `Status: ACTIVE`.
8. Execute only that Issue.

Do not read `README.md`, ROADMAP, or unrelated/old Issues. Repository code/assets/tests may be inspected as needed. Dependency Issues may be read only for workflow state.

## Repair
Repair workflow metadata only; never change task meaning, Objective, Scope, constraints, acceptance criteria, or technical requirements.

Safe mappings:
- Game Programmer -> Coder
- Game Designer | UX Designer | Texture Artist -> Designer
- Test | Tester -> Tester
- Review | Reviewer -> Reviewer

Legacy lane/state fields may be converted only when the intended current `Role` and `Status` are explicit. Normalize stale/legacy claims to `NONE`. Infer missing `Handoff` only from explicit issue text. If safe repair is impossible, leave unclaimed and report the exact Planner correction needed.

## Workflow fields
- `Role`: Coder | Designer | Tester | Reviewer
- `Priority`: P0 | P1 | P2 | P3
- `Status`: READY | ACTIVE | VERIFY | WAITING | DONE
- `Claim`: NONE | `<agent-id>@<UTC timestamp>`
- `Dependency`: NONE | issue numbers
- `Handoff`: NONE | next role

Claims older than 3 hours are stale and must be cleared.

Eligible:
- all workflow fields valid
- `Role` matches
- `Status` is `READY`, or `VERIFY` for Tester/Reviewer
- all dependencies are `DONE`
- `Claim` is `NONE`

`WAITING` is not eligible. Use it only for explicit external/Admin/capability conditions. When the stated condition is resolved, restore the Issue to its executable `Role` and `Status`.

## Completion
- `Handoff: NONE` -> `Status: DONE`.
- Otherwise set `Role` = `Handoff`; Tester/Reviewer -> `VERIFY`, else -> `READY`.
- Clear `Claim`.

Issues are execution contracts. Do not infer missing product requirements. Record only real actions/evidence.

Never upload binaries directly to GitHub. Use the exact Drive destination defined by the Issue.

All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only
- Coder: `.agents/coder.md`
- Designer: `.agents/designer.md`
- Tester: `.agents/tester.md`
- Reviewer: `.agents/reviewer.md`
