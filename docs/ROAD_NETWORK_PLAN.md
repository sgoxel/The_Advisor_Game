# Connected seeded roads — Stage S002 requirements

Status: planning requirements from the owner on 2026-10-07. No road-network implementation is claimed here. These rules refine [world-building priorities and earthworks](WORLD_BUILDING_PRIORITY.md) and [settlement access and housing](SETTLEMENT_PLAN.md).

## Network ownership and required destinations

One canonical SEED-owned road graph connects every village, capital/big city, ruin, critical structure and critical area entrance on a connected landmass. Countries participate through their capitals/regional routes and legal land-border connections, not an arbitrary road to the center of a country polygon. Connect through settlement gates and streets to services and home entrances. Every road bridge is part of that graph, with both bank approaches and its usable deck joined to real roads. A line drawn near a site or a decorative unconnected bridge is insufficient.

Connectivity means a traversable path between required destinations; it does not require a separate direct road between every pair. Plan a regional/country backbone with appropriate branches, junctions and local access roads. Critical-site branches must attach to that backbone rather than form isolated networks. Retain world counts and minimum village walking time on legal walking routes. Sea-link travel duration is a separate transport cost and must not be misreported as walking time.

The owner selected **roads on land, linked by ferries or ships** for separate continents/islands. The global transport graph must connect all required destinations through road-connected harbors/landings and seeded ferry/ship links. Land road edges and maritime transport edges remain explicitly different; do not draw asphalt across the ocean or invent enormous bridges. Each sea link has canonical endpoint ports, water-route identity, geometry and cost/settings derived from SEED. Harbors have legal road access and usable land/water transfer points; no disconnected dock node. Full vessel AI, fleet management and live timetables are separate gameplay work. The existing 120 m rural bridge limit remains in force for road bridges.

## Terrain-aligned route selection

- **Rivers:** every road crossing a river requires a real seeded bridge with suitable dry/stable bank anchors, deck clearance, correct span and connected approaches. Prefer a valid narrow crossing when the direct one violates the practical bridge limit. Preserve river flow. Small culverts may support explicitly permitted drainage channels, but do not silently substitute them for the owner's required river bridge.
- **Lakes:** route around the lake on usable shoreline/land, with legal clearance from water. Do not fill the lake, paint a dirt road over it or use a road bridge across it as the default shortcut.
- **Hills:** allow bounded cut/fill to establish a smooth, near-flat usable roadbed and dirt foundation; join heights with usable grades rather than discontinuous flat steps.
- **Mountains:** route around the summit using the lowest feasible pass, saddle or contour corridor within the route's relevant region. Consider elevation, ascent/descent, grade, length, substrate and earthwork cost. Do not interpret “lowest” as a planet-wide search for sea level or always excavate a direct trench through the highest peak. Modest cuts into a chosen slope/pass remain permitted; summit avoidance is the preferred alignment.
- **Forests and other land types:** account for substrate/access cost, then clear the accepted corridor and shoulders without restoring trees during refinement. Keep natural surroundings outside the modifier support.

Canonical research contracts must fix physical road widths, longitudinal/cross grades, curvature, earthwork and bridge budgets, path-search bounds and SEED-defined costs. The route planner uses geographic facts and explicit stable tie-breaking, not a camera-dependent path search. Select a physically plausible low route while retaining practical length/access constraints; every walkable destination must have a valid route before its plan is accepted. If a required destination itself is high, use a legal graded/switchback approach for the necessary ascent; avoiding unnecessary summits must not omit that destination.

## Geometry, junctions and definitive settings

Each accepted road has a canonical SEED code, endpoints, parent network/region, ordered planet-space centerline, station heights/graded profile, width, surface/dirt materials, shoulder and falloff bounds, vegetation exclusions, crossings, junctions, walkability and cost. Bridge records include their own code, river/crossing reference, bank anchors, approach profiles and deck geometry. Features and positions retain the same definition under every render level.

Connected roads share a canonical junction coordinate and compatible elevation/profile. Snap and join them using the same authority; do not allow gaps, abrupt height steps, competing cut profiles, mismatched widths or duplicated intersection ownership at tile boundaries. A screen-space intersection does not create a graph connection when two decks are at different heights; any intended overpass needs explicit separate traversal connections.

Build final elevation/material/walkability from the shared modifiers. Road meshes must follow the graded terrain, and bridge decks use their explicit crossing geometry. The path followed by NPCs and players is the one displayed. Test connectivity on final composed terrain after cuts/fills, pads, bridge approaches and critical-site access, not on the initial unmodified hill/forest surface.

Priority 9 sites may declare deterministic access-road intents to the priority 8 backbone. The completed plan resolves these intents into canonical road/spur records before any affected tile is materialized; road modifiers still compose at priority 8 and site preparation at priority 9. Do not create a new branch opportunistically when the player first discovers a ruin. Preserve existing home/service/gate reservations and choose legal alternatives on conflicts.

## Determinism and lazy reconstruction

Generate the foundation graph and route recipes from Campaign SEED and canonical geographic identities only. Fixed road settings do not depend on fantasy time, viewport, interest, tile size, LOD, hardware, frame timing, worker completion or visit order. Regional detailed paths may be computed/cached lazily, but their endpoints, crossing/route choices, heights and features must reproduce exactly from those same inputs. Tie-breaking and numerical quantization must be defined independently of device/locale and render-mesh resolution.

Keep lightweight topology/required-node coverage available for validating connectivity without eagerly creating all road meshes or fine terrain. Query complete modifier support across neighboring regions/tiles, wrap boundaries and caches. Revisit an unchanged location after unloading or exploring elsewhere: same road code, alignment, grade, bank/deck heights, material, junctions, terrain and vegetation clearances. Legitimate later campaign road damage/construction requires separately persisted simulation events; streaming never invents a foundation change.

If a mandatory destination has no legal connector, deterministically try another route/crossing or an allowed site candidate within fixed budgets. If the constraints cannot be satisfied, report generation failure explicitly rather than accepting an orphan destination, invalid bridge or hidden blocked road.

## Acceptance evidence and work boundaries

- Enumerate required destination nodes and verify traversable coverage of every country, settlement, ruin, critical structure/area and bridge in each land-connected network, and global graph reachability through road-connected harbors and legal ferry/ship links between landmasses.
- Prove that each river crossing has a legal connected bridge, lake routes stay on land, hill sections have usable graded roadbeds, and representative mountain routes choose a low feasible pass around the summit.
- Check endpoints, junction coordinates/profiles, bridge banks/decks, terrain support and final walkability for gaps, incompatible heights and collisions. Preserve home/service/gate access and village minimum walking times.
- Compare canonical road/bridge settings, grades and features after direct regeneration, reversed region/tile visits, cache eviction and changed LOD/worker order. Do not compare only screenshots or approximate visual resemblance.
- Inspect fresh overview and close images of a multi-settlement/critical-site network, river bridge approaches, lake detour, hill grading and mountain-pass route on both renderer paths. Record measured software budgets separately from physical device performance.

The dedicated reference/contract analysis remains WP-S002-004-001. WP-S002-004-014 owns required-node network topology, terrain-aware alignments, shared junctions and connected crossings. WP-S002-004-008 owns final village route costs/minimum time and travel presentation. WP-S002-004-012 owns reusable earthwork composition and profiles; WP-S002-004-013 owns critical-site reservations and access intents. Each package implements minimum missing contracts within its own scope and does not wait on another Issue.
