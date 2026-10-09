# The Advisor Game — ROADMAP

## Fundamental Planning Rules — Exception to Roadmap Minimalism

These rules are the explicit exception to the compact ROADMAP format below and must remain at the top of this file.

1. **GENERAL → SPECIFIC ARCHITECTURE FIRST.** Every new system, Stage, or material redesign must be planned from general foundations toward specific implementation. Planning order is: authoritative world/domain model → root invariants and contracts → shared system architecture → subsystem implementation → presentation/integration → performance optimization and polish. Do not begin by patching narrow symptoms while a broader unresolved architectural cause can produce them. Before implementation WPs are planned, identify the system's root invariants, ownership boundaries, canonical identities/data flow, and deterministic behavior. If a narrow WP reveals a broader architectural cause, feed that finding back into ROADMAP planning before creating further narrower implementation WPs. This is a planning-order rule, not an Issue dependency; every WP must still be independently solvable in one pass.
2. **REFERENCE ANALYSIS MUST BE THE FIRST WP FOR A SYSTEM.** Whenever ROADMAP introduces a new system or materially redesigns an existing system, the first WP for that system must be a dedicated research/analysis WP. It must use current internet research to examine the best-known and most relevant proven examples available—such as leading games, engines, platforms, standards, production systems, technical documentation, or academic/industry references as appropriate. The analysis must identify the examples' general architecture, invariants, proven patterns, tradeoffs, failure modes, performance implications, and lessons applicable to The Advisor Game under `docs/README.md`. It must not blindly copy proprietary implementations. Subsequent implementation WPs for that system must be created or revised from the documented analysis conclusions rather than from unverified assumptions or isolated symptoms.
3. **UI/UX/VISUAL-FIRST IMPLEMENTATION.** After the required reference analysis and root architecture/invariants are defined, implementation for every Stage or major system must first establish the intended player-facing UI, UX flow and visible presentation before deeper feature coding. The visible surface must make the Stage understandable and testable early, while remaining consistent with `docs/README.md`, deterministic world authority and performance budgets. Use WebGPU 3D Visuals whenever possible.

## Roadmap Rule

Apart from the Fundamental Planning Rules above, keep only Stage headings and WP code/title/status lines here. WP details, evidence and implementation notes belong in the corresponding GitHub Issue.

## STAGE S001 — Seeded 3D World Foundation

- WP-S001-001-001 — Google Earth reference analysis, five-level seeded world atlas, lazy simulation and fantasy clock — COMPLETED and REVIEWED at 2026-10-07
- WP-S001-002-001 — Explicit WebGPU renderer initialization and real-backend validation — COMPLETED and REVIEWED at 2026-10-07
- WP-S001-003-001 — Default Chrome rendering with WebGPU preference and WebGL2 fallback — COMPLETED and REVIEWED at 2026-10-07

## STAGE S002 — Round, Natural World Foundation

- WP-S002-001-001 — Reference analysis and root contracts for canonical planet scale, pure-zoom UX, wrapped coordinates and performance budgets — COMPLETED and REVIEWED at 2026-10-07
- WP-S002-002-001 — Globe Realm view: the Realm level rendered as a sphere — COMPLETED and REVIEWED at 2026-10-07
- WP-S002-002-002 — Latency-bounded focus-preserving pure-zoom globe↔local handoff with destination-ready LOD and zero blank frames — COMPLETED and REVIEWED at 2026-10-08
- WP-S002-002-003 — Responsive globe/local navigation HUD and Realm framing: truthful scale/ruler, wrap-safe input, labels and seven-viewport UX — COMPLETED and REVIEWED at 2026-10-08
- WP-S002-003-001 — Canonical spherical coordinate and identity authority: remove legacy planar world truth with wrap/pole-safe reversible mapping — COMPLETED and REVIEWED at 2026-10-08
- WP-S002-003-002 — Precision-safe ENU local rendering: camera-relative patches, canonical picking/labels/shadows and deterministic rebasing — COMPLETED and REVIEWED at 2026-10-08
- WP-S002-003-003 — Canonical wrap/pole streaming: stable IDs, no-blank coverage, device/byte budgets and eviction-safe caches — COMPLETED and REVIEWED at 2026-10-08
- WP-S002-004-001 — Reference analysis/contracts for natural-world authority, readable 3D settlement/living-world UX and mobile performance — COMPLETED and REVIEWED at 2026-10-08
- WP-S002-004-002 — Canonical planet-scale/travel migration UX: physical metres, route-derived time, truthful ruler/copy and legacy cleanup — COMPLETED and REVIEWED at 2026-10-09
- WP-S002-004-003 — Realm macro-geography visual/performance foundation: seeded continents/islands, distinct mountain/volcanic systems and cross-LOD silhouettes
- WP-S002-004-004 — Biome/material readability foundation: diverse climates/terrain, stable semantic colors and cross-LOD identity
- WP-S002-004-005 — Terrain/hydrology/traversal foundation: natural landforms, distributed freshwater, canonical walkability and bounded seam-safe queries
- WP-S002-004-006 — Vegetation/ground-detail presentation: natural deterministic scatter, reusable instancing, stable ownership and mobile budgets
- WP-S002-004-007 — Political atlas UX/performance: full-continent country partition, scalable settlement counts, readable borders and bounded deterministic 1/1000 labels
- WP-S002-004-008 — Travel routing UX: shortest legal paths, ≥60 fantasy-minute village separation, bounded search and truthful route/time UI
- WP-S002-004-009 — Settlement/building UX: terrain-shaped non-grid functional layouts, logical building scale, lazy usable interiors and mobile-safe rendering
- WP-S002-004-010 — Continuous-zoom material/LOD continuity: stable semantic color, threshold blending, tile-patch regressions and wrap/pole ownership
- WP-S002-004-011 — Living-resident scalability/UX: canonical home/work/gate identity, analytical schedules, spatial queries, pooled actors and inspection
- WP-S002-004-012 — Unified terrain compositor: deterministic earthworks and one render/routing/collision/material authority
- WP-S002-004-013 — Ruin/critical-place UX: 1/1000 discoverability, legal access, stable labels and bounded lazy detail
- WP-S002-004-014 — Transport-network UX/architecture: connected roads/bridges/harbors, terrain-aware topology and bounded regional generation
- WP-S002-005-001 — S002 performance acceptance gate: frame/input/worker/upload/streaming/DOM/simulation/resource budgets, adaptive quality and renderer-loss recovery
- WP-S002-005-002 — Responsive accessible atlas UI/UX acceptance: safe areas, ≥44px touch targets, focus/modal/keyboard parity, readable HUD/inspection/labels
- WP-S002-005-003 — README/runtime product-truth compatibility gate: player-authority semantics, canonical world/zoom/travel/count rules and default-Chrome backend recovery
