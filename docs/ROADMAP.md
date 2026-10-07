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
- WP-S002-003-002 — Precision-safe ENU local rendering: camera-relative patches, canonical picking/labels/shadows and deterministic rebasing
- WP-S002-003-003 — Canonical wrap/pole streaming: stable IDs, no-blank coverage, device/byte budgets and eviction-safe caches
- WP-S002-004-001 — Reference analysis and contracts for natural world generation, readable settlement/living-world UX and mobile budgets
- WP-S002-004-002 — Canonical scale/travel migration: remove legacy planar metres and obsolete 420 m/1.4 m/s player-facing travel truth
- WP-S002-004-003 — Natural Realm macro-geography: SEED-shaped continents/islands/seas/lakes/ranges with phone-readable cross-LOD continuity
- WP-S002-004-004 — Shared climate/biome authority: readable frozen poles, deserts, forests and grasslands across Realm↔local LOD
- WP-S002-004-005 — Natural terrain/hydrology authority: grid-free coasts/ridges/rivers/lakes, truthful walkability and seam-safe LOD
- WP-S002-004-006 — Natural vegetation/ground detail: non-lattice scatter, stable ownership, instancing and mobile draw-call budgets
- WP-S002-004-007 — Terrain-aware settlement siting: irregular SEED placement, full capacity/access envelopes and canonical labels
- WP-S002-004-008 — Truthful village travel UX: shortest legal routes, all-pair ≥60 fantasy minutes and route visualization
- WP-S002-004-009 — Organic settlement UX: distinct archetypes, services/homes/gates/access and mobile render budgets
- WP-S002-004-010 — Composed-world continuity gate: wrap/pole/LOD seams, unique ownership and no healed modifiers
- WP-S002-004-011 — Inspectable living residents: owned homes/workplaces/gate duties, legal schedules and bounded focused simulation
- WP-S002-004-012 — Single terrain/walkability compositor: deterministic priority earthworks shared by rendering, routing, vegetation and collision
- WP-S002-004-013 — Seeded ruins/critical places: discoverable labels, legal road access and bounded lazy detail
- WP-S002-004-014 — Canonical transport graph: connected terrain-aware roads/bridges/junctions/harbors with stable profiles
- WP-S002-005-001 — S002 performance/compatibility acceptance gate: responsive input, adaptive quality, byte budgets, telemetry and WebGPU/WebGL2 parity
