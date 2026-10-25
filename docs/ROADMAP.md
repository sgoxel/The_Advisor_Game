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

## STAGE S004 — Settlements, Buildings & World Sites

- WP-S004-001-001 — Deterministic settlement distribution & morphology: viable-area density, readable functional villages/cities, legal access and bounded mobile rendering — COMPLETED and REVIEWED at 2026-10-17
- WP-S004-002-001 — Critical-site UX: readable 3D access, collision-safe labels & dual-backend parity — COMPLETED and REVIEWED at 2026-10-20

## STAGE S005 — Transport & Traversal Network

## STAGE S006 — Living World & Usable Buildings

- WP-S006-001-001 — Lawful resident journeys & real canvas identity: owned door→work→home, blocked routes, midnight & dual-backend visuals
- WP-S006-002-001 — Same-world interior research: legal entry, persistence & responsive UX — COMPLETED and REVIEWED at 2026-10-20

## STAGE S007 — World Visual Presentation

## STAGE S008 — Player Interface & Accessibility

- WP-S008-001-001 — Accessible canonical map flow: keyboard/screen-reader parity, ≥44px touch, seven layouts & focus return

## STAGE S009 — Performance, Stability & Product Conformance

- WP-S009-001-001 — Bounded streaming & measured first-use latency: ≤1 upload/frame, ≤4/6/8 work & exact-SHA p95
- WP-S009-002-001 — Responsive authoritative picking & idle UI: bounded final-surface hits, zero unchanged-frame layout reads
- WP-S009-003-001 — Mobile GPU resilience: 256MB trim, 1GB combined cap, DPR/shadow tiers & WebGPU→WebGL2 recovery
- WP-S009-004-001 — README conformance ledger: Advisor autonomy, 2D resident art, campaign time/age/save & truthful claims
- WP-S009-005-001 — Truthful terrain→interaction→3D readiness & pure zoom: focus lock, no blanks, settled detail

## STAGE S010 — Hero-Zoom Gameplay, Advisor Tools & Same-World Interiors

- WP-S010-001-001 — Hero/Close reference architecture: 2D resident art, Advisor-safe UX, true interiors & mobile budgets
- WP-S010-002-001 — SEED-owned Hero/Close 3D object kits: lawful placement, instanced GLBs & continuous semantic zoom
- WP-S010-003-001 — Accessible Hero/Close inspection: canonical touch/keyboard picking, 2D resident identity & advice-only actions
- WP-S010-003-002 — Advisor observation tools: inspect, camera-follow & Simulation-legal time/distance estimates
- WP-S010-004-001 — Simulation-truth workstations & 2D resident work/idle visuals: grounded tasks, bounded assets
- WP-S010-004-002 — SEED-built household yards: reusable low-poly GLBs, collision clearances & mobile budgets
- WP-S010-004-003 — Resident inventory: authoritative ownership, validated deltas & accessible truthful inspection
- WP-S010-005-001 — Same-world home entry: valid door/portal, camera-only preview & honest interior readiness
- WP-S010-005-002 — Same-world service interiors: canonical rooms/access, truthful occupancy & reusable mobile kits
- WP-S010-005-003 — Indoor resident continuity: lawful schedules/portals, same identity & inspectable 2D actors
- WP-S010-005-004 — Interior persistence: Simulation event deltas, deterministic revisit, usable entry/exit & recovery
- WP-S010-006-001 — Hero/Close exact-SHA performance: p95 input/frames, 256MB/1GB resources & dual-backend mobile proof
