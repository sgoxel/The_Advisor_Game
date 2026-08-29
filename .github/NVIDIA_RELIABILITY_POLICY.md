# NVIDIA Nemotron Reliability Addendum

This is subordinate operational HOW. `README.md` and `.github/AI_AUXILIARY_RULES.md` remain higher authority. This addendum does not grant NVIDIA new authority.

## Active role/model boundary

- Active auxiliary model: **NVIDIA Nemotron 3 Super 120B A12B**.
- Executable auxiliary roles remain **Reviewer** and **Tester** only.
- NVIDIA never acts as Coder, Designer production, formal Planner, formal independent Tester, phase authority, or release authority.

## Strict terminal evidence

Evidence quality is more important than prose volume. Reviewer/Tester must use a compact machine-checkable terminal comment.

A successful role result must:

1. begin with the exact assigned marker: `AI REVIEW EVIDENCE:` or `AI TEST EVIDENCE:`;
2. include **1–3** `SOURCE: relative/path :: exact literal token` lines verified against the exact checkout;
3. include exactly one `GROUNDING: VERIFIED` line;
4. include exactly one role-valid `VERDICT:` line;
5. avoid Markdown code fences around the evidence block.

Unsupported repository/game claims must not be invented. If exact grounding cannot be completed, use `AI-HANDOFF:`.

## Full-history inspection

The NVIDIA composite action must unshallow/fetch repository history before read-only execution when necessary. Referenced exact candidate commits should be inspected with `git show`, `git diff`, or equivalent read-only commands instead of being declared absent merely because the outer workflow used a shallow checkout.

## One bounded evidence repair

When the primary role execution (or its one 503 retry) succeeds but the terminal evidence is structurally invalid, the composite action may perform **one and only one** evidence-format repair attempt.

The repair is not a second broad review. It may inspect the latest evidence plus the minimum sources required to post a corrected grounded terminal comment. It remains read-only, cannot change product/planning state, and cannot loop. If repaired evidence is still invalid, the normal finalizer must route `ai-handoff`.

Each repair is observable on ledger issue #79 with append-only `AI AUXILIARY EVIDENCE REPAIR:` records using `started`, then `valid` or `invalid` state.

## Reviewer/Tester balance guard

Reviewer is useful for code/game-logic/process analysis, but routing must not become Reviewer-only.

When NVIDIA is free and there are multiple legitimate candidates, prefer an eligible **Tester preflight** over another ordinary Reviewer pass when:

- an exact-SHA/objective test or artifact target exists; and
- current-policy Tester share is below **25%** of Reviewer+Tester runs, **or** the latest **four routed NVIDIA opportunities contain no Tester**.

A Reviewer-specific gameplay-logic, architecture, or process audit may still outrank Tester when materially higher value. This is not a quota: never invent a Tester target, never route a phase/release gate as NVIDIA authority, and never race a formal Tester claim.

## Gameplay/world reasoning

For product/world-system Reviewer work, inspect logic only where relevant to the target. README/game rules and intentional fantasy abstractions come before real-world assumptions. Applicable findings may use `RULE CONSISTENCY`, `GAMEPLAY LOGIC`, `REAL-WORLD PLAUSIBILITY`, and `INTENTIONAL ABSTRACTION`; irrelevant categories should be omitted rather than padded with generic prose.
