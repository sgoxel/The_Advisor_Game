# Stage S006 usable building-interior architecture

Status: **binding reference architecture for WP-S006-002-001**. This document defines how future usable interiors must fit the authoritative world. It is architecture and acceptance planning only; it does **not** claim that enterable buildings are implemented by this WP.

`docs/README.md` remains the game law. In particular, the player is the Advisor: an inspection or advice UI may express intent, but protagonist movement is authoritative only after **Character decision -> Simulation validation -> World reaction**. A loading screen, camera move, renderer, device profile or cache may never become gameplay authority.

## 1. Current-source audit

The 2026-10-16 source baseline had settlement, resident, traversal, streaming and canonical-world systems but no interior runtime module or interior test suite. This architecture document is now committed; it must not be confused with implemented enterable interiors. Existing contracts already establish the inputs an interior system must consume rather than duplicate:

- `SETTLEMENT_PLAN.md` gives every building a canonical settlement/building identity, footprint and legal entrance, and keeps homes logically present even when no mesh is loaded.
- `LIVING_WORLD_PLAN.md` keeps NPC identity/home/work/activity authoritative across LOD and cache eviction and requires off-screen life to use analytical/interest-based simulation rather than camera-created residents.
- `INVISIBLE_WORLD.md` establishes finite on-demand queries, immutable seeded foundations plus persisted revision, and a shared app resource policy. Its current policy retains reusable terrain through 256 MB and trims unused entries above that while enforcing one combined estimated CPU+GPU ceiling of 1 GB on every profile. Interiors are another consumer of that shared policy; they do not get a separate hidden memory ceiling.
- `PLANET_ARCHITECTURE.md` defines canonical spherical position, local ENU rendering, presentation-only rebasing, WebGPU/WebGL2 parity and responsive viewport requirements.

Therefore an interior is **not a second world, a menu scene, a rerolled duplicate building, or a renderer-owned simulation**. It is demand-materialized detail for an already-existing canonical building.

## 2. Reference analysis

Research refreshed 2026-10-16. Public references are used for architectural patterns only; proprietary engine internals are not assumed.

### 2.1 PlayCanvas asset lifecycle, batching and instancing

Sources:
- https://developer.playcanvas.com/user-manual/assets/loading-unloading/
- https://developer.playcanvas.com/user-manual/assets/preloading/
- https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/batching/
- https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/hardware-instancing/
- https://developer.playcanvas.com/user-manual/optimization/guidelines/

Applicable lessons:
- optional assets can be loaded only when needed and unloaded while their registry identity remains available;
- related assets should be prepared as a group before presentation to avoid partial pop-in at an interaction boundary;
- batching reduces draw calls when materials and spatial bounds are compatible, but oversized batches reduce culling quality and rebatching is expensive;
- hardware instancing is useful for repeated meshes, but instances are submitted together, so very large cross-room instance groups can waste rendering work;
- collision geometry should be simpler than render geometry and dynamic physics bodies should stay limited on mobile;
- shared asset unloading needs reference ownership because unloading a shared PlayCanvas asset affects every consumer.

Interior consequence: use reusable small mesh/material/texture kits, group batches by room/visibility cell, use bounded instancing for repeated props, and let an interior residency service own shared asset references. Destroying one interior entity tree must not unload a kit still used by another prepared/visible space.

### 2.2 Seamless world streaming

Sources:
- https://dev.epicgames.com/documentation/en-us/unreal-engine/level-streaming-in-unreal-engine
- https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine
- https://dev.epicgames.com/documentation/unreal-engine/level-streaming-overview-in-unreal-engine
- https://docs.unity3d.com/6000.1/Documentation/ScriptReference/SceneManagement.LoadSceneMode.Additive.html

Applicable lessons:
- large worlds remain practical by keeping a persistent authority while loading only player-relevant detail;
- an interest source can prepare the destination before movement crosses into it;
- additive/dynamic content can coexist with the surrounding world instead of replacing the whole world scene;
- loading work should be asynchronous/incremental and readiness must be explicit.

Interior consequence: the exterior world remains authoritative and present through an entry transition. Approaching or choosing a doorway may prepare its interior, but the character crosses only after the Simulation approves the portal and the entry-critical interior representation is ready.

### 2.3 Portal visibility

Sources:
- https://docs.unity.com/en-us/engine/6000.5/manual/cameras/occlusion-culling/class-occlusion-portal
- https://docs.unity.com/en-us/engine/6000.6/manual/cameras/occlusion-culling/scene-loading

Applicable lesson: doors are natural visibility boundaries. Whether a door is open can change which neighboring room presentation is useful without changing the room topology itself.

Interior consequence: use a deterministic room/portal graph for coarse visibility. Render the occupied room plus directly visible neighbors as needed; do not keep the whole building visually active merely because its logical foundation exists. This project does not require Unity-style baked occlusion data; the transferable pattern is explicit portal-aware visibility.

### 2.4 Procedural architecture and constrained floor plans

Sources:
- Wonka et al., *Instant Architecture* (SIGGRAPH 2003): https://www.cg.tuwien.ac.at/research/publications/2003/Wonka-2003-Ins/
- Müller et al., *Procedural Modeling of Buildings* (SIGGRAPH 2006): https://doi.org/10.1145/1141911.1141931
- Lopes et al., *A constrained growth method for procedural floor plan generation* (GAME-ON 2010): https://repository.tno.nl/SingleDoc?find=UID+7828c749-ddcd-4aa0-b14f-cdce3a164cf5
- Wang & Zhang, *Generating layout designs from high-level specifications* (Automation in Construction 2020): https://doi.org/10.1016/j.autcon.2020.103288

Applicable lessons:
- grammar/rule systems can turn semantic building requirements into geometric structure;
- room adjacency is naturally represented as a graph and embedded inside an outer building boundary;
- procedural interiors need explicit consistency constraints such as containment, non-overlap, circulation and reachability rather than accepting any generated arrangement;
- designer-controlled semantic programs produce more useful interiors than unconstrained visual variation.

Interior consequence: generate a **semantic room program first**, then deterministically embed and validate it inside the canonical exterior footprint. No renderer-time or visit-order choice may decide the layout.

### 2.5 Navigation tiles

Source:
- https://recastnav.com/classdtNavMesh.html

Applicable lesson: navigation can be represented as bounded tiles that are added/removed while the logical world persists.

Interior consequence: future implementation may use Recast/Detour or an equivalent in-project representation, but the required contract is engine-independent: navigation is room/cluster-bounded, shares the same doors/stairs as collision and portal identity, and can be reconstructed independently of presentation meshes.

## 3. Non-negotiable invariants

1. **One building identity.** Exterior and interior resolve to the same canonical `buildingId`, owner, settlement, entrance and campaign history.
2. **Same world space.** Interior coordinates are a local transform of the building's canonical world position. A far-away staging coordinate or unrelated scene authority is invalid.
3. **SEED is foundation authority.** Immutable layout and furnishing foundations derive only from Campaign SEED, generator version and canonical semantic inputs. No runtime RNG is permitted.
4. **Persisted changes are separate.** Moved, damaged, owned, opened/closed, consumed or otherwise changed authoritative objects are deltas layered over the immutable foundation.
5. **Fantasy Game Time continues.** Entering a building does not create a separate clock or pause simulation unless an explicit future gameplay rule says so.
6. **Simulation owns traversal.** Advisor UI can inspect or request/advice; character movement across an entrance occurs only after Character decision and Simulation-valid traversal.
7. **Presentation is never authority.** Camera, backend, viewport, device capability, render density, frame timing, worker order and cache residency may change cost/appearance only.
8. **Eviction loses no world state.** Destroying interior entities, meshes, nav tiles or resources removes reconstructible presentation/detail only.
9. **Off-screen occupancy stays analytical.** An NPC being logically inside a house/workplace is not sufficient reason to realize that interior.
10. **Failure is explicit.** If a deterministic plan cannot satisfy its constraints, generation returns a diagnostic failure for that building/version; it does not silently mutate the footprint, entrance, owner or seeded inputs.

## 4. Canonical identity and coordinate model

### 4.1 Foundation key

Each interior foundation is keyed by:

`InteriorKey = (campaignSeed, interiorGeneratorVersion, buildingId)`

The generator reads canonical building data by `buildingId`:
- footprint polygon and final ground/elevation;
- canonical entrance portal(s), outward direction and access route;
- building archetype/use;
- settlement/country/culture identity;
- climate/environment/site context;
- number of floors allowed by the canonical exterior;
- canonical owner/service/work anchors already assigned by settlement/resident authority.

These are **inputs**, not recomputed interior guesses. Culture/environment can choose ordered kit/style rules, but cannot move the building, change ownership or replace its entrance.

A campaign snapshot pins `interiorGeneratorVersion`; changing generator code therefore cannot silently alter an already-established campaign foundation. The project does not require legacy compatibility between pre-release generator versions, but a single campaign version must be internally deterministic.

### 4.2 Stable interior IDs

Derived IDs are hierarchical and reproducible:

- `buildingId/room/<roomRole>/<ordinal>`
- `buildingId/portal/<portalRole>/<ordinal>`
- `buildingId/fixture/<fixtureRole>/<ordinal>`
- `buildingId/nav/<floor>/<cluster>`

Ordinals come from a canonical sorted result, not iteration arrival order. Persisted events refer to these IDs, never ephemeral entity IDs.

### 4.3 Local building frame

Define a right-handed building-local frame anchored at the canonical primary entrance threshold:

- local origin = entrance threshold projected to final structural floor elevation;
- +Z = inward through the doorway;
- +Y = local up;
- +X = right when facing inward.

The building transform maps this local frame to the planet's active ENU/canonical world frame. Exterior threshold and interior vestibule are physically adjacent points separated only by the actual wall/threshold depth. There is no coordinate discontinuity.

Render-origin rebasing may change GPU transforms, but `buildingId`, local room coordinates, portal mapping and Simulation position are unchanged.

## 5. Deterministic interior generation pipeline

Generation is a pure operation over the foundation key and canonical building context.

### Step 1 — normalize the exterior envelope

Use the canonical building footprint, floor elevations, structural envelope and entrance(s). Validate minimum usable area and entrance frontage. Do not enlarge the building to make an interior fit.

### Step 2 — derive a semantic room program

The building archetype produces required room roles, adjacency requirements, service anchors, minimum circulation and optional roles. Culture/climate/site context can select compatible variants from an ordered deterministic rule set.

### Step 3 — construct a room/portal graph

Nodes are rooms or vertical circulation zones. Edges are doors, open passages or stairs. Required gameplay/service relationships are expressed here before geometry. Example: a blacksmith entrance must reach a customer/service area without forcing the protagonist through a forge hazard zone.

### Step 4 — embed the graph inside the envelope

Enumerate deterministic candidate splits/placements using fixed-point or quantized geometry. Candidate order is derived from the foundation key and documented stable ordering. Score candidates using explicit constraints/preferences such as:
- required adjacency;
- circulation length;
- usable wall frontage;
- room aspect ratio;
- service/vent/window frontage where appropriate;
- stair legality for multi-floor layouts;
- exterior-door compatibility.

Choose the highest-ranked valid candidate under a canonical tie-break. This is deterministic selection, not runtime chance.

### Step 5 — place structural portals and fixture anchors

Doors/stairs/windows, beds, hearth/workbench/counter/stall/post/storage and other semantic anchors receive stable IDs and positions. Presentation props may later be culled or simplified, but canonical interactive anchors remain queryable.

### Step 6 — validate before acceptance

A foundation is accepted only if all required checks pass:
- all room polygons are inside the canonical floor envelope;
- no illegal room/structural overlap;
- every required room is reachable from the exterior entrance;
- door clearances and corridor widths meet the project's gameplay capsule/navigation requirements;
- stairs connect valid floor portals with consistent collision/nav endpoints;
- no traversal path requires crossing walls, fixed hazards or non-walkable fixture footprints;
- service anchors are reachable and match the building's canonical use;
- entrance orientation/elevation agrees with the exterior route and final terrain;
- collision and navigation are derived from the same accepted structural geometry.

Invalid candidates are skipped deterministically. Exhaustion returns a typed generation failure with the violated constraints and building ID.

### Step 7 — derive a foundation fingerprint

Serialize authoritative geometry/IDs in canonical order and compute a stable fingerprint. The same Campaign SEED + generator version + building ID must produce the same fingerprint regardless of visit order, backend, worker count, viewport or cache state.

## 6. Required functional room programs

Exact historical furnishing can evolve, but these gameplay functions are minimum semantic contracts.

| Archetype | Required functional program | Required canonical anchors / safety rules |
| --- | --- | --- |
| Ordinary home | entrance/vestibule or direct common entry; common/hearth area; sleeping area(s); storage; culture-appropriate wash/latrine solution where applicable | home entrance, sleep anchors for residents, hearth/common anchor, storage; legal path from entrance to every occupied room |
| Inn | public entrance; common/service room; service/prep area; guest sleeping area(s); storage; sanitation/wash solution | innkeeper/service anchor, guest sleep anchors, service counter, safe public path that does not require crossing prep hazards |
| Blacksmith | customer/entry zone; forge/work zone; material/tool storage; optional private/back room if footprint permits | service counter/work anchor, forge hazard clearance, storage; public route separated from unsafe forge footprint |
| Butcher | sales/entry zone; preparation/work zone; storage/cold-store abstraction; waste/service route appropriate to world rules | service counter, preparation anchor, storage; public path separated from work hazard/dirty-service area |
| Farm/barn | legal entrance; stall/equipment/storage bays appropriate to the registered building; hay/feed/storage; work/service access | stall/storage/work anchors; wide-enough service path where required; exterior yard/field relation remains canonical exterior authority |
| Guard space | public/report point; duty-ready/gear area; rest/storage; holding space only where the canonical building use includes it | duty/post anchor, gear/storage, legal route between entrance and duty area; no invented prisoner state |
| Larger city/castle building | entrance hall/threshold; functional room clusters; vertical circulation; service/private/public zones as dictated by archetype | cluster portals, stairs, service anchors, owner/use anchors; room-cluster streaming must not change topology |

A small footprint may merge compatible functions into one room; it may not delete required gameplay anchors or create physically impossible circulation. The canonical exterior archetype determines which program applies.

## 7. Exterior <-> interior portal and traversal contract

### 7.1 Portal record

Each usable entrance owns a stable `InteriorPortal` record:

- `portalId` and `buildingId`;
- exterior threshold canonical position/orientation/elevation;
- interior threshold local position/orientation;
- collision aperture and traversal width/height;
- connected exterior route/nav node;
- connected interior room/nav node;
- authoritative door state reference if the door can change state;
- accessibility/entry rules queried by Simulation.

The exterior and interior sides are two faces of one portal identity.

### 7.2 Player-facing state machine

Presentation may expose these states:

`OUTSIDE -> INTENT -> VALIDATING -> PREPARING -> READY -> CROSSING -> INSIDE`

Exit mirrors the same path. State meanings:

- **INTENT:** Advisor/character interaction indicates the doorway/building; no movement occurs.
- **VALIDATING:** Character decision is submitted to Simulation. Simulation checks current position, legal route, door/ownership/rule state and any authoritative gameplay restrictions.
- **PREPARING:** after a positive validation, entry-critical foundation/collision/nav/resources are prepared. Character remains at the exterior threshold.
- **READY:** required collision/nav and coarse room presentation exist and fingerprint validation passed.
- **CROSSING:** the character follows an ordinary short traversal through the threshold into the interior local frame.
- **INSIDE:** interior room visibility/refinement may continue, but world/time/identity are unchanged.

If validation is denied, show the Simulation reason and leave the character at the legal exterior position. If preparation fails, keep the character outside, expose retry/cancel, record the failure and preserve canonical state.

### 7.3 No unexplained teleport

The camera may ease through a doorway/cutaway, but the protagonist position must traverse from the exterior threshold to the interior threshold along the portal corridor. A loading veil may cover refinement, but it cannot disguise movement to a disconnected coordinate space.

On exit, resolve the exact same portal and place the character on its legal exterior threshold/approach, preserving heading where collision permits. Never choose a different door because it is closer to a camera or already cached.

### 7.4 First authoritative response versus first usable entry

A selected map marker/door may immediately open a **read-only inspection** of already-authorized facts; it cannot claim that the protagonist approached, entered or exited. The earliest action result is **Character decision + Simulation validation**, not a render/asset-loading callback. Track the stages separately:

1. **Intent acknowledged:** the Advisor request/selection is accepted by the UI, with stable `buildingId/portalId`; movement status remains **not started**.
2. **Authority pending:** if character choice, canonical portal state or Simulation validation is unresolved, show a visible, accessible pending message and retain the current legal position. Never infer approval from a prepared mesh.
3. **First authoritative response:** show a typed accepted/denied result with the currently validated portal/route and denial reason when applicable. Report a separately measured intent-to-authority latency. Accepted intent is **permission to prepare/cross when still legal**, not evidence of completed travel.
4. **First usable interior:** after the current authorization and portal/collision/nav/coarse room/required anchors agree, the ordinary crossing can be committed. Show the first usable interaction and measure its latency separately from the first authoritative response. If the door or route changed while preparing, revalidate before crossing rather than using stale approval.
5. **Settled presentation:** meshes, furnishings, materials and optional neighboring room clusters may finish later. Record their completion separately; no decorative resource is required to truthfully report the earlier authoritative decision.

On exit, use the identical stages in reverse: inspection/request, authority pending or denied, validated threshold crossing, first usable exterior focus, and optional exterior visual settling. In all pending/failure cases, retry/cancel applies to the request or rebuildable preparation only and cannot synthesize a Character decision, change Simulation state or warp position. Expose the current authoritative state and recovery path through keyboard/screen-reader status as well as visible text.

## 8. Persisted authoritative-change layering

An interior is reconstructed as:

`LiveInterior = ImmutableFoundation(InteriorKey) + PersistedDeltas(buildingId, revision, FantasyGameTime)`

The immutable foundation contains room topology, structural portals and seeded foundation fixtures. Persisted deltas contain authoritative campaign changes such as:

- moved/removed/damaged/repaired fixture state;
- ownership changes;
- container/inventory state where later gameplay owns it;
- door/lock/open state;
- built/destroyed/replaced structural changes approved by future Simulation rules;
- durable interaction state.

Rules:
- events/deltas reference stable interior IDs;
- ordering is canonical by campaign event sequence/revision, with Fantasy Game Time recorded where relevant;
- applying a delta never mutates the Campaign SEED foundation recipe;
- cache eviction drops reconstructed entities but never delta records;
- rebuilding at the same revision yields the same live fingerprint;
- direct time catch-up and stepwise catch-up must agree when no intervening player decision differs.

A foundation-version change in an active campaign requires an explicit migration/reset policy. It may not silently orphan delta targets.

## 9. NPC occupancy without eager interiors

Resident schedules refer to `buildingId` and semantic destinations, not render entities. For an off-screen NPC inside a building, Simulation can represent position as:

`(buildingId, roomRole/anchorId, schedulePhase, analyticProgress)`

This is sufficient for most off-screen work/rest/service state. Full room meshes, props, collision and NPC actor entities are unnecessary.

When the protagonist materializes an occupied interior:
- query logical occupants at the current Fantasy Game Time;
- resolve their deterministic room/anchor positions from the same foundation;
- allocate only presentation actors allowed by the existing visible-actor policy;
- preserve every logical occupant even if some actors are culled;
- reconstruct the same identities/anchors after eviction/re-entry.

Exterior camera visibility, atlas inspection and an NPC's schedule alone never request full interior materialization.

## 10. Demand loading, residency and shared resource accounting

### 10.1 Residency tiers

1. **Foundation summary:** lightweight deterministic metadata/room-role summary and fingerprint. May be generated for inspection/testing without meshes.
2. **Entry-critical realization:** portal, first room/cluster, collision, navigation, required interaction anchors and coarse reusable visuals.
3. **Visible refinement:** high-detail meshes/materials/props for the occupied room plus portal-visible neighbors.
4. **Large-building cluster detail:** additional room clusters prepared only as the protagonist approaches their portals.

### 10.2 Maximum simultaneously realized interiors

The initial implementation contract is:

- at most **one occupied fully realized interior**;
- at most **one additional entry-critical candidate** may be prepared for an imminent portal transition;
- large city/castle buildings count as the one occupied interior and stream internal room clusters instead of realizing the whole building;
- background NPC occupancy contributes **zero** realized interiors.

This is a deterministic scheduling/concurrency rule, not an independent memory ceiling. If the shared app resource policy cannot accommodate the candidate, the candidate waits or trims rebuildable presentation while the occupied/required world remains valid.

### 10.3 Shared resource policy

Interior accounting joins existing app telemetry. Record, at minimum:
- interior entity count;
- unique/shared mesh bytes;
- texture/material bytes;
- nav/collision bytes;
- JS foundation/delta/cache bytes;
- draw calls and visible mesh instances;
- shared-kit reference counts;
- combined application CPU+GPU estimate.

There is **no interior-only memory allowance**. The current shared contract in `INVISIBLE_WORLD.md`/`PLANET_ARCHITECTURE.md` remains authoritative: reusable terrain may be retained through 256 MB with unused trimming above it, while combined estimated CPU+GPU residency stays under the shared 1 GB ceiling on every profile. Future S009 policy changes supersede those figures globally.

Interior caches must participate in the same pressure ordering. Rebuildable visible-refinement data and inactive prepared candidates are trim candidates before canonical/persisted state. Cache presence may never change layout or world facts.

### 10.4 Preparation and eviction

Preparation order:
1. foundation summary/fingerprint;
2. portal + structural collision;
3. first-room nav/interaction anchors;
4. coarse shared render kit;
5. visible refinement.

A transition becomes `READY` after 1-4. Step 5 may continue after crossing.

Eviction order after exit:
1. remove interaction bindings and visible actors;
2. release per-interior entities/batches/nav/collision;
3. release unique resources;
4. decrement shared-kit references;
5. keep only normal bounded rebuildable metadata if shared policy permits.

Never unload a shared PlayCanvas asset while another realized/prepared interior still references it.

### 10.5 Performance targets for future implementation evidence

These are acceptance budgets for implementation WPs, not measured claims by this analysis WP:

- no synchronous interior preparation task may consume more than **2 ms of main-thread work in one frame** under the instrumented target browser; longer work must be chunked or moved off-thread where safe;
- ordinary home/service **entry-critical** cold preparation p95 target: <= **300 ms desktop**, <= **500 ms tablet**, <= **750 ms physical phone**;
- warm-kit re-entry p95 target: <= **150 ms desktop**, <= **250 ms tablet**, <= **400 ms physical phone**;
- large city/castle first playable cluster uses the same entry-critical target; remaining clusters refine after entry;
- eviction is incremental and must not create a >2 ms main-thread cleanup spike;
- repeat 20 enter/leave/evict/re-enter cycles with no upward retained-resource drift after the cache reaches steady state;
- all interior bytes are reported together with the existing app resource totals, and the shared app ceiling remains the actual acceptance gate.

If measured target hardware cannot meet a latency target without violating determinism/quality, revise presentation/refinement granularity rather than changing canonical contents by device.

## 11. Rendering, visibility, cutaway and reusable kits

### 11.1 Reusable kit strategy

Prefer a bounded library of reusable low-poly modules:
- wall/floor/ceiling/beam/stair/door/window pieces;
- furniture silhouettes and service fixtures;
- culture/climate material atlases;
- small reusable prop sets.

Canonical diversity comes from deterministic layout, role, transforms, material/style assignments and semantic fixture combinations. It does not require a unique texture/mesh per building.

Batch static geometry **per room/visibility cluster and compatible material**, not across an entire large building. This preserves culling. Use instancing for repeated props where a room/cluster-sized instance group keeps submission bounded.

### 11.2 Portal-aware visibility

The accepted room graph doubles as coarse visibility structure:
- occupied room always visible;
- open doorway can admit one or more adjacent rooms into the visible set;
- closed opaque door can terminate visibility at that portal;
- upper/lower floor clusters are inactive unless visible/near traversal;
- renderer visibility never changes logical room existence or door authority.

### 11.3 Roof/wall readability

When indoors, presentation may hide/fade/cut away roof and camera-facing exterior walls needed for legibility. The cutaway decision is presentation-only and reversible. Required rules:
- never remove collision/nav with the visual wall;
- never expose another room as traversable merely because its wall is visually cut away;
- selected/interacting character and target anchor stay visible;
- the transition from exterior roof to interior cutaway should be progressive enough to preserve building identity;
- provide a user-facing visibility override if automatic cutaway creates accessibility/readability problems.

### 11.4 2D-in-3D residents, doorway sightlines and focus return

Use the same canonical room/portal and resident anchors for sprite depth, collision context and interaction picks. A resident drawn as 2D artwork in 3D space must be placed and depth-tested in the building frame; billboard orientation may face the viewer but may not move the resident's authoritative feet, room or occupancy. Roof/camera-facing-wall cutaway must reveal the current protagonist, relevant NPC, selected door and required station without displaying an unreachable character as though visible through a closed opaque door.

For portrait and landscape, compute a map-safe composition around the actual selected canonical door/actor/anchor bounds: preserve a visible doorway path and required control hit targets outside safe areas and persistent panels; permit focus/camera offset without changing world positions. Use portal-aware visibility and explicit wall/roof cutaway, not unconditional always-on-top sprites or disabling structural depth/collision. Compare WebGPU and WebGL2 for identical anchor IDs, occlusion semantics, sprite grounding and readable interaction focus; renderer-specific alpha/depth behavior may require presentation adjustments but must not alter authority.

On exit, restore the last stable exterior focus (building/door/selected actor ID, canonical coordinate, camera heading and accessible keyboard target), recalculating only the presentation framing for the active viewport. If the previous target was removed by Simulation, fall back deterministically to the same portal threshold with a truthful status. Test door sightline, actor visibility, selectable anchor and focus return at both landscape and portrait orientations.

### 11.5 Lighting

Prefer shared/baked-looking or inexpensive local lighting solutions; dynamic shadow-casting lights must be tightly bounded, especially omni lights. Device/backend quality may reduce shadow resolution/count and decorative lights only. It may not change room topology, portal state or interactive anchors.

## 12. Collision and navigation contract

Collision and navigation derive from the accepted structural foundation, not from simplified visual LOD.

- Structural walls, floor slabs, stairs and door apertures own authoritative collision shapes.
- Render meshes may be richer; collision meshes stay low complexity.
- Each room/cluster owns a bounded nav region/tile; portal edges connect rooms; stair edges connect floors.
- An authoritative closed/locked door can disable traversal across its portal edge while the room graph identity remains.
- Nav generation/reconstruction must produce the same portal connectivity for the same foundation/delta revision.
- Furniture that changes authoritative obstruction state updates only the affected room/cluster, never a whole settlement nav rebuild.
- Any route from exterior threshold to required service/interaction anchors is testable headlessly.

The implementation may use Detour/Recast or native deterministic graph/polygon navigation. The invariant is shared portal geometry and bounded reconstruction, not a specific library.

## 13. Player UX and accessibility

### 13.1 Distinguish inspection from action

An Advisor-facing inspection can show:
- building identity/use/owner;
- known residents/workers;
- entrance status;
- relevant room/service information already knowable to the character/campaign.

An **Enter** affordance is an advice/action intent, not an immediate teleport command. UI text/state must make Simulation denial distinguishable from loading delay.

### 13.2 Transition presentation

- Keep the canonical doorway/character visible while validating/preparing where practical.
- Show compact progress/status rather than replacing the whole game with an unrelated loading scene.
- On preparation failure, keep a usable **Retry** and **Cancel** path; the exterior remains interactive.
- Camera target and heading should continue through the doorway. Any temporary camera easing is presentation-only.
- On phone portrait/landscape, status controls may not cover the doorway, selected character or primary scene interaction area.

### 13.3 Interaction and focus

Inside, selecting an object/NPC resolves a real canonical fixture/resident anchor. Focus/highlight persists by stable ID through room refinement or reload. UI cannot create ownership, inventory, occupants or unlocked doors.

Touch controls intended as actions should normally retain the existing >=44 x 44 CSS px target convention and safe-area handling. Keyboard/controller focus should remain visible. Transition and error status should be exposed with appropriate live-region semantics without repeatedly stealing focus. Record a stable return-focus target before entering: on successful exit restore the exterior doorway/building selection and keyboard focus, or choose the same portal's threshold if that target is no longer valid. Loading, denied-entry and renderer-recovery states must preserve a reachable Cancel/Back control without covering the doorway in either orientation.

## 14. Failure modes and required behavior

| Failure mode | Required behavior |
| --- | --- |
| Exterior footprint cannot fit required room program | typed deterministic generation failure; building ID/footprint/ownership remain unchanged; evidence identifies violated constraints |
| Door/route state denies entry | Simulation denial reason; protagonist stays outside; no interior crossing |
| Entry-critical asset load fails | keep protagonist outside, preserve world state, expose retry/cancel, log resource error |
| Fine texture/prop load fails after entry | keep structural collision/nav/coarse visuals usable; degrade presentation only |
| Prepared candidate loses resource pressure race | discard rebuildable candidate and retry on next valid intent; no canonical change |
| Persisted delta references missing foundation ID | explicit integrity error for that campaign/version; do not drop the delta silently |
| Backend/device differs | may alter quality/cost only; authoritative fingerprint and state must match |
| Cache eviction/reordered visits | reconstruct same foundation + persisted revision |
| Door changes while inside | update authoritative door state and local portal/nav edge; presentation follows |
| Large building exceeds visible-detail target | stream room clusters; never delete logical rooms or anchors to fit presentation |

## 15. Telemetry and deterministic fingerprints

Future implementation exposes an interior diagnostics snapshot containing at least:

**Authority**
- `buildingId`, `portalId`, generator version;
- foundation fingerprint;
- persisted revision and live fingerprint;
- current Fantasy Game Time;
- selected room/anchor IDs;
- logical occupant IDs/count.

**Streaming/presentation**
- residency tier/state;
- realized interior count and prepared-candidate count;
- active room/cluster IDs;
- entity/mesh/draw-call counts;
- shared-kit refs and asset hit/miss counts;
- visible actor count versus logical occupant count;
- CPU/GPU/JS/nav/collision byte estimates;
- main-thread preparation/eviction slice maxima;
- cold/warm preparation and reconstruction latency.

**Parity**
- backend (`webgpu`/`webgl2`) and viewport are recorded as evidence labels but excluded from authoritative fingerprints;
- changed visit order, worker order, cache state and device profile must reproduce the same authority fields for the same inputs.

## 16. Acceptance plan for implementation WPs

This analysis WP has **VISUAL: N/A** because it changes no runtime presentation. Future implementation is MIXED and requires fresh screenshots plus functional evidence.

### 16.1 Required fixtures

Use deterministic fixtures covering:
1. ordinary owned home;
2. inn;
3. blacksmith;
4. butcher;
5. farm/barn;
6. guard space;
7. larger city/castle building with multi-room/multi-floor or clustered interior.

For each fixture capture building/portal IDs, foundation fingerprint, required-room graph, canonical anchors and final resource metrics.

### 16.2 Functional assertions

- Same SEED + generator version + building ID -> identical foundation fingerprint across fresh process, reordered visits, eviction/rebuild, WebGPU and WebGL2.
- Same foundation + same persisted revision/time -> identical live fingerprint.
- Apply a persisted moved/damaged/door/ownership fixture change -> leave -> evict -> re-enter -> change remains exactly once.
- Stepwise time catch-up versus direct catch-up agrees for interior occupant/door state where no player decision differs.
- Exterior inspection and 100 off-screen NPC occupancy queries realize zero interiors.
- Approach/valid entry realizes no more than one occupied + one prepared candidate; after crossing/settling, unused candidate resources are released.
- Every required room/service anchor is reachable from the legal entrance; collision/nav/portal graph agree.
- Illegal entry request never moves the protagonist.
- Entry/exit returns through the same canonical portal and maintains world/clock continuity.
- Twenty eviction/re-entry loops reach stable retained-resource behavior and remain under shared app policy.
- Large city/castle fixture loads first playable cluster without realizing the whole interior.

### 16.3 Backend and viewport matrix

Run both real WebGPU and forced WebGL2 fallback where available. At minimum inspect:
- 360 x 800 phone portrait;
- 390 x 844 phone portrait;
- 844 x 390 phone landscape;
- 768 x 1024 tablet portrait;
- 1024 x 768 tablet landscape;
- 1366 x 768 desktop;
- 1920 x 1080 desktop.

Future fresh screenshots must cover exterior -> threshold -> interior, cutaway/readability of grounded 2D-in-3D residents, selected interaction anchor and return to exterior. Keep standard evidence screenshots to 1920 x 1080 landscape and 1080 x 1920 portrait; use the other listed viewport sizes for focused responsive/layout checks rather than a seven-device screenshot matrix. MIXED implementation WPs must achieve the repository's >=8/10 visual requirement with no major clipping, camera discontinuity, unreadable controls, wall/roof occlusion of the selected target or broken-looking geometry.

### 16.4 Performance/resource evidence

For desktop/tablet/physical phone, report p50/p95 **intent-to-first-authoritative-response**, **response-to-first-usable-interaction** and **first-usable-to-settled-presentation** separately, plus cold and warm entry-critical preparation, maximum main-thread slice, eviction time, steady-state resource contribution, combined app resource total, draw calls/mesh instances, active room clusters and reconstruction latency. Do not infer phone performance from a desktop emulated viewport.

## 17. Minimum recommended implementation work packages

These are **research recommendations only**. Do not add WPs to ROADMAP or implement them in WP-S006-002-001. Each candidate is independently solvable from this architecture and the then-current `main`: an implementer must include the smallest missing scaffolding it needs inside its own scope, never wait for another candidate. Actual WPs should be split/reduced further if a one-pass bounded acceptance is not feasible.

### Candidate A — Canonical portal and home first-use vertical slice

**Objective:** make one deterministic ordinary-home doorway usable without teleportation, with Character decision -> Simulation-validated threshold crossing and truthful first authoritative response.

**Scope and authority:** implement a seeded home room/entrance foundation, one actual exterior/interior portal and local-to-canonical coordinate mapping, room/door collision and nav continuity, bounded entry-critical realization, minimal coarse reusable visual kit and persistent building/portal IDs. Demonstrate inside/exit, denied/changed-door recovery, first authoritative response distinct from first usable and settled detail, no atlas selection as movement. Reuse the existing Simulation/campaign store; persist only essential changes this fixture permits.

**Acceptance:** deterministic home IDs and legal crossing headlessly; first authoritative response/pending/denied timing; first usable exit/entry and resource accounting; portrait/landscape keyboard/touch and inspected WebGPU/WebGL2 screenshots with grounded resident/door and reversible cutaway. Off-screen occupancy realizes no interior.

### Candidate B — Service-room geometry and reusable kit vertical slice

**Objective:** produce playable functional rooms and safe public/service anchor access for inn, blacksmith, butcher, farm/barn and guard-space archetypes.

**Scope and authority:** implement deterministic semantic room programs, finite geometry validation, stable fixture/door IDs, canonical exterior footprint/portal agreement, required hazard separation, collision/nav and reusable clustered low-poly kit. Supply any minimal portal/crossing/runtime integration needed for self-contained fixture entry; do not depend on Candidate A.

**Acceptance:** all five archetypes have reachable mandatory anchors and no wall/hazard shortcut; stable fingerprints and bounded generated/visible resources across visit order/cache/backend; legal entry/exit, responsive first-use status and actual WebGPU/WebGL2 portrait/landscape visual checks, including occlusion and cutaway.

### Candidate C — Interior persisted-delta/reconstruction vertical slice

**Objective:** prove that a canonical interior's mutable door, fixture, ownership and damage/repair facts survive eviction, reload and Fantasy-Time catch-up.

**Scope and authority:** implement stable versioned interior records, ordered persisted Simulation-authorized delta application, conflict/integrity diagnostics and the smallest enterable home fixture/portal needed to exercise the full path. Cache eviction removes only disposable residency; no new independent save authority, detached scene or separate interior clock. The slice includes its own necessary minimum foundation/inspection UI, independent of A/B.

**Acceptance:** repeated move/open/damage/ownership change -> evict -> rebuild -> reload restores one authoritative revision with identical fingerprint; direct vs stepwise time catch-up is equivalent where inputs match; no off-screen interior realization; first-response/pending/recovery states, shared resource measures and minimal inspected dual-backend/portrait-landscape proof.

### Candidate D — Responsive entry/exit, occlusion and resource-recovery vertical slice

**Objective:** establish usable Advisor inspection, doorway focus, grounded 2D-in-3D actor visibility and resilient first-use transition on a seeded home or service fixture.

**Scope and authority:** independently implement the minimal canonical door/home portal and Simulation handshake necessary to exercise UI; split first authoritative response, first usable collision/nav/interaction and settled refinement; provide truthful pending/denied/retry/cancel, focus restore, responsive cutaway, portal-aware sprite depth, backend parity and incremental asset/renderer recovery. Do not turn UI inspection into protagonist travel.

**Acceptance:** keyboard/screen reader, portrait/landscape, WebGPU/WebGL2 and measured first-response/first-use/settled timings; correct roof/door/resident sightlines and focus return; no false entry under delayed assets, lost graphics resources or denial; shared CPU+GPU/resource bounds and fresh inspected screenshots >=8/10. Emulated mobile viewports verify layout, not physical-device GPU, memory or thermal performance.

The candidates describe **separable ownership/acceptance problems**, not a mandated implementation order. If planned together, combine overlapping scaffolding rather than creating duplicated runtime authorities; if planned separately, each retains its own complete executable vertical slice.

## 18. Architecture decision summary

Future interiors are **deterministic detail of canonical buildings**, not separate worlds. A semantic room graph is generated from the Campaign SEED and stable building identity, embedded and validated inside the exterior envelope, then layered with persisted campaign deltas. One portal identity connects exterior and interior coordinates. Character movement crosses it only after Character decision and Simulation validation. Off-screen occupants remain analytical. At runtime only the occupied interior plus one imminent candidate can be realized, and large buildings stream room clusters. Meshes/materials are reusable and room-bounded for culling; collision/nav come from the same accepted structure. Every byte participates in the existing shared application resource policy. Eviction may remove presentation, never history.
