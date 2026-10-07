# Stage S002 settlement and housing requirements

Status: planning only. The owner selected updating Stage S002 on 2026-10-07; this document does not claim the atlas already implements these systems. The binding design is [README.md](README.md#seeded-settlement-design-and-npc-homes).

## Authority and ownership

One settlement registry owns seeded population, building, road, service, border and gate identities. NPC foundation records refer to those identities; render tiles only display them. Every NPC has a distinct owned home-building code, entrance and settlement affiliation. Homes exist logically before any mesh is loaded. Castle inhabitants have houses in a castle residential area, with an explicit parent settlement/region; a keep mesh is insufficient.

Plan enough habitable plots for the full population before accepting a settlement layout. For example, the current 80-resident village would need at least 80 distinct owned home buildings, plus its service infrastructure. The current 2,400-resident city would need at least 2,400 home buildings. These examples expose the current capacity gap; they do not set new population or planetary-scale constants. Never fabricate an NPC without a home or reuse one home as several NPCs' individual property.

Initial layouts, professions, owners and guard rosters use only the Campaign SEED and stable foundation addresses. The absolute fantasy timestamp drives later schedules and live changes. A home transfer or destroyed/rebuilt house changes campaign state through a persisted event, not regeneration of the foundation. Full construction, crime, combat, commerce and relocation gameplay are beyond these two initial implementation packages.

## Design and simulation rules

An inhabited village starts with a public center and water point; market; inn; blacksmith; farmstead and fields; butcher; guard office; all resident houses; an enclosing core border; one or two seeded gates; and one or two on-duty resident guards per gate. External fields connect through usable paths. Gate openings and the local street graph join external routes without creating a shortcut that violates village separation.

Each mandatory service has a staffed workplace identity. Gate duty references a gate/post, an actual NPC and that NPC's home. Rotating rosters may support work and rest, but preserve the required one or two on-duty guards per gate. Rendering a guard model is presentation of that assignment, not creation of a new NPC. Layer hiding and unloading never remove ownership or duties from the logical world.

Layouts follow the [0–9 world-building priorities](WORLD_BUILDING_PRIORITY.md). Within city/village phases, reserve border/gates and route connections → streets/center → services/homes → entrances/props. Seeded house and living-area pads may cut mountainsides, grade usable ground and clear vegetation; final road cuts join legal entrances/gates. Final terrain composition honors these reservations. Test footprints, access and frontage; a roster of building names is not enough. Homes have safe entrances connected to the street network; NPC movement follows that network instead of cutting through roofs, walls or water. Houses and guard posts remain traceable across detail levels.

## Diverse settlements and resident activity

Follow [living-world diversity requirements](LIVING_WORLD_PLAN.md). The shared minimum service list does not require identical villages: vary terrain-shaped streets/plots, building forms/materials, public spaces, fields, border/gates and economic character. Individuals retain their SEED identity and own home while differing in appearance descriptors, roles and behavioral tendencies. Basic daily work/travel/rest and guard activities use real service/home/post destinations and SEED + Fantasy Game Time. Inspect structural village differences and purposeful visible routines, not only name/roof-color swaps or generic looping crowds. Castle/city residents and visitors keep registered homes, including an origin home for visitors rather than a fabricated local residence.

## Reference notes and implementation boundaries

[0 A.D.'s civilization design](https://docs.wildfiregames.com/design/gameplay/civs/mauryas.html) separates civic centers, houses, markets and gates into functional building categories. Its [settlement war-story design](https://docs.wildfiregames.com/design/gameplay/main/war-story.html) describes walls and gates as linked fortification infrastructure. The applicable lesson is to give each structure a semantic role and connect its access to the settlement, rather than scatter unrelated meshes. These strategy-game designs do not establish our one-house-per-NPC rule, exact village service list, deterministic schedules or tile-streaming architecture; those are this project's owner requirements. No asset or proprietary implementation is copied.

The dedicated reference/contract analysis remains WP-S002-004-001. It must research resident home/work assignment and schedule models as well as terrain and settlement examples, document trade-offs and fix canonical identities, footprint/access constraints and lazy-generation budgets. This brief supplies requirements for that research; it does not mark the analysis package complete.

WP-S002-004-009 implements the visible and logical settlement layout: homes with capacity, required services, borders, accessible gates and guard-post infrastructure. WP-S002-004-011 implements NPC-to-home ownership, service staffing, actual guard rosters and seed/time-driven home/work/gate travel. Each package must implement the minimum contracts it needs if absent and must not wait on another issue. WP-S002-004-007 must reserve suitable land for a complete settlement, and WP-S002-005-001 must measure the resulting streaming/mesh/simulation budgets without allocating every NPC or house on the planet.

## Acceptance evidence

- Enumerate every generated NPC: exactly one existing owned home building per NPC, unique ownership, valid entrance and village/city/castle affiliation; no orphan services or guards.
- Validate all 270 villages for required service roles, housing capacity, enclosing core border, one or two gates, one or two assigned on-duty guards per gate, dry footprints, non-overlap and connected entrances/routes.
- Verify a city and a castle residential area as well as villages; home requirements apply to all inhabitants.
- Reconstruct layouts, homes and rosters under different visit/streaming orders and detail levels. The same SEED gives the same foundation; the same SEED and fantasy timestamp give the same schedule/duty results, including direct catch-up.
- Inspect fresh images showing a complete village layout, labeled services, borders/gates, posted resident guards, and an NPC's identified home/workplace. Show a city housing district and castle residential area. Follow the repository's mixed-work-package visual evaluation rules.
- Test WebGPU and automatic WebGL2 fallback, including a phone viewport. Record software-test limits separately from physical phone performance. Measure only focused detail allocation; coarse country views must not instantiate all their homes and NPC meshes.
