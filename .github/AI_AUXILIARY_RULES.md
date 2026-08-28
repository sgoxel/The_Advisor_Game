# Auxiliary NVIDIA Agent Routing

This file is subordinate operational guidance. `README.md` remains product authority.

## Purpose

OpenCode using NVIDIA Nemotron is an auxiliary read-only evidence agent. The active model is **NVIDIA Nemotron 3 Super 120B A12B**.

NVIDIA may execute only as **Reviewer** or **Tester**. It is not a sixth authoritative project Worker, never acts as Coder, and never gains Planner or release authority.

NVIDIA Reviewer may assist planning by performing read-only audits of planning/process state and reporting recommendations. Those recommendations are advisory evidence only. Formal Planner Workers alone may change `ROADMAP`, `TODO`, scope, acceptance criteria, dependencies, phase order, or other Planner-owned state.

## Labels

- `ai-ready`: Planner reserved a free eligible issue for NVIDIA/OpenCode.
- `ai-role-coder`: legacy/disabled routing label. If present, NVIDIA must skip the issue without claiming it.
- `ai-role-reviewer`: read-only review/audit/inspection, including read-only planning/process analysis when no Planner-authoritative change is requested.
- `ai-role-tester`: read-only objective testing of an explicitly referenced committed target/PR.
- `ai-running`: NVIDIA/OpenCode is currently executing.
- `work-claimed`: execution is reserved; other executors must skip.
- `ai-awaiting-review`: NVIDIA completed auxiliary evidence; a formal Worker must inspect it.
- `ai-handoff`: NVIDIA could not complete safely; the responsible formal Worker must continue.
- `blocked`: issue must not execute.

`ai-ready` should normally be added last. After it is added, the workflow waits 30 seconds before reading fresh issue state.

An explicit single supported role label is preferred. If no role label exists after the 30-second grace period, NVIDIA semantically classifies the issue title and body. It may return only `reviewer`, `tester`, or `none`.

- `reviewer`: read-only review/audit/inspection/analysis of an existing committed implementation, PR, infrastructure/process state, or planning state where only recommendations are requested.
- `tester`: objective verification/testing of an existing committed target or PR.
- `none`: implementation/coding/fixing/configuration writes, Planner-authoritative work, Graphic Designer production, README/governance changes, release/phase approval, admin-only, unclear, mixed-role, or otherwise unsuitable auxiliary work.

Only an exact `reviewer` or `tester` semantic result continues. The workflow then adds the inferred supported role label and records `AI ROLE INFERRED:` on the issue. `none`, malformed output, unavailable classification, multiple role labels, or the legacy `ai-role-coder` label stops execution without claiming the issue.

## Eligibility

NVIDIA may run only when the issue is open, free, unblocked, has no open GitHub `blocked by` dependency, resolves to exactly one supported auxiliary role, and is not already claimed/running/awaiting-review/handoff.

Eligibility and dependency checks occur before semantic role inference where possible, so blocked or occupied work does not consume NVIDIA classification work.

`ai-ready` is a reservation signal, not permission to bypass dependencies or governance.

## Independence

NVIDIA Reviewer and NVIDIA Tester are read-only for production implementation. Their evidence can reduce duplicate work, but formal Workers retain all implementation, planning, merge, phase, and release authority.

No NVIDIA role may:
- implement/fix/configure repository or production code as Coder;
- edit README;
- change Planner-owned ROADMAP/TODO/scope/AC/dependencies/phase order;
- approve a planning revision;
- approve a phase or release;
- silently merge implementation;
- overwrite unrelated/newer work.

## Planning Assistance

A formal Planner may route a suitable read-only planning/process audit to NVIDIA Reviewer when the requested outcome is analysis or recommendations only.

NVIDIA Reviewer may inspect current README, ROADMAP/TODO, issue/dependency state, workflow/process evidence, and bottlenecks, then report findings using `AI REVIEW EVIDENCE:`.

NVIDIA Reviewer must use `AI-HANDOFF:` instead of making changes whenever the requested outcome would require Planner authority.

## Handoff

If NVIDIA cannot safely complete its assigned role, it must create `AI-HANDOFF:` evidence. The workflow releases its claim and adds `ai-handoff`.

Formal Worker priority should treat `ai-handoff` above ordinary unclaimed work, after valid T-REV and existing continuation. The formal Worker must inspect NVIDIA comments and Actions evidence first, reuse valid evidence when safe, then continue under the normal role rules.

## Success

Successful auxiliary execution releases `ai-running` and `work-claimed` and adds `ai-awaiting-review`.

- Reviewer success requires `AI REVIEW EVIDENCE:`.
- Tester success requires `AI TEST EVIDENCE:`.

No auxiliary success is a Planner decision, merge approval, phase approval, or release approval.
