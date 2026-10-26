# The Advisor Game — ROADMAP

## Fundamental Planning Rules — Exception to Roadmap Minimalism

These rules are the explicit exception to the compact ROADMAP format below and must remain at the top of this file.

1. **GENERAL → SPECIFIC ARCHITECTURE FIRST.** Every new system, Stage, or material redesign must be planned from general foundations toward specific implementation. Planning order is: authoritative world/domain model → root invariants and contracts → shared system architecture → subsystem implementation → presentation/integration → performance optimization and polish. Do not begin by patching narrow symptoms while a broader unresolved architectural cause can produce them. Before implementation WPs are planned, identify the system's root invariants, ownership boundaries, canonical identities/data flow, and deterministic behavior. If a narrow WP reveals a broader architectural cause, feed that finding back into ROADMAP planning before creating further narrower implementation WPs. This is a planning-order rule, not an Issue dependency; every WP must still be independently solvable in one pass.
2. **REFERENCE ANALYSIS MUST BE THE FIRST WP FOR A SYSTEM.** Whenever ROADMAP introduces a new system or materially redesigns an existing system, the first WP for that system must be a dedicated research/analysis WP. It must use current internet research to examine the best-known and most relevant proven examples available—such as leading games, engines, platforms, standards, production systems, technical documentation, or academic/industry references as appropriate. The analysis must identify the examples' general architecture, invariants, proven patterns, tradeoffs, failure modes, performance implications, and lessons applicable to The Advisor Game under `docs/README.md`. It must not blindly copy proprietary implementations. Subsequent implementation WPs for that system must be created or revised from the documented analysis conclusions rather than from unverified assumptions or isolated symptoms.
3. **UI/UX/VISUAL-FIRST IMPLEMENTATION.** After the required reference analysis and root architecture/invariants are defined, implementation for every Stage or major system must first establish the intended player-facing UI, UX flow and visible presentation before deeper feature coding. The visible surface must make the Stage understandable and testable early, while remaining consistent with `docs/README.md`, deterministic world authority and performance budgets. Use WebGPU 3D Visuals whenever possible.

## Roadmap Rule

Apart from the Fundamental Planning Rules above, keep only Stage headings and WP code/title/status lines here. WP details, evidence and implementation notes belong in the corresponding GitHub Issue.

## STAGE S001 — Seeded 3D World Foundation

All S001 WPs are COMPLETED and REVIEWED (see docs/ROADMAP_ARCHIVE.md).

## STAGE S002 — Canonical Planet & Macro-World Foundation

Completed S002 history is listed in docs/ROADMAP_ARCHIVE.md. Remaining continuation work was resegmented into S003–S009 on 2026-10-12; S002 has no open WPs.

## STAGE S003 — Natural World & Surface Authority

## STAGE S004 — Settlements, Buildings & World Sites

- WP-S004-001-001 — Deterministic settlement distribution & morphology: viable-area density, readable functional villages/cities, legal access and bounded mobile rendering — COMPLETED and REVIEWED at 2026-10-17
- WP-S004-002-001 — Critical-site UX: readable 3D access, collision-safe labels & dual-backend parity — COMPLETED and REVIEWED at 2026-10-20

## STAGE S005 — Transport & Traversal Network

- WP-S005-001-001 — Traversable SEED transport: grade-safe roads, connected bridges/ferries & honest route preview

## STAGE S006 — Living World & Usable Buildings

- WP-S006-001-001 — Same resident's legal home→gate→bridge→work→home journey, real picking & dual-backend proof — COMPLETED and REVIEWED at 2026-10-26
- WP-S006-002-001 — Same-world interior research: legal entry, persistence & responsive UX — COMPLETED and REVIEWED at 2026-10-20

## STAGE S007 — World Visual Presentation

## STAGE S008 — Player Interface & Accessibility

- WP-S008-001-001 — Accessible world inspection: semantic SEED targets, ≥44px controls, safe-area layouts & focus return

## STAGE S009 — Performance, Stability & Product Conformance

- WP-S009-001-001 — Bounded streaming and first-use response: aggregate 4/6/8 admission & ≤1 upload/frame
- WP-S009-002-001 — Responsive world picking: bounded final-surface hits & no redundant idle layout work
- WP-S009-003-001 — Mobile/browser resource safety: >256MB unused-cache trim, ≤1GB total, DPR caps & WebGL2 recovery
- WP-S009-004-001 — README gameplay conformance audit: Advisor autonomy, campaign time/save, 2D characters & truthful UX
- WP-S009-005-001 — Honest first-visible 3D readiness & pure zoom: stable focus, no blank homes or false 100%

## STAGE S010 — Hero-Zoom Gameplay, Advisor Tools & Same-World Interiors

- WP-S010-001-001 — Research-first Hero/Close architecture: 3D world, 2D residents, legal camera UX & mobile budgets
- WP-S010-002-001 — Shared toon-ready GLB/prop kits: SEED placement, instancing, safe access & LOD reuse
- WP-S010-003-001 — Hero/Close illustrated 2D residents: real feet, roof occlusion, canonical picking & accessibility
- WP-S010-003-002 — Advisor read-only camera tools: inspect/follow/measure, legal route preview & focus return
- WP-S010-004-001 — Truthful work activity: Simulation-validated stations/tools & illustrated 2D action frames
- WP-S010-004-002 — SEED homes/yards: grounded reusable 3D props, visible owned doors & legal footpaths
- WP-S010-004-003 — Canonical inventory UI: SEED item IDs, legal transfers & persistent ownership truth
- WP-S010-005-001 — Legal same-world home entry: camera preview, physical door, room readiness & no teleport
- WP-S010-005-002 — Enterable service interiors: legal connected rooms, real workstations & lawful occupants
- WP-S010-005-003 — Same resident indoors: validated door traversal, 2D occlusion & truthful occupancy
- WP-S010-005-004 — Persistent interiors: validated item/occupant events, stable revisits & safe exit/recovery
- WP-S010-006-001 — Hero/Close device acceptance: 30 FPS floor, first-response latency, 1GB cap & renderer parity
