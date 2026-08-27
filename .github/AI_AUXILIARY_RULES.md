# Auxiliary NVIDIA Agent Routing

This file is subordinate operational guidance. `README.md` remains product authority.

## Purpose

OpenCode using NVIDIA Nemotron is an auxiliary executor. It can assist as Coder, Reviewer, or Tester, but it is not a sixth authoritative project Worker and never gains Planner or release authority.

## Labels

- `ai-ready`: Planner reserved a free eligible issue for NVIDIA/OpenCode.
- `ai-role-coder`: implement the issue and create an unmerged PR.
- `ai-role-reviewer`: read-only review of an explicitly referenced committed target/PR.
- `ai-role-tester`: read-only objective testing of an explicitly referenced committed target/PR.
- `ai-running`: NVIDIA/OpenCode is currently executing.
- `work-claimed`: execution is reserved; other executors must skip.
- `ai-awaiting-review`: NVIDIA completed auxiliary work/evidence; a formal Worker must inspect it.
- `ai-handoff`: NVIDIA could not complete safely; the responsible formal Worker must continue.
- `blocked`: issue must not execute.

`ai-ready` should normally be added last. After it is added, the workflow waits 30 seconds before reading fresh issue state.

An explicit single `ai-role-*` label is preferred. If no role label exists after the 30-second grace period, NVIDIA semantically classifies the issue title and body. It may return only `coder`, `reviewer`, `tester`, or `none`.

- `coder`: implementation/fix/integration/config/repository-write work.
- `reviewer`: read-only review/audit of an existing committed implementation or PR.
- `tester`: objective verification/testing of an existing committed target or PR.
- `none`: Planner, Graphic Designer production, README/governance, release/phase approval, admin-only, unclear, mixed-role, or otherwise unsuitable auxiliary work.

Only an exact `coder`, `reviewer`, or `tester` semantic result continues. The workflow then adds the inferred `ai-role-*` label and records `AI ROLE INFERRED:` on the issue. `none`, malformed output, unavailable classification, or multiple explicit role labels stops execution without claiming the issue.

## Eligibility

NVIDIA may run only when the issue is open, free, unblocked, has no open GitHub `blocked by` dependency, resolves to exactly one supported auxiliary role, and is not already claimed/running/awaiting-review/handoff.

Eligibility and dependency checks occur before semantic role inference where possible, so blocked or occupied work does not consume NVIDIA classification work.

`ai-ready` is a reservation signal, not permission to bypass dependencies or governance.

## Independence

NVIDIA Coder work may self-test but cannot independently verify itself. It always needs formal independent Tester verification.

NVIDIA Reviewer and NVIDIA Tester are read-only for production implementation. Their evidence can reduce duplicate work, but formal Tester Worker retains independent phase/release authority.

No NVIDIA role may:
- edit README;
- change Planner-owned ROADMAP/TODO/scope/AC/dependencies/phase order;
- approve a phase or release;
- silently merge implementation;
- overwrite unrelated/newer work.

## Handoff

If NVIDIA cannot safely complete its assigned role, it must create `AI-HANDOFF:` evidence. The workflow releases its claim and adds `ai-handoff`.

Formal Worker priority should treat `ai-handoff` above ordinary unclaimed work, after valid T-REV and existing continuation. The formal Worker must inspect NVIDIA comments, Actions evidence, commits, branches and PRs first, reuse valid work when safe, then continue under the normal role rules.

## Success

Successful auxiliary execution releases `ai-running` and `work-claimed` and adds `ai-awaiting-review`.

- Coder success requires a referenced open PR plus `AI CODER EVIDENCE:`.
- Reviewer success requires `AI REVIEW EVIDENCE:`.
- Tester success requires `AI TEST EVIDENCE:`.

No auxiliary success is a phase/release approval.
