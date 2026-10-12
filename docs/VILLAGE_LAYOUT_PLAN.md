# Stage S004 Village Morphology & Placement Contract

Status: binding planning requirements for WP-S004-001-001. This document defines how villages obtain realistic structural variety while remaining fully deterministic. It does not claim the runtime already implements these rules.

## Authority and deterministic variation

Village layout is a Campaign-SEED foundation. **SEED remains the only authority deciding what exists and what variant is chosen.** Canonical world coordinates, settlement identity, feature role and candidate ordinal are stable addressing inputs to the SEED derivation; they are never independent randomness sources.

Every layout choice must come from a stable keyed derivation equivalent to:

`SEED + generatorVersion + settlementId + canonicalCoordinate + featureRole + candidateOrdinal`

Examples of `featureRole` are `village-center`, `main-road`, `residential-lane`, `house-plot`, `garden`, `orchard`, `farm-field`, `roadside-tree`, `shop`, `mayor-residence`, `guard-station`, `butcher`, `blacksmith`, `farmstead`, `pavement`, `gate` and `wall-segment`.

No runtime random-number API, frame time, camera state, loading order, worker order, renderer, device or LOD may decide village layout. Coordinates are quantized in the canonical planet/local settlement coordinate system before hashing so identical inputs reproduce identical results across devices. Later authoritative construction/destruction or ownership changes are persisted campaign events using SEED + Fantasy Game Time; streaming never changes the foundation.

The goal is **random-looking natural variety without nondeterminism**. Different villages and different coordinates inside one village should produce visibly different but logically valid outcomes.

## Village structure before buildings

Do not place houses first and then thread roads through them. Generate the settlement structure in this order inside the Stage S004 settlement plan:

1. legal settlement envelope, enclosure reserve and canonical gates;
2. village center / public space;
3. main road and external-road gate connections;
4. secondary/residential roads and lanes;
5. pavement/footpath/public-edge space;
6. service/special-building zones and farm access;
7. residential plots, gardens/yards and agricultural plots;
8. buildings and entrances;
9. roadside trees, props and other bounded detail.

All later placements must respect earlier reserved corridors and footprints.

## Village center and public-space variety

Every inhabited village has a recognizable center, but it must not always be the same square. The SEED may produce, where terrain permits:

- a green/common;
- a widened main-road market center;
- a crossroads center;
- an irregular plaza around a well/fountain/water point;
- a civic/service cluster;
- a river/coast-facing public space where legal;
- a terraced or split center on sloped terrain.

The center must provide usable pedestrian/public space and connect to the main road, services and residential lanes. It cannot be filled wall-to-wall with buildings.

## Road hierarchy inside villages

Village roads must have distinct canonical classes and functions:

- **Main road:** primary external-through route, gate-to-center route or strongest internal spine. It has the greatest local width/clearance and persistent visual identity.
- **Secondary road:** connects important service clusters, gates, farms or village sectors to the main road.
- **Residential/accommodation lane:** lower-speed access serving groups of homes, gardens and small yards; it may curve, narrow and branch naturally within legal traversal limits.
- **Service/farm lane:** reaches farmsteads, barns, workshops, fields and other work areas.
- **Pedestrian path/pavement:** walkable edge or connector that is visually and geometrically distinct from the vehicle/cart roadway where used.

Road geometry follows terrain and canonical external-network junctions. Avoid repeated parallel streets, square grids and equal-spacing patterns unless the SEED and geography genuinely produce such a rare planned settlement.

## Building-road clearance and setbacks

A building may **never sit on, intersect or visually consume a road corridor**. Road reservation includes the traveled surface plus its canonical shoulder/drainage/clearance support.

Every building plot has a SEED-derived, role-valid setback from its serving road. Setbacks vary within legal ranges instead of placing every facade at the same distance. Buildings may sit closer to a village-center street and farther back on residential/farm lanes when their archetype permits, but all placements must preserve:

- road surface and shoulder clearance;
- drainage and earthwork support;
- pedestrian access/pavement where required;
- a valid entrance path from road or pavement to the building door;
- turning/work-yard space for buildings that need it;
- separation from neighboring footprints, walls, water and reserved vegetation.

Building orientation is derived from road frontage, terrain and SEED identity. Houses should usually address their access lane/frontage but may rotate, offset or stagger naturally. Repeated identical angle/offset rows fail acceptance.

## Residential plots, gardens and yards

Homes are placed on explicit plots rather than as isolated boxes. Residential plots may contain deterministic combinations of:

- front or rear gardens;
- fenced kitchen gardens;
- small yards/courtyards;
- sheds or low-cost auxiliary structures where the archetype permits;
- wells/water access only where canonical service rules allow;
- footpaths from lane/pavement to entrance;
- sparse trees or hedges that do not block access or roads.

Plot dimensions, frontage width, depth, building offset and garden position vary from SEED + canonical coordinate while satisfying capacity and non-overlap contracts. Not every home needs the same garden, fence or yard pattern.

## Pavements and pedestrian areas

Village centers, main roads and denser service/frontage areas may include paved/packed pedestrian edges, stepping zones, small forecourts or sidewalks where context permits. Pavement is real walkable geometry/material and must not be only a texture painted underneath a building.

Pedestrian areas must connect public-space anchors and entrances without forcing NPCs or the protagonist to walk through houses, walls, gardens or the main roadway when a pavement/path exists. Rural lanes may use simpler packed-earth verges instead of urban-style pavement; SEED/context decides the valid treatment.

## Agriculture and farming variety

A farming village must not be represented by one repeated rectangular field. Agricultural land may include deterministic mixtures of:

- crop fields with varied legal size/shape/orientation;
- pasture/grazing areas;
- orchards/tree rows;
- vegetable plots;
- hay/storage yards;
- barns and farm sheds;
- paddocks/animal enclosures;
- farm tracks linking fields to farmsteads and the road network.

Agricultural geometry follows terrain, water, enclosure/gates and road access. Fields may lie outside the village enclosure and remain reachable through legal gates/access lanes. Farm parcels must vary across villages and must not form a universal square grid.

## Roadside trees and vegetation

Important village main roads should support SEED-derived roadside vegetation where climate/biome, visibility, drainage, wall/gate geometry and safety permit it. Tree placement is **not** a perfectly periodic avenue unless that rare pattern is explicitly selected by the SEED for a more formal settlement.

Use bounded irregular spacing, occasional gaps, side switching, clusters and species/material choices derived from SEED + canonical coordinates. Trees must remain outside road/shoulder/pavement clearance, gate sight/access space, building entrances, bridge approaches and required drainage. Vegetation rendering should use existing reusable/instanced assets and bounded detail.

## Special and service buildings

Villages must contain functionally placed special buildings in addition to ordinary houses. Existing required services remain binding: inn, market, blacksmith, farmstead, butcher, guard office/posts, water point/public center and sufficient homes. Stage S004 additionally treats the following as explicit village-layout roles when supported by settlement scale/governance:

- shops / merchant buildings;
- mayor/headman residence or mayor's villa/manor;
- police/constabulary equivalent appropriate to the medieval-fantasy setting, represented by the canonical guard/watch station rather than a modern disconnected prop;
- butcher;
- blacksmith;
- farmer/farmstead and agricultural support buildings;
- inn/accommodation service;
- market/stalls and other SEED-selected local services consistent with the village role.

Placement must be logical but not template-fixed. For example, shops and market services often favor center/main-road frontage; the mayor/headman residence may favor a prominent accessible plot; guard/watch functions favor a gate, center or strategic road junction; blacksmith/farm work requires usable work-yard and access space; farmsteads favor agricultural access. These are weighted legal preferences evaluated deterministically by SEED-addressed candidate scoring, not hard-coded identical coordinates.

Every service building has a stable identity, footprint, entrance, role, serving road/path and capacity. Labels alone do not satisfy the requirement.

## Structural village archetypes and local variation

The SEED may select or blend structural tendencies such as:

- linear road village;
- crossroads village;
- clustered village around a common;
- river/coastal village;
- hillside/terraced village;
- farming-focused dispersed village;
- fortified/frontier village;
- market/trade-route village.

Archetypes are constraints/tendencies, not fixed blueprints. Terrain, enclosure, roads and service demand reshape them. Two villages of the same broad archetype must still differ materially in center geometry, roads, plot sizes, house positions, gardens, field pattern, service placement and roadside vegetation.

## Candidate placement and rejection rules

For each plot/building/field/tree feature, generate bounded SEED-addressed candidates and score only legal candidates against canonical geometry. Reject candidates that intersect or violate:

- road traveled surface, shoulder or reserved road support;
- another building/plot's protected footprint;
- village enclosure/gate clearance;
- active river/lake/wet footprint;
- authoritative drainage;
- cliff or unwalkable final terrain without an explicitly legal earthwork;
- required pavement/path or entrance corridor;
- public-center reserve;
- required garden/work-yard/service-space contract;
- bridge/harbor/border access support.

If no legal candidate exists inside the initial local envelope, deterministically expand/replan within the settlement's allowed envelope rather than overlapping a road or silently deleting a required building.

## Performance and rendering

The full logical plan may exist as compact canonical records, but detailed meshes/props remain focus-bounded. Reuse/instance houses, wall pieces, fences, trees, pavement modules and farm props where possible. Variation should come primarily from deterministic composition, transform, modular combinations and bounded material families rather than unique heavy meshes for every plot.

Country/Province views do not instantiate every garden, pavement stone, tree or crop. Village/Street views progressively materialize the same canonical identities without changing layout.

## Acceptance evidence

WP-S004-001-001 cannot pass unless fresh inspected evidence demonstrates all of the following:

- at least three villages with materially different road/center/plot structure, not the same layout with rotated buildings;
- no building footprint intersects a road, shoulder, pavement or required road-support corridor;
- visibly varied house setback, orientation, grouping and plot depth;
- recognizable village center and main road;
- residential/accommodation lanes and pedestrian/pavement areas where appropriate;
- gardens/yards associated with homes;
- multiple agricultural parcel types/shapes and farm-access lanes;
- SEED-derived roadside trees along representative main-road sections without blocking traversal or gates;
- visibly/functionally distinct shop/market, mayor/headman residence where generated, guard/watch station, butcher, blacksmith and farmstead roles;
- stable canonical IDs and identical layout fingerprints after reload, reversed visit order, cache eviction, LOD change, WebGPU/WebGL2 and worker-order changes;
- a different Campaign SEED produces materially different village morphology while still satisfying every structural/access rule.

Automated tests must enumerate the actual generated villages, validate road/building clearance and required-role reachability, and assert deterministic reconstruction from the same SEED + canonical coordinates. Visual acceptance remains MIXED-WP evidence and must score at least 8/10 under the project evaluation rules.
