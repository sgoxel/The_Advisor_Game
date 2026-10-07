# Seeded world-building priorities and terrain earthworks

Status: Stage S002 planning requirements, added by the owner on 2026-10-07. This document does not claim that these generation passes or terrain modifications are implemented in the current build.

## Canonical priority sequence

| Priority | Foundation layer | Purpose |
| --- | --- | --- |
| 0 | Oceans | Initial ocean/water domain and baseline. |
| 1 | Continents | Seeded major land envelopes and coasts within the ocean baseline. |
| 2 | Islands | Seeded island land envelopes and coasts. |
| 3 | Forests, deserts, grasslands and mountains | Natural biomes, vegetation eligibility, elevation, ridges and slopes within land envelopes. |
| 4 | Lakes and rivers | Seeded water bodies, drainage and river/lake beds. |
| 5 | Countries | Seeded political regions and affiliations; country ownership alone does not flatten its land. |
| 6 | Capital cities and big cities | Urban sites, residential/service areas and bounded settlement earthworks. |
| 7 | Villages | Village sites, required services, owned homes, plots, borders, gates and bounded living-area earthworks. |
| 8 | Roads | Connected routes, graded roadbeds, dirt foundations, shoulders and road surfaces. |
| 9 | Ruins and critical quest places | Seeded sites, reservations, access and local site preparation for ruins and important quest locations. |

Evaluate foundation plans in this 0 → 9 sequence. These priorities are separate from display-detail levels, view buckets and streaming queues. Later layers can locally override earlier natural terrain when their footprint requires it. They cannot depend on which tile was visited first or cause an unrelated continent, lake, country or settlement to vanish. Resolve same-priority overlaps by explicit compatible channels and deterministic canonical SEED-code ordering, not insertion order or locale-dependent sorting.

One canonical plan owns all layer identities, coordinates, footprints, heights and reserved uses. Use separate composition channels for terrain elevation, ground material, water/flow, vegetation exclusion, reserved use and walkability. Elevation and biome fields at priority 3 may coexist, such as a forest on a mountain slope; they are not mutually exclusive whole-world replacement passes. The foundation is Campaign-SEED-only. Later campaign construction/damage may create persisted simulation changes under SEED + Fantasy Game Time; it never silently rewrites initial generation.

## Road cuts and foundations

A road may make bounded hill/mountainside cuts and clear forest within its seeded corridor. The owner's refined alignment rule prefers the lowest feasible passes around mountain summits; it does not automatically excavate a direct trench through a high peak. Derive a connected centerline and graded near-flat longitudinal profile, then cut high ground and fill low ground within the accepted roadbed/shoulder footprint. Blend the outside edge into the remaining terrain; preserve visible cut slopes and retaining/bank treatment where required. Clear vegetation from the roadbed and shoulders, lay a dirt foundation, and place the road surface on top. This changes the authoritative terrain/material/walkability data as well as the visual mesh; lifting a floating road mesh above unchanged impassable terrain is insufficient.

Road placement and cut/fill volume are both part of deterministic planning. Research must set physical width, grade, excavation and falloff budgets. Routes follow terrain type, elevation and water positions: river crossings require connected bridges; lakes are routed around; hills allow modest grading; mountain routes seek low feasible passes with usable grades. Painting dirt across an ocean, lake or river is not a crossing. Preserve drainage, the practical bridge-length limit and minimum village walking time after grading. Validate the final road network, including critical-site access. Separate continents/islands connect through road-linked harbors and seeded ferry/ship edges, as selected by the owner. See [complete network rules](ROAD_NETWORK_PLAN.md).

## Houses and living-area pads

Village/city houses, services, courtyards, entrances and their required perimeter can cut mountainside terrain and clear trees to establish proper living areas. A seeded pad records its footprint, usable perimeter, target elevation, access height and edge transition. The building footprint and needed living area are level/usable; the surrounding slope transitions outside that area rather than protruding through the floor, fence or entrance. Farmland and public spaces can have appropriate prepared-ground reservations as well.

Edits are bounded to the seeded site and its transition buffer. A small house does not flatten an entire mountain or erase a neighboring house, service, gate or water body. Large settlements may use connected terraces rather than one huge flat disc. Sampling at any tile/LOD boundary uses the same final height, exclusion and walkability functions. Home identity and ownership remain independent of the tile that displays the pad.

## Reservations and conflict rules

The numeric order replaces the former global shorthand that put roads first and treated all terrain as final fill. Within a settlement subplan, reserve streets, public areas, gate access and external road connections before accepting individual building footprints. Village/city site plans at priorities 6/7 expose those reservations; roads at priority 8 follow the legal entry/gate and street connections. Later road grading cannot cut through an occupied house or wall; choose another deterministic alignment if a footprint conflicts. House entrances and road profiles must meet without height steps or inaccessible ledges.

Priority 9 ruins/critical quest sites can clear vegetation and prepare bounded terrain, but do not delete mandatory village services, owned homes, gates or the established walkable road network. Validate their sites and access against previous reservations and try another seeded candidate on a conflict. Existing ruins can occupy suitable terrain outside the inhabited core; full quest scripts, rewards and runtime story logic are separate work.

Ocean/land domains and hydrological constraints remain explicit parent constraints. A later house/road/site edit is not permission to silently reclaim open sea or dam an entire drainage basin. Continents and islands deliberately define land at their own phases; water crossings and any future major reclamation need their own defined infrastructure rules. Country borders are political data and remain valid above local road/pad material edits.

## Lazy evaluation and evidence

Store/query modifier plans by stable global spatial identity with their full support bounds, including falloff. A tile queries every intersecting modifier, including a modifier whose anchor belongs to a neighbor. Compose the same priority/channel/SEED-code order for any sampling order. Rendering samples that final authority, and collisions, vegetation and route costs use it too. Globe/coarse views represent the same features within their resolution limits; closer views must not generate a conflicting mountain through a canonical road cut or restore trees on a house pad. Wrap-line/pole handling and existing phone budgets apply to modifier queries and caches.

Acceptance checks: exact 0–9 semantic mapping; stable ordering under reversed tile/feature visits; a road cut through a mountain and forest with dirt foundation and usable shoulders; a village home and perimeter cut into a hillside with legal entrance access; no vegetation in reserved cleared areas; unchanged terrain outside modifier support; matching neighboring tile/LOD samples; legal water crossings; final route-time validation after cuts; no destruction of required services/homes/gates by roads or quest sites; bounded focused allocation and consistent WebGPU/WebGL2 presentation. Inspect fresh road-cut, hillside-home, gate-join and ruin/site screenshots before scoring future mixed work.

## Reference input and work packages

[Epic's Landscape Splines documentation](https://dev.epicgames.com/documentation/unreal-engine/landscape-splines?application_version=4.27) describes raising/lowering terrain and painting a layer along a spline, with controlled width and side falloff. The applicable pattern is a road centerline plus bounded elevation/material influence. It does not provide our seeded identities, priority rules or lazy world authority. This is reference input to WP-S002-004-001, not a completed analysis or a recommendation to change PlayCanvas.

The dedicated natural-world analysis defines composition and deformation contracts first. Existing terrain, vegetation, settlement and road packages consume them. WP-S002-004-012 implements the reusable priority compositor and seeded road/house earthworks; WP-S002-004-013 implements initial ruin/critical-quest-site reservations and visible locations. Each work package provides minimum missing contracts within its own scope and does not wait on another Issue. Keep these requirements aligned with [settlement housing rules](SETTLEMENT_PLAN.md) and the root game design.
