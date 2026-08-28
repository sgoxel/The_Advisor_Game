# Worker Rotation Control

This file documents the ChatGPT Worker execution protocol only. It is not product scope, phase planning, release authority, or a replacement for README/ROADMAP/TODO/issues.

## Worker identities

Five independent scheduled Workers exist:

- Worker #1
- Worker #2
- Worker #3
- Worker #4
- Worker #5

One additional persistent manual Worker exists:

- Worker #6

Workers #1–#5 use the recurring schedule and canonical rotation cursor. Worker #6 is manual-only and does not consume or advance the recurring cursor merely by being invoked. All Worker identities persist across runs and roles.

## Role cycle

`Planner -> Coder -> Designer -> Tester -> Reviewer -> Planner`

The canonical cursor provides the starting role for scheduled Workers #1–#5. Worker #6 is cursor-independent and begins with a priority scan before entering the same role boundaries.

## Work-conserving execution

A Worker should maximize useful work in the current invocation without inventing scope.

Starting from the applicable role, the Worker traverses the role cycle. In each role it processes eligible work sequentially in role-specific priority order rather than stopping after one task.

There is no artificial one-task, one-role, or one-pass work cap. A run may complete multiple eligible targets in the same role and may repeat the full five-role cycle as long as useful eligible progress continues and project safety/authority rules remain satisfied.

After every material state change — including a commit, issue transition, revision outcome, claim change, dependency change, test result, NVIDIA handoff, or planning update — re-fetch the relevant GitHub state before selecting the next target.

At the start of the run and after every material state change, perform a project-wide critical-work scan. Critical work remains owned by its proper role, but it must not be starved by lower-value ordinary backlog in another role. Before taking another ordinary target in the current role, check whether a blocking correction, revision, handoff, verification obligation, continuation, release blocker, or active-phase dependency has become eligible elsewhere in the cycle; if so, advance through the role cycle toward that critical work instead of draining lower-priority backlog first.

When one role has no further eligible work, continue to the next role. After all five roles have been visited, begin another pass if the preceding pass performed useful work or materially changed eligibility.

Stop normally only when one complete five-role pass produces no eligible progress.

A blocked or unchanged target must not be retried indefinitely in the same invocation. Record the blocker, clear or preserve ownership according to project rules, and skip that unchanged target until external state materially changes.

Do not wait idly for CI, GitHub Actions, NVIDIA/OpenCode, another Worker, or another external result when other eligible work exists. Record the pending external state, continue through other roles and eligible targets, and revisit the waiting target only if its state materially changes during the same invocation.

If a hard platform, tool, connector, or execution limit prevents further safe work before the normal no-progress stopping condition is reached, checkpoint safely: preserve or clear claims accurately, record exact completed work and pending continuations, and report `continuation required`. A limit-interrupted run must not be reported as a full no-progress pass or as completed work that was not actually completed.

## Critical priority inside roles

Critical obligations outrank ordinary backlog inside the relevant role:

- Planner: README reconciliation, blocking Planner revisions, active-phase planning repair, then normal backlog and NVIDIA routing.
- Coder: accepted Tester revision correction, continuation, `ai-handoff`, then ordinary eligible coding.
- Designer: accepted Designer revision correction or continuation, then required active/earlier visual work.
- Tester: revision retest, blockers, `ai-awaiting-review` or Tester handoff, active untested work, earlier fixes, then release gates.
- Reviewer: evidenced blocking process/workflow/CI/automation defects, stale-state risks, and reliability problems before ordinary process improvement.

Within those priorities, prefer the oldest/highest-priority eligible unclaimed target whose dependencies are satisfied.

Workers must not invent work merely to keep a role busy.

## Independence

A Worker must never independently approve its own implementation, design, revision, bug fix, workflow fix, process fix, or other prior change from the same or an earlier run.

When reaching Tester or Reviewer, the Worker first seeks another eligible independent target. If none exists, that self-authored target remains for another Worker identity while the current Worker continues with other eligible work.

Coder, Designer, and Reviewer changes still require independent Tester verification by a different Worker identity before being called independently verified.

## Claims and overlap

Workers may overlap in time. `WORK-CLAIM`, dependency checks, exact committed-state checks, and NVIDIA ownership are the collision controls.

Before modifying a target, claim it with the current Worker identity and role. Re-fetch before important writes. Never duplicate a live claim or break live NVIDIA ownership merely because a run is old.

A Worker must not treat NVIDIA Coder self-test as independent PASS.

## Scheduled rotation state

The canonical recurring cursor is the latest valid `WORKER ROTATION STATE:` JSON comment on GitHub issue #97. Scheduled Workers append state comments; they do not rewrite history.

At the end of a scheduled work-conserving run, the Worker records one `WORKER ROTATION RESULT:` summarizing the starting role, roles/passes attempted, targets completed or blocked, commits/PRs, checks/results, revisions, claim-clear state, pending external work, and whether continuation is required.

The next scheduled cursor uses the successor of the last role in which useful work was actually performed. If the run produced no eligible progress in any role, preserve the original starting role. If the run was interrupted by a hard execution limit while eligible work remained, preserve continuity from the last useful role and explicitly record the pending continuation so the next Worker can resume from current GitHub state rather than repeating completed work.

## Manual Worker #6

Worker #6 is a manually invoked capacity Worker, not a sixth recurring scheduled slot.

Worker #6 must:

1. Read current `main/README.md` first.
2. Inspect active/earlier phase state, dependencies, revisions, claims, NVIDIA state, CI/Actions, and current issue/task eligibility.
3. Use the same Planner/Coder/Designer/Tester/Reviewer authority boundaries and critical priorities as scheduled Workers.
4. Run work-conservingly across roles with no artificial task/pass cap, repeat passes until a complete five-role pass makes no eligible progress, and use the same anti-idle/external-wait rules as scheduled Workers.
5. Respect Worker #6 identity independence across all current and future runs.
6. Use normal `WORK-CLAIM` collision protection.
7. Never edit README without explicit Admin authorization.
8. Never advance or rewrite the scheduled `WORKER ROTATION STATE:` cursor.
9. Post a `MANUAL WORKER #6 RESULT:` audit on issue #97 with roles/passes attempted, targets, commits/PRs, checks/results, blockers/revisions, pending external work, continuation state, and claim-clear state.

Because Worker #6 does not advance the scheduled cursor, its repository changes are discovered by the next scheduled Worker through normal state re-fetch and claim/dependency checks.

Detailed scheduling times and automation implementation remain outside this file.
