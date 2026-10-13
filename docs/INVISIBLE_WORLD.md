# Invisible-world continuity — WP-S003-002-001

## Refreshed reference and source audit (2026-10-13)

[Epic World Partition](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine) separates persistent world structure from cells loaded by explicit interest sources. References can accidentally pull in dependency bundles: this adapter therefore forbids recursive neighbor evaluation. [Red Blob's graph explanation](https://www.redblobgames.com/pathfinding/a-star/introduction.html) separates traversable connectivity from visual grids. Matching random ports cannot establish connectivity: existing seeded destination/road records remain the compact topology, and final surface validation remains authoritative.

Existing macro/political registries are permitted coarse startup work. `world.ts` already indexes road support, caches 4,096 final point evaluations, and evaluates roads, pads, sites and water through one final composer. `geometry.ts` materializes only requested render patches; workers have 4/6/8 outstanding-job ceilings. `village-routes.ts` explicitly refines an on-demand corridor against that same final surface; it does not create remote scenery. This WP adds canonical shared boundaries and finite query continuations around these consumers rather than introducing a competing terrain or road generator.

## Contract fixed before implementation

Logical regions use cube-sphere level 7 independently of render LOD. Boundary identity is the sorted pair of exact integer cube vertices; equal cube-face edges therefore share an identity without neighbor generation. Vertex ties are single-owner; no per-side jitter or post-load averaging. Recipe encodings use JSON arrays of SEED, version, domain and address, avoiding delimiter ambiguity. Coordinates quantize to 1e-10 rad; profiles/widths to 1 cm. World-facing samples normalize wrap and poles first.

A query holds at most 81 canonical sample positions and four boundaries for one logical region. Each continuation evaluates at most eight points by default (hard maximum 81); budget exhaustion returns the next cursor, never another candidate. No dependencies are recursively requested. Persisted revision is part of evaluation cache keys; presentation eviction cannot remove campaign state. The query owns at most 32 cached region results and 256 shared port records, with conservative byte accounting; all additional bytes count against existing CPU ceilings. Requests exceeding these limits fail explicitly rather than silently dropping required samples.

Road boundary records reconstruct intersections of the existing compact centerline recipe with the canonical edge, with fixed finite bracketing and bisection. They retain road identity, width, tangent and the final composed height/material/water/traversal. A blocked crossing is recorded as an authoritative validation failure, never presented as legal or moved by only one side. Existing legal bridge and route-repair policies own repairs; a SEED-selected random midpoint must not replace a terrain-valid destination corridor. A crossing away from the midpoint is expected because the road topology determines its station.

The opt-in diagnostic view is developer inspection, outside ordinary gameplay controls. It shows actual region boundaries, port identities/status and stream counters. Remote recipe inspection may evaluate final terrain but must leave visual job counts unchanged. Rivers consume the edge schema with basin/outlet identity; vegetation consumes fixed slots and full exclusion support; buildings/residents keep semantic ownership and persisted events outside rebuildable detail. This foundation does not implement those complete subsystems.

## Runtime implementation and finite limits

`continuity.ts` defines the pure address/query contract; `continuity-runtime.ts` binds it to the same `world.finalSurfaceAt()` used by traversal, rendering and inspection. Renderer patches register their logical region once; each rendered sample forwards directly to the existing composer. Inspecting an edge does not prepare its neighboring mesh. Outer query records, sample positions, completed surface snapshots and port records are immutable. A changed persisted revision constructs a service bound to the corresponding immutable campaign snapshot; cache eviction cannot change that snapshot.

| Operation | Maximum and failure behavior |
| --- | --- |
| Terrain query | 81 positions, 8 evaluations per default continuation, hard quota 81; four outstanding queries; oversized/full requests fail explicitly and can retry the same recipe |
| Logical detail cache | 32 region entries, 128 evaluated edges, 256 port records; oldest rebuildable entries evicted |
| Road boundary evaluation | Four edges per region; compact registry scan reported separately; at most 33 segments per road, 16 intersection brackets and 48 bisections; 32 ports per edge, three final samples per port |
| Terrain dependencies | Existing composer and support index; one-source-unit slope halo, no recursive neighbor generation; at most 20 base-coordinate reads for five composed samples including road endpoint and settlement-anchor support |
| Obstacle candidate search | Six lakes, 16 existing destinations per lake, 120 destination pairs, 16 alternatives, 34 coarse stations, at most 67 coarse probes per alternative; total bound 772,560 coarse probes, then explicit generation failure |
| Local presentation | Road-support patches up to size 128 use at most 64x64 cells; other patches keep existing mesh LOD; jobs 4/6/8, CPU/GPU 96/160/256 MiB each and one upload group per frame remain unchanged |

The edge prefilter bounds centerline support in canonical angular space before any fine terrain evaluation. Road fragments are split into fixed coarse intervals, and bridge station enumeration clips to the requesting patch without scanning the whole corridor's fine stations. Regions and edges with no crossings stay empty. Coplanar overlaps resolve to canonical endpoints; a cube corner has one vertex owner and one deduplicated port. Port identity includes feature and shared boundary/corner, independent of request direction. Elevation is the composer's existing height in metres; only horizontal source distances/widths require the canonical metre conversion. Legacy prototype roadbed width/support (10/12 source units) remains explicit; this WP does not claim the future physical road-class dimensions.

Recipe caches, pending payloads, the final-surface cache and compact road/place registry are conservatively charged to CPU budgets. Tile-worker telemetry is added to main-thread residency; transient globe preparation reserves its own registry, sample cache and texture buffer. The optional overlay's retained records are also charged. Obsolete ready presentation jobs are discarded before upload while active, root and retained transition coverage remains protected. Scheduling affects readiness, never port identity or accepted route choice.

## Actual connected obstacle proof

`continuity-corridor.ts` selects an ordered SEED-defined detour around an actual macro lake, joining two existing village destinations. The compact corridor is appended to the actual `geography.roads` registry, whose road support index, final-surface profiles, vegetation exclusion, bridge renderer and segmented travel adapter all consume it. It is not a separate diagnostic drawing. Existing prototype road identities are preserved; the new corridor is domain-versioned under `v4/continuity-1`.

For the current campaign the direct midpoint crosses lake 0. Alternative 0 joins villages `0/2/1/0` and `0/10/0/0`, uses 34 coarse nodes, is 257,270.91 m long and required 111 coarse probes. The global road registry grows from 216 to 217 compact records. Its 24 shared boundary ports are legal; 8,763 final-surface stations at spacing no greater than two source units are walkable, dry and outside forbidden sites. These are acceptance evaluations, not eager resident station arrays. Failed coarse candidates return an explicit failure; an endpoint is never moved independently by one neighbor.

Ten distinct macro-SEED plans use this same corridor/service factory and the same final composer with their own terrain/topology. Tests compare forward, reverse, shuffled and independently constructed worker-equivalent contexts, eviction/rebuild, finite quota/cancellation, corner ownership and a timestamped persisted road closure. Adding 2,000 unrelated coarse records increases the separately reported registry checks while local fine-sample counts remain identical. Full hydrology, transport topology replacement, settlement interiors and resident simulation remain their existing subsystem responsibilities.

## Information panel

The owner's green left information panel starts minimized in static HTML on every page load. A 44-pixel minimum button reads **Show information**, then **Minimize** when expanded, and reports `aria-expanded`. Toggling preserves geographic focus, heading and layer selections; hidden controls leave keyboard navigation until expanded. The opt-in developer continuity overlay has a separate show/minimize control. Neither toggle changes canonical facts.

## Verification and limitations

Native Edge on Windows provides real WebGPU and forced WebGL2 evidence; viewport sizes simulate desktop/tablet/phone, not physical devices. Unit tests cover the actual road's composed surface, and browser evidence covers remote inspection/travel without scenery preparation, 60 seconds of desktop navigation and ten unload/revisit cycles. Raw timings, retained resource estimates and screenshots are recorded with release evidence. No physical-device FPS, thermal claim or invented speed-up percentage follows from these measurements. Coarse distant filtering, approximate coasts and existing prototype building/road styling remain presentation limitations.
