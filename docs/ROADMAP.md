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

- WP-S004-001-001 — Seeded settlement distribution + morphology + exterior UX/performance: viable-area density, variable city/village counts, varied roads/plots/services/homes/farms/gates and mobile-safe rendering
- WP-S004-002-001 — Ruin/critical-place integration + UX/performance: 1/1000 discoverability, legal access, stable canonical identity, bounded terrain preparation, semantic-zoom symbols and lazy detail

## STAGE S005 — Transport & Traversal Network

- WP-S005-001-001 — Terrain-aware shared transport authority + graph/render parity: 1/100 roads, real junctions/trunks, required-node connectivity, bridges/harbors/ferries and bounded lazy generation

## STAGE S006 — Living World & Usable Buildings

- WP-S006-001-001 — Living-resident authority + inspectable life performance: stable home/work/guard identity, analytical schedules, no full-pool rebuild/scan, spatial queries and reusable actor pools
- WP-S006-002-001 — Usable building-interior architecture analysis + implementation plan: same-world portals, deterministic persisted reconstruction, demand loading, reusable kits and mobile-safe bounds

## STAGE S007 — World Visual Presentation

- WP-S007-001-001 — Medieval-fantasy presentation architecture + implementation slicing: toon lighting/materials, unified semantic zoom, readable 2D actors/labels, font-stable layout, globe↔local continuity and mobile/WebGPU/WebGL2 budgets

## STAGE S008 — Player Interface & Accessibility

- WP-S008-001-001 — Responsive accessible gameplay shell: viewport-fit safe areas, ≥44px controls, readable typography, map-safe panels, keyboard/Escape/focus lifecycle, reduced motion, accessible map semantics and debug separation

## STAGE S009 — Performance, Stability & Product Conformance

- WP-S009-001-001 — Exact-SHA performance observability + deploy gates: frame/input/coverage/worker/upload p95, first-visible-response latency, app-wide resource accounting, seven viewports and WebGPU/WebGL2 acceptance
- WP-S009-002-001 — Main-thread/UI latency optimization: invalidation-driven labels/overlays/inspectors, font/layout caching, bounded canonical picking, pooled DOM/resources and stable-frame zero-churn
- WP-S009-003-001 — Adaptive mobile renderer + live backend recovery: device-class DPR/render-scale/shadows, sustained-pressure hysteresis, shared resource policy, asset reuse, semantic continuity and WebGPU→WebGL2 recovery
- WP-S009-004-001 — README/runtime/release truth: current-stage status, Advisor-vs-atlas semantics, canonical dynamic copy/counts, legacy-authority cleanup and exact-SHA compatibility claims