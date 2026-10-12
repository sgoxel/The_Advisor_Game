# Stage S004 settlement and housing requirements

Status: planning requirements. This document does not claim the atlas already implements these systems. The binding design is `docs/README.md`, the Stage S004 ROADMAP entries, and their GitHub Issues.

## Authority and ownership

One settlement registry owns seeded population, building, road, service, enclosure, gate and guard-post identities. NPC foundation records refer to those identities; render tiles only display them. Every NPC has a distinct owned home-building code, entrance and settlement affiliation. Homes exist logically before any mesh is loaded. Castle inhabitants have houses in a castle residential area, with an explicit parent settlement/region; a keep mesh is insufficient.

Plan enough habitable plots for the full population before accepting a settlement layout. Never fabricate an NPC without a home or reuse one home as several NPCs' individual property. Initial layouts, professions, owners, enclosure geometry and guard rosters use only the Campaign SEED and stable foundation addresses. The absolute fantasy timestamp drives later schedules and live changes. A home transfer or destroyed/rebuilt structure changes campaign state through a persisted event, not regeneration of the foundation.

## Design and simulation rules

An inhabited village starts with a public center and water point; market; inn; blacksmith; farmstead and fields; butcher; guard office; all resident houses; one enclosing physical perimeter; one or two seeded gates; and one or two on-duty resident guards per gate. External fields connect through usable paths. Gate openings and the local street graph join external routes without creating a shortcut that violates village separation.

Each mandatory service has a staffed workplace identity. Gate duty references a gate/post, an actual NPC and that NPC's home. Rotating rosters may support work and rest, but preserve the required one or two on-duty guards per gate. Rendering a guard model is presentation of that assignment, not creation of a new NPC. Layer hiding and unloading never remove ownership or duties from the logical world.

Layouts follow the [0–9 world-building priorities](WORLD_BUILDING_PRIORITY.md). Within city/village phases, reserve enclosure/gates and route connections → streets/center → services/homes → entrances/props. Seeded house and living-area pads may cut mountainsides, grade usable ground and clear vegetation; final road cuts join legal entrances/gates. Final terrain composition honors these reservations. Test footprints, access and frontage; a roster of building names is not enough. Homes have safe entrances connected to the street network; NPC movement follows that network instead of cutting through roofs, walls or water.

## Physical village enclosure and internal reserve space

Every generated village has a real visible physical enclosure around its inhabited core. The enclosure type is a deterministic Campaign-SEED result chosen from at least:

- fence or light rural boundary;
- wooden palisade / wooden wall;
- stone wall;
- a coherent mixed enclosure where culture, terrain, economic role or defensive character justify it.

The enclosure is structural world geometry, not only metadata, an atlas line or a label. Material/type must be visibly recognizable at Village/Street scale and remain semantically identifiable at broader relevant scales.

The perimeter must sit outside the developed house/service footprint and include intentional **empty internal reserve/buffer space beyond the outermost buildings**. A wall immediately tracing the back walls of the last row of houses is invalid. The reserve area gives the village breathing room for yards, paths, commons, guard circulation, irregular terrain transitions and future logical expansion.

The reserve/buffer has these rules:

- It must have non-zero meaningful area around the developed core; it cannot be a token visual gap.
- Width and shape are SEED-derived and terrain-aware rather than perfectly uniform. Cliffs, riverbanks, roads, slopes and other canonical constraints may narrow or widen portions of the buffer.
- The buffer can contain legal open ground, paths, sparse props, trees where compatible, livestock/common space or defensive clear zones, but it may not be silently filled with additional houses until the settlement plan is explicitly changed by authoritative game state.
- The buffer is part of the canonical settlement plan and has a stable footprint independent of camera, LOD, renderer, device, visit order or streaming.

The perimeter itself must form a coherent enclosure except at deliberate canonical openings. Random gaps, floating segments, buried segments, disconnected decorative pieces or walls that stop before joining a gate are invalid.

Every village retains exactly one or two seeded primary gates unless a later owner rule explicitly changes that count. External roads pass through these gate openings. A road may not cut through the fence/wall elsewhere. Gate width, grade and profile must match the connected road class and final terrain. Guard posts must remain physically compatible with the gate and enclosure geometry.

Enclosures may follow terrain naturally but cannot violate world authority:

- no enclosure segment, house, service building or guard post may overlap an active river/lake footprint;
- walls may not dam authoritative drainage or reroute rivers merely to close the perimeter;
- cliffs, shorelines or other natural barriers may influence enclosure shape, but a natural barrier only substitutes for a constructed segment when the canonical enclosure plan explicitly records that boundary treatment;
- fields may remain outside the enclosure when appropriate and must retain legal access through a gate or explicitly supported opening;
- roads, gates, walls and house pads must share the same final terrain/elevation authority, with no buried/floating segments.

Enclosure geometry must be mobile-safe. Prefer low-poly reusable fence/wall modules, shared materials/atlases, deterministic segment reuse and instancing/batching where appropriate. Long perimeters may use bounded lazy presentation while keeping the complete logical perimeter and gate records available.

## Diverse settlements and resident activity

Follow [living-world diversity requirements](LIVING_WORLD_PLAN.md). The shared minimum service list does not require identical villages: vary terrain-shaped streets/plots, building forms/materials, public spaces, fields, enclosure shape/material, gates and economic character. A farming village might use a lighter fence, a woodland/frontier village a wooden palisade, and a wealthier/fortified settlement a stone wall when SEED/context justify it. These are examples, not fixed templates.

Individuals retain their SEED identity and own home while differing in appearance descriptors, roles and behavioral tendencies. Basic daily work/travel/rest and guard activities use real service/home/post destinations and SEED + Fantasy Game Time. Inspect structural village differences and purposeful visible routines, not only name/roof-color swaps or generic looping crowds. Castle/city residents and visitors keep registered homes, including an origin home for visitors rather than a fabricated local residence.

## Reference notes and implementation boundaries

[0 A.D.'s civilization design](https://docs.wildfiregames.com/design/gameplay/civs/mauryas.html) separates civic centers, houses, markets and gates into functional building categories. Its [settlement war-story design](https://docs.wildfiregames.com/design/gameplay/main/war-story.html) describes walls and gates as linked fortification infrastructure. The applicable lesson is to give each structure a semantic role and connect its access to the settlement, rather than scatter unrelated meshes. These references do not establish this project's one-house-per-NPC rule, exact service list, enclosure buffer, deterministic schedules or streaming architecture.

The completed natural-world/reference work supplies general settlement/terrain contracts. WP-S004-001-001 owns the visible/logical settlement exterior: homes with capacity, required services, terrain-shaped streets, physical fence/wood/stone enclosure, internal reserve space, accessible gates and guard-post infrastructure. WP-S006-001-001 owns NPC-to-home ownership, service staffing, actual guard rosters and SEED/time-driven home/work/gate activity. WP-S006-002-001 owns usable-interior reference analysis. WP-S005-001-001 owns the external road network that must join the village through canonical gates. Each package remains independently solvable within its own scope.

## Acceptance evidence

- Enumerate every generated NPC: exactly one existing owned home building per NPC, unique ownership, valid entrance and village/city/castle affiliation; no orphan services or guards.
- Validate every generated village for required service roles, housing capacity, one coherent enclosing physical perimeter, one or two gates, one or two assigned on-duty guards per gate, dry footprints, non-overlap and connected entrances/routes.
- Validate that every village has non-zero canonical internal reserve/buffer area between the outermost developed building footprints and the enclosing perimeter.
- Assert no house/service footprint intersects the enclosure, no enclosure blocks a legal gate/road entrance, and no wall/fence segment illegally occupies authoritative water or breaks drainage.
- Inspect at least three materially different villages including representative fence/light-boundary, wooden/palisade and stone-wall variants where their SEED/context permits. Screenshots must visibly show the reserve gap between the outermost houses and the enclosure.
- Verify a city and a castle residential area as well as villages; home requirements apply to all inhabitants. City/castle fortification rules may differ from village enclosure rules but must remain canonical and terrain-valid.
- Reconstruct layouts, homes, enclosures, gates and rosters under different visit/streaming orders and detail levels. The same SEED gives the same foundation; the same SEED and fantasy timestamp give the same schedule/duty results.
- Fresh MIXED-WP evidence must show complete village layouts, labeled services, enclosure/gates, reserve space, posted resident guards, and an NPC's identified home/workplace. Follow the repository's visual evaluation rules; a wall touching the final row of houses fails the owner requirement.
- Test WebGPU and automatic WebGL2 fallback, including phone/tablet/desktop evidence. Record software-test limits separately from physical-device performance. Measure only focused detail allocation; coarse country views must not instantiate all homes, enclosure meshes or NPC actors.
