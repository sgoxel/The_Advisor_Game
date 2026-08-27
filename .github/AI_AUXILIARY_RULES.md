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

Exactly one `ai-role-*` label is required before `ai-ready` is added.

## Eligibility

NVIDIA may run only when the issue is open, free, unblocked, has no open GitHub `blocked by` dependency, has exactly one auxiliary role, and is not already claimed/running/awaiting-review/handoff.

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
