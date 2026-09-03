# Lightweight Project Hygiene

This file defines focused operational HOW below explicit Admin instructions, `README.md`, ROADMAP/TODO, the target issue, `.github/WORKER_ROTATION.md`, and the newer Admin-authorized `.github/WORKER_THROUGHPUT.md` amendment.

## Goal

Keep The Advisor Game responsive at runtime, economical in shipped/static payload, bounded in background work, simple to maintain, and efficient to verify in CI.

Lightweight does **not** mean reducing required world behavior, Simulation authority, determinism, accessibility, visual quality, usability, test rigor, or approved product scope.

## Evidence before optimization

Do not optimize by intuition or file-count aesthetics alone. A cleanup/performance change needs concrete evidence of avoidable cost or maintainability risk. Useful evidence includes:

- interaction/frame-time, startup/first-frame, long-task, memory, cache, or scheduling measurements;
- file, asset, bundle, embedded-payload, network-transfer, repository or CI-artifact size;
- repeated/unbounded timers, listeners, polling, redraws, DOM/canvas work, logs, caches, queues, or per-frame computation;
- duplicate/obsolete source, fallback path, wrapper, generated artifact, asset, test, dependency, or workflow;
- test/workflow duration, redundant executions, oversized CI artifacts, or evidence-retention cost;
- profiler/browser/runtime evidence tying a suspected path to visible responsiveness or resource pressure.

When evidence is insufficient, record a hypothesis only. Do not perform a speculative rewrite and do not create cleanup filler merely to claim progress.

## Preferred correction order

When behavior can be preserved, prefer:

1. remove obsolete/redundant work or data;
2. reuse an existing path instead of another permanent wrapper/system;
3. bound, defer, stagger, lazy-load, cache safely, or relevance-limit necessary work;
4. reduce payload/asset/dependency/CI cost without reducing required quality;
5. add new machinery only when simpler options cannot meet the measured requirement.

Avoid replacing one performance problem with permanent architectural complexity.

## Inspection cadence

Repeated unchanged hygiene scans are themselves waste and are prohibited.

Perform a formal **LIGHTWEIGHT HYGIENE CHECK** only when at least one is true:

- `main` changed since the last hygiene-checked SHA and the change plausibly affects runtime, presentation, assets, dependencies, logs/caches/queues, tests, or workflows;
- new performance/size/runtime/CI evidence appeared;
- a known hygiene target materially changed state;
- the active public/runtime regression indicates a performance or visual responsiveness risk;
- **24 hours** elapsed since the last full hygiene review.

A `QUIESCENT_FAST_PATH` run never repeats hygiene. A later Worker may reuse a prior measurement when exact main/evidence is unchanged; it should reference the prior result rather than paste the same analysis again.

## Role expectations

### Planner
- Treat evidenced performance/lightweight debt as legitimate approved-scope reliability work, not filler.
- Keep corrections focused/testable and separate unrelated runtime, asset/repository and CI/tooling problems.
- Prefer high-fan-out performance blockers that unlock several current/earlier targets.
- Never invent features, fake dependencies, weaken acceptance criteria, or create speculative micro-cleanups.

### Coder
- Prefer the smallest correct implementation.
- Avoid unnecessary dependencies, duplicate state machines/pathways, wrapper-on-wrapper fixes, always-on debug/instrumentation, unbounded queues/caches/logs/timers/listeners, synchronous broad loops on interaction-critical frames, and large embedded payloads when a cheaper correct path exists.
- Remove obsolete code only when ownership/compatibility are understood and regression coverage protects behavior.
- Runtime optimization must preserve authoritative Simulation chronology, determinism, save/load, world state and required functionality.

### Designer
- Keep visual assets/presentation efficient without lowering visual quality or accessibility.
- Avoid redundant assets, unnecessarily oversized runtime assets, hidden always-rendered layers, needless redraws, and effects that keep expensive work alive off-screen.
- Use responsive/relevance-aware/lazy materialization where approved design permits it.
- Visual performance is a first-class quality requirement: camera, zoom, input and visible-frame presentation must remain responsive.

### Tester
- Optimization claims require exact-state verification and, where meaningful, before/after or controlled comparison evidence.
- Verify responsiveness/resource gains are real and correctness, determinism, accessibility, visual quality, world continuity, NPC behavior, save/load and Simulation authority did not regress.
- Hidden work reduction that disables required behavior/entities/quality is a failure, not optimization.
- Preserve normal different-Worker independence for Coder/Designer/Reviewer changes.

### Reviewer
- Inspect evidenced cross-cutting waste after higher-priority blocker/revision work when the cadence above requires a hygiene check.
- Safely fix evidenced Reviewer-scope waste through a focused target; route Coder/Designer/Planner-owned problems instead of crossing authority.
- Do not keep a Worker busy by repeatedly re-reporting an unchanged hypothesis or measurement.

## Runtime priority

Interactive visualization is the first runtime performance priority when it competes with optional/background work. Input, camera/projection, zoom/pan and visible-frame presentation must not be needlessly blocked by unrelated NPC/environment/background reconciliation.

Necessary authoritative work may be deferred, chunked, staggered, lazy-loaded or relevance-bounded only when Simulation chronology and deterministic outcomes remain correct. Existing focused performance issues/gates retain their exact acceptance criteria.

## CI and evidence hygiene

- Follow the Tier 1/2/3 evidence model in `.github/WORKER_THROUGHPUT.md`.
- Preserve enough artifacts to debug and independently verify, but avoid unlimited screenshots/videos/traces/reports.
- Prefer targeted failure artifacts and bounded retention over recording every successful case.
- Do not weaken assertions to shorten CI.
- Broad same-ref workflows should cancel obsolete runs when safe so runner capacity follows the newest candidate.
- If required evidence cannot be reliably produced or dispatched, classify `non_dispatchable_evidence_wait` and route a focused infrastructure repair instead of repeatedly waiting.
- When an artifact/workflow becomes unusually large or slow, measure contributors and remove redundant evidence while preserving diagnostic value.

## Audit fields

When a material run performs a hygiene check, report concisely:

- `lightweight_hygiene_checked=true`
- `lightweight_hygiene_main_sha`
- `lightweight_findings`
- `lightweight_actions_taken`
- `lightweight_evidence`

When the cadence does not require a check, use `lightweight_hygiene_checked=false` and optionally reference the last valid checkpoint. Do not repeat old measurements as new findings.

## Current evidence seeds

These are audit seeds, not deletion instructions; re-verify current main before acting:

- unusually large embedded/static payloads;
- backup/original/temporary-looking repository files that may no longer be required;
- large browser-test evidence artifacts or duplicate broad workflows;
- interaction-critical camera/render work competing with NPC/environment processing;
- synchronized/background NPC work that creates frame spikes rather than relevance-bounded staggered work.

A Worker must prove current cost/obsolescence and ownership before deleting, replacing or restructuring anything.
