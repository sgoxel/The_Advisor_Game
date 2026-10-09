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
- WP-S002-002-004 — Pure-zoom orientation regression: consistent ENU/globe axes, drag/picking continuity and deployed evidence — IN PROGRESS (AGENT #2, owner-requested regression fix)
- WP-S002-003-001 — Canonical spherical coordinate and identity authority: remove legacy planar world truth with wrap/pole-safe reversible mapping — COMPLETED and REVIEWED at 2026-10-08
- WP-S002-003-002 — Precision-safe ENU local rendering: camera-relative patches, canonical picking/labels/shadows and deterministic rebasing — COMPLETED and REVIEWED at 2026-10-08
- WP-S002-003-003 — Canonical wrap/pole streaming: stable IDs, no-blank coverage, device/byte budgets and eviction-safe caches — COMPLETED and REVIEWED at 2026-10-08
- WP-S002-004-001 — Reference analysis/contracts for natural-world authority, readable 3D settlement/living-world UX and mobile performance — COMPLETED and REVIEWED at 2026-10-08
- WP-S002-004-002 — Canonical planet-scale/travel migration UX: physical metres, route-derived time, truthful ruler/copy and legacy cleanup — COMPLETED and REVIEWED at 2026-10-09
- WP-S002-004-003 — Realm macro-geography visual/performance foundation: seeded continents/islands, distinct mountain/volcanic systems and cross-LOD silhouettes — COMPLETED and REVIEWED at 2026-10-09
- WP-S002-004-004 — Canonical biome/material readability: diverse climates/terrain, non-color-only semantic cues, cross-LOD identity and mobile/backend parity
- WP-S002-004-005 — Natural terrain/hydrology/traversal authority: irregular landforms, distributed freshwater, canonical walkability and bounded seam-safe queries
- WP-S002-004-006 — Vegetation/ground-detail presentation: biome-specific deterministic scatter, instanced/reused assets, stable ownership and mobile budgets
- WP-S002-004-007 — Political atlas authority/UX: full-land country partition, SEED-variable ≥30/90/270 counts, readable borders/names and bounded 1/1000 labels
- WP-S002-004-008 — Shortest-legal-route authority/UX: all-pair ≥60-minute proof on final terrain, bounded routing and truthful route preview — COMPLETED (AGENT #2, 2026-10-09): straight-line ≥60-minute proof, on-demand bounded route planner and route overlay; full CI run on 08bf625 passed (unit, WebGL2/WebGPU route captures, deploy)
- WP-S002-004-009 — Settlement/building world UX: terrain-shaped non-grid layouts, entrance-connected homes/services, usable lazy interiors and mobile-safe rendering
- WP-S002-004-010 — Continuous-zoom visual identity: canonical material/albedo parity, smooth LOD/handoff blending and no tile/palette pop across backends
- WP-S002-004-011 — Living-resident scalability/UX: persistent home/work identity, analytical schedules, spatial indexing, pooled actors and responsive inspection
- WP-S002-004-012 — Unified world-surface compositor: deterministic priority 0–9 earthworks with shared render/routing/collision/material truth
- WP-S002-004-013 — Ruin/critical-place discoverability UX: 1/1000 labels/leaders, legal access, stable canonical identity and bounded lazy detail
- WP-S002-004-014 — Global transport-network authority/UX: connected roads/bridges/harbors/ferries, terrain-aware topology, shared boundaries and bounded generation
- WP-S002-004-015 — Invisible-world continuity/performance: SEED-defined shared-boundary recipes, bounded queries and gameplay-focused lazy materialization
- WP-S002-005-001 — S002 performance/adaptive-rendering release gate: real-device budgets, full telemetry, DOM hot-path control and renderer-loss recovery
- WP-S002-005-002 — Responsive UI/accessibility release gate: safe areas, ≥44px targets, focus/keyboard parity, dense-label readability and seven-viewport evidence
- WP-S002-005-003 — README/runtime semantics release gate: Advisor-vs-atlas wording, dynamic registry counts, canonical truth and Chrome/WebGPU→WebGL2 recovery
