# Natural terrain and hydrology — WP-S003-003-001

## Current execution contract — AGENT #1, 2026-10-14

This WP owns the priority-3 natural terrain and priority-4 freshwater foundation consumed by the shared final-surface authority. The aggregate world/final-surface generator remains version **v5**; accepted macro/political/climate layout recipes retain their explicit **v4** interpretation. Initial natural features are Campaign-SEED/address-defined only. Camera, viewport, renderer, cache state, visit order, worker completion order and wall-clock time never decide terrain, drainage, freshwater access or traversal identity.

The current bounded drainage plan provides 144 deterministic source slots per continent, eight source candidates per slot, up to **144 shorter main-channel stations**, ten tributary stations and 24 outlet probes per main interval. Main stations use 250–380 source-unit strides with gently varying deterministic steering; the shorter chords replace the previous 380–550 source-unit segmented presentation while retaining a fixed reach/work cap. The source index uses 1,024-source spatial buckets. Freshwater access uses a 4 km legal radius. Settlement candidate generation reserves 160 source units around accepted cores, preserves 6 km village and 18 km city separation, and remains capped at 220 city proposals, 20 child-layout trials and 280 village proposals per slot. Exactly three continents remain authoritative; country/city/village validation always consumes the actual canonical registries under the current >=30 / >=90 / >=270 lower-bound contract.

Natural mesh repair uses one bounded surface sampled from `finalSurfaceAt()` in affected local patches. Maximum affected tile size remains 2,048 source units, with 16,384 leaves and 65,536 cached samples. Narrow river/wet-boundary leaves retain the centre fan needed for canonical channel identity; uniform leaves use two triangles instead of an unnecessary four-triangle fan, and border skirts use bounded coarser segmentation. River detail targets remain 0.5/1/2 source units by tile size, additionally bounded by tile size/32. River-bank support is 6 source units so dry-to-wet transitions can blend over several close-detail samples without changing the authoritative wet channel.

The renderer/streaming envelopes remain unchanged: generation-ready queues 4/6/8 and CPU/GPU resource ceilings 96/160/256 MiB for phone/tablet/desktop, with one upload per frame. The implementation must meet those budgets by bounded generation, cache reclamation and lower presentation cost; it may not relax the documented ceilings. Continuous-zoom acceptance measures the stable post-transition state after obsolete LOD resources have had their normal reclamation update, and still fails if the budget does not recover within the existing timeout.

Rendering, picking, collision legality, routing and settlement/road legality consume the same final terrain/water/traversal truth. Explicit bridge evidence comes from a real deterministic road/natural-river intersection selected by `finalSurfaceEvidenceAnchors()`, never from a synthetic creek or historical midpoint. Route evidence likewise selects a current canonical road/terrain case that satisfies the unchanged acceptance property rather than assuming a particular S001 road remains representative after the natural-world foundation changes.

PlayCanvas Engine 2, WebGPU-preferred startup and automatic WebGL2 fallback remain required. Visual presentation must preserve the same canonical river/lake/coast/ridge identity across Realm↔local semantic zoom and across both backends. Fresh MIXED evidence must be actually inspected for coast/bank stepping, repetitive relief, river segmentation, mountain/cliff readability, seams, overlay alignment, viewport fit and backend mismatch before any visual score is assigned.

## Previous retained evaluation — AGENT #2

The retained candidate established 231 coarse drainage recipes. Canonical freshwater probes found all 324 then-current villages within 4 km of existing freshwater with dry/walkable cores. A fine-flow probe covered 233,920 points with zero sampled downstream bed rises and zero dry tributary gaps; 704 non-river main-path probes terminated in ocean/lake water. The deterministic representative natural bridge had a 78.49856522029202 m wet span. These are retained diagnostic results only and must be revalidated after the AGENT #1 station/mesh changes.

The prior run's full unit invocation finished 144/147, with three integration failures: a hard-coded historical road was no longer a mostly prepared legal route under the natural authority; the chosen difficult-route evidence did not satisfy the later asserted open-ground time comparison; and a historical synthetic bridge-midpoint fixture no longer matched the actual natural crossing. Native browser validation finished 27/29, with both continuous-zoom cases exceeding the stable resource gate as sampled at that time. Twenty-four WebGPU/WebGL2 desktop/phone scene captures were actually inspected at **VISUAL 7/10**: the main remaining presentation defects were serrated Street banks, mechanically segmented river bends, soft local mountain relief and coarse Realm coast/ridge stepping. No completion, main merge or deployment was claimed.

## AGENT #1 Attempt 1 changes

Attempt 1 keeps all authority and acceptance thresholds intact while correcting the retained integration/evidence mismatches and reducing presentation cost:

- drainage stations are shorter and more numerous within a fixed 144-station cap, with gentler deterministic steering;
- uniform natural-mesh leaves use two triangles while river/wet-transition leaves retain the higher-detail fan; border skirts are coarsened within the existing coverage contract;
- the road-speed regression chooses a real current canonical road route that still satisfies the original prepared-distance/open-approach/time bounds;
- terrain-cost evidence is selected using the same difficult-distance and open-ground-time conditions asserted by the test;
- bridge-refinement evidence uses the actual deterministic natural-water crossing and retains the same narrow-deck/color/legacy-slab assertions;
- continuous-zoom waits for both settled presentation and successful resource reclamation, without changing the resource limits or timeout.

Acceptance still requires the complete unit/build/browser suites, the continuous-zoom/perceptual matrix, fresh actual WebGPU/WebGL2 evidence with **VISUAL >=8/10**, successful deployment of the exact final `main` implementation/docs commit, completion bookkeeping deployment, and only then Issue closure. Physical-device FPS, thermal and memory behavior remain **UNVERIFIED** unless separately measured on real hardware.
