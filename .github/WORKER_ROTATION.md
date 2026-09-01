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

Persistent identity includes continuity responsibility for that Worker's own previously claimed open issues. A later invocation of the same Worker must reconcile its own unfinished claim history before taking unrelated work.

## Role cycle

`Planner -> Coder -> Designer -> Tester -> Reviewer -> Planner`

The latest valid `WORKER ROTATION STATE:` on issue #97 supplies only the starting role for the next scheduled Worker. A cursor is routing information, never ownership.

**Own-claim continuation outranks the rotation cursor.** The cursor is consulted for unrelated work only after the Worker has reconciled every open issue for which that same Worker still has an executable claim or retained waiting responsibility.

## Own-claim continuity and resume priority

Immediately after reading README and before normal role/capacity scanning, every Worker must perform an **OWN-CLAIM RECONCILIATION** across open issues.

The Worker must find:

- every exact-target `WORK-CLAIM` issued by that same Worker, whether it is still valid under the three-hour stale rule, and whether it was subsequently cleared or closed;
- every unresolved `WORK-CLAIM WAIT` / retained-responsibility record previously created by that same Worker;
- whether each such issue is closed, still waiting, or executable again.

Priority rules:

1. If any own unresolved claimed/responsibility issue has a safe authorized action now, that issue is mandatory continuation and outranks the cursor, a new issue, another role target, capacity expansion, and easier work.
2. When legacy state exposes multiple own executable unresolved claims, resume the **oldest unresolved own claim first**, unless a higher-authority dependency or explicit Admin instruction requires another order.
3. Continue the owned issue until it is closed/completed, handed to a required independent role, or reaches a documented **MANDATORY WAIT** as defined below.
4. A Worker must not acquire a new unrelated `WORK-CLAIM` while any own unresolved issue has an executable safe action.
5. Difficulty, size, uncertainty, investigation cost, number of files, expected test duration, or preference for another role is never permission to abandon an executable owned issue.
6. After every material state change, and before every new unrelated claim, re-check own waiting responsibilities. If a resume trigger has become true, return to that older owned issue at the next atomic checkpoint before claiming further work.
7. If an own historical claim has expired under the three-hour rule, it is no longer exclusive. Before resuming it, inspect whether another Worker validly took over or completed the issue; reacquire normally only when the target remains available.

This rule applies equally to scheduled Workers #1-#5 and manual Workers #6-#20.

## Mandatory wait and retained responsibility

A claimed issue may be set aside for unrelated work **only** when the issue has a genuine mandatory wait and there is no safe authorized action left for the owning Worker on that exact target now.

A MANDATORY WAIT must be evidenced and target-specific. Valid examples include:

- required CI/check/workflow evidence is still nonterminal and no further safe owner action exists until it finishes;
- a different independent Worker identity must perform Tester/Reviewer verification and the owner is prohibited from self-approving;
- an explicit hard prerequisite owned by another target/role is unsatisfied and there is no safe preparatory/correction action remaining on the claimed target;
- required external/Admin-provided evidence or an external system result is unavailable and no local safe action remains.

The following are **not** mandatory waits:

- the task is difficult, large, unfamiliar, risky, or time-consuming;
- more investigation, reproduction, code reading, design work, implementation, local testing, logging, or evidence collection can still be performed safely;
- another issue looks easier or higher throughput;
- the current role would prefer to rotate;
- the run is approaching a context/tool/execution limit. A hard-limit cutoff is a continuation checkpoint, not a wait reason.

### Parking an issue without losing responsibility

When a genuine mandatory wait is reached and the Worker needs to do unrelated work:

1. record a durable `WORK-CLAIM WAIT(worker=..., issue=..., blocker=..., evidence=..., resume_trigger=..., exclusive=false)` on the issue;
2. in the same handoff, explicitly clear the exclusive claim with `WORK-CLAIM CLEAR(... reason=mandatory_wait, responsibility=retained)`;
3. state the exact condition that will make the issue executable again;
4. only then may the Worker claim another unrelated issue.

`WORK-CLAIM WAIT` preserves **continuity responsibility**, but it is **non-exclusive**. It must not prevent the specifically required independent Tester/Reviewer/other Worker action that constitutes the wait condition. Exclusive collision protection exists only while an exact-target live `WORK-CLAIM` has not been cleared.

When the resume trigger becomes true, the original responsible Worker must preferentially reclaim and continue the issue before taking further unrelated work, unless the issue was already validly completed/closed by the required handoff role.

## Three-hour stale exclusive-claim expiry

Exclusive claim protection has a sliding maximum inactivity window of **3 hours**.

### Clock and qualifying action

- The initial `WORK-CLAIM` comment starts the clock for that exact Worker + exact issue.
- The clock is refreshed only by a **qualifying action from the same Worker on the same issue**.
- A qualifying action must contain concrete target progress or a material target-state decision/evidence update, such as a target-linked commit/PR/handoff, implementation/design/test/review evidence, a revision decision/correction, or an exact continuation checkpoint that records newly completed work/evidence and the next safe action.
- Empty heartbeat/status comments (`still working`, `claim refresh`, etc.), repeated unchanged blocker text, re-fetch-only activity, activity on another issue, cursor/rotation comments, or unrelated commits do **not** refresh the clock.
- Mandatory external/independent waits must use the non-exclusive parking protocol above; they must not keep an exclusive claim alive merely by periodic comments.

### Expiry

If **more than 3 hours** have elapsed since the most recent qualifying same-Worker/same-issue action, the exclusive claim is automatically **STALE / INVALID** and has zero collision-blocking effect.

Before ignoring or taking over a claim as stale, the acting Worker must:

1. fetch the full exact-target issue history;
2. identify the original claim and the most recent qualifying action by that Worker on that issue;
3. verify from timestamps that more than 3 hours have elapsed;
4. confirm no later qualifying action renewed the claim;
5. record `STALE WORK-CLAIM INVALIDATED(worker=..., issue=..., claim_comment=..., last_qualifying_action=..., inactive_for=..., checked_at=...)` on the issue;
6. only then use the normal two-phase exact-target claim -> immediate re-fetch check before writing.

A stale claim does not need consent from the inactive Worker to expire. A later invocation of the original Worker must treat the stale claim as non-exclusive historical responsibility, inspect whether another Worker has validly taken over/completed the target, and reacquire normally only if the target is still available.

### Hard-limit continuation

A hard execution/context/tool cutoff may keep an executable exclusive claim only while the three-hour validity window remains satisfied. The Worker records an exact continuation checkpoint and must resume on its next invocation. If no qualifying same-target action occurs for more than three hours, that preserved claim still expires automatically and may be taken over safely using the stale-invalidation protocol.

### Classification and audit

Only **valid, non-stale exclusive claims** belong in collision/live-claim blocker classifications. Stale claims are invalidated first and then the target is reclassified from live state. Run/audit output should identify stale invalidations separately (`stale_claims_invalidated_this_run`, `stale_claim_issue_ids`) whenever any are found.

## Maximum work-conserving execution

After own-claim reconciliation, starting at the assigned role, traverse the cycle and perform all safely eligible work in project-priority order.

Within **each role**, process as many eligible targets sequentially as possible. Completing, closing, PASSing, blocking, yielding, handing off, or clearing one target is never by itself a reason to end the run.

After every material issue, commit, check, revision, dependency, claim, handoff, wait-state, or planning change:

1. preserve/clear/park the current target claim according to the claim-continuity rules above;
2. re-fetch relevant GitHub state;
3. re-check own unresolved claim/wait responsibilities first;
4. if no own issue is executable, re-scan the **same role** for another eligible target;
5. continue that role while eligible work remains;
6. advance to the next role only when the current role is exhausted and no own resumable issue requires priority.

Useful work or any eligibility-changing event, including stale-claim invalidation, resets the empty-pass stop gate. Continue passes until the stop conditions below are satisfied.

Never invent work, retry an unchanged blocker indefinitely, or idle on a mandatory external wait when another unrelated eligible target exists after the wait has been properly parked and the exclusive claim cleared.

## Eligibility classification and dependency semantics

Eligibility is **target-specific and role-specific**. Never infer serialization merely because two issues mention each other or affect the same feature area.

### Hard blockers

A target may be excluded from immediately executable depth only when current authoritative evidence establishes at least one real blocker for the role being measured, such as:

- the target belongs to a future/inactive phase;
- an explicit `Depends on`, Planner dependency/order decision, acceptance prerequisite, or other authoritative prerequisite is unsatisfied;
- an earlier valid, non-stale conflicting **exclusive** `WORK-CLAIM` exists on that exact target;
- the target requires external evidence/CI/another Worker result before the measured role can safely act and no independent action remains for that role;
- the measured Worker/role is prohibited by role authority or independence;
- an unresolved P-REV prevents implementation because scope/AC/dependency/phase authority is genuinely undecided;
- an unresolved T-REV prevents **Tester PASS** because no corrected candidate/evidence exists yet.

A non-exclusive `WORK-CLAIM WAIT` responsibility record is not itself a collision blocker. Inspect its stated blocker/resume trigger and the role being measured.

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

Owned executable continuations are consumed **before** Planner attempts to replenish unrelated capacity. Properly parked mandatory-wait responsibilities do not count as immediately executable until their resume condition becomes true.

The normal executable target is **12-15** when legitimate approved scope permits. If executable depth is **below 10**, that Planner visit must perform a **capacity-recovery sweep** after any higher-priority README reconciliation, blocking P-REV, active planning repair, and mandatory own-claim continuation.

The sweep must examine **every approved current/earlier open focused issue/task**, not merely targets already mentioned earlier in the run or a remembered candidate subset.

For each scanned target, classify the current live state for authorized roles as one of the applicable outcomes: eligible normal work, eligible revision work, eligible independent verification, hard dependency blocked, live-claimed, mandatory-wait responsibility, external-only wait, independence/role excluded, future/inactive, or other evidenced hard exclusion. Soft coordination/reuse relationships remain visible in the ledger but do not reduce executable depth.

Immediately executable means the target is current/earlier and open, has no unsatisfied **real hard prerequisite for the measured role**, can be acted on safely now by an authorized role, has no earlier valid non-stale conflicting exclusive exact-target claim, and requires no external wait before that role's next safe action. A revision counts as executable whenever the measured authorized role has a concrete safe correction/retest action now.

If legitimate independent work can be exposed from approved scope, Planner must create, adapt, reopen, or split focused outcomes as appropriate, preserving real dependencies, acceptance criteria, phase boundaries, Designer coverage, independence, and non-duplication. Then re-fetch state and continue the role cycle so newly executable work can be consumed in the same run when safe.

Planner must never create filler, duplicate scope, speculative/invented gameplay, fake eligibility, false dependencies, weakened acceptance criteria, or artificial micro-tasks merely to satisfy a metric.

If executable depth remains below 10, the result must record the exact lower count and **issue/area-specific blocker evidence**. Statements such as `open inventory is substantial` are not sufficient because total open inventory is not executable capacity.

## Normal stop gate

Normal STOP is permitted only when:

1. own-claim reconciliation has completed and no own unresolved responsibility has an executable safe action;
2. any required capacity-recovery sweep has completed;
3. state has been re-fetched after that sweep;
4. the final current/earlier issue-by-issue eligibility ledger has been rebuilt from live state;
5. a subsequent complete Planner -> Coder -> Designer -> Tester -> Reviewer pass produces zero useful progress and creates no new eligibility; and
6. `remaining_eligible_targets` is the exact count of all targets for which at least one authorized role still has a safe action now.

A zero result must be **proved by subtraction from the complete final scan**, not inferred from absence of remembered candidates. It is invalid to report `remaining_eligible_targets=0` while any current/earlier issue has eligible implementation, design, revision correction, independent verification, Reviewer work, or a resumable own responsibility.

`remaining_eligible_targets=unknown` is not valid for a normal stop. It is allowed only when a real connector/platform/hard execution failure prevents the final count; then record the failure/checkpoint and set `continuation_required=true`.

A safe hard-limit cutoff may end a run before this gate only after the current target reaches an atomic checkpoint and exact continuation state is recorded. **Do not clear an executable exclusive claim merely because the invocation hit a hard limit.** Preserve the claim with a durable continuation checkpoint so the same Worker is forced to resume it next invocation. Set `continuation_required=true` and do not claim another target in that invocation.

## Target-scoped claim invariant

A Worker may actively work at most one exclusive formal `WORK-CLAIM` at a time, and only for the single concrete issue/task actively being worked.

Before acquiring a new unrelated exclusive claim, the Worker must prove one of these conditions:

- it has no unresolved own claim/responsibility with a safe action now; or
- every unresolved own responsibility is in a documented non-exclusive MANDATORY WAIT state.

A claim on issue A has zero ownership effect on issue B. Parent/child, sibling, same-feature, dependency, role, pass, cursor, phase, backlog, chain, batch, queue, or invocation relationships never create broader ownership.

Use a two-phase safety check before writes: inspect target state, claim the exact target when collision protection is needed, then immediately re-fetch and abandon the claim if an earlier valid non-stale conflicting exclusive claim exists. If an apparent earlier claim is older than three hours, apply the stale-invalidation protocol before deciding collision state.

If a target reaches a genuine mandatory wait and the Worker moves elsewhere, use the parking protocol above: record wait evidence/resume trigger, explicitly clear exclusivity, retain responsibility, then continue. Never silently leave an uncleared claim behind.

If the target is still executable but the invocation must stop for a hard execution/context/tool limit, keep the exact-target claim and post a continuation checkpoint. On the next invocation, own-claim reconciliation must resume it before unrelated work.

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

When independence creates the only remaining required action on an owned issue, that is a valid MANDATORY WAIT for the author. The author must park/clear exclusivity so the independent Worker can claim and verify the same target, while retaining responsibility to resume if the verdict returns correction work.

## Revisions

- Planning changes required by Coder/Designer/Reviewer -> `PLANNER REVISION REQUEST` on the same issue; Planner records ACCEPTED or REJECTED with evidence.
- Tester defects -> reopen/use the same issue and record `TESTER REVISION REQUEST` with repro, evidence, expected behavior, affected refs and required correction. The responsible role accepts/fixes or rejects with evidence; a different eligible Tester retests.
- An accepted/evidenced unresolved Tester revision is correction work, not an excuse to classify the whole target as globally blocked.

A Worker that previously parked an issue for independent verification must resume it ahead of unrelated work if a Tester revision makes safe correction work executable for that Worker again.

## Audit and completion

Every change maps to an issue/task and records English audit evidence: purpose, change, refs/files, checks, result, risks/blockers and next action.

Close work only after required commits/assets, checks, resolved revisions and required verification are complete. Do not claim independent PASS without eligible independent Tester evidence.

An owned issue should be driven toward closure across invocations. `WORK-CLAIM WAIT` is a temporary, evidenced continuity state, not abandonment and not a substitute for completion.

## Scheduled run result

Each scheduled Worker posts one `WORKER ROTATION RESULT:` on #97 containing starting role, roles/passes, targets, commits/PRs, checks, revisions/blockers and continuation state.

Always report:

- `own_claims_scanned`
- `own_claim_issue_ids`
- `resumed_owned_issue_ids`
- `waiting_owned_issue_ids`
- `mandatory_wait_issue_ids`
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

Normally `live_claims_at_end=0` for a normal STOP because executable work is complete or genuine waits were parked non-exclusively. At a SAFE CUTOFF, `live_claims_at_end=1` is valid and preferred when the current executable target is preserved for same-Worker continuation; the result must identify that issue and exact next action.

If no new target was acquired but an owned target was resumed, that is useful work and must not be reported as idle. If no target was acquired or resumed, also record `eligible_targets_found` and concise exclusion counts/reasons. If executable depth remains below 10, include representative issue numbers/areas and concrete blocker categories showing why legitimate approved work cannot safely replenish the pool further.

The next scheduled starting role is the successor of the last role that performed useful **unrelated rotation work**; mandatory own-claim continuation itself does not erase the stored cursor. If no unrelated useful role occurred, preserve the original starting role.
