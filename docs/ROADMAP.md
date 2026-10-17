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

- WP-S004-001-001 — Deterministic settlement distribution & morphology: viable-area density, readable functional villages/cities, legal access and bounded mobile rendering
- WP-S004-002-001 — Canonical ruins & critical sites: 1/1000 discoverability, legal access, responsive inspection and lazy mobile-safe detail

## STAGE S005 — Transport & Traversal Network

- WP-S005-001-001 — Canonical transport network: terrain-aware shared topology, graph/render parity, truthful route UX and bounded mobile rendering

## STAGE S006 — Living World & Usable Buildings

- WP-S006-001-001 — Scalable living residents: canonical home/work/guard identity, deterministic schedules/routes, bounded spatial queries and reusable actors
- WP-S006-002-001 — Usable-interior architecture analysis: same-world portals, deterministic persisted reconstruction, demand loading, responsive UX and implementation slices

## STAGE S007 — World Visual Presentation

- WP-S007-001-001 — Medieval-fantasy presentation architecture analysis: toon 3D materials, semantic zoom, readable actors/labels, mobile/backend budgets and implementation slices

## STAGE S008 — Player Interface & Accessibility

- WP-S008-001-001 — Responsive & accessible gameplay shell: safe-area layout, 44px touch targets, readable UI, keyboard/focus semantics and map-safe panels

## STAGE S009 — Performance, Stability & Product Conformance

- WP-S009-001-001 — Exact-SHA performance & release gates: p95 frame/input/streaming metrics, first-visible/final-detail latency, resources and dual-backend viewport acceptance
- WP-S009-002-001 — Main-thread/UI latency: invalidation-driven layout/labels/inspectors, bounded canonical picking, pooled DOM/resources and stable-frame zero-churn
- WP-S009-003-001 — Adaptive mobile renderer & live recovery: device-class DPR/render scale, hysteresis, resource reuse and WebGPU→WebGL2 state-preserving recovery
- WP-S009-004-001 — README/runtime/release conformance: truthful stage/Atlas semantics, dynamic canonical copy, legacy cleanup and evidence-backed compatibility claims