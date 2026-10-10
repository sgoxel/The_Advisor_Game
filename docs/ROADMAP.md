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

- WP-S002-004-005 — Natural terrain/hydrology/traversal authority: distributed freshwater, drainage-valid rivers/lakes, canonical walkability, surface-safe earthworks and bounded seam-safe generation
- WP-S002-004-007 — Political atlas + settlement-siting completion: preserve full-continent partition/variable registries, canonical-hydrology/final-surface envelopes, connected access, borders and bounded 1/1000 labels
- WP-S002-004-008 — Shortest-legal-walk routing/travel UX: all-pair ≥60-minute proof, final-surface routing, bounded search/cache and truthful route preview
- WP-S002-004-009 — Living settlement/building UX: anti-stamped terrain-shaped layouts, structurally distinct services/homes, entrance-connected access, demand-loaded usable interiors and mobile-safe rendering
- WP-S002-004-011 — Living-resident simulation UX/performance: persistent home/work identity, analytical absolute-time schedules, spatial indexing, bounded logical/visible populations and responsive inspection
- WP-S002-004-012 — Unified final-surface authority: deterministic priority 0–9 earthworks and one render/routing/collision/material/vegetation truth
- WP-S002-004-013 — Ruin/critical-place UX: 1/1000 discoverability, legal road access, stable canonical identity, bounded terrain preparation and lazy detail
- WP-S002-004-014 — Global transport-network authority/UX: connected roads/bridges/harbors/ferries, terrain-aware profiles/junctions and bounded lazy generation
- WP-S002-004-015 — Invisible-world continuity/performance: SEED-defined shared-boundary contracts, bounded on-demand queries, eviction-safe reconstruction and streaming-independent identity
- WP-S002-005-001 — Exact-main performance/stability release gate: complete percentile/UI telemetry, adaptive budgets, bounded resources, runtime renderer recovery and deploy-SHA browser/visual gating
- WP-S002-005-002 — Responsive UI/UX/accessibility release gate: safe-area/mobile map visibility, ≥44px targets, accessible labels, modal/focus/keyboard parity and seven-viewport evidence
- WP-S002-005-003 — README/runtime product-truth release gate: Advisor-safe atlas wording, canonical dynamic context/counts, world-scale truth, backend parity/recovery and exact-main conformance
