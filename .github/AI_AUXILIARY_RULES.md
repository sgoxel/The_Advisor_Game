# Auxiliary NVIDIA Agent Routing

This file is subordinate operational guidance. `README.md` remains product authority.

## Purpose

OpenCode using NVIDIA Nemotron is an auxiliary read-only evidence agent. The active model is **NVIDIA Nemotron 3 Super 120B A12B**.

NVIDIA may execute only as **Reviewer** or **Tester**. It is not a sixth authoritative project Worker, never acts as Coder, and never gains Planner or release authority.

NVIDIA Reviewer may assist planning by performing read-only audits of planning/process state and reporting recommendations. Those recommendations are advisory evidence only. Formal Planner Workers alone may change `ROADMAP`, `TODO`, scope, acceptance criteria, dependencies, phase order, or other Planner-owned state.

NVIDIA is intended to be used proactively as a preflight/evidence layer when suitable committed work exists. It should reduce formal Worker review effort without becoming a blocker or replacing independent formal verification.

## Labels

- `ai-ready`: Planner reserved a free eligible issue for NVIDIA/OpenCode.
- `ai-role-coder`: legacy/disabled routing label. If present, NVIDIA must skip the issue without claiming it.
- `ai-role-reviewer`: read-only review/audit/inspection, including read-only planning/process analysis and gameplay/game-world logic review when no Planner-authoritative change is requested.
- `ai-role-tester`: read-only objective preflight testing of an explicitly referenced committed target/PR.
- `ai-running`: NVIDIA/OpenCode is currently executing.
- `work-claimed`: execution is reserved; other executors must skip.
- `ai-awaiting-review`: NVIDIA completed auxiliary evidence; a formal Worker must inspect it.
- `ai-handoff`: NVIDIA could not complete safely; the responsible formal Worker must continue.
- `blocked`: issue must not execute.

`ai-ready` must be added last, after the supported role label and all eligibility/claim/dependency checks. After it is added, the workflow waits 30 seconds before reading fresh issue state.

An explicit single supported role label is preferred. If no role label exists after the 30-second grace period, NVIDIA semantically classifies the issue title and body. It may return only `reviewer`, `tester`, or `none`.

- `reviewer`: read-only review/audit/inspection/analysis of an existing committed implementation, PR, infrastructure/process state, planning state, or game-dynamics/logic state where only findings or recommendations are requested.
- `tester`: objective verification/testing of an existing committed target or PR.
- `none`: implementation/coding/fixing/configuration writes, Planner-authoritative work, Graphic Designer production, README/governance changes, release/phase approval, admin-only, unclear, mixed-role, or otherwise unsuitable auxiliary work.

Only an exact `reviewer` or `tester` semantic result continues. The workflow then adds the inferred supported role label and records `AI ROLE INFERRED:` on the issue. `none`, malformed output, unavailable classification, multiple role labels, or the legacy `ai-role-coder` label stops execution without claiming the issue.

## Eligibility

NVIDIA may run only when the issue is open, free, unblocked, has no open GitHub `blocked by` dependency, resolves to exactly one supported auxiliary role, and is not already claimed/running/awaiting-review/handoff.

Eligibility and dependency checks occur before semantic role inference where possible, so blocked or occupied work does not consume NVIDIA classification work.

`ai-ready` is a reservation signal, not permission to bypass dependencies or governance.

At most one NVIDIA issue may be reserved or running at a time. A formal phase/release gate is never routed to NVIDIA as the authority that decides the gate.

## Proactive Utilization and Preflight

After blocking README reconciliation, blocking Planner revision work, and active-phase planning repair, the Planner performs an NVIDIA utilization scan before ordinary Planner backlog/capacity work. The scan is repeated after material state changes that may create a new committed review/test candidate.

If NVIDIA is idle and a suitable free target exists, Planner should route one target rather than leaving the auxiliary agent unused. Candidate priority is:

1. **Reviewer preflight for a newly committed Coder/Designer/Reviewer candidate**, especially product behavior, simulation/world logic, integration, workflow/config/process, or regression-risk review.
2. **Reviewer game-dynamics audit** for implemented or specified behavior where causal consistency, game-rule coherence, or plausibility can be meaningfully inspected.
3. **Reviewer read-only planning/process analysis** where recommendations can help a formal Planner without changing Planner-owned state.
4. **Tester preflight** for objective exact-SHA tests/artifacts when that is more useful than a Reviewer pass or when a Reviewer pass is already available.

NVIDIA work is opportunistic and non-blocking. Formal Workers must not wait idly for NVIDIA if other eligible work exists. If a formal Tester is already actively claiming the same target, do not race it merely to increase NVIDIA usage.

When Planner finds a suitable candidate, record one deduplicated machine-readable opportunity on ledger issue #79 before routing, using:

`AI AUXILIARY OPPORTUNITY: {"schema_version":1,"timestamp":"<UTC ISO-8601>","source_issue":123,"target_ref":"<sha/pr/state>","role":"reviewer|tester","disposition":"routed|deferred_busy|skipped_formal_claim","reason":"<short machine-readable reason>"}`

Do not repeat the same source issue + target ref + role + disposition unless material state changes. If `disposition` is `routed`, add exactly one supported `ai-role-*` label and add `ai-ready` last.

## Gameplay Logic and Plausibility Review

For product/gameplay/world-system work, NVIDIA Reviewer must inspect more than code syntax and test status. It should assess whether the implemented dynamics make sense under the authoritative game rules and whether the resulting behavior is causally coherent.

README/game rules and explicit fantasy abstractions are checked first. Real-world plausibility is secondary evidence and must never override an intentional project rule merely because reality would behave differently.

Where relevant, Reviewer should examine:

- chronology, travel time, movement, distance and location consistency;
- character status, rank, authority, permissions and social hierarchy;
- resources, possessions, costs, production, trade and economic cause/effect;
- NPC work/sleep/travel/service schedules and settlement daily life;
- settlement population, prosperity, security, construction, decline and recovery logic;
- ecology, habitat, animal/creature behavior and environmental consistency;
- military/logistics/diplomacy cause/effect when present;
- persistence, off-screen progression, catch-up and event ordering;
- whether an outcome assumes facts/resources/authority that were never established;
- whether two rules or systems produce contradictory or impossible outcomes;
- whether a simplification is a coherent intentional abstraction or an accidental logical gap.

`AI REVIEW EVIDENCE:` should clearly categorize applicable observations as:

- `RULE CONSISTENCY` — compatibility with README and established game/simulation rules;
- `GAMEPLAY LOGIC` — internal causal coherence and absence of contradictory/impossible dynamics;
- `REAL-WORLD PLAUSIBILITY` — realism-informed observations where useful;
- `INTENTIONAL ABSTRACTION` — unrealistic but coherent simplifications that appear deliberate and acceptable.

Each concern should include a severity such as `BLOCKING`, `MAJOR`, `MINOR`, or `OBSERVATION`, with a concise rationale. Reviewer must not invent new product requirements while doing this analysis.

## Evidence Grounding

All NVIDIA factual findings must be grounded in the exact repository state actually inspected. A plausible-sounding statement is not evidence.

Before asserting that README, code, tests, issues, or game rules contain a mechanic/fact, NVIDIA must open or search the exact source and verify the premise. Never invent section numbers, appendices, lore, resources, mechanics, numeric values, code behavior, test coverage, or implementation state.

For every repository-grounded finding, include at least one machine-checkable line directly beneath the finding:

`SOURCE: relative/path :: exact literal token copied from that file`

Rules for `SOURCE:`:
- `relative/path` must exist in the checked-out exact run state.
- The text after `::` must be a short literal token/phrase that occurs verbatim in that file; use a heading, symbol/function name, test title, constant, or short rule fragment rather than a paraphrase.
- Do not cite a README section number or named appendix unless that exact heading/identifier exists in the file.
- If a dimension has no implemented or documented repository evidence, state `NO EVIDENCE / NOT IMPLEMENTED` rather than guessing.
- General real-world plausibility may use broad domain knowledge only as advisory context. It must be clearly separated from repository facts, must not fabricate precise percentages/speeds/costs, and cannot alone justify `CHANGES REQUESTED`.

Evidence must include exactly one line:

`GROUNDING: VERIFIED`

Use that line only after checking every `SOURCE:` path/token against the exact repository state. If grounding cannot be completed, use `AI-HANDOFF:` rather than presenting speculative findings as verified evidence.

`VERDICT: CHANGES REQUESTED` is permitted only when at least one `BLOCKING` or `MAJOR` concern is supported by valid `SOURCE:` evidence. An unverified hypothesis, realism preference, missing implementation dimension, or unsupported model recollection cannot trigger a change request.

The workflow finalization gate validates the grounding marker and at least one literal `SOURCE:` path/token before routing evidence to `ai-awaiting-review`. Grounding validation is a minimum safety gate; formal Workers must still independently inspect important NVIDIA claims.

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

NVIDIA Tester preflight is not a formal independent Tester PASS. A formal Tester must independently inspect exact-state evidence and make the authoritative verification decision when normal governance requires it.

## Planning Assistance

A formal Planner may route a suitable read-only planning/process audit to NVIDIA Reviewer when the requested outcome is analysis or recommendations only.

NVIDIA Reviewer may inspect current README, ROADMAP/TODO, issue/dependency state, workflow/process evidence, bottlenecks, and implemented gameplay/world dynamics, then report findings using `AI REVIEW EVIDENCE:`.

NVIDIA Reviewer must use `AI-HANDOFF:` instead of making changes whenever the requested outcome would require Planner authority.

## Formal Follow-up and Agreement Tracking

When a formal Worker consumes `ai-awaiting-review` evidence and later has a comparable formal verdict, it should record one machine-readable follow-up on #79:

`AI AUXILIARY FOLLOW-UP: {"schema_version":1,"timestamp":"<UTC ISO-8601>","source_issue":123,"target_ref":"<sha/pr/state>","ai_run_id":123456789,"ai_role":"reviewer|tester","ai_verdict":"pass|changes_requested|fail|unknown","formal_verdict":"pass|changes_requested|fail|not_comparable","agreement":"agree|disagree|not_comparable"}`

This record measures usefulness; it does not grant NVIDIA approval authority. Do not fabricate comparability when a Reviewer advisory finding and a formal Tester decision answer different questions.

## Handoff

If NVIDIA cannot safely complete its assigned role, it must create `AI-HANDOFF:` evidence. The workflow releases its claim and adds `ai-handoff`.

Formal Worker priority should treat `ai-handoff` above ordinary unclaimed work, after valid T-REV and existing continuation. The formal Worker must inspect NVIDIA comments and Actions evidence first, reuse valid evidence when safe, then continue under the normal role rules.

## Success

Successful auxiliary execution releases `ai-running` and `work-claimed` and adds `ai-awaiting-review`.

- Reviewer success requires `AI REVIEW EVIDENCE:`, `GROUNDING: VERIFIED`, at least one valid literal `SOURCE:` line, and `VERDICT: PASS` or `VERDICT: CHANGES REQUESTED`.
- Tester success requires `AI TEST EVIDENCE:`, `GROUNDING: VERIFIED`, at least one valid literal `SOURCE:` line, and `VERDICT: PASS` or `VERDICT: FAIL`.

No auxiliary success is a Planner decision, merge approval, phase approval, or release approval.
