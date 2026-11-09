# Living fauna architecture (WP-S010-009-001)

Status: **binding research/architecture reference for WP-S010-009-001**, and the input contract for the follow-on implementation WP-S010-009-002. This document is planning and design only. It does **not** claim that any animal exists in the game, that any fauna mesh is loaded, or that any acceptance screenshot has been produced. `VISUAL: N/A (research-only; no runtime visuals modified)`.

`README.md` remains the game law. In particular:

- **Campaign SEED** fixes every canonical entity and its initial distribution. No runtime randomness decides what exists.
- **Simulation** authorizes real locations, actions and occupancy over Fantasy Game Time.
- **Presentation** only draws what the authoritative layers already resolved. A camera, viewport, streaming budget, device profile or frame timing may never spawn, move, rename or delete an animal.

The player is the Advisor: inspection may express intent, but no animal action becomes authoritative merely because the camera looked at it.

---

## 1. Current-source audit (2026-11-09)

What already exists and must be reused rather than duplicated:

| System | File | What fauna must consume |
|---|---|---|
| Canonical planet position | `src/planet.ts` | `lonLatToSource`, `sourceToLonLat`, `greatCircleDistance`, seam-safe `wrapSourceX` |
| Terrain identity | `src/climate.ts` | `TerrainClass` (real taxonomy below), `climateSampleAt`, `terrainLabel` |
| Settlement identity | `src/geography.ts`, `src/settlement-exterior.ts` | place codes, footprints, legal gates, service plots, barns/farmsteads, pastures |
| Wilderness identity | `src/wilderness.ts` | `WildernessKind` (`forest`, `lake`, `cliff`, `hill`, `wild-meadow`, `ruin`, …) and `wildernessCell` stable codes |
| Surface legality | `src/world.ts` (`finalSurfaceAt`) | walkable / water kind / ground height / deck policy |
| Resident pattern | `src/simulation.ts` | the proven "cold sieve → bounded query → worker shard → presentation" pipeline |
| Asset kit | `src/asset-meshes.ts`, `src/models` | optional GLB override with procedural fallback |
| Rendering budget | `src/streaming.ts`, `src/streaming-metrics.ts` | per-device admission, bounded caches, no per-frame full scans |

**Nothing in `src/` currently resolves, simulates, persists or draws an animal.** This document is the missing contract.

---

## 2. Reference analysis

Public references are used for architecture patterns only. Engine internals are re-checked against the shipped `playcanvas@2.23.0` in this repository before a slice is implemented.

| # | Source (dated) | Lesson used | Pitfall recorded |
|---|---|---|---|
| R1 | Elith & Leathwick, *Species Distribution Models: Ecological Explanation and Prediction Across Space and Time*, Annu. Rev. Ecol. Evol. Syst. 40:677–697, 2009. doi:10.1146/annurev.ecolsys.110308.120159 | Occurrence is a **function of environmental layers**, not a global density. Habitat suitability must be a per-cell predicate, which maps directly onto `TerrainClass` + slope + water + settlement layers. | Correlative envelopes assume equilibrium; a game has no observations, so we use an explicit **mechanistic** rule set instead (R2). |
| R2 | Kearney & Porter, *Mechanistic niche modelling*, Ecology Letters 12(4):334–350, 2009. doi:10.1111/j.1461-0248.2008.01277.x | Threshold rules derived from physiology-like constraints are the correct choice when no presence data exists: "species persists only inside these conditions". | Mechanistic models are labour-intensive; keep the rule set small and data-driven per species. |
| R3 | Reynolds, *Flocks, herds and schools: A distributed behavioral model*, SIGGRAPH '87, pp. 25–34. doi:10.1145/37401.37406 | Separation / alignment / cohesion produce believable herds and flocks from **local** rules. | Emergent motion is not authority: run it inside Simulation on legal ground, never in the renderer. |
| R4 | PlayCanvas engine `src/scene/batching/batch-manager.js` (2.23.0, read from `playcanvas/engine` main 2026-11-09) | Static/dynamic batching glues compatible meshes into one draw call. Groups split on material, shader defines, instance count and AABB size. | **65535-vertex** batch ceiling; ~**128 instances on low-end / 1024 on high-end**; rebatching a group is "potentially expensive"; skin/morph/clipped instances are excluded and drawn individually. |
| R5 | PlayCanvas user-manual batching, hardware instancing, loading/unloading, optimization guidelines (fetched 2026-11-09, mirrors the links already used by `docs/INTERIOR_ARCHITECTURE.md` §2.1) | On-demand asset load, prepare-as-a-group, bounded instancing, simple collision, shared-kit ownership. | Oversized batches reduce culling quality; very large cross-cell instance groups waste rendering work. |
| R6 | Wikipedia, *Species distribution modelling* (revision 1382043839, read 2026-11-09) — survey of BIOCLIM/MAXENT/J-SDM classes | Confirms the correlative-vs-mechanistic split and that **biotic interaction** and **dispersal barriers** are the usual gaps. | Do not pretend a niche model is a population model; explicitly define dispersal and barrier rules. |
| R7 | `docs/LIVING_WORLD_PLAN.md` (this repo) | Identity/home/activity survive LOD and cache eviction; off-screen life advances analytically, not per frame. | Camera-created actors are forbidden; reuse the resident query discipline. |
| R8 | `docs/INVISIBLE_WORLD.md` (this repo) | One shared CPU+GPU ceiling (~1 GB); everything streams and can be reconstructed from SEED. | Fauna gets **no separate hidden budget**; it competes inside the same ceiling. |

### 2.1 Consequence of R4/R5 for fauna

Animals are *many small repeated meshes near the camera*, the exact case batching handles well but skinning handles badly. Therefore:

- **One static mesh per species per LOD**, sharing one material family, so a herd batches into a single draw call.
- Animation is **either** a tiny baked vertex animation in the same material **or** procedural node transforms on a batched group (leg swing, wing flap, hop). No per-animal skeletal skinning, which R4 confirms would exclude the instance from batching.
- LOD is chosen by *screen coverage of the herd*, not by each individual, so one decision covers a whole group.

---

## 3. Ten invariants

**I1. SEED owns identity and initial placement.** Every animal individual and herd has a stable code derived from `digest(WORLD_SEED, region/settlement cell, species, ordinal)`. The same seed always yields the same species, the same herd membership and the same starting territory.

**I2. Simulation owns live location, action and occupancy.** Positions come from a validated Simulation state at the current Fantasy Tick, exactly like residents. The renderer's feet are a projection of that state.

**I3. The renderer only draws resolved facts.** A viewport, zoom tier, device class or streaming decision may change *which* resolved animals are visible, never *whether they exist*.

**I4. Habitat is a deterministic predicate, not a probability roll.** A candidate cell is eligible only if every rule in §5 passes. There is no `Math.random()` gate anywhere.

**I5. Illegal habitats have no animals.** A row in the matrix is a *hard negative*: ducks on dry grassland, cows indoors, gazelles on polar tundra and eagles in a town square evaluate to zero animals, and that is a tested case, not a preference.

**I6. Domestic stock needs an owner.** Barn/pasture species belong to a real SEED building or farmstead plot and cannot appear without one. Ownership is read from the settlement registry, never invented.

**I7. Wild territory is bounded and shared.** A herd has a home territory (a wilderness cell cluster or a pasture) and may wander only inside it plus a legal corridor. Dispersal is a slow, deterministic seasonal rule, not teleportation.

**I8. Background life is analytical and bounded.** Off-screen herds advance at coarse grain from tick formulas (like country summaries). Only view-adjacent herds resolve individuals. No per-frame scan of the whole world.

**I9. Meaningful events persist; trivia does not.** Herd territory shifts, an animal being killed/domesticated/freed and a herd's persisted state survive reload. A single frame's exact grazing pose is presentation, not save data.

**I10. Absence is honest.** If habitat, ownership or occupancy cannot be resolved, the answer is "no animal yet", never a fabricated cow. Fail empty.

---

## 4. Identity model

### 4.1 Two levels, one code space

```
wild herd      <regionCell>/WILD/<species>/HERD/<n>
wild individual <herdCode>/<ordinal>
domestic herd  <placeCode>/PASTURE/<plotId>/HERD/<n>
domestic animal <herdCode>/<ordinal>
```

`regionCell` is the canonical wilderness cell code; `plotId` is the real settlement plot id. Codes are derived by `digest`, are stable across reloads, and are **never reused** for a different species.

### 4.2 Individual vs herd

| Aspect | Herd | Individual |
|---|---|---|
| Authority | territory, membership, coarse state, daily phase | exact position when resolved, action, inspect data |
| Persistence | always | only if it changed something meaningful (I9) |
| Cost when off-screen | one tick formula | none |
| Cost when near | O(1) | O(members) |

Resolution radius uses the existing bounded-query discipline: a **close** band resolves individuals, a **far** band keeps the herd as one anchor (drawn as a small cluster or not at all), and beyond the band the herd has no rendered representation.

---

## 5. Habitat rule set

A candidate point `p` is eligible for species `s` when **all** of these pass, evaluated in this order (cheapest first):

1. **Terrain class** — `climateSampleAt(p).terrainClass` is in `s.habitats` (§6).
2. **Surface legality** — `finalSurfaceAt(p)` is walkable (or aquatic for swimmers), water kind matches `s.water` policy, ground height above the local water line where required.
3. **Slope** — local gradient ≤ `s.maxSlopeDeg`.
4. **Water distance** — `s.water === "required"` needs `distanceToWater(p) ≤ s.waterRadiusM`; `"none"` needs `> s.avoidWaterM`.
5. **Settlement rule** — `s.street` `"never"` → outside `place.radiusM + s.bufferM`; `"drove"` → inside a legal street/gate corridor only; `"allowed"` → streets and squares permitted.
6. **Ownership** — domestic species require a resolved barn/pasture plot with capacity.
7. **Danger / campaign state** — a persisted hazard (site ruin, conflict) may remove eligibility; it may never *add* it.

Cluster rule: a herd seeds on the best-scoring eligible cell within its territory, then members stand on a deterministic golden-angle spiral (same pattern as resident standing slots), so neighbours never fuse into one silhouette.

---

## 6. Species habitat matrix (all 13 owner-requested species)

Terrain tokens are the real `TerrainClass` values from `src/climate.ts`.

| Species | Kind | Habitats (terrainClass) | Water | Max slope | Pasture / barn | Street rule | Grouping | Signature action |
|---|---|---|---|---|---|---|---|---|
| goats | domestic | `highland`, `cliff`, `dryland`, `grassland`, `bare-earth` | `required` within 120 m | 28° | barn + fenced pasture required | `drove` | herd 3–8 | graze, climb, headbutt |
| sheep | domestic | `grassland`, `meadow`, `highland` | `required` within 150 m | 18° | barn + pasture required | `drove` | flock 6–20 | graze, flock, huddle |
| pigs | domestic | `bare-earth`, `temperate-forest`, `grassland` | `required` within 60 m (wallow) | 12° | sty + yard required | `never` | sounder 2–6 | root, wallow, rest |
| horses | domestic | `grassland`, `meadow`, `dryland` | `required` within 200 m | 15° | stable + paddock required | `drove` (ridden/dray) | herd 1–5 | walk, trot, graze |
| cows | domestic | `grassland`, `meadow` | `required` within 180 m | 14° | byre + pasture required | `drove` | herd 4–12 | graze, chew, low |
| buffaloes | domestic | `grassland`, `dryland`, `beach` | `required` within 90 m (wallow) | 12° | byre + wallow required | `drove` | herd 3–8 | wallow, graze, wade |
| gazelles | wild | `dryland`, `dry-woodland`, `grassland` | `required` within 400 m | 20° | none | `never` | herd 5–15 | graze, bound, flee |
| rabbits | wild | `meadow`, `temperate-forest`, `grassland` | `none` (avoid > 40 m) | 25° | none | `never` | warren 3–10 | hop, sit, bolt |
| crows | wild | `temperate-forest`, `conifer-forest`, `grassland`, `bare-earth` | `none` | 35° | none | `allowed` (scavenge) | flock 4–18 | perch, caw, fly |
| pigeons | wild/domestic | `grassland`, `meadow`, `bare-earth` near a settlement | `none` | 30° | cote optional | `allowed` | flock 5–20 | peck, perch, flutter |
| eagles | wild | `highland`, `cliff`, `snowy-mountain`, `conifer-forest` | `none` | 45° (eyrie on cliff) | none | `never` | pair/solitary | soar, stoop, perch |
| ducks | wild/domestic | `lake`, `beach`, `grassland` beside water | `required` (swim) | 8° | pond optional | `never` | raft 3–12 | swim, dabble, preen |
| frogs | wild | `lake` shore, `meadow`, `grassland`, `temperate-forest` near water | `required` (amphibious) | 15° | none | `never` | chorus 2–8 | hop, bask, croak |

**Hard negatives (tested):** ducks on `desert` or `tundra` → 0. Cows inside a residence footprint → 0. Eagles on a settlement square → 0. Gazelles on `polar-ice` → 0. Any domestic species without a resolved pasture → 0. Rabbits in open water → 0.

---

## 7. Daily behaviour contract

Each species has a small deterministic state machine driven by local Fantasy Time and its habitat, never by the camera:

```
rest → graze → drink → move → rest     (grazers)
perch → fly → scavenge → perch          (crows, pigeons)
soar → hunt → perch → soar              (eagles)
swim → dabble → preen → bank            (ducks)
hop → bask → hide → hop                 (rabbits, frogs)
```

Rules:

- Transitions use `digest(herdCode, dayIndex)` for *which* legal transition is taken, so replays match.
- Movement targets are legal habitat cells inside the territory, reached by a straight legal segment (aquatic species swim along water, never over land beyond a bank).
- A blocked step stops the animal at its real position; it does not teleport.
- Predator/flight response is a bounded radius rule (R3 separation/alignment), resolved inside Simulation, and always yields to surface legality.

---

## 8. 3D asset, animation and LOD plan

### 8.1 Meshes

- One low-poly static mesh per species per LOD tier, authored or procedurally generated, **GLB preferred** with the existing `src/asset-meshes.ts` procedural fallback.
- Shared toon/cel material family, palette per species; no per-animal material instances.
- Triangle budgets (targets, to be measured in #548, labelled **unmeasured** here):

| Tier | Landscape usage | Triangle target per species mesh | LODs |
|---|---|---|---|
| Hero (< 20 m half-height) | closest animals, inspect | 350–900 | LOD0 |
| Close (< 80 m) | street/farm animals | 180–450 | LOD1 |
| Street (< 400 m) | distant herds | 60–160 | LOD2 |
| Region / globe | none | — | culled |

- One LOD decision per herd by projected screen coverage; individuals inherit it.
- Wings/legs animate procedurally (node rotation or baked vertex offsets) so the mesh stays batchable (R4).

### 8.2 Draw-call strategy

- A herd is one **dynamic batch group** keyed by `herdCode` and LOD; rebuild only when membership changes or the herd crosses a band (R4 warns rebatching is expensive, so batch per herd, not per animal).
- Flocks (crows/pigeons) and batched ducks use the same group rule.
- Beyond the close band, the herd collapses to a single instanced cluster mesh or nothing.

### 8.3 Budget and admission

- Fauna shares the existing ~1 GB CPU+GPU envelope (R8) and is admitted by the same device policy as terrain/residents.
- Hard visible-instance caps per device class (targets, unmeasured until #548): low-end 24 individuals, mid 64, high 160.
- No shadow casting beyond the close band; no per-animal point lights.

---

## 9. Inspection and accessibility

- Clicking/tapping an animal opens the existing card pattern with **species name, kind (wild/domestic), owner herd/building, current action, habitat, Fantasy Time phase**.
- Animals are never labelled with raw SEED codes; codes stay in a technical disclosure like residents.
- Touch target ≥ 44 px, keyboard reachable through the same nearest-target mechanism used for residents.
- A screen-reader label names the species and action; colour is never the only signal.
- Purely decoy scenery is forbidden: if it can be seen, it can be inspected and it is Simulation-backed.

---

## 10. Concrete acceptance scenes for WP-S010-009-002

Each scene names the fixed focus, what must be true, and the negative that must also hold.

| Scene | Fixed setup | Positive assertion | Negative assertion |
|---|---|---|---|
| Farm pasture | A village farmstead with a cow herd at Hero | ≥ 4 cows grounded in the pasture, grazing/chewing, feet on surface | no cow inside a house footprint or on a street |
| Barn + yard | Barn door open, pigs and goats | pigs in wallow/yard, goats on highland pasture | 0 pigs outside their owned yard |
| Marché street | Town square midday, crows + pigeons | birds perched on roofs/square, some flying | no eagle, no cow on the square |
| Lake bank | Lake shore at Close | ducks swimming, frogs at the bank | 0 ducks on dry grass; 0 rabbits in water |
| Highland cliff | Cliff/highland at Close | eagles soaring/perched on the cliff | 0 cows on `cliff` |
| Polar negative | `polar-ice`/`tundra` region | 0 of every warm-species | — |
| Reload parity | Any scene, reload | identical herd codes/positions for the same tick | no invented animal after cache eviction |

Evidence format follows the repo rule: `tools/screenshot_tool.py` real-game captures, 1920×1080 and 1080×1920 where layout changes, WebGPU and WebGL2, original PNGs inspected, score recorded per scene.

---

## 11. Testable contracts for the follow-on WP

1. **Determinism** — for a fixed seed, tick and region, the resolved animal set (codes, species, positions) is byte-identical across two fresh runs and after cache eviction.
2. **Habitat legality** — every resolved animal passes §5 at its own point; every §6 hard negative resolves to zero.
3. **Ownership** — every domestic animal maps to a real SEED pasture/barn with capacity.
4. **No camera spawning** — teardown/rebuild of the renderer, viewport resize and zoom round-trips change presentation only; the authoritative set and positions are unchanged.
5. **No teleport** — consecutive resolved positions are separated by at most `maxSpeed × Δt × 1.1` and every segment is legal.
6. **Persistence** — a persisted herd event (territory shift, animal removed) replays exactly once across reload.
7. **Budget** — visible-instance caps and draw-call counts stay inside the device envelope on both backends.
8. **Accessibility** — inspect target reachable by pointer, touch and keyboard; label names species and action.

These are the gates this architecture requires of WP-S010-009-002; they are not yet implemented and are not claimed as passing.

---

## 12. Explicit non-goals

- Not a physics engine, not ragdolls, not navmesh pathfinding around arbitrary geometry.
- Not a second population ledger; fauna reuses the resident streaming/persistence discipline.
- Not camera-authored life; no "spawn when looked at".
- Not fantasy creatures — those are separate follow-on work; this WP covers the 13 named real animals.
- Human characters remain 2D billboards; only animals become 3D meshes.

---

## 13. References

1. Elith, J. & Leathwick, J. R. (2009). *Species Distribution Models: Ecological Explanation and Prediction Across Space and Time.* Annu. Rev. Ecol. Evol. Syst. 40: 677–697. doi:10.1146/annurev.ecolsys.110308.120159
2. Kearney, M. & Porter, W. (2009). *Mechanistic niche modelling: combining physiological and spatial data to predict species' ranges.* Ecology Letters 12(4): 334–350. doi:10.1111/j.1461-0248.2008.01277.x
3. Reynolds, C. W. (1987). *Flocks, herds and schools: A distributed behavioral model.* SIGGRAPH '87, 25–34. doi:10.1145/37401.37406
4. PlayCanvas Engine 2.23.0, `src/scene/batching/batch-manager.js` — https://github.com/playcanvas/engine/blob/main/src/scene/batching/batch-manager.js (read 2026-11-09).
5. PlayCanvas user manual — batching https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/batching/, hardware instancing https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/hardware-instancing/, asset loading/unloading https://developer.playcanvas.com/user-manual/assets/loading-unloading/, optimization guidelines https://developer.playcanvas.com/user-manual/optimization/guidelines/ (fetched 2026-11-09).
6. Wikipedia, *Species distribution modelling*, revision 1382043839 (read 2026-11-09) — https://en.wikipedia.org/wiki/Species_distribution_modelling
7. Wikipedia, *Boids*, revision 1382465991 (read 2026-11-09) — https://en.wikipedia.org/wiki/Boids
8. This repository: `docs/LIVING_WORLD_PLAN.md`, `docs/INVISIBLE_WORLD.md`, `docs/PRESENTATION_ARCHITECTURE.md`, `docs/INTERIOR_ARCHITECTURE.md`.
