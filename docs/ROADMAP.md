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

## STAGE S006 — Living World & Usable Buildings

- WP-S006-001-001 — Resident journeys & rendered-home proof: owned door/gate/bridge/work replay, real picking, dual-backend PNGs
- WP-S006-002-001 — Same-world interior research: legal entry, persistence & responsive UX — COMPLETED and REVIEWED at 2026-10-20

## STAGE S007 — World Visual Presentation

## STAGE S008 — Player Interface & Accessibility

- WP-S008-001-001 — Accessible map→inspect→return: semantic keyboard/touch paths, ≥44px controls, seven safe-area layouts

## STAGE S009 — Performance, Stability & Product Conformance

- WP-S009-001-001 — Streaming admission & first-use latency: aggregate 4/6/8 queue, one upload/frame, exact-SHA milestones
- WP-S009-002-001 — Fast canonical picking & idle UI: bounded final-surface hits, zero stable-frame layout reads
- WP-S009-003-001 — Mobile memory & renderer resilience: >256MB trim, ≤1GB combined, adaptive DPR, GPU fallback
- WP-S009-004-001 — README conformance ledger & honest UI: Advisor authority, campaign time, 2D proof, persistence
- WP-S009-005-001 — Pure-zoom continuity & visible-scene readiness: fixed focus, no blank home, no false 100%

## STAGE S010 — Hero-Zoom Gameplay, Advisor Tools & Same-World Interiors

- WP-S010-001-001 — Research Hero/Close UX architecture: lawful 3D spaces, 2D residents, Advisor-only control & mobile limits
- WP-S010-002-001 — SEED-owned 3D prop/GLB kits: collision-safe Hero/Close placement, instancing & reuse
- WP-S010-003-001 — Hero/Close 2D resident proof & accessible selection: foot anchoring, occlusion, canonical hits
- WP-S010-003-002 — Read-only Advisor inspect/follow/measure: camera-only tracking, legal distances & bounded answers
- WP-S010-004-001 — Simulation-truthful workstations: legal tasks, owned tools & 2D resident action sprites
- WP-S010-004-002 — Deterministic homes/yards: grounded 3D props, traversable doors & mobile reuse
- WP-S010-004-003 — Canonical resident inventory: SEED item IDs, validated transfers & truthful UI
- WP-S010-005-001 — Enterable same-world homes: camera-only previews, legal portals & staged room readiness
- WP-S010-005-002 — Enterable service interiors: legal doors, connected rooms, actual occupants & 3D kits
- WP-S010-005-003 — 2D residents indoors: Simulation-validated door crossings, occupancy & roof occlusion
- WP-S010-005-004 — Interior continuity: validated item/occupant changes, stable revisits & safe exit/recovery
- WP-S010-006-001 — Hero/Close performance acceptance: exact-SHA p95, ≥30 FPS, 256MB/1GB & renderer parity
