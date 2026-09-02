# Lightweight Project Hygiene

This file defines focused operational HOW below explicit Admin instructions, `README.md`, ROADMAP/TODO, and the target issue. It complements `.github/WORKER_ROTATION.md` and does not change product scope or README authority.

## Goal

Keep The Advisor Game lightweight as it grows: responsive at runtime, economical in shipped/static payload, bounded in background work, simple to maintain, and efficient to verify in CI.

Lightweight does **not** mean reducing required world behavior, Simulation authority, determinism, accessibility, visual quality, usability, test rigor, or approved product scope.

## Evidence before optimization

Do not optimize by intuition or file-count aesthetics alone. A cleanup/performance change needs concrete evidence of avoidable cost or maintainability risk. Useful evidence includes:

- interaction/frame-time, startup/first-frame, long-task, memory, cache, or scheduling measurements;
- file, asset, bundle, embedded-payload, network-transfer, or repository size;
- repeated/unbounded timers, listeners, polling, redraws, DOM/canvas work, logs, caches, queues, or per-frame computation;
- duplicate/obsolete source, fallback path, wrapper, generated artifact, asset, test, dependency, or workflow;
- test/workflow duration, redundant executions, oversized CI artifacts, or evidence-retention cost;
- profiler/browser/runtime evidence tying a suspected path to visible responsiveness or resource pressure.

When evidence is insufficient, record the finding as a hypothesis only. Do not perform a speculative rewrite and do not create filler cleanup work merely to claim optimization progress.

## Preferred correction order

When behavior can be preserved, prefer in this order:

1. Remove obsolete/redundant work or data.
2. Reuse an existing path instead of adding another parallel wrapper/system.
3. Bound, defer, stagger, lazy-load, cache safely, or relevance-limit necessary work.
4. Reduce payload/asset/dependency cost without reducing required quality.
5. Add new machinery only when simpler options cannot meet the measured requirement.

Avoid replacing one performance problem with permanent architectural complexity.

## Role expectations

### Planner

- Treat evidenced lightweight/performance debt as legitimate reliability/performance work within approved scope, not as filler.
- Keep each correction focused and testable; separate unrelated runtime, asset/repository, and CI/tooling problems.
- Never invent features, fake dependencies, weaken acceptance criteria, or create speculative micro-cleanups to satisfy capacity targets.
- Reuse existing performance targets/gates when they already own the exact problem instead of duplicating issues.

### Coder

- Prefer the smallest correct implementation.
- Avoid unnecessary dependencies, duplicate state machines/pathways, wrapper-on-wrapper fixes, always-on debug/instrumentation work, unbounded queues/caches/logs/timers/listeners, synchronous broad loops on interaction-critical frames, and large embedded payloads when a cheaper correct path exists.
- Remove obsolete code only when ownership and compatibility are understood and regression coverage protects the behavior.
- Runtime optimization must preserve authoritative Simulation chronology, determinism, save/load, world state, and required functionality.

### Designer

- Keep visual assets and presentation paths efficient without lowering required visual quality or accessibility.
- Avoid redundant duplicate assets, unnecessarily oversized source/runtime assets, hidden always-rendered layers, needless redraws, and presentation effects that keep expensive work alive off-screen.
- Use responsive/relevance-aware/lazy materialization where the approved design permits it.

### Tester

- An optimization claim requires exact-state verification and, where meaningful, before/after or controlled comparison evidence.
- Verify that responsiveness/resource gains are real and that correctness, determinism, accessibility, visual quality, world continuity, NPC behavior, save/load, and Simulation authority did not regress.
- Treat hidden work reduction that merely disables required behavior/entities/quality as a failure, not an optimization.
- For Coder/Designer/Reviewer changes, preserve the normal different-Worker independence requirement.

### Reviewer

At least once in each complete work-conserving role cycle, perform a **LIGHTWEIGHT HYGIENE CHECK** after higher-priority revision/blocker work.

Inspect current evidence for cross-cutting avoidable weight, including as applicable:

- duplicate/obsolete repository files, generated backups, `.orig`/temporary outputs, unused assets or dependencies;
- oversized embedded/static payloads and avoidable initial-load materialization;
- repeated wrappers/fallbacks that retain obsolete execution paths;
- unbounded or duplicated timers, listeners, polling, redraws, logs, caches and queues;
- work that continues at full detail while off-screen/irrelevant when approved relevance/lazy behavior exists;
- redundant/overlapping tests or workflows that provide no distinct evidence;
- unexpectedly large CI artifacts, traces, screenshots, videos or reports;
- recurring workflow/test failures caused by resource exhaustion or excessive execution cost.

If evidence proves a safely correctable issue and Reviewer authority covers it, use/claim a focused existing issue or create/route one focused issue according to governance, then implement the smallest correction and hand it to a different Tester. If the problem belongs to Coder/Designer/Planner scope, route it rather than silently crossing role authority.

Do not keep a Worker busy by repeatedly re-reporting the same unchanged bloat hypothesis.

## Runtime priority

Interactive visualization remains the first runtime performance priority when it competes with optional/background work. Input, camera/projection, and visible-frame presentation must not be needlessly blocked by unrelated NPC/environment/background reconciliation. Necessary authoritative work may be deferred/chunked only in ways that preserve Simulation chronology and deterministic outcomes.

Existing focused performance issues and performance gates own their exact acceptance criteria; this document does not weaken or replace them.

## CI and evidence hygiene

- Produce enough evidence to debug and independently verify, but avoid unlimited screenshots/videos/traces/artifacts by default.
- Prefer targeted failure artifacts and bounded retention/collection over recording every frame or every successful case.
- Do not weaken assertions simply to shorten CI.
- When a CI artifact or workflow becomes unusually large/slow, measure its contributors and reduce redundant evidence while preserving diagnostic value.

## Audit fields

When a scheduled or manual Worker reaches the Reviewer role, include these concise fields in its normal rotation result when relevant:

- `lightweight_hygiene_checked`: `true|false`
- `lightweight_findings`: issue IDs or `[]`
- `lightweight_actions_taken`: issue IDs/commits or `[]`
- `lightweight_evidence`: short measurement/ref summary or `none`

A clean check may report empty findings. The check is not permission to manufacture work.

## Current evidence seeds

These are **audit seeds, not deletion instructions**. Re-verify current main before acting:

- unusually large embedded/static payloads;
- backup/original/temporary-looking repository files that may or may not still be required;
- large browser-test evidence artifacts;
- interaction-critical camera/render work competing with NPC/environment processing.

A Worker must prove current cost/obsolescence and ownership before deleting, replacing, or restructuring anything.