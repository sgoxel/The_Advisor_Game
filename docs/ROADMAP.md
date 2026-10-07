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

- WP-S002-001-001 — Reference analysis and root contracts for the wrapped planet, globe Realm view and world scale
- WP-S002-002-001 — Globe Realm view: the Realm level rendered as a sphere
- WP-S002-002-002 — Seamless pure-zoom handoff between the globe and the flat levels
- WP-S002-002-003 — Globe navigation and HUD: scale-aware drag, centre marker, coordinates and truthful ruler
- WP-S002-003-001 — Canonical wrapped coordinate fabric with east–west wrap
- WP-S002-003-002 — Precision-safe rendering for planet-scale coordinates
- WP-S002-003-003 — Wrap-aware tile streaming and continuous east–west travel
- WP-S002-004-001 — Reference analysis and contracts for natural seeded terrain, water and settlement placement
- WP-S002-004-002 — World rescale: planet size, settlement spacing and fantasy-time walking speeds
- WP-S002-004-003 — Seeded planet geography: continents, islands, seas and mountain ranges
- WP-S002-004-004 — Planet climate and biomes: frozen poles, deserts, forests and grasslands that drive every closer level
- WP-S002-004-005 — Natural seeded terrain: mountains, cliffs, rivers, lakes and coasts without grid patterns
- WP-S002-004-006 — Natural seeded vegetation and ground detail without lattice patterns
- WP-S002-004-007 — Seeded terrain-aware placement of countries, cities and villages
- WP-S002-004-008 — Terrain-aware village routes and the one-fantasy-hour minimum
- WP-S002-004-009 — Organic seeded settlement layouts, village services, borders and guarded gate infrastructure
- WP-S002-004-010 — Seam-safe and pole-safe seeded terrain
- WP-S002-004-011 — Seeded NPC home ownership, workplaces and gate-guard duties
- WP-S002-005-001 — Performance budgets and telemetry for the globe, wrapped streaming and natural terrain
