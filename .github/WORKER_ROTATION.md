# Worker Rotation Control

This file documents the ChatGPT Worker execution protocol only. It is not product scope, phase planning, release authority, or a replacement for README/ROADMAP/TODO/issues.

## Worker identities

Five independent scheduled Workers exist:

- Worker #1
- Worker #2
- Worker #3
- Worker #4
- Worker #5

Worker #6 and Worker #7 are different: they are reserved **manual Admin-invoked execution identities / instruction profiles**, not scheduled routines.

Workers #1–#5 use the recurring schedule and canonical rotation cursor. Worker #6 and Worker #7 exist only when the Admin directly invokes the respective Worker or gives that manual Worker an instruction in chat. Neither manual Worker has automation, timer, recurrence, scheduled task, or recurring cursor slot. All Worker identities persist across runs for independence purposes.

## Role cycle

`Planner -> Coder -> Designer -> Tester -> Reviewer -> Planner`

The canonical cursor provides the starting role for scheduled Workers #1–#5.

Worker #6 and Worker #7 are cursor-independent. A direct Admin instruction may define either manual Worker's role, target, scope, or starting point. When the Admin invokes either manual Worker broadly without narrowing the role, that Worker reads README first, performs a project-priority scan, and then uses the same role boundaries and work-conserving cycle as the scheduled Workers.

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

Worker #6 and Worker #7 are separate persistent identities for this rule even though neither has a recurring routine. Work produced manually as Worker #6 cannot later be independently approved by Worker #6, and the same applies to Worker #7. Worker #6 may independently verify Worker #7 work, and Worker #7 may independently verify Worker #6 work, when all normal Tester requirements are satisfied.

## Claims and overlap

Workers may overlap in time. `WORK-CLAIM`, dependency checks, exact committed-state checks, and NVIDIA ownership are the collision controls.

Before modifying a target, claim it with the current Worker identity and role. Re-fetch before important writes. Never duplicate a live claim or break live NVIDIA ownership merely because a run is old.

A Worker must not treat NVIDIA Coder self-test as independent PASS.

## Scheduled rotation state

The canonical recurring cursor is the latest valid `WORKER ROTATION STATE:` JSON comment on GitHub issue #97. It applies only to scheduled Workers #1–#5. Scheduled Workers append state comments; they do not rewrite history.

At the end of a scheduled work-conserving run, the Worker records one `WORKER ROTATION RESULT:` summarizing the starting role, roles/passes attempted, targets completed or blocked, commits/PRs, checks/results, revisions, claim-clear state, pending external work, and whether continuation is required.

The next scheduled cursor uses the successor of the last role in which useful work was actually performed. If the run produced no eligible progress in any role, preserve the original starting role. If the run was interrupted by a hard execution limit while eligible work remained, preserve continuity from the last useful role and explicitly record the pending continuation so the next Worker can resume from current GitHub state rather than repeating completed work.

## Manual Worker #6 and Worker #7 instruction profiles

Worker #6 and Worker #7 are available only through direct Admin invocation. Neither is created, enabled, scheduled, resumed, or triggered by an automation routine.

A manual Worker #6 or Worker #7 invocation must:

1. Treat the Admin's direct instruction as the highest authority and use it to determine any explicitly supplied role, target, scope, or exception.
2. Read current `main/README.md` first before project work.
3. Inspect relevant active/earlier state, dependencies, revisions, claims, NVIDIA state, CI/Actions, and task eligibility.
4. Use the same Planner/Coder/Designer/Tester/Reviewer authority boundaries and critical priorities unless the Admin explicitly narrows or overrides the normal workflow.
5. When the Admin gives a broad instruction rather than a single-role/task instruction, run work-conservingly across roles with no artificial task/pass cap and stop normally only after a complete five-role pass makes no eligible progress.
6. Respect its own persistent Worker identity independence across all current and future manual invocations.
7. Use normal `WORK-CLAIM` collision protection and never interfere with live scheduled Worker, the other manual Worker, or NVIDIA ownership.
8. Never edit README without explicit Admin authorization.
9. Never consume, advance, rewrite, or reserve the scheduled `WORKER ROTATION STATE:` cursor.
10. If project work is performed, post a `MANUAL WORKER #6 RESULT:` or `MANUAL WORKER #7 RESULT:` audit on issue #97, matching the invoked identity, with roles/passes attempted, targets, commits/PRs, checks/results, blockers/revisions, pending external work, continuation state, and claim-clear state.

Because Worker #6 and Worker #7 do not participate in the recurring cursor, their repository changes are discovered by scheduled Workers #1–#5 and by each other through normal state re-fetch and claim/dependency checks.

Detailed scheduling times and automation implementation remain outside this file.
