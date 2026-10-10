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

## STAGE S002 — Round, Natural World Foundation

Completed S002 WPs are listed in docs/ROADMAP_ARCHIVE.md; only open WPs stay below. A WP absent here and present there is COMPLETED.

- WP-S002-004-005 — Natural terrain/hydrology/traversal authority: irregular landforms, distributed freshwater, canonical walkability and bounded seam-safe queries
- WP-S002-004-007 — Political atlas authority/UX: full-land country partition, SEED-variable ≥30/90/270 counts, readable borders/names and bounded 1/1000 labels
- WP-S002-004-009 — Settlement/building world UX: terrain-shaped non-grid layouts, entrance-connected homes/services, usable lazy interiors and mobile-safe rendering
- WP-S002-004-011 — Living-resident scalability/UX: persistent home/work identity, analytical schedules, spatial indexing, pooled actors and responsive inspection
- WP-S002-004-012 — Unified world-surface compositor: deterministic priority 0–9 earthworks with shared render/routing/collision/material truth
- WP-S002-004-013 — Ruin/critical-place discoverability UX: 1/1000 labels/leaders, legal access, stable canonical identity and bounded lazy detail
- WP-S002-004-014 — Global transport-network authority/UX: connected roads/bridges/harbors/ferries, terrain-aware topology, shared boundaries and bounded generation
- WP-S002-004-015 — Invisible-world continuity/performance: SEED-defined shared-boundary recipes, bounded queries and gameplay-focused lazy materialization
- WP-S002-005-001 — S002 performance/adaptive-rendering release gate: real-device budgets, full telemetry, DOM hot-path control and renderer-loss recovery
- WP-S002-005-002 — Responsive UI/accessibility release gate: safe areas, ≥44px targets, focus/keyboard parity, dense-label readability and seven-viewport evidence
- WP-S002-005-003 — README/runtime semantics release gate: Advisor-vs-atlas wording, dynamic registry counts, canonical truth and Chrome/WebGPU→WebGL2 recovery
