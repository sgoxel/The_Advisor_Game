# Diversity and a lively natural world — Stage S002

Status: owner requirements added on 2026-10-07. This is planning for existing natural-terrain, settlement and resident packages, not a claim that diverse NPCs or these activities already run in the current build.

## Terrain diversity

Terrain must have coherent regional character and local variety: ridges, valleys, slopes, plains, irregular coasts, river banks, lakeshores, forest clearings, grassland and desert variations, and frozen polar environments. Vegetation/ground details cluster and vary according to the seeded climate, elevation, moisture and land use. Avoid a uniformly scattered forest, repeated terrain stamp, rigid cell-center placement or a palette-only recolor of otherwise identical landscapes. Transitions must be plausible and agree with Realm geography and every closer level.

The owner requirements for 0–9 priorities, final road/house earthworks, water flow, natural continent/island placement and minimum village walking time remain binding. Diversity cannot produce disconnected roads, invalid houses or contradictory terrain when streaming changes.

## Village diversity

Every village has the required center, water point, market, inn, blacksmith, farmstead/fields, butcher, guard office, houses, border and guarded gates. That minimum service set is not a repeated visual template. Give villages SEED-derived identities shaped by their site, climate, terrain, access and economic role: for example farming, woodland production, riverside/coastal trade or fortified frontier life.

Vary the actual street/plot geometry, orientation, housing forms and materials, public-center shape, field arrangement, service placement, border shape and activity distribution. Terrain-aware changes must matter: a hillside village may use terraces, a riverside village relates to a connected bridge, and a trade village gives its market/inn meaningful street access. Rotating one rigid layout or changing only roof colors does not establish this diversity. City districts and castle residential areas should express their own functions while preserving housing and connected access.

## NPC diversity and identity

Every NPC has an individual SEED identity and owned home. Foundation descriptors vary names, appearance/body or silhouette, hair/clothing, profession/role, birth date, baseline personality/behavioral tendencies and initial home/work relationships. Existing birth-date/age and character-identity rules apply: birth dates come from SEED, while current age/life stage derives from Fantasy Game Time. Appearance and clothing can reflect climate and work while individuals remain distinguishable; a village's residents must not be identical clones of one sprite or three repeated appearances.

Keep descriptors traceable to the same NPC code through visits, LOD and cache eviction. Reusing optimized meshes/atlases is allowed; reusing identical identity or always the same visual combination is not the intended result. Foundation identity, personality and ownership cannot be reassigned to fit a render budget. This baseline does not claim a full autonomous dialogue, emotion or relationship simulation is implemented in Stage S002.

## Purposeful observable activity

Liveliness comes from residents using the places that exist: farmers work at their farm/fields, smiths at the forge, innkeepers at the inn, market/butcher staff at their service, guards at posts/patrol paths, and other residents travel, pause, rest or use public places when their schedule calls for it. Add appropriate visible work/idle/movement cues rather than declaring every NPC “Walking” on a perpetual shared loop. Connect activities to actual home/work/post IDs and legal entrances/roads; no roof/wall/water clipping or anonymous decorative replacement guards.

Schedules vary by NPC/role and use SEED + absolute Fantasy Game Time. Show meaningful home/work/rest and duty changes, with quieter periods when appropriate rather than every resident being busy at every hour. Different residents need not start the same activity or depart simultaneously. Guard coverage and staffed service ownership remain valid. Basic role activity is distinct from full economic transactions, crime, combat, dialogue and quest logic; do not claim those effects until implemented.

Revisiting at the same SEED and fantasy timestamp reconstructs the same activities and positions. A later timestamp may show the deterministic progression or recorded campaign changes; it must not reroll the villagers' identities or homes. Off-screen state uses the established interest/catch-up model. Bound visible actors, geometry and updates on phones without spawning or deleting logical residents because the camera moves. Ambient animation or later sound can support the scene, but cannot substitute for the required resident routines or change authoritative world data.

## Evidence and existing work packages

- Natural terrain/vegetation packages: inspect representative forest, desert, grassland, mountain, lake/river/coast and frozen-region scenes; variation is structural and region-consistent, not a uniform lattice or color swap.
- Settlement layout package: inspect at least three villages with materially different terrain-aware layouts/roles, while all mandatory facilities, owned-home capacity, borders/gates and connected roads remain present. Include city/castle housing comparisons where relevant.
- NPC home/work/duty package: inspect a varied group of named/code-identifiable residents with distinct appearance descriptors, owned homes and roles. At explicit morning/work/rest or duty timestamps, show residents using legal destinations and visibly changing activities. Same-input replay and changed-view/cache order must agree.
- Verify no duplicate identities/orphan homes, impossible activity destinations, synchronized clone routines, perpetual generic wandering or viewport-generated crowds. Record foundation descriptors and schedule states alongside fresh visual evidence.
- Follow the existing mixed-package screenshot/score rules during implementation and measure focused simulation/render budgets separately from real-phone performance. Planning documents have VISUAL: N/A.

Use WP-S002-004-001 for root reference/contracts, 004/005/006 for natural environments, 009 for diverse layouts, 011 for baseline NPC identity/appearance and purposeful home/work/guard routines, and 005-001 for budgets. Update these existing scopes rather than create a duplicate “lively world” package. Full story simulation and elaborate asset/animation systems remain separately scoped future work.
