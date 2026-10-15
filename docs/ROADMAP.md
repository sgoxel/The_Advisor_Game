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
- WP-S004-002-001 — Ruin/critical-place UX/performance: 1/1000 discoverability, legal network access, stable canonical identity, bounded site preparation and lazy detail

## STAGE S005 — Transport & Traversal Network

- WP-S005-001-001 — Terrain-aware shared transport-network authority/UX/performance: 1/100-and-closer roads, real junctions/trunks, settlement/capital/site connectivity, bridges/harbors/ferries and bounded lazy generation

## STAGE S006 — Living World & Usable Buildings

- WP-S006-001-001 — Living-resident authority + inspectable life UX/performance: unique home/work/guard identity, analytical schedules, spatial indexing and bounded reusable actor pools
- WP-S006-002-001 — Usable building-interior architecture reference analysis + implementation plan: same-world entry/exit, deterministic reconstruction, persisted changes, demand loading and mobile-safe resource bounds

## STAGE S007 — World Visual Presentation

- WP-S007-001-001 — World-presentation + semantic-zoom reference analysis + implementation plan: coherent README medieval-fantasy art system, scale-tier visibility, 2D character/label readability, globe↔local continuity and mobile budgets

## STAGE S008 — Player Interface & Accessibility

- WP-S008-001-001 — Responsive gameplay shell + accessibility/mobile UX acceptance: safe areas, readable typography, measured 44px targets, keyboard/focus, accessible map semantics, reduced motion and player-vs-debug clarity

## STAGE S009 — Performance, Stability & Product Conformance

- WP-S009-001-001 — Exact-SHA performance observability + release evidence: frame/input/simulation/DOM/worker/upload/GPU/resource telemetry, seven viewports, backend matrix, combined memory accounting and physical-device truth
- WP-S009-002-001 — Main-thread hot-path performance: analytical/event-driven resident updates, spatial indexing, invalidation-driven DOM/labels, pooled overlays/actors and bounded allocations
- WP-S009-003-001 — Adaptive renderer/resource resilience: DPR/render-scale hysteresis, 256MB reusable-cache / 1GB combined app budget, pooled assets, continuous-zoom parity and runtime WebGPU/WebGL2 recovery
- WP-S009-004-001 — README/runtime product conformance: current-stage truth, Advisor-vs-atlas boundary, route/geography semantics, legacy-scale cleanup and exact-release claims