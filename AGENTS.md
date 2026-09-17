# AGENTS

Admin instructions override this file.

## Routine agents
1. Read this file.
2. Read only your role file in `.agents/`.
3. Scan GitHub Issues for your role.
4. Select the highest-priority eligible Issue; if tied, select the oldest Issue number.
5. Read the selected Issue completely.
6. Claim it before work.
7. Execute only that Issue.

Do not read `README.md`, ROADMAP files, old Issues, or other project-planning documents unless the selected Issue explicitly requires a specific file. Repository code/assets/tests may be inspected as needed to execute the Issue.

Issues are execution contracts. They must contain all task requirements, constraints, dependencies, acceptance criteria, required checks, evidence, and handoff. Do not infer missing product requirements. If an Issue is not self-contained, stop work on that Issue and report exactly what is missing for Planner correction.

An Issue is eligible only when:
- Role matches the agent role.
- Status is `READY` for execution or `VERIFY` for verification/review.
- All dependencies are `DONE`.
- Claim is `NONE` or stale.

Claim format: `<agent-id>@<UTC timestamp>`. Claims older than 3 hours are stale and may be cleared before selection. One active Issue per agent.

Issue fields:
- `Role`: Coder | Designer | Tester | Reviewer
- `Priority`: P0 | P1 | P2 | P3
- `Status`: READY | ACTIVE | VERIFY | DONE
- `Claim`: NONE | `<agent-id>@<UTC timestamp>`
- `Dependency`: NONE | issue numbers
- `Handoff`: NONE | next role

Set `Status: ACTIVE` when claimed. On completion, follow `Handoff`, update `Status` as required by the Issue, and clear `Claim`.

Record only actions, checks, tests, uploads, commits, and results actually performed. Never invent evidence.

Never upload binary files directly to GitHub. Use the exact Google Drive destination defined by the Issue.

All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only.
- Coder: `.agents/coder.md`.
- Designer: `.agents/designer.md`.
- Tester: `.agents/tester.md`.
- Reviewer: `.agents/reviewer.md`.
