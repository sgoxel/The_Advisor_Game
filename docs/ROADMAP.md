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
- WP-S004-002-001 — Critical-site presentation & access UX: safe labels/leaders, visible 3D sites, clean road joins & renderer parity

## STAGE S005 — Transport & Traversal Network

- WP-S005-001-001 — Terrain-aware transport & route UX: real junctions/bridges/ferries, graph–mesh parity & responsiveness

## STAGE S006 — Living World & Usable Buildings

- WP-S006-001-001 — Resident life & inspection UX: legal home/work/guard routes, Fantasy Time schedules & pooled actors
- WP-S006-002-001 — Usable-interior architecture research: same-world portals, persistence, first-use UX & lazy budgets

## STAGE S007 — World Visual Presentation

- WP-S007-001-001 — Toon 3D & semantic-zoom architecture research: readable roles/labels, stable transitions & mobile budgets

## STAGE S008 — Player Interface & Accessibility

- WP-S008-001-001 — Seven-viewport accessible atlas UX: 44px touch, safe map context & keyboard/screen-reader parity

## STAGE S009 — Performance, Stability & Product Conformance

- WP-S009-001-001 — Cold-to-useful performance & exact-SHA release: first interaction, p95/p99 & dual-renderer parity
- WP-S009-002-001 — Idle-frame UI performance & exact picking: revision-cached labels/telemetry & responsive inspection
- WP-S009-003-001 — Adaptive mobile rendering & recovery UX: DPR/shadow tiers, shared resources & WebGPU/WebGL2
- WP-S009-004-001 — README/runtime conformance: Atlas vs Advisor, campaign/save truth, routes & compatibility claims