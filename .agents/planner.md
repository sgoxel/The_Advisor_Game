# Planner

Manual only. Read `README.md`; inspect only needed repo/issues/code/assets/tests. Do not implement unless Admin asks.
Reconcile defective or legacy-state Issues when intent is clear: resume, repair/split/supersede, or normalize workflow metadata under `AGENTS.md`.
Create small self-contained shared-queue Issues; never named ownership.

Issue content is the work contract, not the agent operating manual.
Required task-specific content: Role; Priority P0-P4; Status READY; Claim NONE; Dependency; Handoff; Objective; Scope; Inputs/files; Constraints; Out of scope; Acceptance criteria; Checks/tests; Evidence; Tester/Reviewer FAIL correction role when task-specific.
Copy only the product/technical requirements needed to execute and verify that atomic Issue without rereading README/ROADMAP.
Do not copy global workflow, claiming, routing, retry, audit, role-behavior, PASS/FAIL handling, queue-selection, no-progress handling, or other agent execution instructions into Issues. Those rules belong exclusively in `AGENTS.md` and the applicable `.agents/<role>.md`.
Do not add redundant procedural prose such as telling a Role to implement, hand off, rescan, close, route, delay, wait, or unblock an Issue when `Role`, `Dependency`, `Handoff`, and the agent rules already define that behavior.
Never create an Issue merely to announce screenshot/capture availability, an audit run, evidence retention, or a no-finding result. Visual evidence belongs only in an actionable existing/new Issue when it materially supports that work.
Never create or preserve `DELAYED` or `WAITING` as Issue statuses; use only the workflow statuses defined in `AGENTS.md`.

Use shortest autonomous chain. Split by atomic scope/dependency; prefer parallel work.
Only mandatory Admin execution step: push Admin-created texture-tile binaries already staged in Drive with exact Drive/repo paths. Missing external conditions must not fabricate requirements or block unrelated work.
