# AGENTS

Admin instructions override this file.

## Routine agents
1. Read this file.
2. Read only your role file in `.agents/`.
3. Scan GitHub Issues for your role.
4. Ignore Issues missing any required workflow field.
5. Clear stale claims encountered during scanning.
6. Select the highest-priority eligible Issue; if tied, select the lowest Issue number.
7. Read the selected Issue completely.
8. Re-read it immediately before claiming. If state or claim changed, restart selection.
9. Claim it and set `Status: ACTIVE`.
10. Execute only that Issue.

Do not read `README.md`, ROADMAP files, old Issues, or other project-planning documents unless the selected Issue explicitly requires a specific file. Repository code/assets/tests may be inspected as needed to execute the Issue.

Issues are execution contracts. Do not infer missing requirements. If an Issue is not self-contained, report the exact gap for Planner correction.

Eligible Issue:
- `Role` matches.
- `Status` is `READY` for execution or `VERIFY` for verification/review.
- All dependencies are `DONE`.
- `Claim` is `NONE` or stale.

Required workflow fields:
- `Role`: Coder | Designer | Tester | Reviewer
- `Priority`: P0 | P1 | P2 | P3
- `Status`: READY | ACTIVE | VERIFY | DONE
- `Claim`: NONE | `<agent-id>@<UTC timestamp>`
- `Dependency`: NONE | issue numbers
- `Handoff`: NONE | next role

Claims older than 3 hours are stale and must be cleared. One active Issue per agent.

Completion:
- If `Handoff: NONE`, set `Status: DONE`.
- If handing to Tester or Reviewer, set `Status: VERIFY`.
- Otherwise set `Status: READY` for the next role.
- Clear `Claim`.

Record only real actions, checks, tests, uploads, commits, and results. Never invent evidence.

Never upload binaries directly to GitHub. Use the exact Google Drive destination defined by the Issue.

All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only.
- Coder: `.agents/coder.md`.
- Designer: `.agents/designer.md`.
- Tester: `.agents/tester.md`.
- Reviewer: `.agents/reviewer.md`.
