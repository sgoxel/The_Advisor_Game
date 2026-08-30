# Worker Rotation Protocol

This file defines operational HOW below explicit Admin instructions and `README.md`.

## Authority

- Read current `main/README.md` before project work.
- Authority order: Admin explicit instruction -> README -> ROADMAP -> TODO -> issues -> code/assets -> tests.
- Never modify README without explicit Admin authorization.
- GitHub is the sole project workspace and durable audit record.

## Worker identities

Scheduled Workers are persistent identities `Worker #1` through `Worker #5`.
Workers `#6` through `#20` are manual-only Admin-invoked persistent identities and never consume or alter the scheduled cursor.

## Role cycle

`Planner -> Coder -> Designer -> Tester -> Reviewer -> Planner`

The latest valid `WORKER ROTATION STATE:` on issue #97 supplies only the starting role for the next scheduled Worker. A cursor is routing information, never ownership.

## Maximum work-conserving execution

Starting at the assigned role, traverse the cycle and perform all safely eligible work in project-priority order.

Within **each role**, process as many eligible targets sequentially as possible. Completing, closing, PASSing, blocking, yielding, handing off, or clearing one target is never by itself a reason to end the run.

After every material issue, commit, check, revision, dependency, claim, handoff, or planning change:

1. clear/yield any finished or waiting target claim;
2. re-fetch relevant GitHub state;
3. re-scan the **same role** for another eligible target;
4. continue that role while eligible work remains;
5. advance to the next role only when the current role is exhausted.

Useful work or any eligibility-changing event resets the empty-pass stop gate. Continue passes until the stop conditions below are satisfied.

Never invent work, retry an unchanged blocker indefinitely, or idle on an external wait when another unrelated eligible target exists.

## Actionable-capacity recovery

Planner measures two different values:

- total usable focused open inventory;
- immediately executable unclaimed **current/earlier** work.

The normal executable target is **12-15** when legitimate approved scope permits. If executable depth is **below 10**, that Planner visit must perform a **capacity-recovery sweep** after any higher-priority README reconciliation, blocking P-REV, or active planning repair.

The sweep must examine **all approved current/earlier scope and current open issue state**, not merely targets already mentioned earlier in the run.

Immediately executable means the target is current/earlier, open, has all real dependencies satisfied, can be acted on now by an authorized role, has no live conflicting target claim, has no unresolved blocking revision, and requires no external wait before safe action. Future-phase and dependency-blocked work never counts.

If legitimate independent work can be exposed from approved scope, Planner must create, adapt, reopen, or split focused outcomes as appropriate, preserving real dependencies, acceptance criteria, phase boundaries, Designer coverage, independence, and non-duplication. Then re-fetch state and continue the role cycle so newly executable work can be consumed in the same run when safe.

Planner must never create filler, duplicate scope, speculative/invented gameplay, fake eligibility, false dependencies, weakened acceptance criteria, or artificial micro-tasks merely to satisfy a metric.

If executable depth remains below 10, the result must record the exact lower count and **issue/area-specific blocker evidence**. Statements such as `open inventory is substantial` are not sufficient because total open inventory is not executable capacity.

## Normal stop gate

Normal STOP is permitted only when:

1. any required capacity-recovery sweep has completed;
2. state has been re-fetched after that sweep;
3. a subsequent complete Planner -> Coder -> Designer -> Tester -> Reviewer pass produces zero useful progress and creates no new eligibility; and
4. `remaining_eligible_targets` is an exact integer from the final scan.

`remaining_eligible_targets=unknown` is not valid for a normal stop. It is allowed only when a real connector/platform/hard execution failure prevents the final count; then record the failure/checkpoint and set `continuation_required=true`.

A safe hard-limit cutoff may end a run before this gate only after the current target reaches an atomic checkpoint, all live claims are cleared/yielded, exact continuation state is recorded, and `continuation_required=true`.

## Target-scoped claim invariant

A Worker may hold at most one live formal `WORK-CLAIM`, and only for the single concrete issue/task actively being worked.

Before moving to another issue or role target, clear/yield the current target claim. A claim on issue A has zero ownership effect on issue B. Parent/child, sibling, same-feature, dependency, role, pass, cursor, phase, backlog, chain, batch, queue, or invocation relationships never create broader ownership.

Use a two-phase safety check before writes: inspect target state, claim the exact target when collision protection is needed, then immediately re-fetch and abandon the claim if an earlier conflicting claim exists.

If a target becomes blocked or waits on CI/another Worker and the Worker moves elsewhere, record the pending state, clear/yield that target claim, and continue.

## Role authority

### Planner
Owns planning below README: phase/order/dependencies/architecture/organization/decomposition/scope/acceptance criteria/routing/release prerequisites and ROADMAP/TODO consistency. Maintains legitimate deep and executable work inventory, performs mandatory capacity recovery when the executable pool is shallow, and never pads capacity with filler or false dependencies. Does not implement product code/design or approve release work.

### Coder
Owns approved technical implementation, integration, configuration and implementation-focused tests. Does not redefine Planner scope/AC/dependencies/phase order. Planning changes require a Planner revision request.

### Designer
Owns approved UI/UX, 2D/2.5D/3D visual production, assets, terrain/world/map presentation, responsiveness, accessibility and visual performance. Runtime/gameplay/simulation logic remains Coder-owned unless explicitly approved as integration work.

### Tester
Independent committed-state verification authority. Verifies exact SHA/files/assets/CI/browser/responsive/accessibility/performance/public behavior as applicable. Tester does not repair product/design code while verifying. Defects return through the same issue as a Tester revision request. Normal phase/release approval requires an independent Worker identity unless the README-defined cumulative Tester-deadlock exception truly applies.

### Reviewer
Owns process control, defect/root-cause analysis, CI/workflow reliability, bottleneck correction and continuous improvement. Reviewer may implement focused evidenced process/workflow/config fixes but cannot override Planner scope/AC/dependencies/phase authority and cannot independently approve its own changes.

## Independence

No Worker independently PASSes or approves its own prior implementation, design, revision, bug fix, workflow/process fix, or other authored change except the narrowly defined README cumulative Tester-deadlock gate. Coder/Designer/Reviewer changes normally require Tester verification by a different Worker identity.

## Revisions

- Planning changes required by Coder/Designer/Reviewer -> `PLANNER REVISION REQUEST` on the same issue; Planner records ACCEPTED or REJECTED with evidence.
- Tester defects -> reopen/use the same issue and record `TESTER REVISION REQUEST` with repro, evidence, expected behavior, affected refs and required correction. The responsible role accepts/fixes or rejects with evidence; a different eligible Tester retests.

## Audit and completion

Every change maps to an issue/task and records English audit evidence: purpose, change, refs/files, checks, result, risks/blockers and next action.

Close work only after required commits/assets, checks, resolved revisions and required verification are complete. Do not claim independent PASS without eligible independent Tester evidence.

## Scheduled run result

Each scheduled Worker posts one `WORKER ROTATION RESULT:` on #97 containing starting role, roles/passes, targets, commits/PRs, checks, revisions/blockers and continuation state.

Always report:

- `claims_acquired_this_run`
- `claims_cleared_this_run`
- `live_claims_at_end`
- `executable_depth_before`
- `capacity_recovery_required`
- `capacity_recovery_performed`
- `capacity_actions_taken`
- `executable_depth_after`
- `remaining_eligible_targets`

Normally `live_claims_at_end=0`; that means cleanup, not zero work.

If no target was acquired, also record `eligible_targets_found` and concise exclusion counts/reasons. If executable depth remains below 10, include representative issue numbers/areas and concrete blocker categories showing why legitimate approved work cannot safely replenish the pool further.

The next scheduled starting role is the successor of the last role that performed useful work; if no useful progress occurred, preserve the original starting role.
