# Connected seeded roads — Stage S005 requirements

Status: owner planning requirements, updated 2026-10-12. No road-network implementation is claimed here. These rules refine [world-building priorities and earthworks](WORLD_BUILDING_PRIORITY.md), [settlement access and housing](SETTLEMENT_PLAN.md), and the canonical world rules in `docs/README.md`.

## Network ownership and required destinations

One canonical Campaign-SEED-owned transport graph connects every village, city, Capital City, castle, ruin, critical structure and critical-area entrance. Countries participate through real settlement/capital routes and legal border crossings, not arbitrary links to polygon centers.

Every village, city and castle in the same country must belong to the country's canonical road network. On the same connected landmass this connectivity must be represented by actual visible road geometry, not only an abstract graph edge. Country/Province views must reveal the important inter-settlement road structure; Village/Street views refine that same road identity and geometry rather than replacing it with unrelated local roads.

Visible continuity is mandatory. Roads join settlement gates, city/castle entrances, streets, junctions, bridges and border crossings without unexplained gaps, floating or buried segments, screen-only intersections or graph-only connections. The path used by routing, NPCs and the player is the road/profile authority that is rendered.

Connectivity does not require one direct road between every possible pair. Build a hierarchical network of main roads, regional roads, settlement branches and local streets. However, every required settlement endpoint must reach that network legally and visibly. Critical-site branches attach to the same backbone rather than forming isolated decorative networks.

If same-country destinations occupy separate islands or disconnected landmasses, each land component must have visible road continuity from its settlements/castles to a legal harbor or landing. The gap is an explicitly typed ferry/ship edge. Never draw a fake road over open sea merely to satisfy graph connectivity.

## Mandatory neighboring-country Capital City main roads

Every country must have at least one canonical international **main-road** connection from its Capital City to the Capital City of a nearby land-neighbor country.

- Prefer a country sharing a land border. Choose the nearby foreign capital and border crossing by deterministic SEED-owned geographic/route cost with stable tie-breaking.
- The main road must be a real continuous route from the first capital's road network, through an explicit canonical border crossing, into the neighboring country's road network and to its Capital City.
- A graph edge from country node to country node, a road that stops at the border, two roads that almost meet, or a decorative line on the atlas does not satisfy the rule.
- More than one international capital road is allowed and expected where geography and the SEED justify it. The minimum is at least one per country.
- International main roads must be visually distinguishable from ordinary settlement streets/access spurs through the canonical road-class contract such as width, surface treatment, shoulders and hierarchy, while remaining compatible with terrain and mobile rendering budgets.
- Border crossings are world facts with stable canonical identity, road/junction coordinates, terrain profile and country-side ownership semantics. Changed LOD, renderer, visit order or streaming cannot move or replace them.

If a country has no land-border neighbor because it is isolated on an island/landmass, preserve the no-fake-ocean-road rule. Its capital must connect by visible main road to a harbor; a canonical ferry/ship edge crosses the water; the receiving harbor connects by visible main road to a nearby foreign Capital City. Validation records this as an explicit maritime exception rather than silently treating the capitals as road-connected across water.

The overall country adjacency/main-road design should avoid unnecessary isolated countries. Where the generated country partition allows legal land adjacency, use land capital links rather than routing ordinary neighboring-country traffic through maritime transport.

## Maritime connectivity

The owner selected **roads on land, linked by ferries or ships** for separate continents/islands. The global transport graph connects all required destinations through road-connected harbors/landings and seeded ferry/ship links. Land-road and maritime edges remain explicitly different.

Each sea link has canonical endpoint ports, water-route identity, geometry and transport cost/settings derived from SEED. Harbors have legal road access and usable land/water transfer points. No disconnected dock node is acceptable. Full vessel AI, fleet management and live timetables remain separate gameplay work.

## Terrain-aligned route selection

- **Rivers:** every road crossing a river requires a real seeded bridge with suitable dry/stable bank anchors, deck clearance, correct span and connected approaches. Prefer a valid narrow crossing when the direct one violates the practical bridge limit. Preserve river flow. Small culverts may support explicitly permitted drainage channels, but do not silently substitute them for required river bridges.
- **Lakes:** route around the lake on usable shoreline/land. Do not fill the lake, paint a road across it or use an invented long bridge as the default shortcut.
- **Hills:** allow bounded cut/fill to establish a smooth usable roadbed and dirt/foundation layer; join heights with usable grades rather than discontinuous flat steps.
- **Mountains:** route around summits using the lowest feasible pass, saddle or contour corridor inside the relevant route search. Consider elevation, ascent/descent, grade, length, substrate and earthwork cost. Modest cuts into accepted slopes/passes remain permitted; direct summit trenches are not the default.
- **Forests and other land types:** account for substrate/access cost, then clear only the accepted corridor and shoulders. Refinement may not restore trees inside the authoritative road support.
- **Borders:** choose physically legal border crossings. A capital main road may not jump an impassable cliff, river, lake or wall simply because the two countries touch in political topology.

Canonical contracts fix road-class widths, longitudinal/cross grades, curvature, earthwork and bridge budgets, search bounds and SEED-defined costs. The planner uses canonical geography and stable tie-breaking, never camera-dependent search or runtime RNG.

Every walkable required destination must have a valid route before its transport plan is accepted. High castles/sites may use legal graded or switchback approaches. Terrain difficulty can lengthen a route; it cannot justify silently omitting a required road endpoint.

## Geometry, hierarchy, junctions and definitive settings

Each accepted road has a canonical SEED code, road class, endpoints, parent network/region, ordered planet-space centerline, station heights/graded profile, width, surface/foundation materials, shoulders/falloff, vegetation exclusions, crossings, junctions, walkability and cost. Bridge and border-crossing records have their own stable identities and geometry.

Recommended hierarchy semantics are:

- **Main road:** capital-to-capital, major city/castle or major regional backbone route; highest persistent visibility and strongest road form.
- **Regional road:** connects cities, castles and groups of villages into the main backbone.
- **Settlement/access road:** connects individual villages, services, gates, harbors, ruins and critical sites.
- **Local street/path:** internal settlement circulation that joins the external road at explicit gates/entrances.

Road hierarchy changes presentation detail and routing semantics but never identity. A main road visible in Country view resolves to the same canonical road in closer views.

Connected roads share canonical junction coordinates and compatible profiles. Snap and join through the same authority; do not allow gaps, abrupt height steps, mismatched widths or duplicated intersection ownership at tile boundaries. A screen-space crossing does not create a graph connection when decks are separated vertically.

Build final elevation/material/walkability from the shared final-surface authority. Road meshes follow graded terrain; bridge decks and border-crossing surfaces use their explicit geometry. Routing and collision consume the same result.

Priority-9 sites may declare deterministic access-road intents to the priority-8 backbone. Resolve those intents into canonical road/spur records before affected tiles are materialized. Discovery may not opportunistically invent a new route.

## Determinism and lazy reconstruction

Generate topology and route recipes from Campaign SEED, generator version and canonical geographic identities. Fixed roads, capital-link selection and border crossings do not depend on Fantasy Game Time, viewport, interest, tile size, LOD, device, renderer, frame timing, worker completion or visit order.

Detailed regional road geometry may be computed/cached lazily, but road endpoints, classes, crossing choices, profiles and IDs reconstruct exactly. Keep lightweight topology and required-node coverage available for connectivity validation without eagerly materializing every road mesh.

A remote road can exist canonically without being rendered. When it becomes visible, the generated mesh must match the already-defined route. Visibility is a scheduling/presentation input, never a road-selection input.

If a mandatory destination or capital link has no legal connector, deterministically try another route, crossing or legal candidate within fixed budgets. If constraints truly cannot be satisfied, report generation failure explicitly instead of accepting an orphan settlement, missing international link or invalid road.

## Acceptance evidence

Functional acceptance must include:

- Enumerate every generated country and every village, city and castle. Assert that each same-country endpoint belongs to the canonical road network and is reachable on legal final terrain.
- Assert each required same-landmass connection can materialize continuous visible road geometry using the same canonical road records used by routing/collision.
- Enumerate every country and assert at least one qualifying nearby foreign Capital City connection: a continuous border-crossing main road for land neighbors, or the explicit capital-road → harbor → ferry/ship → harbor → capital-road exception for isolated countries.
- Verify international main roads cross an actual shared border through a canonical crossing and continue to both capitals; no abstract polygon-center or border-edge-only links.
- Verify every river crossing has a legal connected bridge, lake routes remain on land, hills use graded roadbeds and representative mountain routes use feasible passes.
- Verify endpoint, junction, bridge, harbor and border-crossing profiles for gaps, incompatible heights, collisions and false intersections.
- Preserve settlement gates, homes/services, drainage and the world minimum village walking-time rules.
- Compare canonical road identities, road classes, capital-neighbor selection, border crossings, geometry and route digests after reversed generation/visit order, cache eviction, changed LOD/worker order and WebGPU/WebGL2 presentation.

Visual acceptance for this MIXED package must include fresh actually inspected screenshots showing:

- a Country/Province view where roads are visibly readable between representative villages, cities and a castle in one country;
- a closer view proving those roads actually enter the appropriate settlements/castle through legal gates/entrances;
- a main road visibly crossing a country border and continuing between two Capital Cities;
- representative bridge, lake-detour, hill-grade and mountain-pass sections;
- road-linked harbors and a visibly distinct maritime link where required.

A visual score may be assigned only from the actual screenshots and must meet the project threshold with no obvious broken roads, gaps, floating segments, unreadable network hierarchy or misleading fake connections.

## Work ownership

- **WP-S005-001-001** owns the required destination topology, visible same-country village/city/castle roads, international neighboring-capital main roads, terrain-aware route alignments, shared junctions, bridges, border crossings, harbors/ferries and connected road materialization.
- **WP-S003-001-001** owns reusable final-surface composition and road/settlement modifier truth.
- **WP-S004-001-001** owns settlement/building exteriors, gates, entrances and local settlement access geometry that must join the transport network.
- **WP-S004-002-001** owns ruin/critical-site reservations and access intents.
- **WP-S003-002-001** owns shared invisible-world continuity/query machinery used to reconstruct remote road facts consistently.
- Final routing/travel semantic conformance is checked by **WP-S009-004-001** where README/runtime claims are audited.

These ownership boundaries are not blocking dependencies. Each WP implements any minimum local adapter it needs and must not wait on another Issue to become claimable.
