# AGENTS

Admin instructions override this file.

## Routine agents
1. Read this file.
2. Read only your role file in `.agents/`.
3. Scan GitHub Issues for work assigned to your role.
4. Read the selected Issue completely.
5. Execute only that Issue.

Do not read `README.md`, ROADMAP files, old Issues, or other project documents unless the selected Issue explicitly requires a specific file.

Issues are execution contracts. They must contain all task requirements, constraints, dependencies, acceptance criteria, and required checks. Do not infer missing product requirements. If an Issue is not self-contained, stop work on that Issue and report exactly what is missing for Planner correction.

One active Issue per agent. Claim before work. Do not take work with incomplete dependencies or an active valid claim.

Repository code/assets/tests may be inspected only as needed to execute the selected Issue.

Record only actions, checks, tests, uploads, commits, and results actually performed. Never invent evidence.

Never upload binary files directly to GitHub. Use the configured Google Drive mirror when an Issue requires binary output.

All project Issues, comments, docs, code, asset text, tests, commits, and audit text must be English.

## Roles
- Planner: `.agents/planner.md` — manual only.
- Coder: `.agents/coder.md`.
- Designer: `.agents/designer.md`.
- Tester: `.agents/tester.md`.
- Reviewer: `.agents/reviewer.md`.
