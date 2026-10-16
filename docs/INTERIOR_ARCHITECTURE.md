# Usable Building Interior Architecture — WP-S006-002-001

Status: authoritative reference analysis and implementation plan for Stage S006. This document defines architecture and acceptance requirements only. It does **not** claim that enterable interiors are already implemented.

`docs/README.md` remains the product law. In particular, an accessible building is part of the same authoritative world; entering it must preserve the same building, occupants, location, history and campaign state. A detached duplicate scene, menu-only shortcut or presentation-owned interior is invalid.

## 1. Research conclusions

Current engine and production references converge on four patterns that fit The Advisor Game:

1. **Keep logical identity separate from loaded resources.** PlayCanvas distinguishes registry records from loaded runtime resources and supports explicit runtime load/unload. The useful lesson is to retain stable canonical records while releasing expensive resources when they leave the interest set. References: <https://developer.playcanvas.com/user-manual/assets/> and <https://developer.playcanvas.com/user-manual/assets/loading-unloading/>.
2. **Stream local detail instead of replacing the world.** PlayCanvas scenes/assets can be loaded separately, and Unity additive scenes demonstrate the general pattern of adding local content without discarding the already loaded world. The Advisor Game should use the principle without introducing a second scene authority. References: <https://developer.playcanvas.com/user-manual/editor/scenes/loading-scenes/> and <https://docs.unity3d.com/6000.0/Documentation/ScriptReference/SceneManagement.LoadSceneMode.Additive.html>.
3. **Reuse repeated geometry.** PlayCanvas hardware instancing is appropriate for repeated identical meshes, while batching is useful for nearby static geometry sharing materials. Batching has larger-culling and re-batching costs, so dynamic doors/containers/props should remain outside static batches. References: <https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/hardware-instancing/> and <https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/batching/>.
4. **Persistent world data must outlive streamed presentation.** The repository already follows this model in `docs/INVISIBLE_WORLD.md`: canonical identities and campaign revisions survive cache eviction, while visual detail is reconstructible. Interiors should extend that existing ownership model rather than invent another persistence system.

The references are architectural evidence, not rules copied from another engine. This project keeps PlayCanvas 2.23.0, its existing canonical planet coordinates, Campaign SEED authority, Fantasy Game Time and current streaming policy.

## 2. Root invariants

Every implementation must preserve all of these invariants:

- **One authoritative building.** Exterior footprint, entrances, interior rooms, occupants, ownership and live changes resolve to one canonical `buildingId`.
- **No random decision mechanics.** Layout and foundation content derive only from Campaign SEED, versioned domain keys and stable canonical addresses. Visit order, renderer, device and cache state never enter generation.
- **Portal continuity.** Exterior and interior share an invertible entrance mapping. Crossing a doorway changes presentation residency, not world identity.
- **Simulation owns movement.** A player or Advisor command can request an action, but protagonist position changes only after Simulation validates traversal and the entrance transition.
- **Cache is not state.** Unloading an interior may release meshes, collision, nav acceleration and instance buffers; it may not erase ownership, damage, moved objects, container contents, door state or other campaign facts.
- **Logical occupancy is independent of rendering.** NPC schedules may place residents inside an unrealized building. Their existence, task and ownership do not require an interior mesh or actor sprite to be loaded.
- **One collision/nav truth for a realized interior.** Visible walls, floors, openings and furniture clearance must agree with legal traversal.
- **Presentation adaptation is non-authoritative.** Device class may reduce decorative density, shadow quality or visible actor count; it may not remove rooms, doors, required workstations, residents or interactive objects.
- **No compatibility layer is required.** Interior records begin with the new versioned contract instead of preserving obsolete prototype formats.

## 3. Canonical data ownership

Interiors use three deliberately separate layers.

### 3.1 Immutable seeded foundation

`InteriorFoundation` is reconstructible from `(campaignSeed, interiorVersion, buildingId)` and contains only canonical initial facts:

- stable `buildingId` and archetype;
- floor count and floor-to-floor heights;
- `entranceId` records and exterior portal anchors;
- room graph, room polygons and room purpose;
- interior wall/opening topology;
- required semantic stations such as bed, counter, forge, anvil, prep table, storage, stall, guard post or stairs;
- canonical fixture identities and initial transforms;
- collision/nav recipe signature;
- presentation-kit references, not loaded resources.

IDs are address-derived strings, for example `BUILDING/<building>/ROOM/<n>` and `.../FIXTURE/<n>`. Enumeration is always stable-sorted before hashing or placement. Hashes may choose among finite authored forms, but they are pure keyed decisions from the canonical address; JavaScript RNG APIs are never used.

### 3.2 Persisted campaign deltas

`InteriorDeltaStore` owns changes that must survive time and residency transitions. Deltas reference stable foundation IDs and may include:

- moved or removed fixtures;
- opened/closed/locked doors and containers;
- item/container contents;
- damage and repair state;
- ownership or access-right changes;
- workstation usage state when gameplay requires persistence;
- later construction/replacement records;
- authoritative occupant-affecting events already owned by Simulation.

A delta never mutates the seed recipe. Rebuild is always `foundation + ordered persisted deltas at campaign revision`. Cache presence is not part of the result.

### 3.3 Ephemeral residency

`InteriorResidency` is disposable acceleration/presentation data:

- PlayCanvas entities and render instances;
- reusable mesh/material handles;
- static batch groups and instance buffers;
- collision shapes and local nav acceleration structures;
- cutaway/roof visibility state;
- visible actor sprites;
- short-lived interaction hit-test structures.

Destroying residency must leave the first two layers unchanged. Re-entering at the same campaign revision must reproduce the same authoritative signature.

## 4. Same-world coordinate and portal contract

Every enterable doorway has one `EntrancePortal` with:

- canonical exterior position in the existing spherical world authority;
- exterior elevation from the final composed surface/building pad;
- a normalized doorway forward vector, local right vector and up vector;
- doorway width/height and threshold depth;
- the destination floor and matching interior-local threshold transform;
- a stable `entranceId` shared by exterior and interior representations.

Each building defines a deterministic local metric frame anchored to its canonical exterior footprint. Interior coordinates are ordinary metres in that frame. A fixed transform maps local points to canonical world coordinates and its inverse maps world points back to local coordinates. The mapping is mathematical state, not a screen-space camera trick.

Entry sequence:

1. The protagonist reaches the legal exterior approach node through normal Simulation traversal.
2. Interaction requests entry at a specific `entranceId`.
3. Simulation validates that the entrance exists, is usable under current campaign state, and has legal clearance on both sides.
4. The residency service prepares the required interior if it is not ready. Loading feedback may appear, but it cannot move the character or alter authority.
5. After readiness, Simulation advances the protagonist through the threshold to the first valid interior nav sample within the same portal volume.
6. Camera/roof presentation transitions around that authoritative crossing.

Exit uses the exact inverse portal and returns through the same canonical doorway unless gameplay explicitly chooses another valid exit. A failed validation leaves the protagonist on the original side and reports the reason; it never silently moves the doorway, rerolls the room or teleports to a fallback scene.

Door thresholds, steps and ramps must share the same final elevation authority as the exterior building pad and connected path. Multi-floor transitions use canonical stairs/ramps/ladders owned by the room graph; a visual staircase without traversal connectivity is invalid.

## 5. Deterministic interior generation

Generation is a finite pipeline with stable ordering:

1. Read the canonical building footprint, archetype, owner/service identity and legal entrances.
2. Select one versioned archetype program from the building address.
3. Fit the room graph to usable footprint/floors while preserving every entrance and mandatory room/station.
4. Generate room polygons and circulation corridors.
5. Place walls, openings and vertical connections from the accepted topology.
6. Derive collision and nav surfaces from the same topology.
7. Place mandatory fixtures/stations first, then bounded optional furnishings from stable address slots.
8. Validate circulation, clearance, scale and semantic requirements.
9. Produce a canonical foundation fingerprint before any render resource is created.

Finite candidates use deterministic address order and explicit failure if none is legal. There is no unbounded retry loop and no camera-dependent fallback.

### Functional geometry rules

- Every enterable room is reachable from at least one legal exterior entrance or a legal internal connector.
- Required service stations have a traversable standing/working position and are not embedded in walls or other mandatory fixtures.
- Doors have clearance on both sides and do not open through authoritative obstacles.
- Furniture and props may narrow paths but cannot remove the minimum legal route to mandatory destinations.
- Interior floor area stays inside the building's accepted structural envelope unless the canonical building definition explicitly contains a cellar, overhang or annex.
- Character scale, doorway scale, furniture scale and room height use metric dimensions and remain plausible across archetypes.
- Foundation generation exposes validation errors instead of replacing illegal content with decorative-only stand-ins.

## 6. Required building programs

The first implementation evidence set must cover these distinct functional programs:

| Archetype | Minimum canonical program |
| --- | --- |
| Home | entry/circulation, sleeping place, table or hearth/living station, storage |
| Inn | public room, service counter, tables/seating, storage, sleeping rooms or clearly connected lodging area |
| Blacksmith | forge, anvil, workbench, storage and safe working clearance connected to the entrance |
| Butcher | customer counter, preparation station, storage and clean circulation between work/customer sides |
| Farm / barn | usable aisle, storage, livestock/stall or farm-work stations as appropriate, legal exterior yard/field access |
| Guard space | duty desk/post, equipment/storage, rest/bunk area when the building program calls for it, legal route to assigned gate/street |
| City/castle large context | multi-room or multi-floor example that proves the same portal, residency and resource rules scale beyond one small village house |

These are semantic requirements, not one repeated floor-plan template. Seeded variants should differ in legal room geometry, fixture arrangement and presentation while preserving the mandatory program.

## 7. Occupants and Fantasy Game Time

Simulation remains the authority for who is in a building and what they are doing. Interior residency is a query consumer.

- An off-screen resident can analytically be `at home`, `working in inn`, `at forge`, or another valid task without loading that interior.
- When an interior becomes resident, visible actors are materialized only for residents whose authoritative schedule/position intersects the realized space.
- Actor feet use authoritative world/local coordinates. Sprite pooling or device actor limits may hide presentation but may not change logical occupancy.
- Direct Fantasy Game Time catch-up updates authoritative schedules/deltas without stepping every unseen interior frame-by-frame.
- Re-entry at the same SEED, timestamp and campaign revision reproduces the same occupant/task result regardless of previous visit order.

## 8. Demand-loading lifecycle

Residency has a small explicit state machine:

`unrealized -> preparing -> ready -> occupied -> cooling -> unrealized`

Only protagonist-relevant work may request full realization: approaching an intended entrance, entering/occupying the building, an explicit close-range player inspection that requires geometry, or a transition target. Atlas visibility, exterior rendering, ordinary Advisor lookup and off-screen NPC occupancy may read lightweight canonical metadata but must not realize the full interior.

Preparation is resumable and cancellable. Work is divided into deterministic finite quanta so a superseded request can stop before GPU upload. Eviction removes only rebuildable residency.

### Initial residency ceilings

These are acceptance ceilings for the first implementation and live inside the existing `STREAMING_BUDGETS`; they are not new application-wide memory allowances.

| Device class | Fully occupied interiors | Additional warm transition interiors | Interior-specific CPU residency | Interior-specific GPU residency |
| --- | ---: | ---: | ---: | ---: |
| Phone | 1 | 1 | 16 MiB | 16 MiB |
| Tablet | 1 | 1 | 24 MiB | 24 MiB |
| Desktop | 1 | 2 | 32 MiB | 32 MiB |

Shared reusable kit assets are accounted separately and still count against the existing global application resource budget. A building request that would exceed a ceiling evicts the oldest cooling rebuildable residency first. The occupied interior and a portal transition target have priority over unrelated warm entries.

Implementation evidence must also report cold and warm preparation latency and the longest main-thread preparation slice. Initial acceptance target: no interior preparation slice above 8 ms in the automated reference environment; warm reconstruction p95 <= 250 ms and cold reconstruction p95 <= 750 ms for the canonical small-building fixture set. These are software-reference gates, not claims about physical phone hardware. Physical-device performance truth remains a later product gate.

## 9. PlayCanvas rendering/resource strategy

Use the engine's strengths without allowing rendering to become authority:

- Keep reusable GLB/material/texture assets in the asset registry and load them only when required; unload resources only when no resident consumer remains.
- Prefer shared low-poly structural kits and texture atlases over unique per-building materials.
- Use hardware instancing for repeated identical furniture/structural modules when the visibility bounds remain sensible.
- Batch nearby static walls/floors/trim that share material and lifecycle. Keep doors, containers, damageable objects and frequently changing pieces outside static batches because re-batching is comparatively expensive.
- Split roof, ceiling and upper-wall visibility groups from authoritative collision. Hiding a roof for readability never removes its collision/world identity.
- Pool actor sprites and common interaction markers.
- Do not retain generated CPU arrays after upload unless they are required for collision/nav or measured rebuild economics justify them.
- Resource ownership must be explicit so eviction destroys interior-owned buffers/entities without destroying shared kit assets still in use elsewhere.

Renderer selection (WebGPU or WebGL2 fallback) may change shaders/quality but cannot change room graph, fixture IDs, collision, nav, portal transforms, deltas or occupants.

## 10. Player-facing transition and readability

The intended flow is spatial, not menu-based:

- The player walks to the real exterior door and receives an **Enter** affordance only when the protagonist has a legal interaction position.
- Advisor/map inspection may reveal known building facts and occupants but does not move the protagonist.
- When entry is requested, camera focus stays attached to the protagonist/building. A short door/camera transition or loading indicator may mask resource readiness, but the authoritative crossing remains the doorway event.
- Once inside, the roof/ceiling and camera-facing upper walls may hide or cut away to keep the occupied room readable. Adjacent walls remain visible enough to communicate room shape and doors.
- Exiting reverses the same transition and restores exterior roof/wall presentation without changing building identity.
- Selected usable objects expose concise semantic interaction labels; ordinary gameplay does not show developer IDs unless diagnostics are enabled.
- On phone portrait/landscape, the selected object/occupant and primary action remain readable while leaving most of the room visible. Controls follow the repository's existing responsive and accessibility rules; an information sheet should collapse rather than permanently cover the doorway/character.
- Keyboard/focus and reduced-motion behavior must be supported by the same interaction surface, with no separate authoritative path.

## 11. Persistence and reconstruction proof

A canonical interior signature includes at minimum:

`buildingId + interiorVersion + foundationFingerprint + orderedDeltaRevision + portalFingerprint + roomGraphFingerprint + fixtureStateFingerprint`

Acceptance compares signatures across:

- first generation and reconstruction after eviction;
- different building visit orders;
- direct time catch-up versus incremental interest changes;
- WebGPU and WebGL2;
- phone/tablet/desktop presentation budgets;
- save/reload at the same campaign revision.

The signature must match whenever authoritative inputs match. Rendering counters and entity IDs are deliberately excluded because they are presentation details.

A mandatory persistence fixture is: enter -> move/use/change one authoritative object -> leave -> evict -> visit another building -> re-enter. The changed object must retain its new canonical state while the unchanged foundation reproduces exactly. A second fixture performs the same visits in reverse order and compares signatures.

## 12. Acceptance matrix for implementation WPs

### Functional gates

- Same SEED/version/building generates byte-stable canonical foundation records under repeated and reordered generation.
- Every portal transform is invertible within a documented metric tolerance and uses the same `entranceId` on both sides.
- Every mandatory room/station is legally reachable from the relevant entrance.
- Collision/nav topology agrees with visible walls, openings, stairs and mandatory fixture clearance.
- Simulation rejects an unusable/locked entrance without changing protagonist position.
- Off-screen NPC schedules and ordinary atlas/Advisor inspection create zero full interior residencies.
- Campaign deltas survive eviction, reload, visit reordering and direct Fantasy Game Time catch-up.
- Residency counts and interior-specific bytes remain within the device ceilings; repeated visit/evict cycles return to a stable baseline rather than growing monotonically.
- WebGPU/WebGL2 produce the same canonical fingerprints and interaction results.

### MIXED visual gates for the future implementation

Fresh screenshots must be captured and actually inspected on both renderer paths where technically possible. Required scenes are home, inn, blacksmith, butcher, farm/barn, guard space and one larger city/castle interior context, with representative phone portrait, phone landscape, tablet and desktop coverage. Evidence must show:

- readable exterior door -> threshold -> interior continuity;
- no unexplained position jump, wall/roof clipping or furniture penetration;
- useful room depth and distinct service identity rather than one repeated box;
- readable cutaway/roof behavior and character sprite anchoring;
- interaction UI that does not hide the relevant room/door on small viewports;
- exit returning to the same exterior building and doorway.

The implementation WP passes visual acceptance only under the repository's fresh-evidence score rule.

## 13. Minimum implementation packages recommended by this analysis

Do **not** add these lines to `docs/ROADMAP.md` or create their Issues until project planning rules permit it. They are research conclusions for the next S006 planning update.

- **WP-S006-002-002 — Same-World Interior UX & Portal Vertical Slice**
  - Independently deliver one canonical home plus one service building with real exterior-door interaction, Simulation-validated crossing, reversible portal coordinates, camera/cutaway presentation and responsive controls. Include minimal local deterministic foundation data needed for the slice; do not wait on another WP.
- **WP-S006-002-003 — Deterministic Interior Programs, Persistence & Demand Residency**
  - Independently deliver all required archetype programs, stable foundation/delta signatures, finite validation, eviction/reconstruction, occupant-query integration and measured residency ceilings. It may use its own canonical test portal fixture if the UX slice is not present; do not make completion depend on another Issue.
- **WP-S006-002-004 — Interior Resource/Renderer Integration & Full Acceptance Matrix**
  - Independently deliver shared PlayCanvas kits, instancing/batching/resource lifecycle, WebGPU/WebGL2 parity, repeated-cycle resource evidence and the complete home/inn/blacksmith/butcher/farm/guard/city-castle visual matrix. It may construct explicit canonical test buildings inside its own fixture scope; completion must not depend on another Issue.

The split keeps each package one-pass sized while preserving the project's no-dependency rule. Integration may reuse earlier shipped contracts when available, but each package must still prove its own success criteria from current `main`.

## 14. WP-S006-002-001 completion evidence

This analysis WP is **FUNCTIONAL/ANALYSIS**. `VISUAL: N/A` because it changes no runtime presentation and makes no visual implementation claim.

For this WP itself, acceptance is:

- current external reference research recorded above;
- repository/README/streaming/simulation architecture reconciled into one interior contract;
- explicit authority, portal, deterministic generation, persistence, demand-loading, rendering, UX and performance rules;
- quantified residency/latency targets and future visual scenes;
- minimum independent implementation packages proposed but not prematurely added to the ROADMAP;
- existing unit suite and production build remain green after documentation changes;
- exact deployed `main` commit verified before marking this WP completed and closing its Issue.
