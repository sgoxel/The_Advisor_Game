# The Advisor Game — ROADMAP

## Fundamental Planning Rules — Exception to Roadmap Minimalism

These rules are the explicit exception to the compact ROADMAP format below and must remain at the top of this file.

1. **GENERAL → SPECIFIC ARCHITECTURE FIRST.** Every new system, Stage, or material redesign must be planned from general foundations toward specific implementation. Planning order is: authoritative world/domain model → root invariants and contracts → shared system architecture → subsystem implementation → presentation/integration → performance optimization and polish. Do not begin by patching narrow symptoms while a broader unresolved architectural cause can produce them. Before implementation WPs are planned, identify the system's root invariants, ownership boundaries, canonical identities/data flow, and deterministic behavior. If a narrow WP reveals a broader architectural cause, feed that finding back into ROADMAP planning before creating further narrower implementation WPs. This is a planning-order rule, not an Issue dependency; every WP must still be independently solvable in one pass.
2. **REFERENCE ANALYSIS MUST BE THE FIRST WP FOR A SYSTEM.** Whenever ROADMAP introduces a new system or materially redesigns an existing system, the first WP for that system must be a dedicated research/analysis WP. It must use current internet research to examine the best-known and most relevant proven examples available—such as leading games, engines, platforms, standards, production systems, technical documentation, or academic/industry references as appropriate. The analysis must identify the examples' general architecture, invariants, proven patterns, tradeoffs, failure modes, performance implications, and lessons applicable to The Advisor Game under `docs/README.md`. It must not blindly copy proprietary implementations. Subsequent implementation WPs for that system must be created or revised from the documented analysis conclusions rather than from unverified assumptions or isolated symptoms.
3. **UI/UX/VISUAL-FIRST IMPLEMENTATION.** After the required reference analysis and root architecture/invariants are defined, implementation for every Stage or major system must first establish the intended player-facing UI, UX flow and visible presentation before deeper feature coding. The visible surface must make the Stage understandable and testable early, while remaining consistent with `docs/README.md`, deterministic world authority and performance budgets. Use WebGPU 3D Visuals whenever possible.

## Roadmap Rule

Apart from the Fundamental Planning Rules above, keep only Stage headings and WP code/title/status lines here. WP details, evidence and implementation notes belong in the corresponding GitHub Issue.

## STAGE S001 — Seeded 3D World Foundation

- WP-S001-001-001 — Google Earth reference analysis, five-level seeded world atlas, lazy simulation and fantasy clock — COMPLETED
- WP-S001-002-001 — Explicit WebGPU renderer initialization and real-backend validation — COMPLETED
- WP-S001-003-001 — Default Chrome rendering with WebGPU preference and WebGL2 fallback — COMPLETED

## STAGE S002 — Round, Natural World Foundation

- WP-S002-001-001 — Reference analysis and root contracts for canonical planet scale, pure-zoom UX, wrapped coordinates and performance budgets — COMPLETED
- WP-S002-002-001 — Globe Realm view: the Realm level rendered as a sphere — COMPLETED
- WP-S002-002-002 — Latency-bounded focus-preserving pure-zoom globe↔local handoff with destination-ready LOD and zero blank frames — COMPLETED
- WP-S002-002-003 — Responsive globe/local navigation HUD and Realm framing: truthful scale/ruler, wrap-safe input, labels and seven-viewport UX — COMPLETED
- WP-S002-003-001 — Canonical spherical coordinate and identity authority: remove legacy planar world truth with wrap/pole-safe reversible mapping — COMPLETED
- WP-S002-003-002 — Precision-safe ENU local rendering: camera-relative patches, canonical picking/labels/shadows and deterministic rebasing — COMPLETED
- WP-S002-003-003 — Canonical wrap/pole streaming: stable IDs, no-blank coverage, device/byte budgets and eviction-safe caches — DEPLOYED
- WP-S002-004-001 — Reference analysis/contracts for natural-world authority, readable 3D settlement/living-world UX and mobile performance — IN PROGRESS
- WP-S002-004-002 — Canonical planet-scale/travel migration UX: physical metres, route-derived time, truthful ruler/copy and legacy cleanup
- WP-S002-004-003 — Realm macro-geography UX/performance: irregular continents/islands, distinct mountain systems/volcanoes and phone-readable lazy LOD
- WP-S002-004-004 — Climate/biome/material authority: grass/desert/dirt/beach/cliff/forest/snow/poles with cross-LOD semantic readability
- WP-S002-004-005 — Terrain/hydrology/walkability authority: natural coasts/cliffs, distributed freshwater, seam-safe routing/collision and bounded queries
- WP-S002-004-006 — Vegetation/ground-detail rendering performance: natural scatter, LOD-stable ownership, instancing/atlasing and mobile draw-call budgets
- WP-S002-004-007 — Political/settlement map UX: full-continent countries, visible borders, 1/1000 labels and irregular accessible siting
- WP-S002-004-008 — Route-truth travel UX/performance: shortest legal paths, all-pair ≥60 fantasy minutes, bounded search and responsive route/time UI
- WP-S002-004-009 — Organic settlement/building UX: road-connected plots, logical services/homes/gates, on-demand interiors and mobile budgets
- WP-S002-004-010 — Continuous-zoom world continuity: stable materials/colors, seam-free LOD/wrap/poles and unique canonical ownership
- WP-S002-004-011 — Living-resident UX/performance: owned homes/work/gates, purposeful schedules, pooled actors and inspectable state
- WP-S002-004-012 — Unified terrain/walkability compositor: deterministic earthworks, one render/routing/collision truth and bounded modifier queries
- WP-S002-004-013 — Ruins/critical-place UX: 1/1000 discoverability, legal access, inspectable labels and bounded lazy detail
- WP-S002-004-014 — Canonical transport-network UX/performance: connected roads/bridges/harbors, readable routes and bounded regional generation
- WP-S002-005-001 — S002 release acceptance: input/zoom/label responsiveness, DOM/GPU/memory budgets, adaptive quality and WebGPU/WebGL2/default-Chrome parity