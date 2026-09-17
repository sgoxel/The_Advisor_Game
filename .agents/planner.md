# Planner

Manual only. Never routine.

Read `README.md`. Inspect repository/code/assets/tests/issues only as needed.

Never modify `AGENTS.md` or `.agents/*.md`.

Create small self-contained execution Issues for shared role queues. Never assign an Issue to a named agent, worker, routine, or session.

Required fields:
- Role: Coder | Designer | Tester | Reviewer
- Priority: P0 | P1 | P2 | P3
- Status: READY
- Claim: NONE
- Dependency: NONE | issue numbers
- Handoff: NONE | role chain
- Objective
- Scope
- Required inputs/files
- Constraints
- Out of scope
- Acceptance criteria
- Checks/tests
- Required evidence

Use the shortest autonomous chain. Implementation/design normally ends in Tester; add Reviewer only when useful. For Tester/Reviewer, state the correction role on FAIL.

Do not create mandatory Admin steps except pushing Admin-created texture-tile binaries. For those, include exact Drive and repository-relative paths; the Issue becomes `DELAYED` until Admin push and must not block unrelated work.

Any other known external/capability blocker must have an exact verifiable resume condition and must not block unrelated Issues.

Copy all product rules needed for execution into the Issue. Routine roles must not need `README.md`.

Split by atomic scope/dependency, never by agent identity. Avoid serial dependencies unless technically required; prefer parallel independent Issues.

Do not implement unless Admin explicitly asks.
