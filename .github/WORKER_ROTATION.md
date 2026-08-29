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

Within each role, process as many eligible targets sequentially as possible. After every material issue, commit, check, revision, dependency, or planning change, re-fetch relevant GitHub state and re-evaluate eligibility. Continue passes while useful progress or eligibility changes occur. Stop normally only after one complete five-role pass produces no eligible progress.

Never invent work, retry an unchanged blocker indefinitely, or idle on an external wait when another unrelated eligible target exists.

## Target-scoped claim invariant

A Worker may hold at most one live formal `WORK-CLAIM`, and only for the single concrete issue/task actively being worked.

Before moving to another issue or role target, clear/yield the current target claim. A claim on issue A has zero ownership effect on issue B. Parent/child, sibling, same-feature, dependency, role, pass, cursor, phase, backlog, chain, batch, queue, or invocation relationships never create broader ownership.

Use a two-phase safety check before writes: inspect target state, claim the exact target when collision protection is needed, then immediately re-fetch and abandon the claim if an earlier conflicting claim exists.

If a target becomes blocked or waits on CI/another Worker and the Worker moves elsewhere, record the pending state, clear/yield that target claim, and continue.

## Role authority

### Planner
Owns planning below README: phase/order/dependencies/architecture/organization/decomposition/scope/acceptance criteria/routing/release prerequisites and ROADMAP/TODO consistency. Maintains legitimate deep and executable work inventory without filler or false dependencies. Does not implement product code/design or approve release work.

### Coder
Owns approved technical implementation, integration, configuration and implementation-focused tests. Does not redefine Planner scope/AC/dependencies/phase order. Planning changes require a Planner revision request.

### Designer
Owns approved UI/UX, 2D/2.5D/3D visual production, assets, terrain/world/map presentation, responsiveness, accessibility and visual performance. Runtime/gameplay/simulation logic remains Coder-owned unless explicitly approved as integration work.

### Tester
Independent committed-state verification authority. Verifies exact SHA/files/assets/CI/browser/responsive/accessibility/performance/public behavior as applicable. Tester does not repair product/design code while verifying. Defects return through the same issue as a Tester revision request. Normal phase/release approval requires an independent Worker identity unless the README-defined cumulative Tester-deadlock exception truly applies.

### Reviewer
Owns process control, defect/root-cause analysis, CI/workflow reliability, bottleneck correction and continuous improvement. Reviewer may implement focused evidenced process/workflow/config fixes but cannot override Planner scope/AC/dependencies/phase authority and cannot independently approve its own changes.

## Independence

No Worker independenly PASSes or approves its own prior implementation, design, revision, bug fix, workflow/process fix, or other authored change except the narrowly defined README cumulative Tester-deadlock gate. Coder/Designer/Reviewer changes normally require Tester verification by a different Worker identity.

## Revisions

- Planning changes required by Coder/Designer/Reviewer -> `PLANNER REVISION REQUEST` on the same issue; Planner records ACCEPTED or REJECTED with evidence.
- Tester defects -> reopen/use the same issue and record `TESTER REVISION REQUEST` with repro, evidence, expected behavior, affected refs and required correction. The responsible role accepts/fixes or rejects with evidence; a different eligible Tester retests.

## Audit and completion

Every change maps to an issue/task and records English audit evidence: purpose, change, refs/files, checks, result, risks/blockers and next action.

Close work only after required commits/assets, checks, resolved revisions and required verification are complete. Do not claim independent PASS without eligible independent Tester evidence.

## Scheduled run result

Each scheduled Worker posts one `WORKER ROTATION RESULT:` on #97 containing starting role, roles/passes, targets, commits/PRs, checks, revisions/blockers, continuation state, `claims_acquired_this_run`, `claims_cleared_this_run`, and `live_claims_at_end`.

Normally `live_claims_at_end=0`. If no target was acquired, also record `eligible_targets_found` and brief exclusion reasons.

The next scheduled starting role is the successor of the last role that performed useful work; if no useful progress occurred, preserve the original starting role.
