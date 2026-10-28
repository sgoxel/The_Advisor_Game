# The Advisor Game — ROADMAP

## Fundamental Planning Rules — Exception to Roadmap Minimalism

These rules are the explicit exception to the compact ROADMAP format below and must remain at the top of this file.

1. **GENERAL → SPECIFIC ARCHITECTURE FIRST.** Every new system, Stage, or material redesign must be planned from general foundations toward specific implementation. Planning order is: authoritative world/domain model → root invariants and contracts → shared system architecture → subsystem implementation → presentation/integration → performance optimization and polish. Do not begin by patching narrow symptoms while a broader unresolved architectural cause can produce them. Before implementation WPs are planned, identify the system's root invariants, ownership boundaries, canonical identities/data flow, and deterministic behavior. If a narrow WP reveals a broader architectural cause, feed that finding back into ROADMAP planning before creating further narrower implementation WPs. This is a planning-order rule, not an Issue dependency: WPs must be independently actionable and can be delivered as successive safe increments while their full acceptance remains open.
2. **REFERENCE ANALYSIS MUST BE THE FIRST WP FOR A SYSTEM.** Whenever ROADMAP introduces a new system or materially redesigns an existing system, the first WP for that system must be a dedicated research/analysis WP. It must use current internet research to examine the best-known and most relevant proven examples available—such as leading games, engines, platforms, standards, production systems, technical documentation, or academic/industry references as appropriate. The analysis must identify the examples' general architecture, invariants, proven patterns, tradeoffs, failure modes, performance implications, and lessons applicable to The Advisor Game under `docs/README.md`. It must not blindly copy proprietary implementations. Subsequent implementation WPs for that system must be created or revised from the documented analysis conclusions rather than from unverified assumptions or isolated symptoms.
3. **UI/UX/VISUAL-FIRST IMPLEMENTATION.** After the required reference analysis and root architecture/invariants are defined, implementation for every Stage or major system must first establish the intended player-facing UI, UX flow and visible presentation before deeper feature coding. The visible surface must make the Stage understandable and testable early, while remaining consistent with `docs/README.md`, deterministic world authority and performance budgets. Use WebGPU 3D Visuals whenever possible.

4. **CONTINUOUS INCREMENTAL DELIVERY AND ISSUE REASSESSMENT.** Develop and deploy the smallest safe, useful increment even when a WP remains unfinished. Persistently unresolved failures are living work, not a reason to stop at an arbitrary number of attempts, corrections, reviews, or runs. Re-evaluate each active blocker against the latest source and accepted evidence; record its observed failure, canonical cause or uncertainty, next smallest implementation/test action, acceptance proof, ownership and current status in the existing Issue. After a partial delivery, resume from the next actionable blocker rather than repeating diagnostics already answered. Regularly revisit older open Issues and newly recurring faults; update, de-duplicate and prioritize their concrete next actions without silently closing or claiming them. A separate Agent may own its own independent WP; one Agent retains one active incomplete WP unless the owner explicitly reassigns it. Individual tests, CI attempts and resource use remain bounded, but there is no global correction-cycle ceiling. Keep release invariants, SEED/Simulation truth, required visual evidence and honest DEPLOYED / ACCEPTANCE PENDING / COMPLETED states; never weaken a failed gate to force completion.

## Roadmap Rule

Apart from the Fundamental Planning Rules above, keep only Stage headings and WP code/title/status lines here. WP details, evidence and implementation notes belong in the corresponding GitHub Issue.

## STAGE S001 — Seeded 3D World Foundation

All S001 WPs are COMPLETED and REVIEWED (see docs/ROADMAP_ARCHIVE.md).

## STAGE S002 — Canonical Planet & Macro-World Foundation

Completed S002 history is listed in docs/ROADMAP_ARCHIVE.md. Remaining continuation work was resegmented into S003–S009 on 2026-10-12; S002 has no open WPs.

## STAGE S003 — Natural World & Surface Authority

- WP-S003-004-001 — Visible SEED terrain height at Hero/Close: cliffs/canyons, legal grading & renderer/LOD parity

## STAGE S004 — Settlements, Buildings & World Sites

- WP-S004-001-001 — Deterministic settlement distribution & morphology: viable-area density, readable functional villages/cities, legal access and bounded mobile rendering — COMPLETED and REVIEWED at 2026-10-17
- WP-S004-002-001 — Critical-site UX: readable 3D access, collision-safe labels & dual-backend parity — COMPLETED and REVIEWED at 2026-10-20

## STAGE S005 — Transport & Traversal Network

- WP-S005-001-001 — Lawful SEED multi-road travel: grade-safe bridges, actual resident arrival & honest route preview — COMPLETED and REVIEWED at 2026-10-27
- WP-S005-002-001 — Bridge decks reach dry banks: graded road joins & Simulation-legal two-way crossing

## STAGE S006 — Living World & Usable Buildings

- WP-S006-001-001 — Same resident's legal home→gate→bridge→work→home journey, real picking & dual-backend proof — COMPLETED and REVIEWED at 2026-10-26
- WP-S006-002-001 — Same-world interior research: legal entry, persistence & responsive UX — COMPLETED and REVIEWED at 2026-10-20

## STAGE S007 — World Visual Presentation

## STAGE S008 — Player Interface & Accessibility

- WP-S008-001-001 — Accessible atlas UI: ≥44px touch targets, readable safe-area panels, semantic picking & focus return — COMPLETED and REVIEWED at 2026-10-27

## STAGE S009 — Performance, Stability & Product Conformance

- WP-S009-001-001 — First validated resident without cold-index stall: bounded shared queues & worker/upload p95
- WP-S009-002-001 — Zero-idle-reflow atlas: cached label bounds, legible touch UI & canonical pick/input p95
- WP-S009-003-001 — Single 1GB CPU+GPU budget: 256MB unused-cache trim, adaptive DPR & device-loss/WebGL2 recovery
- WP-S009-004-001 — Exact-SHA README conformance ledger: truthful Advisor, campaign, zoom, 2D actor & clock claims
- WP-S009-005-001 — Honest resident/3D readiness & pure zoom: no premature 100%, auto-tilt or blank LOD handoff

## STAGE S010 — Hero-Zoom Gameplay, Advisor Decisions, Same-World Interiors & Campaign Persistence

- WP-S010-001-001 — Research accessible first-play loop: low-rank 2D hero, advice, autonomous lawful consequence
- WP-S010-002-001 — Budgeted toon/GLB Hero/Close kit: SEED-true 3D doors, instancing & WebGPU/WebGL2 parity
- WP-S010-003-001 — Real 2D foot-anchored residents: honest metadata, roof/depth occlusion & canonical picking
- WP-S010-003-002 — Explicit accessible tilt/inspect/follow: zoom never rotates, tilts or moves the hero
- WP-S010-004-001 — Actual resident work: legal arrival, workstation occupancy & truthful 2D work poses
- WP-S010-004-002 — Grounded owned 3D homes: open door apertures, legal final-surface access & walkable streets
- WP-S010-004-003 — Canonical inventory UX: lawful SEED item transfers, ownership & campaign persistence
- WP-S010-005-001 — Legal same-world home entry: owned door→walkable room→exit & truthful readiness
- WP-S010-005-002 — Enterable 3D service interiors: lawful street→door→station & resident occupancy
- WP-S010-005-003 — Same-resident door traversal: Simulation occupancy & 2D roof/depth parity
- WP-S010-005-004 — Persistent interior changes: SEED rooms/items/occupants, validated replay & lawful exit
- WP-S010-005-005 — Occupancy-true 22:00–05:00 lighting: dark empty buildings & no fabricated residents
- WP-S010-006-001 — Physical A55 ≥30 FPS Hero/Close: input/worker/upload p95, combined 1GB & GPU fallback

- WP-S010-007-001 — Research local-first Advisor authority: versioned Sentence Library, character choice and safe LLM proposals
- WP-S010-007-002 — Accessible local-first Advisor dialogue: deterministic phrases, bounded LLM & honest decisions
- WP-S010-007-003 — Autonomous Advisor consequence: character accepts/refuses, Simulation validates & world persists
- WP-S010-008-001 — Research campaign SEED/time authority: creation-derived calendar, 24× clock & offline replay
- WP-S010-008-002 — Accessible create/resume: accepted SEED/date, same low-rank protagonist & no reroll
- WP-S010-008-003 — Crash-safe campaign journal: Simulation-validated events, original IDs & deterministic replay
- WP-S010-009-001 — Research SEED-faithful 3D fauna: habitats, movement, LOD & mobile budgets
- WP-S010-009-002 — SEED-owned living 3D fauna: lawful habitats, real movement & bounded Hero/Close draw cost
