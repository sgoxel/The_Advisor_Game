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

- WP-S006-001-001 — Lawful resident journeys & visible identity: owned door→gate/bridge→work→home, blocked/midnight and dual-backend proof
- WP-S006-002-001 — Same-world interior research: legal entry, persistence & responsive UX — COMPLETED and REVIEWED at 2026-10-20

## STAGE S007 — World Visual Presentation

## STAGE S008 — Player Interface & Accessibility

- WP-S008-001-001 — Accessible map→inspect UX: semantic labels, ≥44px touch, seven layouts, focus return & visible selection

## STAGE S009 — Performance, Stability & Product Conformance

- WP-S009-001-001 — Bounded streaming & first-use latency: ≤1 upload/frame, ≤4/6/8 queue, authoritative first answer & p95
- WP-S009-002-001 — Exact canonical picking & idle UI: bounded final-surface ray hits, zero unchanged-frame layout reads
- WP-S009-003-001 — Mobile resource & renderer resilience: 256MB cache trim, 1GB CPU+GPU cap, DPR/shadow tiers & device recovery
- WP-S009-004-001 — README truth audit: Advisor-vs-atlas, campaign time/save/age, 2D characters, daylight & honest UX
- WP-S009-005-001 — Truthful loading & pure zoom: coherent terrain→authoritative interaction→settled 3D, fixed focus

## STAGE S010 — Hero-Zoom Gameplay, Advisor Tools & Same-World Interiors

- WP-S010-001-001 — Hero/Close root UX research: 2D billboard identity, legal rooms/doors, Advisor boundary & mobile budgets
- WP-S010-002-001 — SEED-owned Hero/Close GLB kits: legal collision-safe placement, instancing, zoom & resource bounds
- WP-S010-003-001 — Accessible Hero/Close selection: exact touch/keyboard hits, 2D sprites, safe areas & focus return
- WP-S010-003-002 — Advisor inspect/follow/measure: camera-only tracking, legal route truth & first-answer latency
- WP-S010-004-001 — Lawful workstations & 2D resident actions: Simulation-backed tasks, owned tools & reusable kits
- WP-S010-004-002 — SEED-owned home/yard detail: legal doors, grounded props, visual clarity & mobile bounds
- WP-S010-004-003 — Canonical resident inventory: SEED ownership, validated item deltas & honest held-item UI
- WP-S010-005-001 — Same-world home entry: separate camera preview & lawful character entry, staged 3D readiness
- WP-S010-005-002 — Same-world service interiors: connected doors/rooms, lawful occupancy & reusable 3D kits
- WP-S010-005-003 — Indoor 2D residents: lawful portal crossings, stable identity, true occupancy & occlusion
- WP-S010-005-004 — Interior persistence & recovery: Simulation-validated deltas, deterministic revisits & safe exits
- WP-S010-006-001 — Hero/Close exact-SHA performance proof: p95/30–60 FPS, 256MB/1GB, phone & dual-backend visuals
