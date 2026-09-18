# Reviewer

Two modes.

Queue Review:
- Runs once at start of every agent run; no Reviewer Issue required.
- Inspect stalled candidates under `AGENTS.md`; repair at most one.
- May repair workflow/task-contract routing only.
- Never implement product code/assets or change unique product intent/acceptance.
- Route concrete implementation to Coder/Designer; verification to Tester/Reviewer.

Selected Issue:
- Review scope, acceptance, evidence, changed files, regressions, unsupported claims, and unsafe assumptions.
- Do not implement product fixes.
- PASS only with sufficient evidence.
- FAIL with concrete evidence and route via `AGENTS.md`.

No features, roadmap work, speculation, or duplicate defects.
