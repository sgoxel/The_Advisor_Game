# Worker Rotation Control

This file documents the ChatGPT Worker execution protocol only. It is not product scope, phase planning, release authority, or a replacement for README/ROADMAP/TODO/issues.

## Worker identities

Five independent scheduled Workers exist:

- Worker #1
- Worker #2
- Worker #3
- Worker #4
- Worker #5

Workers #6 through #20 are different: they are reserved **manual Admin-invoked execution identities / instruction profiles**, not scheduled routines.

Workers #1–#5 use the recurring schedule and canonical rotation cursor. Workers #6 through #20 exist only when the Admin directly invokes the respective Worker or gives that manual Worker an instruction in chat. No manual Worker has automation, timer, recurrence, scheduled task, or recurring cursor slot. All Worker identities persist across runs for independence purposes.

## Role cycle

`Planner -> Coder -> Designer -> Tester -> Reviewer -> Planner`

The canonical cursor provides the starting role for scheduled Workers #1–#5.

Workers #6 through #20 are cursor-independent. A direct Admin instruction may define any manual Worker's role, target, scope, or starting point. When the Admin invokes any manual Worker broadly without narrowing the role, that Worker reads README first, performs a project-priority scan, and then uses the same role boundaries and work-conserving cycle as the scheduled Workers.

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

- Planner: README reconciliation, blocking Planner revisions, active-phase planning repair, **NVIDIA utilization/preflight scan**, then normal backlog and work-inventory capacity.
- Coder: accepted Tester revision correction, continuation, `ai-handoff`, then ordinary eligible coding.
- Designer: accepted Designer revision correction or continuation, then required active/earlier visual work.
- Tester: revision retest, blockers, `ai-awaiting-review` or Tester handoff, active untested work, earlier fixes, then release gates including any documented Tester-deadlock gate that has become executable.
- Reviewer: evidenced blocking process/workflow/CI/automation defects, stale-state risks, and reliability problems before ordinary process improvement.

Within those priorities, prefer the oldest/highest-priority eligible unclaimed target whose dependencies are satisfied.

Workers must not invent work merely to keep a role busy.

## NVIDIA preflight utilization

NVIDIA Nemotron is an auxiliary read-only Reviewer/Tester preflight layer. It should be used when useful eligible evidence work exists, but it must never become the critical-path authority or replace a formal Worker.

Whenever Planner is reached after the higher-priority reconciliation/revision obligations above, and again after a material state change that creates a new committed candidate, perform an NVIDIA utilization scan **before ordinary Planner backlog/capacity work**.

The scan must:

1. Re-fetch open `ai-ready`, `ai-running`, NVIDIA `work-claimed`, `ai-awaiting-review`, `ai-handoff`, and candidate issue state.
2. Respect the maximum of one NVIDIA issue reserved/running at a time.
3. Consider only open, dependency-ready, unclaimed, current/earlier-phase work that is suitable for read-only Reviewer or Tester evidence.
4. Prefer one high-value target in this order:
   - Reviewer preflight of a newly committed Coder/Designer/Reviewer candidate, especially gameplay/simulation/world logic, integration, regression risk, workflow/config/process or architecture evidence;
   - Reviewer audit of game dynamics for rule consistency, internal causal logic and real-world plausibility where relevant;
   - Reviewer read-only planning/process analysis that produces recommendations only;
   - Tester preflight of objective exact-SHA tests/artifacts when that is more useful or Reviewer evidence already exists.
5. Never route NVIDIA Coder work, Designer production, Planner-authoritative changes, README changes, formal phase/release approval, or a target already actively claimed by a formal Tester.
6. If a target is routed, add exactly one supported `ai-role-reviewer` or `ai-role-tester` label and add `ai-ready` **last**.

NVIDIA must not make Workers idle. If NVIDIA is already reserved/running, record the pending state and continue normal work-conserving execution. If a formal Worker can safely progress another task, do so. If a formal Tester has already claimed the same candidate, do not race that claim merely to increase NVIDIA utilization.

When a suitable candidate is found, Planner records one deduplicated machine-readable opportunity on #79 before routing/deferring:

`AI AUXILIARY OPPORTUNITY: {"schema_version":1,"timestamp":"<UTC ISO-8601>","source_issue":123,"target_ref":"<sha/pr/state>","role":"reviewer|tester","disposition":"routed|deferred_busy|skipped_formal_claim","reason":"<short machine-readable reason>"}`

Do not repeat the same source issue + target ref + role + disposition unless material state changes.

When a formal Worker later consumes `ai-awaiting-review` and has a genuinely comparable formal verdict, record one follow-up on #79:

`AI AUXILIARY FOLLOW-UP: {"schema_version":1,"timestamp":"<UTC ISO-8601>","source_issue":123,"target_ref":"<sha/pr/state>","ai_run_id":123456789,"ai_role":"reviewer|tester","ai_verdict":"pass|changes_requested|fail|unknown","formal_verdict":"pass|changes_requested|fail|not_comparable","agreement":"agree|disagree|not_comparable"}`

This follow-up measures usefulness only. It is not independent verification and must not fabricate comparability when NVIDIA Reviewer advice and a formal Tester decision answer different questions.

For gameplay/world-system work, formal Workers should inspect NVIDIA Reviewer logic/plausibility findings rather than treating them as generic prose. Findings categorized as `RULE CONSISTENCY`, `GAMEPLAY LOGIC`, `REAL-WORLD PLAUSIBILITY`, and `INTENTIONAL ABSTRACTION` are advisory evidence. README/game rules and deliberate fantasy abstractions remain authoritative over realism assumptions.

## Planner work-inventory capacity

Planner maintains a deep but legitimate issue inventory so scheduled and manual Workers have enough real work to consume without weakening phase priority or product authority.

After README reconciliation, blocking P-REV work, active-phase planning repairs, and the NVIDIA utilization/preflight scan, Planner counts usable open focused work issues. Pure phase trackers, ledgers, rotation/governance records, and similar non-executable bookkeeping do not count toward work-inventory capacity.

When legitimate Admin/README/ROADMAP-approved scope supports it:

- target roughly **45–55 open focused work issues**;
- if usable inventory falls below **40**, replenish by decomposing already approved work toward roughly 50;
- aim for at least **10 immediately eligible, unclaimed targets** when real dependencies and approved scope permit;
- preserve useful parallel work for both Coder and Designer when legitimate work permits.

Current and earlier unresolved work always remains higher priority. README/ROADMAP-defined near-future work may be pre-decomposed only when useful for capacity planning, and every such issue must be explicitly blocked by its future phase and/or real dependencies until it becomes legitimately eligible. Pre-decomposition never activates a future phase early.

Every capacity issue must trace to an Admin instruction, README requirement, ROADMAP-approved outcome, evidenced defect, required prerequisite, integration need, verification/regression need, or a justified focused decomposition of approved scope. Normally one issue represents one focused, measurable, independently testable outcome.

The numeric inventory target is not a quota and never grants scope authority. Planner must not create filler, duplicate issues, speculative features, invented gameplay, unnecessary artificial micro-tasks, fake dependencies, or future work unsupported by README/ROADMAP merely to reach a count. If the legitimate approved scope supports fewer issues or fewer immediately eligible targets, the truthful lower number is correct and must be reported rather than padded.

## Independence

A Worker must never **independently** approve its own implementation, design, revision, bug fix, workflow fix, process fix, or other prior change from the same or an earlier run.

When reaching Tester or Reviewer, the Worker first seeks another eligible independent target. If another authorized independent Worker can verify the target, normal independent verification remains required.

Coder, Designer, and Reviewer changes still require independent Tester verification by a different Worker identity before being called independently verified.

Workers #6 through #20 are separate persistent identities for this rule even though none has a recurring routine. Work produced manually by a Worker cannot later be independently approved by that same Worker. Any Worker #6 through #20 may independently verify another Worker's work when all normal Tester requirements are satisfied.

### Tester deadlock exception

A cumulative phase or release gate enters **Tester deadlock** only when all of these conditions are true:

- the gate is otherwise dependency-ready;
- required implementation/design/revision work is complete;
- no unresolved valid T-REV, P-REV, claim collision, NVIDIA ownership conflict, or higher-authority blocker remains;
- every currently authorized Worker identity that could act as Tester is disqualified solely because each has accepted authorship inside the cumulative gate scope.

When this exact condition is documented, Worker-identity independence must not leave the project permanently blocked.

For scheduled Workers #1–#5, the **first Worker whose normal canonical rotation/run reaches the Tester gate after the deadlock is documented** may claim and execute that gate. The Worker must not skip ahead in the scheduled cursor merely to obtain the exception. Any Worker #6 through #20 may execute the deadlock gate only when directly invoked by Admin while the deadlock is still unresolved and no other Worker already owns the gate.

The deadlock Worker must perform the same complete exact-state gate verification that an independent Tester would perform. No test, browser, responsive, accessibility, performance, regression, public-state, CI, artifact, exact-SHA, or unresolved-revision requirement is waived by this exception.

A successful exception result must use the explicit marker:

`DEADLOCK TESTER PASS`

The same PASS record must identify the exact tested SHA/state, the deadlock issue/record, required evidence, and the passing Worker's own accepted authorship inside the cumulative scope. The PASS is valid phase/release authority and may activate the next phase or release workflow. It must **not** be described as independent verification of the passing Worker's own included work.

If a genuinely independent authorized Tester becomes available before the deadlock gate is claimed, the normal independent Tester path takes priority and the exception is not used.

## Tester revision resolution

A `TESTER REVISION REQUEST` remains unresolved until its responsible role has accepted/rejected it under normal governance and, when a fix is required, a different independent Tester retests the corrected exact state.

A successful independent revision retest must include this machine-readable line in the same PASS comment:

`T-REV-RESOLVED(request=<request-comment-id>, tested_ref=<exact-commit-sha>)`

`request` is the GitHub issue-comment id of the specific `TESTER REVISION REQUEST`. `tested_ref` is the exact corrected commit SHA independently tested. A generic `TESTER PASS`, a Coder/Designer/Reviewer self-check, or a marker posted before the referenced request does not resolve that revision.

The Tester deadlock exception applies to cumulative phase/release gates, not to ordinary issue-level T-REV retesting when another independent identity can perform that retest. An issue-level revision may use a deadlock exception only if Admin/README governance explicitly recognizes an equivalent documented all-identities deadlock for that verification boundary.

Before closing an issue, re-fetch its comments and confirm every `TESTER REVISION REQUEST` has a later matching `T-REV-RESOLVED(...)` marker. The repository T-REV closure guard performs the same deterministic check on issue-close events and reopens an issue if an unresolved Tester revision remains. The guard is a process safety net only; it never creates Tester PASS, phase approval, or release approval.

## Claims and overlap

Workers may overlap in time. `WORK-CLAIM`, dependency checks, exact committed-state checks, and NVIDIA ownership are the collision controls.

Before modifying a target, claim it with the current Worker identity and role. Claim acquisition is a two-phase pre-write safety check: **(1)** immediately before posting `WORK-CLAIM`, re-fetch the target issue comments/state and confirm there is no earlier live conflicting claim or NVIDIA ownership; **(2)** immediately after posting the claim, re-fetch the target issue comments/state again before the first repository, product, planning, design, test, or workflow write. If that second read reveals an earlier conflicting live claim, the earlier claim wins deterministically; the later claimant must treat its claim as superseded, post a claim-clear/collision audit, make no target write, and continue the work-conserving cycle. Re-fetch again before other important writes. Never duplicate a live claim or break live NVIDIA ownership merely because a run is old.

A Worker must not treat NVIDIA Coder self-test as independent PASS. NVIDIA is not phase/release authority and cannot consume the Tester deadlock exception.

## Scheduled rotation state

The canonical recurring cursor is the latest valid `WORKER ROTATION STATE:` JSON comment on GitHub issue #97. It applies only to scheduled Workers #1–#5. Scheduled Workers append state comments; they do not rewrite history.

At the end of a scheduled work-conserving run, the Worker records one `WORKER ROTATION RESULT:` summarizing the starting role, roles/passes attempted, targets completed or blocked, commits/PRs, checks/results, revisions, claim-clear state, pending external work, and whether continuation is required.

The next scheduled cursor uses the successor of the last role in which useful work was actually performed. If the run produced no eligible progress in any role, preserve the original starting role. If the run was interrupted by a hard execution limit while eligible work remained, preserve continuity from the last useful role and explicitly record the pending continuation so the next Worker can resume from current GitHub state rather than repeating completed work.

A documented Tester deadlock does not itself rewrite or fast-forward the scheduled cursor. The first scheduled Worker that reaches the gate through normal rotation may use the exception; once that Worker claims the gate, later Workers must respect the live claim.

## Manual Worker #6 through #20 instruction profiles

Workers #6 through #20 are available only through direct Admin invocation. None is created, enabled, scheduled, resumed, or triggered by an automation routine.

A manual Worker #6 through #20 invocation must:

1. Treat the Admin's direct instruction as the highest authority and use it to determine any explicitly supplied role, target, scope, or exception.
2. Read current `main/README.md` first before project work.
3. Inspect relevant active/earlier state, dependencies, revisions, claims, NVIDIA state, CI/Actions, and task eligibility.
4. Use the same Planner/Coder/Designer/Tester/Reviewer authority boundaries and critical priorities unless the Admin explicitly narrows or overrides the normal workflow.
5. When the Admin gives a broad instruction rather than a single-role/task instruction, run work-conservingly across roles with no artificial task/pass cap and stop normally only after a complete five-role pass makes no eligible progress.
6. Respect its own persistent Worker identity independence across all current and future manual invocations, except that it may use the documented cumulative Tester deadlock exception when directly Admin-invoked and all exception conditions are satisfied.
7. Use normal `WORK-CLAIM` collision protection and never interfere with live scheduled Workers, another manual Worker, or NVIDIA ownership.
8. Never edit README without explicit Admin authorization.
9. Never consume, advance, rewrite, or reserve the scheduled `WORKER ROTATION STATE:` cursor.
10. If project work is performed, post a `MANUAL WORKER #<n> RESULT:` audit on issue #97, matching the invoked identity, with roles/passes attempted, targets, commits/PRs, checks/results, blockers/revisions, pending external work, continuation state, claim-clear state, and any deadlock-exception use.

Because Workers #6 through #20 do not participate in the recurring cursor, their repository changes are discovered by scheduled Workers #1–#5 and by other manual Workers through normal GitHub state re-fetch and claim/dependency checks.

Detailed scheduling times and automation implementation remain outside this file.
