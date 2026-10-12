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

- WP-S002-004-005 — Natural terrain/hydrology/traversal authority: drainage-valid freshwater, high-relief terrain readability, canonical walkability, surface-only earthworks and seam-safe bounded generation
- WP-S002-004-009 — Living settlement/building UX/performance: terrain-shaped layouts, functionally distinct services/homes, entrance-connected access, demand-loaded usable interiors and reusable mobile-safe rendering
- WP-S002-004-011 — Living-resident simulation UX/performance: persistent home/work/guard identity, analytical schedules, spatial indexing, bounded logical/visible populations and inspectable activity
- WP-S002-004-012 — Unified final-surface authority: deterministic priority 0–9 composition, one render/routing/collision/material/vegetation/hydrology truth and final-route recertification
- WP-S002-004-013 — Ruin/critical-place UX/performance: 1/1000 discoverability, legal network access, stable canonical identity, bounded site preparation and lazy detail
- WP-S002-004-014 — Global transport-network authority/UX/performance: connected roads/bridges/harbors/ferries, terrain-valid profiles/junctions, route-truth recertification and bounded lazy generation
- WP-S002-004-015 — Invisible-world continuity/performance: SEED-defined shared-boundary recipes, bounded on-demand queries, eviction-safe reconstruction, remote-route truth and streaming-independent identity
- WP-S002-004-016 — Toon/cel-shaded world-presentation reference analysis: proven stylized 3D lighting/material/LOD/mobile patterns and S002 visual invariants
- WP-S002-005-001 — Performance observability + budget evidence: complete bounded telemetry, exact-SHA scenario matrix and honest PASS/FAIL/UNVERIFIED reporting
- WP-S002-005-002 — Responsive interaction + accessibility acceptance: cutout-safe seven-viewport layout, measured 44px targets, keyboard/touch/focus parity, readable declutter and reduced motion
- WP-S002-005-003 — README/runtime semantic conformance: Advisor-vs-atlas authority, canonical dynamic geography/routes, current S002 baseline, renderer truth and evidence-backed claims
- WP-S002-005-004 — Simulation + DOM hot-path performance: analytical resident updates, spatially bounded queries, invalidation-driven overlays and allocation regression limits
- WP-S002-005-005 — Renderer/resource resilience: device-class DPR + adaptive render scale, quality hysteresis, reusable assets and canonical-safe WebGPU/WebGL2 recovery
