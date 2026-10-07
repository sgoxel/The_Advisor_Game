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
- WP-S002-002-002 — Latency-bounded focus-preserving pure-zoom globe↔local handoff with destination-ready LOD and zero blank frames
- WP-S002-002-003 — Responsive globe/local navigation HUD and Realm framing: truthful scale/ruler, wrap-safe input, labels and seven-viewport UX — COMPLETED
- WP-S002-003-001 — Canonical spherical coordinate and identity authority: remove legacy planar world truth with wrap/pole-safe reversible mapping
- WP-S002-003-002 — Precision-safe ENU/camera-relative rendering, picking, labels and rebasing at canonical planet scale
- WP-S002-003-003 — Bounded canonical-ID streaming: continuous wrap/pole navigation, device budgets and stable cache/queue behavior
- WP-S002-004-001 — Reference analysis and contracts for natural seeded geography, readable settlement UX and lazy mobile generation
- WP-S002-004-002 — Canonical world rescale and travel migration: remove legacy WORLD_SIZE/420 m/1.4 m/s authority
- WP-S002-004-003 — SEED-derived natural planet macro-geography: irregular continents/islands, seas, lakes and mountain ranges across LOD
- WP-S002-004-004 — Climate/biome continuity and Realm readability: frozen poles, deserts, forests and grasslands across LOD
- WP-S002-004-005 — Natural seeded terrain/hydrology: no grid artifacts, truthful walkability and seam-safe LOD continuity
- WP-S002-004-006 — Natural seeded vegetation/ground detail: non-lattice scatter, instancing and mobile draw-call budgets
- WP-S002-004-007 — Terrain-aware settlement placement: irregular SEED positions, full site/access envelopes and canonical labels
- WP-S002-004-008 — Truthful village routing UX: shortest legal paths, all-pair ≥60 fantasy minutes and route visualization
- WP-S002-004-009 — Organic readable settlements: services, borders, gates, housing access and mobile render budgets
- WP-S002-004-010 — Seam/pole/LOD-safe composed world: no cracks, duplicates, healed modifiers or logical discontinuities
- WP-S002-004-011 — Inspectable living residents: seeded homes/workplaces/gate duties, legal routes and bounded schedules
- WP-S002-004-012 — Deterministic priority compositor and earthworks: one terrain/walkability authority across rendering, routing and LOD
- WP-S002-004-013 — Discoverable seeded ruins/quest places: legal access, readable labels and bounded lazy detail
- WP-S002-004-014 — Inspectable connected transport graph: terrain-aware roads/bridges/junctions/harbors with stable canonical profiles
- WP-S002-005-001 — S002 performance acceptance gate: frame/input/worker/upload latency, adaptive quality, memory telemetry and WebGPU/WebGL2 parity
