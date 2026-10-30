# The Advisor Game — ROADMAP

## Fundamental Planning Rules — Exception to Roadmap Minimalism

These rules are the explicit exception to the compact ROADMAP format below and must remain at the top of this file.

1. **GENERAL → SPECIFIC ARCHITECTURE FIRST.** Every new system, Stage, or material redesign must be planned from general foundations toward specific implementation. Planning order is: authoritative world/domain model → root invariants and contracts → shared system architecture → subsystem implementation → presentation/integration → performance optimization and polish. Do not begin by patching narrow symptoms while a broader unresolved architectural cause can produce them. Before implementation WPs are planned, identify the system's root invariants, ownership boundaries, canonical identities/data flow, and deterministic behavior. If a narrow WP reveals a broader architectural cause, feed that finding back into ROADMAP planning before creating further narrower implementation WPs. This is a planning-order rule, not an Issue dependency: WPs must be independently actionable and can be delivered as successive safe increments while their full acceptance remains open.
2. **REFERENCE ANALYSIS MUST BE THE FIRST WP FOR A SYSTEM.** Whenever ROADMAP introduces a new system or materially redesigns an existing system, the first WP for that system must be a dedicated research/analysis WP. It must use current internet research to examine the best-known and most relevant proven examples available—such as leading games, engines, platforms, standards, production systems, technical documentation, or academic/industry references as appropriate. The analysis must identify the examples' general architecture, invariants, proven patterns, tradeoffs, failure modes, performance implications, and lessons applicable to The Advisor Game under `docs/README.md`. It must not blindly copy proprietary implementations. Subsequent implementation WPs for that system must be created or revised from the documented analysis conclusions rather than from unverified assumptions or isolated symptoms.
3. **UI/UX/VISUAL-FIRST IMPLEMENTATION.** After the required reference analysis and root architecture/invariants are defined, implementation for every Stage or major system must first establish the intended player-facing UI, UX flow and visible presentation before deeper feature coding. The visible surface must make the Stage understandable and testable early, while remaining consistent with `docs/README.md`, deterministic world authority and performance budgets. Use WebGPU 3D Visuals whenever possible.

4. **CONTINUOUS INCREMENTAL DELIVERY AND ISSUE REASSESSMENT.** Develop and deploy the smallest safe, useful increment even when a WP remains unfinished. Persistently unresolved failures are living work, not a reason to stop at an arbitrary number of attempts, corrections, reviews, or runs. Re-evaluate each active blocker against the latest source and accepted evidence; record its observed failure, canonical cause or uncertainty, next smallest implementation/test action, acceptance proof, ownership and current status in the existing Issue. After a partial delivery, resume from the next actionable blocker rather than repeating diagnostics already answered. Regularly revisit older open Issues and newly recurring faults; update, de-duplicate and prioritize their concrete next actions without silently closing or claiming them. A separate Agent may own its own independent WP; one Agent retains one active incomplete WP unless the owner explicitly reassigns it. **ACTIONABLE CHECKPOINT CONTRACT.** At each run and whenever new evidence changes the diagnosis, leave every revisited unresolved Issue with one immediately executable next action: the current observed failure and exact-source evidence; root cause or bounded uncertainty; the smallest safe code, test or measurement step; a concrete acceptance check/artifact; owner and DEPLOYED / ACCEPTANCE PENDING / COMPLETED truth. Mark unknowns UNKNOWN, not BLOCKED or PASS. After each partial deployment, reassess the remaining failures and choose the next useful increment instead of recycling stale diagnostics or exhausting a made-up correction budget. Do not hold safe independent progress hostage to optional checks or unrelated open Issues; keep each individual job, test, retry and resource budget bounded.  Individual tests, CI attempts and resource use remain bounded, but there is no global correction-cycle ceiling. Keep release invariants, SEED/Simulation truth, required visual evidence and honest DEPLOYED / ACCEPTANCE PENDING / COMPLETED states; never weaken a failed gate to force completion.

## Roadmap Rule

Apart from the Fundamental Planning Rules above, keep only Stage headings and WP code/title/status lines here. WP details, evidence and implementation notes belong in the corresponding GitHub Issue.

## STAGE S001 — Seeded 3D World Foundation

All S001 WPs are COMPLETED and REVIEWED (see docs/ROADMAP_ARCHIVE.md).

## STAGE S002 — Canonical Planet & Macro-World Foundation

Completed S002 history is listed in docs/ROADMAP_ARCHIVE.md. Remaining continuation work was resegmented into S003–S009 on 2026-10-12; S002 has no open WPs.

## STAGE S003 — Natural World & Surface Authority

- WP-S003-004-001 — Hero/Close final-surface contact: resident feet, real doors, graded roads & collision

## STAGE S004 — Settlements, Buildings & World Sites

- WP-S004-001-001 — Deterministic settlement distribution & morphology: viable-area density, readable functional villages/cities, legal access and bounded mobile rendering — COMPLETED and REVIEWED at 2026-10-17
- WP-S004-002-001 — Critical-site UX: readable 3D access, collision-safe labels & dual-backend parity — COMPLETED and REVIEWED at 2026-10-20

## STAGE S005 — Transport & Traversal Network

- WP-S005-001-001 — Lawful SEED multi-road travel: grade-safe bridges, actual resident arrival & honest route preview — COMPLETED and REVIEWED at 2026-10-27
- WP-S005-002-001 — Two-way bridge continuity: dry bank→graded road→deck with legal resident feet

## STAGE S006 — Living World & Usable Buildings

- WP-S006-001-001 — Same resident's legal home→gate→bridge→work→home journey, real picking & dual-backend proof — COMPLETED and REVIEWED at 2026-10-26
- WP-S006-002-001 — Same-world interior research: legal entry, persistence & responsive UX — COMPLETED and REVIEWED at 2026-10-20

## STAGE S007 — World Visual Presentation

## STAGE S008 — Player Interface & Accessibility

- WP-S008-001-001 — Accessible atlas UI: ≥44px touch targets, readable safe-area panels, semantic picking & focus return — COMPLETED and REVIEWED at 2026-10-27

## STAGE S009 — Performance, Stability, UI/UX & README Conformance

- WP-S009-001-001 — First-use responsiveness: ≤120s cold, measured +25% CI p95 & SEED-safe streaming — COMPLETED and REVIEWED at 2026-10-29
- WP-S009-002-001 — Prove zero avoidable idle-label reflows; preserve mobile readability, picking & focus
- WP-S009-003-001 — Account for all app-owned CPU+GPU resources within 1 GB; recover rendering in-session
- WP-S009-004-001 — Audit deployed README compliance: source, gameplay, visual & physical-device evidence
- WP-S009-005-001 — Prove angle-invariant pure zoom and separate terrain/detail/resident/interaction readiness
- WP-S009-006-001 — Persist versioned SEED world foundations; accelerate warm restarts without changing truth

## STAGE S010 — Hero-Zoom Advisor Gameplay, Same-World Interiors, Campaign Persistence & Living Fauna

- WP-S010-001-001 — Research first-play Advisor UX: hero→inspect→advise→autonomous choice→world response
- WP-S010-002-001 — Ground & reuse GLB building/door/roof/prop assets; verify mobile 3D resource costs
- WP-S010-003-001 — Prove 2D resident feet, roof/depth occlusion and accessible picking on both backends
- WP-S010-003-002 — Add explicit accessible inspect/tilt/follow/reset; keep pure-zoom camera unchanged
- WP-S010-003-003 — Preserve each NPC's original 2D art; validate optional owner GLBs and safe fallback
- WP-S010-004-001 — Prove lawful worksite arrival, visible shift activity & homecoming for real residents
- WP-S010-004-002 — Connect SEED-owned homes to legal paths, graded entrances & final-surface collision
- WP-S010-004-003 — Make inventory playable: Simulation-owned item inspection, legal transfer & replay
- WP-S010-004-004 — Reroute NPCs around new legal obstacles; safely rejoin or stop without teleport
- WP-S010-005-001 — Enter/exit a real SEED home continuously from street→door→walkable room
- WP-S010-005-002 — Enter same-world 3D services; reach legal workstations with actual occupants
- WP-S010-005-003 — Preserve NPC identity, grounded feet & roof/depth parity across real doors
- WP-S010-005-004 — Persist approved interior item/room/occupant changes and replay lawful exits
- WP-S010-005-005 — Use fantasy 22:00–05:00 for occupied-home light; earlier twilight remains cosmetic
- WP-S010-006-001 — Measure actual Galaxy A55 Chrome FPS/input, combined memory, thermals & recovery

- WP-S010-007-001 — Research deterministic local-first Sentence Library, bounded LLM commands & autonomy
- WP-S010-007-002 — Ship accessible offline-first Advisor chat, local routing & optional bounded LLM
- WP-S010-007-003 — Make advice observable: autonomous choice→Simulation action/refusal→world feedback
- WP-S010-008-001 — Research accepted campaign-time/SEED authority and deterministic offline replay
- WP-S010-008-002 — Create/resume campaigns with accepted time, stable SEED, hero & accessible UX
- WP-S010-008-003 — Replay Simulation-approved campaign changes exactly once after offline restart
- WP-S010-009-001 — Research SEED-faithful fauna identity, habitats, legal behavior & 3D mobile LOD
- WP-S010-009-002 — Render 13 SEED-owned living 3D fauna species with lawful habitat/actions & mobile LOD
