# The Advisor Game — ROADMAP

## Fundamental Planning Rules — Exception to Roadmap Minimalism

These rules are the explicit exception to the compact ROADMAP format below and must remain at the top of this file.

1. **GENERAL → SPECIFIC ARCHITECTURE FIRST.** Every new system, Stage, or material redesign must be planned from general foundations toward specific implementation. Planning order is: authoritative world/domain model → root invariants and contracts → shared system architecture → subsystem implementation → presentation/integration → performance optimization and polish. Do not begin by patching narrow symptoms while a broader unresolved architectural cause can produce them. Before implementation WPs are planned, identify the system's root invariants, ownership boundaries, canonical identities/data flow, and deterministic behavior. If a narrow WP reveals a broader architectural cause, feed that finding back into ROADMAP planning before creating further narrower implementation WPs. This is a planning-order rule, not an Issue dependency: WPs must be independently actionable and can be delivered as successive safe increments while their full acceptance remains open.
2. **REFERENCE ANALYSIS MUST BE THE FIRST WP FOR A SYSTEM.** Whenever ROADMAP introduces a new system or materially redesigns an existing system, the first WP for that system must be a dedicated research/analysis WP. It must use current internet research to examine the best-known and most relevant proven examples available—such as leading games, engines, platforms, standards, production systems, technical documentation, or academic/industry references as appropriate. The analysis must identify the examples' general architecture, invariants, proven patterns, tradeoffs, failure modes, performance implications, and lessons applicable to The Advisor Game under `docs/README.md`. It must not blindly copy proprietary implementations. Subsequent implementation WPs for that system must be created or revised from the documented analysis conclusions rather than from unverified assumptions or isolated symptoms.
3. **UI/UX/VISUAL-FIRST IMPLEMENTATION.** After the required reference analysis and root architecture/invariants are defined, implementation for every Stage or major system must first establish the intended player-facing UI, UX flow and visible presentation before deeper feature coding. The visible surface must make the Stage understandable and testable early, while remaining consistent with `docs/README.md`, deterministic world authority and performance budgets. Use WebGPU 3D Visuals whenever possible.

4. **CONTINUOUS INCREMENTAL DELIVERY AND ISSUE REASSESSMENT.** Develop and deploy the smallest safe, useful increment even when a WP remains unfinished. Persistently unresolved failures are living work, not a reason to stop at an arbitrary number of attempts, corrections, reviews, or runs. Re-evaluate each active blocker against the latest source and accepted evidence; record its observed failure, canonical cause or uncertainty, next smallest implementation/test action, acceptance proof, ownership and current status in the existing Issue. After a partial delivery, resume from the next actionable blocker rather than repeating diagnostics already answered. Regularly revisit older open Issues and newly recurring faults; update, de-duplicate and prioritize their concrete next actions without silently closing or claiming them. A separate Agent may own its own independent WP; one Agent retains one active incomplete WP unless the owner explicitly reassigns it. **ACTIONABLE CHECKPOINT CONTRACT.** At each run and whenever new evidence changes the diagnosis, leave every revisited unresolved Issue with one immediately executable next action: the current observed failure and exact-source evidence; root cause or bounded uncertainty; the smallest safe code, test or measurement step; a concrete acceptance check/artifact; owner and DEPLOYED / ACCEPTANCE PENDING / COMPLETED truth. Mark unknowns UNKNOWN, not BLOCKED or PASS. After each partial deployment, reassess the remaining failures and choose the next useful increment instead of recycling stale diagnostics or exhausting a made-up correction budget. Do not hold safe independent progress hostage to optional checks or unrelated open Issues; keep each individual job, test, retry and resource budget bounded.  Individual tests, CI attempts and resource use remain bounded, but there is no global correction-cycle ceiling. Keep release invariants, SEED/Simulation truth, required visual evidence and honest DEPLOYED / ACCEPTANCE PENDING / COMPLETED states; never weaken a failed gate to force completion.

## Roadmap Rule

Apart from the Fundamental Planning Rules above, keep only Stage headings and WP code/title/status lines here. WP details, evidence and implementation notes belong in the corresponding GitHub Issue.

## STAGE S001 — Seeded 3D World Foundation

All S001 WPs are COMPLETED and REVIEWED (see docs/ROADMAP_ARCHIVE.md).

## STAGE S002 — Canonical Planet & Macro-World Foundation

Completed S002 history is listed in docs/ROADMAP_ARCHIVE.md. Remaining continuation work was resegmented into S003–S009 on 2026-10-12; S002 has no open WPs.

## STAGE S003 — Natural World & Surface Authority

- WP-S003-004-001 — Reconcile Hero/Close 3D relief with SEED final-surface heights, legal walkability & seamless LOD

## STAGE S004 — Settlements, Buildings & World Sites

- WP-S004-001-001 — Deterministic settlement distribution & morphology: viable-area density, readable functional villages/cities, legal access and bounded mobile rendering — COMPLETED and REVIEWED at 2026-10-17
- WP-S004-002-001 — Critical-site UX: readable 3D access, collision-safe labels & dual-backend parity — COMPLETED and REVIEWED at 2026-10-20

## STAGE S005 — Transport & Traversal Network

- WP-S005-001-001 — Lawful SEED multi-road travel: grade-safe bridges, actual resident arrival & honest route preview — COMPLETED and REVIEWED at 2026-10-27
- WP-S005-002-001 — Repair bridge landings end-to-end: dry-bank geometry, legal grades & two-way resident traversal

## STAGE S006 — Living World & Usable Buildings

- WP-S006-001-001 — Same resident's legal home→gate→bridge→work→home journey, real picking & dual-backend proof — COMPLETED and REVIEWED at 2026-10-26
- WP-S006-002-001 — Same-world interior research: legal entry, persistence & responsive UX — COMPLETED and REVIEWED at 2026-10-20

## STAGE S007 — World Visual Presentation

## STAGE S008 — Player Interface & Accessibility

- WP-S008-001-001 — Accessible atlas UI: ≥44px touch targets, readable safe-area panels, semantic picking & focus return — COMPLETED and REVIEWED at 2026-10-27

## STAGE S009 — Performance, Stability & Product Conformance

- WP-S009-001-001 — First-play responsiveness & cache reuse: ≤120s cold, faster repeat opens, measured +25% p95
- WP-S009-002-001 — Stop idle atlas reflow: cache labels/panels, retain stable-ID accessible picking & input p95
- WP-S009-003-001 — Trim unused cache above 256MB, cap CPU+GPU at 1GB & recover WebGPU→WebGL2 without world reset
- WP-S009-004-001 — Audit exact-SHA README promises: PASS / FOUNDATION / ABSENT / UNVERIFIED for UX, performance & browsers
- WP-S009-005-001 — Report truthful resident/scene readiness & keep pure-zoom focus, position and camera angle fixed

## STAGE S010 — Hero-Zoom Gameplay, Advisor Decisions, Same-World Interiors & Campaign Persistence

- WP-S010-001-001 — Research first-play village UX: 2D hero, autonomous Advisor loop & accessible mobile onboarding
- WP-S010-002-001 — Ship mobile-safe Hero/Close GLB kit: real 3D doors/roofs, reusable assets & WebGPU/WebGL2 parity
- WP-S010-003-001 — Ground 2D residents in 3D truth: legal feet, roof occlusion & accessible stable-ID picking
- WP-S010-003-002 — Expose accessible tilt/inspect/follow separately from pure zoom and Simulation-owned actor choice
- WP-S010-004-001 — Prove legal resident work shifts: physical workstation, capacity and visible 2D activity
- WP-S010-004-002 — Grounded owned 3D homes: open door apertures, legal final-surface access & walkable streets
- WP-S010-004-003 — Canonical inventory UX: lawful SEED item transfers, ownership & campaign persistence
- WP-S010-004-004 — NPC obstacle avoidance: deterministic road detours & stuck recovery
- WP-S010-005-001 — Make one owned home enterable in the same world: legal door→room→exit, honest load & roof cutaway
- WP-S010-005-002 — Enterable 3D service interiors: lawful street→door→station & resident occupancy
- WP-S010-005-003 — Same-resident door traversal: Simulation occupancy & 2D roof/depth parity
- WP-S010-005-004 — Persistent interior changes: SEED rooms/items/occupants, validated replay & lawful exit
- WP-S010-005-005 — Light only occupied homes at Fantasy Night 22:00–05:00; empty rooms stay dark
- WP-S010-006-001 — Certify physical Galaxy A55 Chrome: 30-FPS fallback, responsive input & WebGPU→WebGL2 recovery

- WP-S010-007-001 — Research local-first Advisor authority: versioned Sentence Library, character choice and safe LLM proposals
- WP-S010-007-002 — Ship accessible offline-first Advisor chat: deterministic intents, bounded LLM & decision states
- WP-S010-007-003 — Prove advice→autonomous choice→Simulation-valid action→visible, replayable consequence
- WP-S010-008-001 — Research campaign SEED/time authority: creation-derived calendar, 24× clock & offline replay
- WP-S010-008-002 — Create/resume real campaigns: accepted SEED and creation time, accessible UI & truthful save state
- WP-S010-008-003 — Persist validated Simulation events only: atomic campaign saves, stable IDs and exact replay
- WP-S010-009-001 — Research SEED-faithful 3D fauna: habitats, movement, LOD & mobile budgets
- WP-S010-009-002 — Render 13 SEED-owned 3D fauna species: legal habitats, observable actions and mobile LOD
