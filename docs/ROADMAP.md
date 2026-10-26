# The Advisor Game — ROADMAP

## Fundamental Planning Rules — Exception to Roadmap Minimalism

These rules are the explicit exception to the compact ROADMAP format below and must remain at the top of this file.

1. **GENERAL → SPECIFIC ARCHITECTURE FIRST.** Every new system, Stage, or material redesign must be planned from general foundations toward specific implementation. Planning order is: authoritative world/domain model → root invariants and contracts → shared system architecture → subsystem implementation → presentation/integration → performance optimization and polish. Do not begin by patching narrow symptoms while a broader unresolved architectural cause can produce them. Before implementation WPs are planned, identify the system's root invariants, ownership boundaries, canonical identities/data flow, and deterministic behavior. If a narrow WP reveals a broader architectural cause, feed that finding back into ROADMAP planning before creating further narrower implementation WPs. This is a planning-order rule, not an Issue dependency: WPs must be independently actionable and can be delivered as successive safe increments while their full acceptance remains open.
2. **REFERENCE ANALYSIS MUST BE THE FIRST WP FOR A SYSTEM.** Whenever ROADMAP introduces a new system or materially redesigns an existing system, the first WP for that system must be a dedicated research/analysis WP. It must use current internet research to examine the best-known and most relevant proven examples available—such as leading games, engines, platforms, standards, production systems, technical documentation, or academic/industry references as appropriate. The analysis must identify the examples' general architecture, invariants, proven patterns, tradeoffs, failure modes, performance implications, and lessons applicable to The Advisor Game under `docs/README.md`. It must not blindly copy proprietary implementations. Subsequent implementation WPs for that system must be created or revised from the documented analysis conclusions rather than from unverified assumptions or isolated symptoms.
3. **UI/UX/VISUAL-FIRST IMPLEMENTATION.** After the required reference analysis and root architecture/invariants are defined, implementation for every Stage or major system must first establish the intended player-facing UI, UX flow and visible presentation before deeper feature coding. The visible surface must make the Stage understandable and testable early, while remaining consistent with `docs/README.md`, deterministic world authority and performance budgets. Use WebGPU 3D Visuals whenever possible.

4. **CONTINUOUS INCREMENTAL DELIVERY AND ISSUE REASSESSMENT.** Develop and deploy the smallest safe, useful increment even when a WP remains unfinished. Persistently unresolved failures are living work, not a reason to stop at an arbitrary number of attempts, corrections, reviews, or runs. Re-evaluate each active blocker against the latest source and accepted evidence; record its observed failure, canonical cause or uncertainty, next smallest implementation/test action, acceptance proof, ownership and current status in the existing Issue. After a partial delivery, resume from the next actionable blocker rather than repeating diagnostics already answered. Regularly revisit older open Issues and newly recurring faults; update, de-duplicate and prioritize their concrete next actions without silently closing or claiming them. A separate Agent may own its own independent WP; one Agent retains one active incomplete WP unless the owner explicitly reassigns it. Individual tests, CI attempts and resource use remain bounded, but there is no global correction-cycle ceiling. Keep release invariants, SEED/Simulation truth, required visual evidence and honest DEPLOYED / ACCEPTANCE PENDING / COMPLETED states; never weaken a failed gate to force completion.

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

- WP-S005-001-001 — Lawful SEED multi-road travel: grade-safe bridges, actual resident arrival & honest route preview

## STAGE S006 — Living World & Usable Buildings

- WP-S006-001-001 — Same resident's legal home→gate→bridge→work→home journey, real picking & dual-backend proof — COMPLETED and REVIEWED at 2026-10-26
- WP-S006-002-001 — Same-world interior research: legal entry, persistence & responsive UX — COMPLETED and REVIEWED at 2026-10-20

## STAGE S007 — World Visual Presentation

## STAGE S008 — Player Interface & Accessibility

- WP-S008-001-001 — Accessible atlas UI: ≥44px touch targets, readable safe-area panels, semantic picking & focus return

## STAGE S009 — Performance, Stability & Product Conformance

- WP-S009-001-001 — Cap aggregate streaming jobs at 4/6/8, keep ≤1 upload/frame & deliver timely authoritative inspect
- WP-S009-002-001 — Eliminate idle-frame DOM measurements & bound canonical terrain picking
- WP-S009-003-001 — Trim unused cache above 256MB & cap CPU+GPU at 1GB with mobile DPR/WebGL2 recovery
- WP-S009-004-001 — SHA-backed README compliance audit: Advisor autonomy, Fantasy Time, saves, 2D actors & honest UX
- WP-S009-005-001 — Truthful 3-stage loading, settled 3D homes & pure-zoom continuity

## STAGE S010 — Hero-Zoom Gameplay, Advisor Decisions, Same-World Interiors & Campaign Persistence

- WP-S010-001-001 — Research Hero/Close contracts for 3D depth, 2D residents, usable controls & mobile budgets
- WP-S010-002-001 — Reusable low-draw 3D GLB/toon props with instancing, LOD & SEED-lawful doors
- WP-S010-003-001 — Accurate 2D residents in 3D: feet, roof occlusion, picking & accessible selection
- WP-S010-003-002 — Read-only Advisor tools: inspect, follow, measure & preview without actor teleport
- WP-S010-004-001 — Simulation-legal daily work: real resident shifts, workstation access & visible 2D actions
- WP-S010-004-002 — Real SEED homes at Hero zoom: grounded 3D lots, owned doors & walkable streets
- WP-S010-004-003 — Legal inventory with SEED item IDs, accessible UI, validated transfer & persistence
- WP-S010-005-001 — Enter a real home via owned door→room→exit with no teleport or false readiness
- WP-S010-005-002 — Walkable 3D service interiors: street access, real workstations & legal occupants
- WP-S010-005-003 — Simulation-validated resident door traversal with 2D depth & room occupancy
- WP-S010-005-004 — Durable same-world interior events: occupancy/items, reconstruction & lawful exit
- WP-S010-006-001 — Physical-device Hero/Close proof: 30 FPS floor, input p95, ≤1GB & GPU/GL2 parity

- WP-S010-007-001 — Research Advisor contracts: Sentence Library, autonomous character & bounded LLM commands
- WP-S010-007-002 — Accessible Advisor chat: deterministic Sentence Library, bounded LLM & offline fallback
- WP-S010-007-003 — Autonomous character evaluates advice; Simulation validates observable world outcomes
- WP-S010-008-001 — Research campaign authority: accepted creation date, Fantasy Time, SEED & offline resume
- WP-S010-008-002 — Playable campaign create/select: visible SEED, accepted date & stable protagonist
- WP-S010-008-003 — Crash-safe campaign save/reload: validated events & deterministic offline advancement
