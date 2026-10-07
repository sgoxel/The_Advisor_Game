# Binding Stage S002 world requirements

The owner reaffirmed these rules on 2026-10-07. They are planning requirements for the natural-world/scale packages, not a claim that the current globe already meets every rule. They preserve the existing 3 continents, 30 countries, 90 cities and 270 villages, and the [0–9 foundation priorities](WORLD_BUILDING_PRIORITY.md).

## Minimum village walking time

Every pair of distinct village centers must require **at least 60 fantasy-world minutes (3,600 fantasy seconds)** along the shortest legal walking route. It is a minimum, not an exact fixed duration and not a real-world hour. Mountains, cliffs, rivers, lakes, steep ground and other environmental features can make the shortest feasible walk longer.

The existing Stage S002 normal-road walking model uses 3.6 km per fantasy hour (1 meter per fantasy second), and open-ground walking uses 3.0 km per fantasy hour, with difficult terrain slower. A 3.6 km minimum geodesic separation is a sufficient lower bound under that fastest normal walking speed; it is not a substitute for final terrain-aware route costs where a proof is unavailable. Use canonical planet-space meters, including wrap-aware distances, never screen pixels or render-tile counts.

At the established 24× clock, 60 fantasy minutes corresponds to 2.5 real minutes at normal game speed. Do not retain the original atlas's 420 m / five-real-minute placement as the new requirement. Ships, ferries and other transport have separate costs and are not walking routes.

Check all village pairs, not only neighbors or a preferred displayed road. Include legal off-road shortcuts, final road cuts, house/living-area pads, bridges, junctions and critical-site access that may shorten walking time. Validate the composed walkable world after infrastructure planning; choose another deterministic site/route if a candidate breaks the minimum. Longer routes must remain longer in the travel display, never clamped to exactly 60 minutes.

## One planet foundation for all levels

The Realm sphere and every closer level sample the same canonical Campaign-SEED-generated geography and environment in the same planet-space locations. Parent levels define the major land/water domains, mountains, climate/biome regions and fixed feature identities; children refine them rather than independently invent a different world.

Large features must be recognizable in Realm view: mountain ranges/highlands, deserts, forests, lakes, seas and frozen regions at both north and south poles. Their positions, extent and environmental meaning also constrain Province/Country/Village/Street samples, vegetation, height, water and walkability. A globe-only paint map or unrelated local terrain cannot satisfy this requirement. Small details may be omitted at coarse resolution, but major features must not move, disappear logically or turn into contradictory biomes when zooming.

Globe and local views also summarize/sample the same final authorized road/settlement/site modifiers at their available resolution. Canonical road cuts and pads never heal or regain obstructing trees solely because a tile is unloaded or detail changes. The [road network](ROAD_NETWORK_PLAN.md) and [home/settlement plan](SETTLEMENT_PLAN.md) remain binding.

## Natural appearance, deterministic generation

The SEED determines continent locations and orientations, coastline/land shapes, island locations/shapes, mountains, climate/biomes, rivers/lakes, vegetation and settlement geography. Include multiple islands, not just the three main continents. Continents must not remain at fixed hand-authored positions or offsets; different seeds may change the geography while repeated use of the same seed reproduces it exactly.

Terrain must look irregular, diverse and natural: varied ridges/valleys/coasts, irregular climate boundaries, winding drainage and non-lattice vegetation/sites. Logical cells or spatial indices may address data, but must not force landforms, continents, islands or objects onto fixed cell centers or repeated grids. Internal deterministic sampling/interpolation is permitted; visible lattice/stripe/block patterns are not the intended result.

No real randomness or entropy is permitted: no Math.random, cryptographic randomness, unseeded generator or device/wall-clock inputs for foundations. Foundation settings do not depend on fantasy time, camera, viewport, LOD, cache, worker order or which place was visited first. Use stable SEED-derived identities and numeric rules; geometry/material/navigation queries share those records.

## Acceptance and existing packages

- WP-S002-004-002 / 007 / 008: demonstrate all-pair village minimum-time proofs or route checks, terrain-caused longer walks, correct fantasy/real units and revalidation after infrastructure modifications. Preserve world counts and normal walking-speed contracts.
- WP-S002-004-003: prove that continent locations/shapes and multiple islands are SEED-derived, not fixed coordinate templates; same seed/reordered queries are identical and representative different seeds produce differing geography.
- WP-S002-004-004 / 005 / 006: compare the same coordinates across Realm and local levels for all major terrain/environment classes, including both frozen poles, mountain ranges, desert, forest, lake and sea; verify natural-looking shapes/scatter without visible grids.
- WP-S002-004-001: define the root contracts, deterministic natural-placement methods, climate/hydrology inheritance and route-time validation approach through dedicated reference analysis. This reaffirmation does not mark the analysis complete.
- Existing performance/continuity packages: keep lazy generation bounded and cross-level/wrap/tile sampling consistent; rendering budgets cannot change geography or walking time. Inspect fresh Realm/local screenshots during future implementation; do not assign a visual score to this planning document.

All affected implementation Issues remain open until their own work, evidence and final deployment are complete. This planning update creates no duplicate work packages.
