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

## Eligibility classification and dependency semantics

Eligibility is **target-specific and role-specific**. Never infer serialization merely because two issues mention each other or affect the same feature area.

### Hard blockers

A target may be excluded from immediately executable depth only when current authoritative evidence establishes at least one real blocker for the role being measured, such as:

- the target belongs to a future/inactive phase;
- an explicit `Depends on`, Planner dependency/order decision, acceptance prerequisite, or other authoritative prerequisite is unsatisfied;
- an earlier live conflicting `WORK-CLAIM` exists on that exact target;
- the target requires external evidence/CI/another Worker result before the measured role can safely act and no independent action remains for that role;
- the measured Worker/role is prohibited by role authority or independence;
- an unresolved P-REV prevents implementation because scope/AC/dependency/phase authority is genuinely undecided;
- an unresolved T-REV prevents **Tester PASS** because no corrected candidate/evidence exists yet.

### Soft relationships are not blockers

The following relationship language is non-blocking by default and must never be promoted into a dependency without an explicit authoritative prerequisite:

- `coordinate with`;
- `reuse` / `reuses`;
- `related` / `related to`;
- `compatible with`;
- `follow-up`;
- `when available`, `when active`, or equivalent conditional composition wording;
- shared files, feature family, parent/child/sibling linkage, or the fact that a later integration will consume another system.

If wording is ambiguous, inspect the issue's explicit dependency statement, acceptance criteria, Planner decisions, and live state. Do not infer a hard dependency from proximity or coordination language.

Example rule: an active issue that says it will `reuse/coordinate with` another open issue remains independently executable when its own acceptance criteria can be implemented safely now. The referenced issue becomes a blocker only if current authoritative planning explicitly makes it a prerequisite.

### Revision work is role-aware

An unresolved Tester revision is **not a generic blocker on the issue**. Normally it creates high-priority executable correction work for the responsible Coder, Designer, or Reviewer role while preventing Tester PASS until a corrected candidate and required evidence exist.

Classify the same issue differently by role when appropriate:

- responsible implementation/design/reviewer role with an accepted/evidenced T-REV and a safe correction path -> **ELIGIBLE REVISION WORK**;
- Tester before a corrected candidate/evidence exists -> **BLOCKED FOR TESTER**;
- independent Tester with a corrected candidate and terminal required evidence -> **ELIGIBLE RETEST**;
- another role with no authorized action -> **ROLE-INELIGIBLE**, without making the issue globally blocked.

Likewise, a P-REV blocks only work that depends on the unresolved planning decision; it does not reserve unrelated targets or create a project-wide wait.

## Actionable-capacity recovery

Planner measures two different values:

- total usable focused open inventory;
- immediately executable unclaimed **current/earlier** work.

The normal executable target is **12-15** when legitimate approved scope permits. If executable depth is **below 10**, that Planner visit must perform a **capacity-recovery sweep** after any higher-priority README reconciliation, blocking P-REV, or active planning repair.

The sweep must examine **every approved current/earlier open focused issue/task**, not merely targets already mentioned earlier in the run or a remembered candidate subset.

For each scanned target, classify the current live state for authorized roles as one of the applicable outcomes: eligible normal work, eligible revision work, eligible independent verification, hard dependency blocked, live-claimed, external-only wait, independence/role excluded, future/inactive, or other evidenced hard exclusion. Soft coordination/reuse relationships remain visible in the ledger but do not reduce executable depth.

Immediately executable means the target is current/earlier and open, has no unsatisfied **real hard prerequisite for the measured role**, can be acted on safely now by an authorized role, has no earlier live conflicting exact-target claim, and requires no external wait before that role's next safe action. A revision counts as executable whenever the measured authorized role has a concrete safe correction/retest action now.

If legitimate independent work can be exposed from approved scope, Planner must create, adapt, reopen, or split focused outcomes as appropriate, preserving real dependencies, acceptance criteria, phase boundaries, Designer coverage, independence, and non-duplication. Then re-fetch state and continue the role cycle so newly executable work can be consumed in the same run when safe.

Planner must never create filler, duplicate scope, speculative/invented gameplay, fake eligibility, false dependencies, weakened acceptance criteria, or artificial micro-tasks merely to satisfy a metric.

If executable depth remains below 10, the result must record the exact lower count and **issue/area-specific blocker evidence**. Statements such as `open inventory is substantial` are not sufficient because total open inventory is not executable capacity.

## Normal stop gate

Normal STOP is permitted only when:

1. any required capacity-recovery sweep has completed;
2. state has been re-fetched after that sweep;
3. the final current/earlier issue-by-issue eligibility ledger has been rebuilt from live state;
4. a subsequent complete Planner -> Coder -> Designer -> Tester -> Reviewer pass produces zero useful progress and creates no new eligibility; and
5. `remaining_eligible_targets` is the exact count of all targets for which at least one authorized role still has a safe action now.

A zero result must be **proved by subtraction from the complete final scan**, not inferred from absence of remembered candidates. It is invalid to report `remaining_eligible_targets=0` while any current/earlier issue has eligible implementation, design, revision correction, independent verification, or Reviewer work.

`remaining_eligible_targets=unknown` is not valid for a normal stop. It is allowed only when a real connector/platform/hard execution failure prevents the final count; then record the failure/checkpoint and set `continuation_required=true`.

A safe hard-limit cutoff may end a run before this gate only after the current target reaches an atomic checkpoint, all live claims are cleared/yielded, exact continuation state is recorded, and `continuation_required=true`.

## Target-scoped claim invariant

A Worker may hold at most one live formal `WORK-CLAIM`, and only for the single concrete issue/task actively being worked.

Before moving to another issue or role target, clear/yield the current target claim. A claim on issue A has zero ownership effect on issue B. Parent/child, sibling, same-feature, dependency, role, pass, cursor, phase, backlog, chain, batch, queue, or invocation relationships never create broader ownership.

Use a two-phase safety check before writes: inspect target state, claim the exact target when collision protection is needed, then immediately re-fetch and abandon the claim if an earlier conflicting claim exists.

If a target becomes blocked or waits on CI/another Worker and the Worker moves elsewhere, record the pending state, clear/yield that target claim, and continue.

## Role authority

### Planner
Owns planning below README: phase/order/dependencies/architecture/organization/decomposition/scope/acceptance criteria/routing/release prerequisites and ROADMAP/TODO consistency. Maintains legitimate deep and executable work inventory, performs mandatory capacity recovery when the executable pool is shallow, classifies the full current/earlier inventory role-by-role, and never pads capacity with filler or false dependencies. Does not implement product code/design or approve release work.

### Coder
Owns approved technical implementation, integration, configuration and implementation-focused tests. Unresolved evidenced T-REV correction is high-priority Coder work when the defect belongs to Coder scope. Does not redefine Planner scope/AC/dependencies/phase order. Planning changes require a Planner revision request.

### Designer
Owns approved UI/UX, 2D/2.5D/3D visual production, assets, terrain/world/map presentation, responsiveness, accessibility and visual performance. Unresolved evidenced T-REV correction is high-priority Designer work when the defect belongs to Designer scope. Runtime/gameplay/simulation logic remains Coder-owned unless explicitly approved as integration work.

### Tester
Independent committed-state verification authority. Verifies exact SHA/files/assets/CI/browser/responsive/accessibility/performance/public behavior as applicable. Tester does not repair product/design code while verifying. Defects return through the same issue as a Tester revision request. A T-REV blocks Tester PASS until a corrected candidate/evidence exists, but does not make the responsible correction role globally ineligible. Normal phase/release approval requires an independent Worker identity unless the README-defined cumulative Tester-deadlock exception truly applies.

### Reviewer
Owns process control, defect/root-cause analysis, CI/workflow reliability, bottleneck correction and continuous improvement. Reviewer may implement focused evidenced process/workflow/config fixes, including evidenced T-REV corrections in Reviewer-owned scope, but cannot override Planner scope/AC/dependencies/phase authority and cannot independently approve its own changes.

## Independence

No Worker independently PASSes or approves its own prior implementation, design, revision, bug fix, workflow/process fix, or other authored change except the narrowly defined README cumulative Tester-deadlock gate. Coder/Designer/Reviewer changes normally require Tester verification by a different Worker identity.

## Revisions

- Planning changes required by Coder/Designer/Reviewer -> `PLANNER REVISION REQUEST` on the same issue; Planner records ACCEPTED or REJECTED with evidence.
- Tester defects -> reopen/use the same issue and record `TESTER REVISION REQUEST` with repro, evidence, expected behavior, affected refs and required correction. The responsible role accepts/fixes or rejects with evidence; a different eligible Tester retests.
- An accepted/evidenced unresolved Tester revision is correction work, not an excuse to classify the whole target as globally blocked.

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
- `current_open_targets_scanned`
- `eligible_now_issue_ids`
- `revision_work_eligible_issue_ids`
- `hard_dependency_blocked_issue_ids`
- `live_claim_blocked_issue_ids`
- `external_wait_issue_ids`
- `independence_or_role_excluded_issue_ids`
- `future_or_inactive_issue_ids`
- `coordination_only_not_blocking_issue_ids`

The issue-ID fields may be empty lists, but they must be explicit when capacity recovery or the final STOP proof is performed. A target must not appear as hard-dependency blocked solely because of `coordinate/reuse/related/compatible/follow-up/when available` language.

Normally `live_claims_at_end=0`; that means cleanup, not zero work.

If no target was acquired, also record `eligible_targets_found` and concise exclusion counts/reasons. If executable depth remains below 10, include representative issue numbers/areas and concrete blocker categories showing why legitimate approved work cannot safely replenish the pool further.

The next scheduled starting role is the successor of the last role that performed useful work; if no useful progress occurred, preserve the original starting role.
