# Worker Throughput and Critical-Path Policy

Effective 2026-09-03 under explicit Admin authority. This operational amendment applies below `README.md` and alongside `.github/WORKER_ROTATION.md`. Where this file conflicts with older operational wording about repeated no-op scans, mandatory #97 result comments, or per-cycle hygiene checks, **this newer Admin-authorized policy controls**. Claim safety, Worker identity, role authority, revisions, independence, README protection, exact-state verification, and release gates are unchanged.

## Objective

Keep development continuously productive without weakening correctness: spend Worker time on executable product/design/test/reliability work, rapidly clear blockers that unlock other work, avoid repeated zero-delta scans, and keep CI/audit cost proportional to material change.

## Material state vector

A scheduled Worker first checks the smallest state capable of proving whether useful eligibility may have changed:

- current `main` SHA;
- current ROADMAP/TODO blob SHAs and active phase;
- current/earlier product or infrastructure issue updates since the last exhaustive checkpoint, excluding pure #97 no-op audit traffic;
- live exact-target claim/revision changes relevant to current/earlier work;
- watched CI/workflow state transitions that are named resume triggers for parked work;
- stale-claim deadlines recorded by the last exhaustive scan;
- that Worker's compact continuity state in `.github/WORKER_STATE.json`.

An issue comment, workflow transition, claim release, revision, dependency change, new current/earlier issue, commit, planning change, or stale deadline that can alter eligibility is material even when product source files did not change.

## Quiescent fast path

A scheduled Worker MUST use `QUIESCENT_FAST_PATH` instead of a full five-role cycle when **all** are true:

1. `.github/WORKER_STATE.json` has a valid exhaustive checkpoint and does not request a full scan.
2. Current `main`, ROADMAP and TODO SHAs equal that checkpoint.
3. No current/earlier non-#97 material issue/claim/revision/dependency update occurred after the checkpoint.
4. No watched CI/evidence resume trigger changed state.
5. No recorded live claim crossed its stale deadline.
6. This Worker has `needs_reconcile=false` and none of its recorded retained-responsibility resume triggers fired.
7. The exhaustive checkpoint is younger than **6 hours**.

Fast-path behavior:

- do not rebuild the full issue ledger;
- do not perform capacity recovery;
- do not traverse Planner->Coder->Designer->Tester->Reviewer;
- do not repeat unchanged blocker analysis;
- do not run Lightweight Hygiene again;
- do not post a #97 `WORKER ROTATION RESULT`;
- do not write `.github/WORKER_STATE.json` merely to record the no-op;
- preserve `next_role`.

A fast-path run is intentionally cheap and is not a failure or missed work. Any material-state change invalidates it immediately and the Worker performs normal work-conserving execution.

### Safety refresh

Even with no detected delta, at least one exhaustive scan is required every **6 hours**. The first Worker after the checkpoint expires performs it. This bounds the risk of a missed external transition without making every 12-minute trigger repeat the same proof.

## Compact Worker state

`.github/WORKER_STATE.json` is a cache/checkpoint, never product authority. Exact issue history remains authoritative for claims/revisions, and README/ROADMAP/TODO remain authoritative for scope/planning.

After a material full run, the Worker updates the state file from freshly verified facts using the current file SHA (compare-and-swap). If another Worker updated it first, re-fetch and merge only facts still true; never overwrite newer state with stale state.

The state records at minimum:

- `next_role`;
- last exhaustive checkpoint time and main/ROADMAP/TODO SHAs;
- exact executable depth and eligible issue IDs;
- current critical blockers and their fan-out;
- watched evidence/run IDs and resume targets;
- live exclusive claim stale deadlines known at the checkpoint;
- per scheduled Worker compact responsibility IDs and whether a full reconciliation is required.

A missing, malformed, stale, conflicting, or `needs_full_scan=true` state file disables the fast path and causes a normal exhaustive scan.

## Critical-path priority

When work is executable, Workers must optimize **unlock throughput**, not merely issue count.

Planner/Reviewer identify current/earlier blockers with fan-out:

- `direct_fanout`: current/earlier targets explicitly hard-blocked by the issue;
- `indirect_fanout`: additional current/earlier targets blocked transitively through those targets;
- `release_blocking`: whether the blocker lies on the active phase/release gate;
- `revision_severity`: blocking T-REV/P-REV or proven public/runtime regression;
- `evidence_recovery`: whether resolving the target restores verification for multiple targets.

Priority after explicit Admin/README obligations:

1. blocking P-REV/T-REV or evidenced public/runtime blocker with the highest meaningful fan-out;
2. active release/phase critical-path work;
3. own executable continuity responsibility;
4. other current/earlier executable work by normal oldest/role priority;
5. capacity expansion only when the real executable pool is still below policy target.

A Worker must not create artificial dependencies or inflate fan-out. Fan-out is a scheduling signal only and never changes product scope or acceptance criteria.

## Capacity recovery without churn

The 12-15 executable target and `<10` recovery trigger remain valid. However:

- a fresh exhaustive ledger may be reused by a later scheduled Worker when the material-state vector proves no relevant delta;
- a fast-path run does not repeat capacity recovery;
- when depth is genuinely low, Planner first attacks high-fan-out blockers and unnecessary serialization before creating more decomposition;
- new issues are created only for legitimate approved-scope outcomes that can become independently executable; never filler, duplicate scope, fake dependencies, speculative features, or artificial microtasks.

If depth remains below 10 because a small number of blockers dominate the graph, report those blockers and fan-out instead of repeatedly re-proving the entire backlog.

## Evidence and CI tiers

Verification remains exact-state and independent, but evidence cost is tiered:

### Tier 1 — Focused
Run the smallest target-specific deterministic/browser/design checks needed for each implementation or correction. Tier 1 is the default per material change.

### Tier 2 — Affected cumulative
Run subsystem/shared compatibility checks when a target is ready for handoff, integration, a T-REV retest, or when changed files affect shared runtime/presentation/Simulation seams. Reuse a terminal compatible exact descendant only when it contains the candidate unchanged and the target acceptance criteria permit descendant evidence.

### Tier 3 — Full gate
Run broad cumulative browser/responsive/accessibility/performance/release verification for phase/release candidates, explicitly broad-risk infrastructure changes, or acceptance criteria that specifically require it. Do not demand Tier 3 for every intermediate commit unless the target explicitly requires it.

Outdated same-branch broad CI should be cancelable so runner capacity follows the newest candidate. Focused target checks may remain exact-candidate when their acceptance criteria require it.

## Non-dispatchable evidence waits

A target must not remain indefinitely parked on evidence that the available repository/workflow mechanism cannot reliably produce.

Classify such a state as `non_dispatchable_evidence_wait` when:

- the required exact check has no usable automatic trigger for the candidate and no available authorized dispatch/rerun path; or
- repeated cancellation/queue behavior prevents required evidence while newer work continues; or
- the workflow produces evidence for the wrong state and no safe exact-descendant substitute is permitted.

Reviewer then creates/uses a focused infrastructure target to restore reliable evidence production. Fixing the evidence path outranks repeated no-op Worker scans when it blocks multiple current/earlier targets.

## Audit compression

GitHub remains the durable audit record, but audit must not become the workload.

Post to #97 only when a scheduled run has at least one **material orchestration event**:

- target claim/acquisition/clear/stale invalidation;
- commit/PR/design asset or repository mutation;
- PASS/FAIL/T-REV/P-REV/revision resolution;
- issue creation/closure/reopen/dependency/planning change;
- terminal evidence transition that changes eligibility;
- capacity action that creates/reopens/adapts real work;
- critical-blocker classification materially changes;
- full 6-hour safety refresh establishes a new exhaustive checkpoint.

Pure `QUIESCENT_FAST_PATH` runs post **nothing** to #97. They must not create self-generated deltas that wake the next Worker.

Material #97 results should be concise. Do not paste unchanged exhaustive lists when the prior checkpoint plus a delta proves them unchanged; reference the checkpoint and report only changed classifications plus required accounting.

## Lightweight Hygiene cadence

`.github/LIGHTWEIGHT_HYGIENE.md` still governs what to inspect, but repeated unchanged inspection is prohibited.

Run the formal Lightweight Hygiene check only when one of these is true:

- current `main` differs from the last hygiene-checked SHA and the change plausibly affects runtime, assets, dependencies, CI, logs, caches, or presentation cost;
- new measurement/evidence appears;
- a known hygiene target changes state;
- 24 hours elapsed since the last full hygiene review.

Do not repeat unchanged #354/#355-style measurements every 12 minutes.

## Operational KPIs

Material full-run audits should maintain/report enough data to derive:

- `productive_run_rate` = scheduled material runs with useful progress / material full runs;
- `quiescent_fast_path_count` (aggregated at safety checkpoints, not one comment per run);
- `claims_per_productive_run`;
- `handoff_to_tester_verdict_latency`;
- `ci_wait_share` and `non_dispatchable_evidence_wait_count`;
- `broad_ci_runs_per_material_commit`;
- `stale_claims_invalidated`;
- `critical_blocker_issue_ids` with direct/indirect fan-out;
- `executable_depth` before/after material runs.

KPIs diagnose the process; they are not quotas and must never incentivize filler or weakened verification.

## Stop and continuation

For a **material** run, `.github/WORKER_ROTATION.md` normal stop/continuation rules still apply: exhaust safely eligible work, recover legitimate capacity when required, and prove a zero-progress pass before normal STOP.

For a proven quiescent run, `QUIESCENT_FAST_PATH` itself is the valid stop condition. It exists specifically to avoid repeating a proof that remains valid under an unchanged material-state vector.

## Independence and release

Nothing in this policy permits self-verification. Coder/Designer/Reviewer changes still require a different Worker Tester where required. Phase/release approval remains Tester authority under README rules. Fast-path, CI cancellation, descendant evidence, audit compression, or fan-out priority must never be used to bypass unresolved acceptance criteria or authoritative release gates.
