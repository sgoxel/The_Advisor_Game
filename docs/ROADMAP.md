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

- WP-S003-001-001 — Unified final-surface authority: deterministic priority 0–9 composition and one render/collision/material/vegetation/hydrology/traversal truth
- WP-S003-003-001 — Natural terrain/hydrology authority + visual readability: drainage-valid freshwater, smoother canonical banks/coasts/relief, canonical walkability and seam-safe bounded generation

## STAGE S004 — Settlements, Buildings & World Sites

- WP-S004-001-001 — Seeded settlement morphology + exterior gameplay UX/performance: varied roads/plots/services/homes/farms/gates, road-safe placement and mobile-safe rendering
- WP-S004-002-001 — Ruin/critical-place UX/performance: 1/1000 discoverability, legal network access, stable canonical identity, bounded site preparation and lazy detail

## STAGE S005 — Transport & Traversal Network

- WP-S005-001-001 — Visible transport-network authority/UX/performance: same-country village/city/castle roads, neighboring-capital main roads, terrain-valid bridges/harbors/ferries, route-truth recertification and bounded lazy generation

## STAGE S006 — Living World & Usable Buildings

- WP-S006-001-001 — Living-resident authority + inspectable life UX/performance: unique homes/work/guards, analytical schedules, spatial queries and reusable 2D-in-3D actor pools
- WP-S006-002-001 — Usable building-interior architecture reference analysis + implementation plan: same-world entry/exit, deterministic rooms, persisted changes, demand loading and mobile-safe reconstruction

## STAGE S007 — World Visual Presentation

- WP-S007-001-001 — World-presentation + semantic-zoom reference analysis + implementation plan: README medieval-fantasy lighting/materials, 2D character readability, globe↔local continuity and mobile budgets

## STAGE S008 — Player Interface & Accessibility

- WP-S008-001-001 — Responsive gameplay-shell + accessibility/mobile UX acceptance: viewport-fit cutout safety, measured 44px targets, keyboard/focus/Escape/return, accessible map semantics and reduced motion

## STAGE S009 — Performance, Stability & Product Conformance

- WP-S009-001-001 — Exact-SHA performance observability + release evidence: CPU/input/worker/upload/DOM/GPU/resource telemetry, seven viewports, backend matrix and honest hardware status
- WP-S009-002-001 — Main-thread hot-path performance: analytical resident updates/spatial queries + invalidation-driven DOM/label work with bounded allocations
- WP-S009-003-001 — Adaptive renderer/resource resilience: device-class DPR/render scale, quality hysteresis, reusable assets, continuous-zoom parity and runtime WebGPU/WebGL2 recovery
- WP-S009-004-001 — README/runtime product conformance: truthful current-stage baseline, Advisor-vs-atlas semantics, route/geography claims, legacy-scale cleanup and exact-release truth
