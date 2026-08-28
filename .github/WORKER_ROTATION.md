# Worker Rotation Control

This file documents the ChatGPT Worker rotation protocol only. It is not product scope, phase planning, release authority, or a replacement for README/ROADMAP/TODO/issues.

## Worker identities

Five independent scheduled Workers exist:

- Worker #1
- Worker #2
- Worker #3
- Worker #4
- Worker #5

All five use the same Worker profile. Worker identity persists across runs and roles.

## Role cycle

`Planner -> Coder -> Designer -> Tester -> Reviewer -> Planner`

The canonical cursor provides the starting role for a scheduled run.

A Worker does not stop after the first role or first eligible task. Starting from the cursor role, it traverses all five roles exactly once in cycle order during that invocation.

For each role:

1. Inspect active/earlier phase state, dependencies, revisions, claims, NVIDIA state, and eligible targets relevant to that role.
2. Prefer critical obligations for that role over ordinary backlog.
3. If eligible work exists, take at most one highest-priority focused target for the role, create the required `WORK-CLAIM`, perform the allowed work and checks, audit the result, and resolve the claim according to project rules.
4. If no eligible target exists, skip the role without ending the run.
5. Continue to the next role until all five roles have been attempted once.

Maximum normal work per scheduled invocation is one focused target per role, up to five role-targets total. This prevents one role from monopolizing a run while allowing every Worker to use available capacity across the full development cycle.

## Critical priority inside roles

Critical obligations outrank ordinary backlog inside the relevant role:

- Planner: README reconciliation, blocking Planner revisions, active-phase planning repair, then normal backlog and NVIDIA routing.
- Coder: accepted Tester revision correction, continuation, `ai-handoff`, then ordinary eligible coding.
- Designer: accepted Designer revision correction or continuation, then required active/earlier visual work.
- Tester: revision retest, blockers, `ai-awaiting-review` or Tester handoff, active untested work, earlier fixes, then release gates.
- Reviewer: evidenced blocking process/workflow/CI/automation defects, stale-state risks, and reliability problems before ordinary process improvement.

Workers must not invent work merely to keep a role busy.

## Independence

A Worker must never independently approve its own implementation, design, revision, bug fix, workflow fix, process fix, or other prior change from the same or an earlier run.

When reaching Tester or Reviewer, the Worker first seeks another eligible independent target. If none exists, it skips that role and continues the full cycle.

Coder, Designer, and Reviewer changes still require independent Tester verification by a different Worker identity before being called independently verified.

## Claims and overlap

Scheduled Workers may overlap in time. `WORK-CLAIM`, dependency checks, exact committed-state checks, and NVIDIA ownership are the collision controls.

A Worker must not duplicate a live claimed target, break live NVIDIA ownership, or treat NVIDIA Coder self-test as independent PASS.

## Rotation state

The canonical rotation cursor is the latest valid `WORKER ROTATION STATE:` JSON comment on the dedicated GitHub control issue. Workers append state comments; they do not rewrite history.

At the end of a full-cycle run, the Worker records one `WORKER ROTATION RESULT:` summarizing the starting role, every role attempted, selected task or skip for each role, commits/PRs, checks/results, blockers/revisions, and claim-clear state.

The next cursor uses the successor of the last role in which useful work was actually performed. If no role had eligible work, the original starting role is preserved. This lets the next Worker continue from where useful work actually ended instead of consuming empty roles.

Detailed scheduling times and automation implementation remain outside this file.