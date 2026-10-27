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

- WP-S003-004-001 — Readable canonical 3D relief: real hills, valleys, canyons & cliffs

## STAGE S004 — Settlements, Buildings & World Sites

- WP-S004-001-001 — Deterministic settlement distribution & morphology: viable-area density, readable functional villages/cities, legal access and bounded mobile rendering — COMPLETED and REVIEWED at 2026-10-17
- WP-S004-002-001 — Critical-site UX: readable 3D access, collision-safe labels & dual-backend parity — COMPLETED and REVIEWED at 2026-10-20

## STAGE S005 — Transport & Traversal Network

- WP-S005-001-001 — Lawful SEED multi-road travel: grade-safe bridges, actual resident arrival & honest route preview — COMPLETED and REVIEWED at 2026-10-27
- WP-S005-002-001 — Seamless legal bridge landings: dry-bank deck overlap & continuous road grades

## STAGE S006 — Living World & Usable Buildings

- WP-S006-001-001 — Same resident's legal home→gate→bridge→work→home journey, real picking & dual-backend proof — COMPLETED and REVIEWED at 2026-10-26
- WP-S006-002-001 — Same-world interior research: legal entry, persistence & responsive UX — COMPLETED and REVIEWED at 2026-10-20

## STAGE S007 — World Visual Presentation

## STAGE S008 — Player Interface & Accessibility

- WP-S008-001-001 — Accessible atlas UI: ≥44px touch targets, readable safe-area panels, semantic picking & focus return — COMPLETED and REVIEWED at 2026-10-27

## STAGE S009 — Performance, Stability & Product Conformance

- WP-S009-001-001 — Bounded streaming (4/6/8 jobs, ≤1 upload/frame) & first-resident response p95
- WP-S009-002-001 — Zero idle-frame layout churn; fast accessible labels, picking & input
- WP-S009-003-001 — Mobile memory & renderer safety: 256MB trim, ≤1GB total, DPR/WebGL2 recovery
- WP-S009-004-001 — Deployed-SHA README conformance: autonomous advice, fantasy time, saves & truthful 2D UI
- WP-S009-005-001 — Truthful 3D readiness milestones & pure-zoom focus/angle preservation

## STAGE S010 — Hero-Zoom Gameplay, Advisor Decisions, Same-World Interiors & Campaign Persistence

- WP-S010-001-001 — Research Hero/Close first-use UX: autonomous advice, pure zoom, 2D/3D & mobile
- WP-S010-002-001 — Mobile-safe PlayCanvas GLB/toon kit: readable 3D, real doors & bounded GPU cost
- WP-S010-003-001 — Canonical foot-anchored 2D residents: correct depth, roofs, picking & telemetry
- WP-S010-003-002 — Accessible inspect/follow tools: camera-only actions, focus retention & separate tilt
- WP-S010-004-001 — Resident daily work: lawful shifts, actual workstation arrival & visible 2D actions
- WP-S010-004-002 — Grounded SEED-owned 3D homes: clear door apertures & connected walkable streets
- WP-S010-004-003 — Accessible SEED inventory: validated transfers, ownership & persistence
- WP-S010-005-001 — Legal same-world home entry: owned door→walkable room→exit & truthful readiness
- WP-S010-005-002 — Enterable 3D service interiors: lawful street→door→station & resident occupancy
- WP-S010-005-003 — Same-resident door traversal: Simulation occupancy & 2D roof/depth parity
- WP-S010-005-004 — Persistent interior changes: SEED rooms/items/occupants, validated replay & lawful exit
- WP-S010-005-005 — Fantasy-time building lights from true occupancy: empty at night means dark
- WP-S010-006-001 — Real-device Hero/Close proof: ≥30 FPS, input/fact p95, 256MB/1GB & GPU fallback

- WP-S010-007-001 — Research local-first Advisor authority: versioned Sentence Library, character choice and safe LLM proposals
- WP-S010-007-002 — Accessible local-first protagonist chat: Sentence Library, bounded LLM and offline same-person fallback
- WP-S010-007-003 — General Advisor advice→autonomous choice→legal visible consequence beyond the fixed site witness
- WP-S010-008-001 — Research per-campaign SEED/time authority, real-time fantasy clock, saves and bounded offline replay
- WP-S010-008-002 — Create/select/resume campaigns with player SEED, accepted fantasy creation date and same protagonist
- WP-S010-008-003 — Crash-safe SEED event saves: deterministic replay, persistent identity and bounded offline time
- WP-S010-009-001 — Research SEED-faithful 3D fauna: habitats, movement, LOD & mobile budgets
- WP-S010-009-002 — Living 3D fauna in Hero/Close: lawful wild, farm, barn, street & water habitats
