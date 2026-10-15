# Usable building interior architecture

Status: **reference architecture for WP-S006-002-001**. This document defines the implementation contract for future usable interiors. It does **not** claim that enterable interiors are implemented in the current runtime.

`docs/README.md` is authoritative. In particular, accessible buildings are physical parts of the same authoritative world; entering/leaving preserves the same building, occupants, location, history and campaign state; the player remains Advisor; Character decision and Simulation validation remain the authority for movement and interaction.

## 1. Current-main audit

The current runtime has no dedicated interior module, room graph, interior persistence layer or interior materialization state. `src/simulation.ts` explicitly states that keep/house interiors are not implemented and currently keeps resident movement on exterior street axes. Existing `src/streaming.ts` budgets terrain/presentation work by device class and explicitly treats device class as rendering policy rather than canonical generation authority.

Therefore the first implementation must not bolt an unrelated scene onto an exterior building. It must extend existing canonical building, Simulation, final-surface, continuity and shared resource-accounting concepts with one deterministic interior address space.

## 2. Reference research and adopted lessons

The references below are architectural precedents, not new product rules.

| Reference | Useful pattern | Applied lesson | What this project must avoid |
| --- | --- | --- | --- |
| [Epic Unreal World Partition](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine) | One persistent world with cells loaded around explicit streaming sources | Interior realization is interest-driven presentation/detail around the protagonist, while world identity remains persistent | Treating an unloaded cell/interior as nonexistent gameplay state |
| [PlayCanvas asset lifecycle](https://developer.playcanvas.com/user-manual/assets/) and [loading/unloading](https://developer.playcanvas.com/user-manual/assets/loading-unloading/) | Asset records and runtime resources are separate; resources can be loaded/unloaded and later loaded again | Keep canonical interior recipes/state independent from loaded mesh/texture resources; group assets and unload only rebuildable resources | Using asset presence as ownership, occupancy or interaction state |
| [PlayCanvas preloading](https://developer.playcanvas.com/user-manual/assets/preloading/) | Stream optional/large content and load coherent groups before displaying them | Prepare a destination kit before revealing an interior; loading presentation never authorizes entry | Preloading all building interiors because they exist on the map |
| [PlayCanvas hardware instancing](https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/hardware-instancing/) | Repeated geometry can be submitted efficiently, but large instance groups sacrifice per-instance culling | Use reusable modular meshes/materials and bounded room-local instance groups | One planet-wide furniture instance set or device-dependent furniture identity |
| [PlayCanvas batching](https://developer.playcanvas.com/user-manual/editor/interface/settings/batch-groups/) and [optimization guidance](https://developer.playcanvas.com/user-manual/optimization/guidelines/) | Batching reduces draw calls; oversized batches reduce culling efficiency; material/shader proliferation costs performance | Batch/instance per realized room or small interior cell, reuse atlases/material families, keep culling granular | Giant batches spanning hidden rooms or unique material variants for every fixture |
| [Recast/Detour](https://github.com/recastnavigation/recastnavigation) | Navigation can be derived from geometry, tiled/streamed, queried independently of render detail | Render, collision and navigation must share one generated structural result; navigation can be room/cell bounded | Independent decorative floors/doors that disagree with traversal |
| [WaveFunctionCollapse](https://github.com/mxgmn/WaveFunctionCollapse) | Constraint propagation can assemble compatible modules, but contradiction is a normal failure mode and unconstrained search can be expensive | Use deterministic bounded constraint solving with a guaranteed fallback template; keyed SEED choices replace random observation | Unbounded retries, runtime RNG, or changing layout because worker/device/order changed |
| [Azure Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing) | Immutable events can reconstruct later state and materialized views can be rebuilt | Persist interior changes as ordered authoritative deltas over an immutable seeded base; rebuild cached views on demand | Storing only a mutable loaded scene graph as campaign truth |
| [Unity additive scene loading](https://docs.unity3d.com/6000.1/Documentation/ScriptReference/SceneManagement.LoadSceneMode.Additive.html) | Additional scene content can coexist with an already loaded scene | Treat exterior and interior presentation as concurrently composable views of one world during transition | Replacing the world with a detached interior authority or resetting time/state on entry |

These references support the chosen architecture: **persistent canonical identity + deterministic recipe + authoritative delta layer + demand-realized presentation**.

## 3. Non-negotiable invariants

1. **One building, one identity.** Exterior shell, entrance, interior rooms, fixtures, occupants, ownership and later changes all resolve from the same canonical `buildingId`.
2. **Campaign SEED owns immutable foundations.** Camera, renderer, viewport, device, frame time, worker order, cache state, visit order and wall-clock time never choose room layout, fixture identity, entrance mapping or canonical object placement.
3. **Fantasy Game Time owns time-dependent state.** Opening hours, occupant schedule, damage progression or other time-dependent campaign state use authoritative Simulation time/events, not render time.
4. **No runtime random-number API.** Every procedural choice uses the repository's deterministic SEED/hash machinery with explicit domain/version/address inputs.
5. **Loading is not authority.** A building exists when no interior mesh is loaded. An NPC can analytically occupy/use a building without realizing its rooms.
6. **Eviction is not gameplay.** Unloading meshes, collision acceleration structures or cached room presentation never deletes ownership, damage, moved objects, stored items or campaign events.
7. **Render/collision/navigation agree.** Structural walls, doors, floors, stairs and traversable openings come from one canonical structural plan.
8. **Advisor authority is preserved.** Selecting or inspecting a building may show information. Entering requires a Character decision followed by Simulation-valid movement through a legal entrance.
9. **Same world, not a menu scene.** Entry/exit preserves canonical position relationship, building identity, occupants, fantasy time and campaign history.
10. **Resource adaptation changes presentation cost only.** Device/backend may reduce decoration density, shadows, animation or prefetch aggressiveness; it may not change room graph, structural fixtures, owned/interactable objects or persisted state.

## 4. Canonical data model

### 4.1 Building and entrance identity

Every usable interior is addressed from an existing canonical building record.

Minimum stable foundation fields:

```text
BuildingInteriorFoundation
  buildingId              existing canonical building identity
  generatorVersion        explicit interior generator/schema version
  archetype               home | inn | blacksmith | butcher | farm | barn | guard | civic | castle | ...
  cultureContextId        stable settlement/country/culture context
  environmentContextId    stable climate/terrain/material context
  footprintId             canonical exterior footprint
  entrances[]             canonical entrance records
  baseRecipeHash          digest of immutable inputs/result
```

Each entrance requires:

```text
InteriorEntrance
  entranceId              stable child identity of buildingId
  exteriorAnchor          canonical world position/elevation
  exteriorForward         canonical tangent-frame direction
  thresholdWidth/Height   physical opening dimensions
  interiorPortalId        stable matching portal
  accessClass             public | resident | staff | restricted | locked-by-state
```

A renderer never invents another doorway because a model variant has one. Exterior construction must expose the entrance record, and the interior structural plan must consume the same record.

### 4.2 Interior local coordinate frame

Each building receives a deterministic local ENU/tangent frame anchored to its canonical footprint/orientation. Interior coordinates are physical metres in that frame. `localToWorld()` and `worldToLocal()` are pure transforms derived from the canonical building anchor and orientation.

Requirements:

- exterior entrance threshold and interior portal transform round-trip within the project's spatial tolerance;
- floor elevation at the threshold agrees with final exterior prepared surface and the generated interior slab/step/ramp;
- the same transform is returned after eviction/revisit and in WebGPU/WebGL2;
- local coordinates never become a second geographic identity; canonical building/entrance IDs remain the lookup authority.

### 4.3 Stable child addresses

Rooms, portals, stairs, structural fixtures and interactive anchors use stable hierarchical addresses rather than array positions from traversal order:

```text
buildingId / ROOM / roomRole / slot
buildingId / PORTAL / entranceId
buildingId / FIXTURE / roomId / fixtureRole / slot
buildingId / ANCHOR / roomId / interactionRole / slot
```

The address plus generator version and Campaign SEED is the keyed deterministic input. Reordering generation or materialization must not change a child's identity.

## 5. Deterministic generation strategy

### 5.1 Generate a functional graph before geometry

Interior generation is two-stage:

1. **Functional graph:** required rooms/zones, adjacency, circulation, entrance/exit, vertical links and interactive anchors.
2. **Geometric realization:** fit that graph into the canonical footprint/floors using modular structural spans and bounded deterministic candidate evaluation.

A room is accepted only if its role, minimum usable area, clearance, portal connectivity and required anchor set validate. Geometry cannot be accepted merely because it looks plausible.

### 5.2 Keyed deterministic selection

Candidate order is derived from a stateless keyed digest such as:

```text
(SEED, generatorVersion, buildingId, domain, role, slot, candidateIndex)
```

The implementation may sort a finite candidate set by keyed score. It must not consume a mutable PRNG stream, because adding an unrelated room or changing worker order would shift later results.

### 5.3 Bounded solver and guaranteed fallback

Constraint systems such as WFC show that contradiction is a normal possibility. The game therefore uses finite search limits and deterministic fallback:

- each archetype defines a finite set of structural templates/modules;
- candidate count and backtracking depth are explicit constants covered by tests;
- failure returns a diagnostic reason and tries the next keyed candidate within the finite set;
- after the finite set is exhausted, use the archetype's canonical simple fallback layout that is guaranteed to fit its accepted exterior footprint class;
- a building whose exterior footprint cannot support even the fallback is invalid at exterior-generation time and must not be accepted as a usable building.

No camera/device/backend-specific retry path may change the canonical result.

### 5.4 Diversity without identity drift

Variation comes from canonical context and keyed addresses: footprint shape, settlement wealth/function, culture/material family, climate, orientation, floor count where legal, room proportions, furniture module choices and wear palette. Presentation quality tiers may simplify meshes/textures while preserving those semantic choices and stable object IDs.

## 6. Functional room programs

The following are minimum validation programs, not fixed visual templates.

| Archetype | Required functional zones | Required canonical anchors |
| --- | --- | --- |
| Home | entrance/circulation, common/cooking area, sleeping capacity for assigned residents, storage, period-appropriate washing/latrine solution where the culture/building supports it | entry, sleep per capacity, storage, hearth/cook if applicable |
| Inn | public entrance, common/service area, staff access, guest sleeping capacity, storage, circulation to all public/guest rooms | counter/service, seating/use anchors, guest beds, storage, staff work |
| Blacksmith | customer/access zone separated from dangerous work area, forge/work zone, tool/material storage, safe circulation | forge, anvil/workbench, stock, service interaction |
| Butcher | customer/service point, preparation/work zone, clean storage/cold or preserved stock representation appropriate to setting, waste/service access when exterior layout supports it | service counter, prep table, storage, delivery/waste access |
| Farm/Barn | farmhouse living program where inhabited; barn animal/feed/tool zones; large access compatible with exterior yard/path | household anchors, feed/storage/tool anchors, barn door/animal zones |
| Guard space | public/restricted circulation, duty/admin area, equipment storage, rest/sleep capacity where roster requires it | duty desk/post link, equipment, roster/rest anchors |
| Large city/castle building | explicit public/private/service hierarchy, multiple circulation paths where size requires it, stairs between usable floors, role-specific rooms | entrance hierarchy, stairs, service/official anchors, resident/staff capacity as applicable |

General structural validation:

- every usable room is reachable from a legal entrance through traversable portals;
- no required path passes through a wall, fixture collision volume or void;
- doors and stairs have sufficient character clearance;
- exits return to canonical exterior thresholds;
- assigned residents/staff have enough sleep/work capacity where the building's role requires it;
- inaccessible decorative rooms do not satisfy functional requirements;
- cultural variation may change room names/forms but not remove the gameplay function being validated.

## 7. Render, collision, navigation and interaction truth

### 7.1 One structural plan

`InteriorStructuralPlan` is the shared source for:

- visible floor/wall/ceiling/roof and portal geometry;
- collision primitives/meshes;
- navigation walkable surfaces and portal edges;
- room/portal visibility graph;
- fixture placement clearances;
- interaction anchor transforms.

Rendering may simplify a wall mesh; collision/nav may use optimized derivatives. All derivatives carry the originating structural IDs and must validate against the same dimensions/openings.

### 7.2 Navigation

A room/cell-bounded navigation representation is sufficient. Recast/Detour is a useful reference for deriving navigation from geometry and streaming bounded tiles, but adopting that specific library is optional.

Required behavior:

- entrance portal is a real graph edge between exterior navigation and interior navigation;
- stairs/ramps create explicit vertical edges;
- closed/locked/destroyed doors alter authoritative traversal state through Simulation, not by deleting the room recipe;
- interaction reachability is tested from legal walkable space;
- NPC analytical occupancy does not require a loaded nav mesh; a realized NPC route does.

### 7.3 Interaction anchors

Beds, counters, workstations, storage and other meaningful fixtures expose stable canonical interaction anchors. Visual clutter props do not become authoritative simply because they are rendered.

When an interaction changes world state, Simulation records the result against the stable building/object/anchor identity. UI never directly mutates a mesh and treats that mutation as authoritative.

## 8. Persisted-change layering

Interior state has three layers:

1. **Immutable base** — generated from Campaign SEED + generator version + building/context identity.
2. **Persisted authoritative deltas** — campaign events that move, add, remove, damage, repair, own, lock, unlock, use or otherwise change objects/structure.
3. **Ephemeral presentation cache** — loaded meshes, GPU resources, animation state, culling structures and other rebuildable data.

A delta record minimally contains:

```text
InteriorDelta
  eventId                 stable campaign event identity
  buildingId
  targetId                stable room/fixture/object/portal identity
  fantasyTimestamp
  kind
  payload
  schemaVersion
```

Replay order is deterministic: `(fantasyTimestamp, eventId)` after Simulation has validated event legality. If two changes conflict, the domain rule resolves them explicitly; storage/worker arrival order never decides.

Examples:

- moved furniture stores the authoritative new transform against its object ID;
- destroyed base fixture stores suppression/destruction state; regeneration does not resurrect it;
- newly introduced persistent item receives a campaign-stable ID and is layered into the room;
- ownership/lock changes persist without requiring the interior to remain loaded.

Checkpoint/compaction is permitted only when it is hash-equivalent to replaying the same ordered deltas. The immutable base recipe remains reproducible so cache reconstruction and migration diagnostics can distinguish generated foundation from campaign changes.

## 9. Demand loading and lifecycle

### 9.1 Logical states

Each building interior may be represented by these resource states:

```text
ABSENT     canonical building + persisted deltas exist; no interior recipe cache/resources
RECIPE     immutable structural/room recipe decoded or generated; no render resources
PREPARED   required nearby mesh/collision/nav/assets ready for a validated possible transition
ACTIVE     protagonist is inside or transition portal must be visibly coherent
CACHED     rebuildable resources retained opportunistically under shared app policy
```

State changes are resource/presentation behavior, not gameplay authority.

### 9.2 Materialization triggers

A full interior may be prepared only for direct player-relevant need, such as:

- the protagonist has chosen and Simulation has validated movement toward an entrance and is close enough that a transition can occur;
- the protagonist is already inside;
- an explicitly permitted local interaction/inspection requires interior structure rather than metadata.

These do **not** realize full interiors:

- atlas/settlement exterior visibility;
- ordinary building label visibility;
- an off-screen NPC schedule saying the NPC is inside;
- an Advisor inspecting coarse ownership/staffing metadata;
- renderer/backend changes;
- loading order or cache warmness.

### 9.3 Maximum simultaneous realization

The protagonist can physically occupy only one building interior. The architecture therefore sets a device-independent realization bound:

- **1 ACTIVE building interior maximum**;
- **1 additional PREPARED destination/transition interior maximum**;
- **0 background full interiors for off-screen NPC occupancy**.

Thus at most **2 building interiors** may hold realized geometry/collision/nav resources simultaneously under the ordinary transition flow. Larger castles/buildings may internally stream room/cell chunks, but still count as one building interior and must keep only the currently visible/adjacent bounded room set resident.

This bound may be tightened temporarily by shared resource pressure, but never relaxed by silently materializing every visible building.

### 9.4 Preparation and eviction

- Preparation can start before the protagonist reaches the threshold, but entry does not occur until structural, collision and nav prerequisites for the destination threshold/initial room are ready.
- A loading indicator or held door animation is presentation only; Fantasy Game Time and Simulation continue according to the existing authoritative clock policy.
- Cancellation leaves no state mutation unless Simulation already committed a separate world action.
- On exit, current authoritative deltas are already persisted independently of resources; resources become evictable.
- Eviction order follows the shared app/cache policy. Interior code must expose actual/estimated owned CPU/GPU/resource bytes and last-use/priority metadata rather than defining a competing hidden memory ceiling.
- Re-entry reconstructs the same immutable base and folds the same persisted deltas before presenting the room.

### 9.5 Reconstruction-latency evidence

Implementation acceptance records cold and warm prepare timings for all required archetypes on desktop/tablet/phone viewport classes and both WebGPU/WebGL2 paths. Record at least median and p95 for recipe generation, asset preparation, nav/collision preparation and first usable frame. These are measured evidence, not authority inputs.

The transition must never expose a blank/invalid room, allow movement before collision/nav is ready, or convert a slow load into a different layout. Physical-device FPS/thermal/memory claims require physical-device evidence.

## 10. Resource and rendering strategy

Interiors consume the existing shared application streaming/resource policy. They do not define a second app-memory budget.

Implementation rules:

- count interior mesh buffers, decoded assets, textures owned solely by interior residency, collision/nav data, recipe caches and persistent presentation records in shared accounting;
- reuse a small modular mesh library for walls/floors/doors/stairs/furniture families;
- reuse material families and texture atlases to avoid shader/material explosion;
- instance repeated furniture only within culling-friendly room/cell groups;
- batch static geometry in bounded room/cell groups, not across an entire large building when that defeats culling;
- unload rebuildable resources after exit/cache pressure while retaining asset metadata and persisted gameplay deltas;
- do not decode/load all culture variants for one interior;
- no per-visit recreation of unchanged shared materials or atlases.

Device quality may change shadow resolution, non-authoritative clutter density, animation, texture mip residency or prefetch distance. Structural walls/doors/stairs, functional fixtures and persisted objects remain semantically identical.

## 11. Visibility, occlusion and roof/wall presentation

Interior readability uses structural rooms/portals rather than drawing every room all the time.

- Exterior view: normal roof/walls remain visible.
- At a validated threshold transition: roof/upper-wall presentation may fade/cut away only as needed to reveal the occupied room and connected context.
- Inside: render the occupied room plus a bounded portal-visible/adjacent set. Hidden closed rooms can be culled even though their logical recipe exists.
- Looking out: keep the entrance exterior context coherent enough that exit direction is visually understandable.
- Large interiors use room/cell portal visibility plus camera frustum; no full-building draw requirement.
- Cutaway state is camera/presentation state only and never alters collision, ownership, security or line-of-travel rules.

Phone layouts must preserve the playable room and doorway. Inspection panels should collapse/minimize instead of covering the protagonist or entrance.

## 12. Same-world entry/exit flow

### 12.1 Inspection versus action

1. Advisor selects/inspects a building: show known canonical metadata and possible advice affordances. No movement occurs.
2. Advisor suggests entering or pursuing an indoor goal.
3. Character evaluates that advice.
4. Simulation validates route, access rights/state, door/portal legality and any required prerequisites.
5. If valid, the protagonist moves through the exterior route toward the canonical entrance.
6. The resource system may PREPARE the destination interior when the validated transition becomes relevant.
7. The protagonist crosses the canonical threshold; world position maps continuously through the entrance transform into interior-local presentation.
8. Camera/roof presentation changes without changing building identity or Fantasy Game Time.
9. Exit uses the inverse portal mapping and returns to the same exterior threshold/heading relationship.

A UI button may request/advice an action; it may not teleport the protagonist or bypass Character/Simulation.

### 12.2 Invalid or unavailable entry

If the entrance is locked, obstructed, inaccessible, destroyed or currently disallowed, Simulation returns an explicit reason. The interior generator is not allowed to move the door, choose a different building, remove the obstacle or reroll the layout just to make entry succeed.

If preparation fails for a technical reason, gameplay authority remains unchanged. The UI reports a load/technical failure and allows deterministic retry; it does not commit the crossing.

### 12.3 Camera continuity

The transition should preserve readable heading and selected-character context. Camera interpolation/cutaway is presentation-only. The acceptance test must verify no unexplained geographic recenter, identity swap or time reset occurs at entry/exit.

## 13. Analytical NPC occupancy

Residents do not require full interiors merely because schedules place them inside.

For an unrealized building, Simulation can represent an NPC's indoor state using:

```text
residentId
buildingId
activityAnchorId or roomRole
activity/task
fantasyTime interval/state
```

When the player approaches and the resident becomes relevant, the realized interior resolves the same stable anchor and derives the resident's legal local position/task from canonical state. Presentation cannot invent a different workplace/bed/guard assignment because a particular room happened to load first.

## 14. Required telemetry

Future runtime implementation must expose at least:

- logical interior foundations known in current focus;
- RECIPE / PREPARED / ACTIVE / CACHED counts;
- active building/room/cell IDs;
- recipe generation count/time and cache hit/rebuild count;
- owned estimated CPU/GPU bytes charged to shared policy;
- active meshes, material instances, draw calls/instance groups attributable to interior detail where measurable;
- collision/nav preparation count/time;
- cold/warm transition timings;
- persisted-delta count and reconstruction fingerprint;
- visible room/cell count versus total recipe room count.

Telemetry is diagnostic evidence only and cannot become generation authority.

## 15. Acceptance plan for implementation

### 15.1 Determinism and authority tests

For every representative building:

- same SEED/version/building inputs produce identical `baseRecipeHash`, room/portal/fixture/anchor IDs and structural transforms;
- reversed room queries, reordered visits, worker completion order and eviction/reconstruction produce identical results;
- WebGPU/WebGL2 and device/viewport class produce identical canonical fingerprints;
- no runtime RNG API participates in layout/fixture/identity selection;
- entrance world↔local round-trip and exit return agree within the spatial tolerance;
- invalid access cannot be bypassed by UI/loading state.

### 15.2 Persistence fixtures

For home and service-building fixtures:

1. enter;
2. perform a Simulation-valid change to a canonical object;
3. leave;
4. evict all rebuildable interior resources;
5. advance Fantasy Game Time where appropriate;
6. re-enter;
7. verify immutable base fingerprint is unchanged and persisted change remains;
8. repeat in reversed visit order and both renderer paths.

Also test destroyed/suppressed base objects, moved objects, new persistent objects, ownership/lock changes and deterministic delta ordering.

### 15.3 Functional building matrix

Fresh implementation acceptance covers at least:

- ordinary home;
- inn;
- blacksmith;
- butcher;
- farm/farmhouse plus barn;
- guard space;
- larger city/castle building context with vertical/public-private circulation.

Each scene validates room program, entrance, collision, nav, required interactive anchors, assigned occupant/staff capacity and legal exterior return.

### 15.4 Demand-loading/resource tests

Prove:

- exterior/atlas visibility of many buildings does not realize interiors;
- off-screen NPC occupancy does not realize interiors;
- ordinary flow never exceeds 1 ACTIVE + 1 PREPARED building interior;
- repeated entry/exit/revisit does not leak entities/assets and warm revisits reuse shared assets appropriately;
- cache eviction changes resource residency only, not canonical fingerprints or persisted state;
- shared streaming/accounting remains within the existing application policy on phone/tablet/desktop classes;
- large-building room/cell visibility remains bounded while hidden rooms stay logical.

### 15.5 UX/visual acceptance for the implementation WP

The architecture WP itself is FUNCTIONAL/ANALYSIS, so **VISUAL: N/A**. The runtime implementation must be classified MIXED and collect fresh screenshots on both WebGPU and automatic WebGL2 fallback.

Evidence must include phone portrait, phone landscape, tablet and desktop where applicable, showing:

- exterior approach and legal entrance;
- threshold/camera/roof transition;
- readable occupied interior with walls/doors/furniture at plausible scale;
- blocked/locked entry feedback without teleport;
- interior inspection that does not cover the relevant room/character;
- exit returning to the same exterior building/entrance;
- at least one persisted visible change after eviction/re-entry.

A runtime visual pass requires at least 8/10 and no major clipping, wall/roof occlusion, scale mismatch, unreachable door, floating furniture, unreadable panel or context-loss defect.

## 16. Failure modes the implementation must reject

- Detached interior scene with a new building identity.
- Entry by menu teleport without Character decision and Simulation-valid traversal.
- Layout or furniture rerolls after eviction, backend change or visit reordering.
- Full interior realization because an NPC is analytically inside.
- Rendering a doorway that does not exist in collision/navigation, or vice versa.
- Persisting only the loaded scene graph so eviction resets moved/damaged/owned state.
- Unbounded constraint retries after a procedural contradiction.
- Device-specific canonical room/fixture deletion to meet performance targets.
- A single giant batch/instance group that defeats room-level culling.
- Hidden independent memory budget that competes with shared app accounting.
- Cutaway/hidden wall presentation changing collision or security rules.
- Decorative inaccessible room satisfying a required functional role.

## 17. Recommended minimum implementation WPs

The research supports two small implementation packages. These are recommendations only; this analysis WP does not create or implement them.

### WP-S006-002-002 — Canonical usable-interior authority + same-world transition

Implement the minimum complete canonical subsystem: building/entrance/portal identity, deterministic functional room/structural generation with finite fallback, stable child IDs, shared render/collision/nav structural outputs, Character→Simulation validated entry/exit, persisted-delta layering, deterministic eviction/reconstruction and unit/integration fingerprints. Include a minimal player-visible inspection/transition surface so authority is testable. Classification: MIXED.

This package must remain independently solvable: if a required adapter is absent, implement the minimum adapter inside the WP rather than deferring acceptance.

### WP-S006-002-003 — Demand-loaded interior presentation/UX/performance + archetype acceptance

Implement reusable modular room/furniture kits, bounded room/portal visibility, roof/wall cutaway, responsive inspection/entry feedback, shared asset reuse/accounting, 1 ACTIVE + 1 PREPARED realization policy, required archetype scene coverage, telemetry and fresh WebGPU/WebGL2/mobile acceptance. It must preserve the canonical contracts above and implement any minimum missing adapter needed for its own acceptance rather than depending on another open Issue. Classification: MIXED.

## 18. Implementation checklist

Before either implementation package can close, verify:

- [ ] one canonical building identity spans exterior/interior;
- [ ] stable entrance/portal transforms round-trip;
- [ ] deterministic bounded generation with guaranteed fallback;
- [ ] functional room programs and capacity validate;
- [ ] render/collision/nav/interaction share structural truth;
- [ ] persisted deltas survive complete resource eviction;
- [ ] off-screen NPC occupancy remains analytical;
- [ ] ordinary flow stays at <=1 ACTIVE and <=1 additional PREPARED building interior;
- [ ] interior resources are charged to shared app accounting, not a new hidden ceiling;
- [ ] Character decision and Simulation validation precede entry/action;
- [ ] eviction/revisit/backend/device/visit order preserve canonical fingerprints;
- [ ] required building matrix and responsive UX are tested;
- [ ] fresh MIXED visual evidence is actually inspected before scoring runtime implementation.

## 19. Scope conclusion

The suitable architecture is not a second world or level reset. A usable interior is a **deterministic, lazily materialized view of the same canonical building**, derived from Campaign SEED and stable building context, overlaid with persisted Simulation-owned deltas. Exterior and interior meet at one canonical portal transform; Character/Simulation authority controls entry; shared streaming policy controls only when rebuildable resources are resident.

That separation lets the game support large logical populations and many buildings without eagerly realizing their rooms, while preserving the README requirement that entering a building means entering the same building in the same living world.
