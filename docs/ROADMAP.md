# The Advisor Game — ROADMAP

## Roadmap Rule

ROADMAP contains only Stage headings plus Work Package codes and titles.

All Work Package details — including Goal, Scope, Rules, In-Game Proof, Pass Condition, implementation notes, verification evidence, and status — belong in the corresponding GitHub Issue. GitHub Issues are the source of truth for executable WP details.

Work Package codes use zero-padded three-digit numeric segments:

- main WP: `WP-S###-###`
- sub-WP: `WP-S###-###-###`

# Stage 1 — Deterministic World Foundation

- `WP-S001-001` — Base Game, Campaign SEED and Game Clock — COMPLETED
- `WP-S001-002` — Deterministic Foundation and Live Randomness — COMPLETED
- `WP-S001-003` — Infinite World Coordinates + Protagonist Origin — COMPLETED
- `WP-S001-004` — SEED-Generated Geographic Hierarchy + Realistic Settlement Spacing — COMPLETED
- `WP-S001-005` — Viewport-Filling Solid-Color Tiles — COMPLETED
- `WP-S001-006` — Camera Movement Through the Infinite World — COMPLETED

# Stage 2 — Starting Village Physical Foundation

- `WP-S002-001-001` — Starting Village Core + Mainland Connection — COMPLETED
- `WP-S002-001-002` — Tile-Based House Plans + Wall Foundation — COMPLETED
- `WP-S002-001-003` — Rounded Terrain Border Blending — COMPLETED
- `WP-S002-001-004` — Deterministic Terrain Blend Variation — COMPLETED
- `WP-S002-001-005` — Diagonal + Multi-Terrain Junction Smoothing — COMPLETED
- `WP-S002-002` — Special Buildings + Functional Lots — COMPLETED
- `WP-S002-003` — Authoritative Walkability and Collision Foundation — COMPLETED
- `WP-S002-003-001` — Elevation + Slope-Aware Walkability, Climbability + Cliff Blocking — COMPLETED
- `WP-S002-004` — Deterministic Local Route Planning — COMPLETED
- `WP-S002-004-001` — Elevation-Aware Route Cost + Valley/Pass Preference — COMPLETED

# Stage 3 — TOP PRIORITY BLOCKER: SEED Coordinate Fabric + Spatial Registration + Landmark Callouts

- `WP-S003-001` — Legacy PixiJS GPU 2.5D Renderer Foundation — COMPLETED
- `WP-S003-001-001` — PlayCanvas Engine 2 Renderer Migration Foundation — COMPLETED
- `WP-S003-001-002` — Orthographic 3D Scene + Mobile WebGL2/WebGPU Baseline — COMPLETED
- `WP-S003-001-003` — Canonical Root PlayCanvas Cutover — COMPLETED
- `WP-S003-002` — Authoritative Enterable Building Interiors — COMPLETED
- `WP-S003-003` — Interior Objects + Interaction Points — COMPLETED
- `WP-S003-003-001` — Interactable World Objects + Contextual Use Actions — COMPLETED
- `WP-S003-004` — Layered 2.5D Building Presentation + Interior Visibility — COMPLETED
- `WP-S003-004-001` — Tall 2.5D Building Mass + Local Character Occlusion Cutouts — COMPLETED
- `WP-S003-004-002` — 2D Character Billboard Rendering in the 3D World — COMPLETED
- `WP-S003-004-003` — Correct Gabled Roof Geometry + Building Contact — COMPLETED
- `WP-S003-004-004` — Camera-Facing Character Billboards + Zoom Readability — COMPLETED
- `WP-S003-004-005` — 2× Active Character Billboard Presentation Scale — COMPLETED
- `WP-S003-004-006` — NPC Viewport-Edge Visibility Stability — COMPLETED
- `WP-S003-005` — PlayCanvas 3D Asset + Material Preparation Pipeline — COMPLETED
- `WP-S003-005-001` — Adaptive 3D Texture Quality + Mobile GPU Budget — COMPLETED
- `WP-S003-005-002` — GLB Mesh, Material, LOD + Instancing Asset Standard — COMPLETED
- `WP-S003-005-003` — PlayCanvas Terrain PNG-First + SVG-Fallback Textures — COMPLETED
- `WP-S003-005-004` — Building Surface Textures + SVG Asset Fallback — COMPLETED
- `WP-S003-005-005` — Fix Terrain Atlas UV Row Orientation + Black Surface Regression — COMPLETED
- `WP-S003-005-006` — Runtime Building + Tree Material/Texture Lifetime Stability — COMPLETED
- `WP-S003-005-007` — Live Texture Quality Rebuild + Ultra Resolution Application — COMPLETED
- `WP-S003-006` — PlayCanvas 3D Terrain Chunk Mesh + Background Preparation — COMPLETED
- `WP-S003-006-001` — Adjustable Terrain Chunk Size — COMPLETED
- `WP-S003-006-002` — Adjustable Terrain Preload + Chunk Cache Budget — COMPLETED
- `WP-S003-006-003` — Chunk-Native World Data + Complete 3D Background Preparation — COMPLETED
- `WP-S003-006-004` — Persistent PlayCanvas Scene Graph + Navigation Hot-Path Elimination — COMPLETED
- `WP-S003-006-005` — 3D Culling, Static Batching + Hardware Instancing — COMPLETED
- `WP-S003-006-006` — Detailed 2D Tree Plane Presentation + Instancing — COMPLETED
- `WP-S003-006-007` — Low-Poly Chunk Heightfield Terrain + Shared Elevation Anchoring — COMPLETED
- `WP-S003-006-008` — Low-Cost Terrain Surface Micro-Relief + Material Depth — COMPLETED
- `WP-S003-006-009` — Raised Road + Path Surface Profiles on Heightfield Terrain — COMPLETED
- `WP-S003-006-010` — Adaptive Idle Chunk Cache Expansion — COMPLETED
- `WP-S003-006-011` — Responsive Long-Distance Chunk Streaming + Area Loading Gate — COMPLETED
- `WP-S003-006-012` — Hydrology-Carved Basins + Depressed Water Surfaces — COMPLETED
- `WP-S003-006-013` — Fantasy Planet Sphere Foundation (10% Earth Scale) — COMPLETED
- `WP-S003-006-014` — Seeded Planetary Oceans, Continents, Islands + Macro Height Relief — COMPLETED
- `WP-S003-007` — Orthographic 3D Camera + Depth, Lighting + Interior Visibility — COMPLETED
- `WP-S003-007-001` — Mobile Adaptive Quality + Dynamic Render Scale — COMPLETED
- `WP-S003-008` — Responsive Gameplay Control Deck + Multimodal Navigation — COMPLETED
- `WP-S003-008-001` — Screen-Space Camera Navigation Mapping for Rotated PlayCanvas View — COMPLETED
- `WP-S003-008-002` — Colorful Animated Scene Loading Status + Ready Transition — COMPLETED
- `WP-S003-008-002-001` — Real First-Playable Loading Progress + Animated Phase Feedback — COMPLETED
- `WP-S003-008-003` — Functional Projection-Aware Mini Map — COMPLETED
- `WP-S003-008-004` — Responsive Startup Work Slicing + Main-Thread Stall Prevention — COMPLETED
- `WP-S003-008-005` — World Destination Navigator + Nearby Places Popup — COMPLETED
- `WP-S003-009` — Loading-Screen-Inspired Living World Visual Direction Foundation — COMPLETED
- `WP-S003-009-001` — Starting Village Environmental Dressing + Semantic Prop Placement — COMPLETED
- `WP-S003-009-002` — Road Network Hierarchy + Raised Surface + Door Connector Paths — COMPLETED
- `WP-S003-009-003` — Terrain/Object Contact Shadows + Grounding — COMPLETED
- `WP-S003-009-004` — Deterministic Material Variation + Effective Ultra Texture Quality — COMPLETED
- `WP-S003-009-004-001` — Terrain Surface Identity + Blend Weight, UV + Material Binding Correction — COMPLETED
- `WP-S003-009-004-002` — Tile-Authoritative Grouped Surface Regions + Smooth Contours — COMPLETED
- `WP-S003-009-005` — Loading-Screen-Inspired Unified Character, Tree + 3D Environment Art Treatment — COMPLETED
- `WP-S003-009-006` — Architectural Entrance Readability + Threshold Dressing — COMPLETED
- `WP-S003-009-007` — Settlement Landmarks + Visual Hierarchy — COMPLETED
- `WP-S003-009-008` — Large-Scale Terrain Variation + Semantic Wear Zones — COMPLETED
- `WP-S003-009-009` — Low-Cost Ambient Life Motion + Environmental Animation — COMPLETED
- `WP-S003-010` — Continuous Planet-to-Ground Zoom + Multi-Scale Focus Foundation — COMPLETED
- `WP-S003-010-001` — Globe-to-Surface Focus Anchor + Projection Transition — COMPLETED
- `WP-S003-010-002` — Viewport-Bounded Ground Detail + 2 m Surface Resolution — COMPLETED
- `WP-S003-010-003` — Zoom-Driven Detail Refinement + Off-Screen Eviction — COMPLETED
- `WP-S003-010-003-001` — Zoom-Aware Geographic Labels, Borders, Scale Ruler + Streaming Pace — COMPLETED
- `WP-S003-010-003-002` — Smooth Mid-Zoom Projection + Country/Region Scale Rebalance — COMPLETED
- `WP-S003-010-003-003` — Zoom-Only Camera Orientation + Focus Continuity — COMPLETED
- `WP-S003-010-003-004` — Terrain-Anchored Landmarks + World-Projected Political Borders — COMPLETED
- `WP-S003-010-003-005` — Seamless Viewport-Filling Multi-LOD Terrain Continuity — COMPLETED
- `WP-S003-010-003-005-001` — Zero-Movement Geographic Identity + Focus Lock Across LODs — COMPLETED
- `WP-S003-010-003-005-002` — True Cross-LOD Surface Refinement + Texel/Geometry Density Continuity — COMPLETED
- `WP-S003-010-003-006` — Streaming-Safe Scale Ladder + Ready-LOD Semantic Handoffs — COMPLETED
- `WP-S003-010-003-007` — Progressive Local/Settlement World Reveal Before Ground — COMPLETED
- `WP-S003-010-003-008` — Canonical Zoom-Aware Globe Atlas Labels + Visible-Screen Culling — COMPLETED
- `WP-S003-010-003-009` — Canonical Planet/World Coordinate Registration + Political Atlas Integrity — COMPLETED
- `WP-S003-010-003-010` — TOP PRIORITY BUG: SEED-Only Canonical Political Boundaries + SEED-Only Important-Place Placement — COMPLETED
- `WP-S003-010-003-011` — TOP PRIORITY BUG: Pure Zoom + Canonical 1/N Scale Ladder + Scale-Aware Navigation — COMPLETED
- `WP-S003-010-003-012` — TOP PRIORITY BUG: SEED Coordinate Fabric + Gameplay-Center Marker + Landmark Callouts — COMPLETED
- `WP-S003-010-003-013` — Screen-Space-Error Hierarchical Spatial LOD + Canonical Cell Refinement — COMPLETED
- `WP-S003-010-003-014` — Physical-Scale Semantic Layer Ladder + Stable Label/Border/Route Decluttering — COMPLETED
- `WP-S003-010-003-015` — TOP PRIORITY BUG: SEED-Only Settlement Hierarchy + Realistic Physical Spacing — COMPLETED
- `WP-S003-010-003-016` — Temporal-Coherent Detail Residency + Ready-Child Handoff + Navigation Prefetch — COMPLETED
- `WP-S003-010-003-017` — TOP PRIORITY REGRESSION: Planet-Scale Semantic Cleanup + Explainable Marker Visibility — COMPLETED
- `WP-S003-010-003-018` — Smooth Animated Zoom + Intermediate Physical Scale Ladder — COMPLETED
- `WP-S003-010-003-019` — Focus-Centric Layered World Streaming + Center-First Detail Refinement — COMPLETED (AGENT #6; accepted Final Attempt 3 exact product head `58a67087ccb10432700f27ab893854b8d40df53d`, dedicated workflow `36593548216`, artifact `11044724451`: FUNCTIONAL PASS / VISUAL 8.1/10 PASS after direct inspection of all 9 fresh exact-head frames. Canonical two-SEED focus/medium/outer/global-root streaming uses 1×/3×/6× center-first refinement, <=8 resources / 48 MiB, one cooperative build job, retained parent coverage, atomic handoff, pan-back reuse, missingCoverageCount=0, fullWorldScan=false and globalHighDetailMaterialized=false. Route approach uses pure bounded `route-overview-plan-v1` + canonical existing-road gateway centerline; terrain uses restrained v22 SEED-registered directional relief. Accepted implementation/docs head `664751683f775e0057465c788e32216bbf562fd8` deployed successfully via GitHub Pages run `36594928727` before completion bookkeeping.)
- `WP-S003-010-003-020` — World-Map Navigation Performance Budget + Main-Thread Stutter Elimination — IN PROGRESS (AGENT #6; Phase 19 capped 2026-09-30. Attempt 1 `4bbcb2d877260495161e8d68f5d9646ef31e46b7` / workflow `36668070541` / artifact `11077077397`: FUNCTIONAL PASS / VISUAL 7.8/10 FAIL; strategic continuous-parent compositing removed the former 1/75 rectangular focus/context handoff. Attempt 2 `bc0faed15a69a9026693d5a7a2a317b68626e155` / workflow `36669468650` / artifact `11077533988`: FUNCTIONAL PASS / VISUAL 7.9/10 FAIL; physically resolvable 1/500 registered structure and route/roof styling improved, but the ~1/50 gray ridge remained. Final Attempt 3 `9f3788b2a19499668e0dcb0f57c013f0d1d643e7` / workflow `36670578166` / artifact `11078685710`: FUNCTIONAL PASS with canonical `6fe0130c` / `SCF-B83ABE19` / `5BD86CDF`, frame 3.8 ms, preparation 17.3 ms, semantic 22.4 ms, ResidentMovement 6.1 ms, swap 3.8 ms, <=8 resources / 48 MiB, one cooperative job, `missingCoverageCount=0`, `fullWorldScan=false`; all 12 fresh production screenshots directly inspected, VISUAL 7.9/10 FAIL. The prior rectangular handoff is fixed, 1/500 is materially more readable, and 1/2500 grouping is improved with the exact canonical settlement envelope/footprints/access/vegetation, but the first ~1/50 strategic transition still exposes a dominant blurred gray/white regional ridge. Three-attempt cap exhausted; no fourth loop. NOT COMPLETED.)
- `WP-S003-010-004` — Ground-Level Static World Projection + 3D Gameplay Area — COMPLETED
- `WP-S003-010-005` — Zero-Movement Planet-to-Ground Zoom End-to-End Acceptance — COMPLETED
- `WP-S003-011` — Clickable NPC + Building Inspection Tooltips — COMPLETED
- `WP-S003-012` — Day/Night Atmospheric Color + Lighting Palette — COMPLETED
- `WP-S003-013` — Biome-Aware Wilderness Dressing + Ambient Fauna — COMPLETED
- `WP-S003-014` — Reactive Ambient Wildlife Behavior — COMPLETED
- `WP-S003-015` — Contextual Building Activity Indicators — COMPLETED
- `WP-S003-016` — Local Environmental Reaction Effects — COMPLETED
- `WP-S003-017` — Positional Ambient Soundscape + Activity Audio — COMPLETED
- `WP-S003-018` — Regional Weather Presentation + Local Behavior Hooks — COMPLETED
- `WP-S003-019` — Seasonal World Presentation + Vegetation State — COMPLETED
- `WP-S003-020` — Function-Readable Building Surroundings + Ownership Cues — COMPLETED
- `WP-S003-021` — Campaign-State Environmental Wear, Damage + Recovery Projection — COMPLETED
- `WP-S003-022` — Crossroads Direction Signposts + Named Route Wayfinding — COMPLETED

# Stage 4 — Starting Village Population + Indoor Activity Foundation

- `WP-S004-001` — Deterministic Starting Village Resident Roster — COMPLETED
- `WP-S004-002` — Homes, Professions + Indoor Workplace Assignment — COMPLETED
- `WP-S004-003` — Deterministic Daily Activity + Action Targets — COMPLETED
- `WP-S004-004` — Autonomous Indoor/Outdoor Route Execution + Visible Movement — COMPLETED
- `WP-S004-004-001` — NPC Building Approach, Occlusion + Separation — COMPLETED
- `WP-S004-005` — Interior Action Execution + Character State Presentation — COMPLETED
- `WP-S004-006` — Local NPC Social Encounters + Group Activity — COMPLETED
- `WP-S004-007` — Profession-Specific Visible Work Cycles + Workplace Choreography — COMPLETED (AGENT #6; exact accepted product head 4afaaecb54ae6e017ae0db87de4163d2935615db; dedicated functional workflow 36515199494 SUCCESS with deterministic SEED + fantasy work-block-minute authority, six representative professions, 5 indoor professions, outdoor pass, real-target/route pass, exact worker cap 12, generic fallback, fullSettlementPerFrameScan=false, routePlanningPerFrame=false, economyAuthority=false and resourceMutation=false; dedicated visual workflow 36515199557 SUCCESS with portrait artifact 11011085163 + landscape artifact 11010617026; all 8 fresh smith/shopkeeper/guard/woodcutter screenshots directly inspected VISUAL 8.2/10 PASS at stable 1/5000; accepted docs/product included in deployed descendant b58992e5608474a3d3ba3ec2cf525c491fcdc085 / Pages 36515696270 SUCCESS)
- `WP-S004-008` — Contextual NPC Reactions + Local Social Boundaries — COMPLETED
- `WP-S004-009` — Time-of-Day Settlement Activity Rhythm — COMPLETED (AGENT #6; exact accepted product/evidence head aae20c8fc78ecba340696ed2d12388a1891ab423; workflow 36516836041 SUCCESS with portrait artifact 11011033859 + landscape artifact 11010779695; deterministic five-band fantasy-day rhythm, 45-minute gradual transitions, per-resident SEED variation, authoritative DailyActivity schedules unchanged, bounded 12-resident presentation, globalScan=false and fullSettlementPerFrameScan=false; all 8 fresh screenshots directly inspected VISUAL 8.2/10 PASS; pre-completion docs/product descendant 35f29891f0743cb3a7560b4a495bbf056d197d81 deployed successfully in Pages run 36517470427)
- `WP-S004-010` — Density-Scaled Local Crowd Presentation — COMPLETED (AGENT #6; deterministic functional proof PASS with village/town/city 7 < 14 < 24, cityNight=7, mobileCity=18, cityFringe=14; exact persistent NPC authority preserved; bounded class-sized candidate pool with live 33/42/60 checks; one merged vertex-colored mesh / one shared material / one draw call; final phone production evidence visible 7 < 13 < 17 with crowd build 48.0/43.7/45.9 ms, <=20 mobile cap, presentationOnly=true, simulationAuthority=false, selectable=false, persistentIdentity=false, collision=false and exactNpcReplacement=false; complete landscape + portrait workflow 36523668316 artifacts 11014425351 + 11014585695; final readability implementation 9a93057d3247a4dfdc7b601b472d9082876a006c preserved in deployed descendant b5fe7e5fdb4ff61f91436fda23662f20c6ac8c01; final workflow 36524271910 portrait artifact 11014736560 plus fresh landscape village artifact 11013757988 directly inspected, VISUAL 8.0/10 PASS; pre-completion implementation/docs descendant b5fe7e5fdb4ff61f91436fda23662f20c6ac8c01 deployed successfully in Pages run 36525252877)

# Stage 5 — Advisor Interaction + Social Foundation

- `WP-S005-001` — Advisor Interface + Persistent Advice Channel — COMPLETED
- `WP-S005-002` — Character Memory, Observation Log + World Fact Model — COMPLETED
- `WP-S005-003` — Local Dialogue, Social Context + Trust Framing — COMPLETED
- `WP-S005-004` — Advice Acceptance, Rejection + Influence Resolution — COMPLETED
- `WP-S005-005` — Relationship, Reputation + Duty State Foundation — COMPLETED
- `WP-S005-006` — NPC Recognition + Personal Interaction Memory — COMPLETED
- `WP-S005-007` — Local Rumors, Knowledge Exchange + Discoverable Leads — COMPLETED (AGENT #6; accepted exact implementation/evidence head c28d8cdb3f0f7665fdcec95416823e1c89b3bd11 / workflow 36525973107 SUCCESS; deterministic resident-bounded confirmed/uncertain/hearsay knowledge, fantasy-time freshness/stale context, resident-scoped local events, read-only CharacterMemory, persistent discoverable navigator leads, <=6 results / <=16 destinations / <=24 local indexed records / <=5 leads / <=64 resident-memory candidates, localIndexedQueriesOnly=true, globalScan=false, worldMutation=false, simulationAuthority=false; VISUAL N/A; accepted implementation/docs deployed successfully in descendant 2183c06c72c02d6a34fdc25515fbc0464f7b0f82 / Pages 36526269078 SUCCESS)

# Stage 6 — Political Geography + Settlement Diversity Foundation

- `WP-S006-001` — Deterministic Country Territories + Political Centers — COMPLETED
- `WP-S006-002` — Country Profile: Wealth, Governance + Strategic Orientation — COMPLETED
- `WP-S006-003` — Region/Province Profiles + Terrain/Resource Identity — COMPLETED
- `WP-S006-004` — Country Relations + Diplomacy Baseline — COMPLETED
- `WP-S006-005` — Settlement Archetypes + Country/Region/Terrain Inheritance — COMPLETED
- `WP-S006-005-001` — Population-Scaled Settlement Footprints + Realistic Urban Morphology — COMPLETED
- `WP-S006-006` — Settlement Building Catalog + Contextual Composition Rules — COMPLETED
- `WP-S006-007` — Deterministic World Destinations + Points-of-Interest Foundation — COMPLETED (AGENT #6; accepted implementation `b665221d970c5523bdf7a3b2ca77a29c983ef8cf`, workflow `36554647580` SUCCESS; implementation deployment `36554646109` SUCCESS; accepted docs deployment `36554839969` SUCCESS. Worst cold query 4525.439 ms <=5000 ms; deterministic same-SEED/alternate-SEED evidence, all settlement sizes, required historical/hunting/fishing/water destinations, fullWorldScan=false, localChunkMaterialization=false. VISUAL: N/A — functional descriptor/query authority WP.)
- `WP-S006-007-001` — Discoverable Micro-Locations + Wilderness POI Composition — COMPLETED (AGENT #6; corrected accepted product head `9ff7d8404adf50cc39dac9ae5d87d50549fcd2a3`; exact evidence checkout `26dc8f0fe9de8465fc56e6ef7bd1050ac0dbce03`; workflow `36615130935` SUCCESS; landscape artifact `11054664493`; portrait artifact `11055540115`. FUNCTIONAL PASS on six deterministic types + stable unload/revisit with <=4 queried cells, 19–37 live primitives/draw-call estimate, <=6.8 ms measured local build, `fullWorldScan=false`, `perFrameScan=false`, presentationOnly=true, simulationAuthority=false. All 14 fresh Attempt-2 frames directly inspected, VISUAL 8.1/10 PASS. Product is included in deployed descendant `b8a38aeb2ccb06b89d791dde709961b7384886b8` / Pages `36614844101`; corrected acceptance/docs `18a61eefa2a2b70ca8e55a3296c7e201ac824bbe` deployed via Pages `36616677421`; post-reconciliation regression workflow `36616679669` SUCCESS on both profiles.)
- `WP-S006-008` — Deterministic Place Naming + Toponym Hierarchy — COMPLETED (AGENT #6; accepted exact implementation/evidence head `0938e2ccafba8dce0db241e773690f9c1843a3b7`; dedicated workflow `36585570249` SUCCESS; exact implementation deployed via Pages `36585568708` SUCCESS; acceptance/docs commit `0581c467a8e30506c09c469d099f8b27dd693af7` deployed via Pages `36586168233` SUCCESS. Canonical `PlaceNaming` v1 now serves PoliticalGeography countries/capitals, RegionProfile, canonical SettlementArchetypes/plans and WorldDestinations with Campaign SEED + stable entity ID + naming-version authority, inherited cultural profiles, deterministic scoped uniqueness without visible numeric suffixes, phonotactic readability, save-name preservation, bounded 2,048-entry cache and load/camera/time independence. Acceptance proved 5+ countries, 3+ sibling regions, 28 settlements across 2 countries, four cultural profiles, representative ruin/lake/river/pass naming, real generated POI consistency, cross-consumer name equality, 3,000 cold descriptors in 28.62 ms, `fullWorldScan=false` and `localChunkMaterialization=false`. VISUAL: N/A — canonical naming identity/query metadata adds no new rendered surface.)
- `WP-S006-009` — Hierarchical Inter-Settlement Road Graph + Geography-Aware Main Routes — COMPLETED (AGENT #6; accepted exact implementation/evidence head `f88852215ba3080255d3b8900e89a2837df8f299`; dedicated workflow `36598537893` SUCCESS; accepted implementation/docs deployment `36598786759` SUCCESS on head `7de83688f7bb0d7aa699ed3bd79a525fa173a7ef`. Deterministic `WRG-BA3CD6F5` vs alternate-SEED `WRG-EABA690F`; cold planning 3936.772 ms; max route query 0.145 ms; 11 canonical settlement nodes / 17 hierarchical edges / 8 junctions / 1 connected component; 4 trunk / 8 primary / 4 secondary / 1 local edges; shared corridors and canonical StartingVillage gateway proven; <=40 nodes / <=64 edges / <=96 route expansions; `fullWorldScan=false`, `localChunkMaterialization=false`, `detailedSegmentsMaterialized=0`, `perFramePlanning=false`. VISUAL: N/A — functional graph/query authority with no new rendered surface.)

# Stage 7 — Hierarchical Lazy World Simulation + Deterministic Persistence

- `WP-S007-001` — Immutable SEED Foundation + Campaign Delta State Model — COMPLETED
- `WP-S007-002` — Hierarchical World Context Resolver + Influence Inheritance — COMPLETED
- `WP-S007-003` — Multi-Resolution Lazy Simulation Tiers + Relevance Activation — COMPLETED
- `WP-S007-004` — Deterministic Event Scheduler + Stable Random Streams — COMPLETED
- `WP-S007-005` — Global Country/Diplomacy Aggregate Simulation — COMPLETED
- `WP-S007-006` — Regional + Settlement Aggregate Simulation with Lazy Revision Propagation — COMPLETED
- `WP-S007-007` — NPC Materialization, Dematerialization + Schedule Reconstruction — COMPLETED
- `WP-S007-008` — Deterministic Lazy Catch-Up + Offline World Progression — COMPLETED
- `WP-S007-009` — Versioned Save/Load, Deterministic Resume + World Compatibility — COMPLETED (AGENT #6; exact accepted head `ed5b2702f30d3cf006b1df1ac101a851c5492063`; final functional workflow `36601364910` SUCCESS; accepted implementation/docs descendant `3ad080fb7a69b5d799676f4b7b2de936d199f95a` deployed successfully via Pages `36601627493`. `AdvisorCampaignSave` v1 persists Campaign SEED/header, fantasy-time/offline metadata, sparse CampaignStateDelta entries, scheduler pending events and catch-up checkpoint under explicit world-generator/simulation-rule/save-schema versions and checksum. Final evidence: 3537-byte sparse save, 2 mutated entries (1 settlement + 1 NPC), 1 pending scheduled event, stable IDs, authoritative pre-playable resume, device/camera invariance, untouched distant SEED regeneration, generator/simulation mismatch rejection, corruption rejection, `wholeWorldSerialized=false`, `renderStateSerialized=false`, `cameraStateSerialized=false`, production PlanetStage restore gate. VISUAL: N/A — persistence/resume authority introduces no normal rendered surface.)
- `WP-S007-009-001` — Persistent Generated-World Cache + Incremental Campaign Resume Store — COMPLETED (AGENT #6; exact accepted head `211e14a859a1d8282207b0e88ff4e30ffb7daa02`; final dedicated issue-comment workflow `36604168138` SUCCESS; accepted/reconciled implementation/docs descendant `c1b002c6e7c533bb71eeace69e4b1e71a3ef6d78` deployed successfully via Pages `36604729634`. Production `GeneratedWorldStore` uses campaign-scoped IndexedDB with exact generator/family/dependency keys, bounded 128-record recent priming, 256-record RAM cache, serialized 32-record write-behind, 512 dirty-queue bound, 8 MiB soft / 12 MiB hard derived-cache budgets, targeted invalidation, crash-safe committed revisions, quota fallback and telemetry. Real Chromium close/reopen proved compatible records persist and reuse with zero regeneration; deterministic evidence proved family-local invalidation, crash rollback, cache deletion preserving authoritative campaign truth, and SEED fallback. VISUAL: N/A — no new rendered surface.)
- `WP-S007-010` — World Simulation Budgets, Backpressure + Runtime Telemetry — COMPLETED (AGENT #6; exact accepted implementation head 2183c06c72c02d6a34fdc25515fbc0464f7b0f82; exact-head workflow 36526269883 SUCCESS with 10.0/10 deterministic functional verification, 160 due events preserving identical authoritative order/outcomes, constrained background max 8 events/slice vs current-authority max 32, aggregateRefreshTelemetry=true, bounded tier/exact-NPC/background work, persistence telemetry hooks, visible-frame correlation, telemetryAuthority=false, fullWorldScan=false, perFrameWorldScan=false; VISUAL: N/A because this WP is runtime scheduling/backpressure/telemetry; implementation + acceptance-docs descendant 68b7913807a73634a215ecb47132c44f1b5a9f58 deployed successfully via Pages 36526546062)
- `WP-S007-011` — Local Dynamic Event Vignettes + Reactive Scheduling — COMPLETED (AGENT #6; Phase 5 accepted implementation/evidence 2026-09-30. Exact accepted product/evidence head `50e647ceef83b8ccfe751e03aa7a0d1fe44a427a`; workflow `36667982079` SUCCESS; landscape artifact `11077127379`; portrait artifact `11077550126`. FUNCTIONAL PASS: deterministic EventScheduler start/end authority, 2–4 real DailyActivity residents/event, <=2 active events, exact `compact-walkable-cluster-v2` staging, bounded pooled `compact-event-silhouette-v3` cues, event-driven processing, `perFrameScan=false`, `fullSettlementPerFrameScan=false`, `fullWorldScan=false`. Presentation-only `participant-aware-safe-slots-v1` measures already-projected bounds for at most four visible participants on the existing UI/event refresh and chooses only top-right/bottom-right/bottom-left; all 8 final frames record 0 px² event-card/participant overlap, and portrait top-right is below persistent top chrome at y=104. Event render max 7.6 ms landscape / 11.6 ms portrait; captured ResidentMovement max 4.2 / 1.6 ms. All 8 fresh exact-head screenshots directly inspected: VISUAL 8.1/10 PASS with readable cards, compact actors, no actor/card or top-chrome collision, clipping, or broken layout. Accepted implementation is present in deployed main descendant `4bbcb2d877260495161e8d68f5d9646ef31e46b7` via Pages run `36668069709`; acceptance docs/changelog/future guidance head `73899c6c5a288ca73eeb48fcc3fc7136fa93e124` deployed successfully via Pages run `36668521903` before completion bookkeeping.)
- `WP-S007-012` — Persistent World Consequence Projection + Local Recovery — IN PROGRESS (AGENT #6; MIXED Phase 3 ACCEPTED. Exact accepted product/evidence head `c8d9f153560fd2c6607faa2343ab56a6715c34cc`, workflow `36675317946`, artifacts `11079508019` landscape + `11079344404` portrait: deterministic + real-browser CampaignPersistence save/validate/restore/resume PASS, one sparse `consequence-registry` delta with exact `A3849BED` signature preserved across restore and leave/return, damaged-building / road-blockage / abandoned-workplace each project one bounded local consequence at canonical ground `1/10000`, and recovery removes all local consequence cues. Architecture remains event-driven/lazy-local with <=8 local records, <=3 visible, <=4 recoveries/advance, `perFrameScan=false`, `fullSettlementPerFrameScan=false`, `fullWorldScan=false`. Direct inspection of all 8 fresh screenshots: VISUAL 8.1/10 PASS; cards are readable/unclipped in landscape + portrait, damage/debris, road barrier, and overgrowth cues are visible, and recovered state removes the active cue. Accepted head deployed by Pages run `36675317609`; current evidence-only descendant `10712eacffbe112e4a8eb61be1e47db7c06f7a7c` also PASSed exact-head workflow `36675818806` and deployed via Pages run `36675817922`. Acceptance docs/future guidance are being deployed before completion bookkeeping. NOT COMPLETED.)
- `WP-S007-013` — Rare Traveling Encounters + Surprise Event Stream — IN PROGRESS (AGENT #6; capped three-attempt continuation on 2026-09-29. Attempt 1 workflow `36619452840` deterministic proof PASS but production capture failed because controlled proof activation evaluated relevance before moving to the deterministic encounter anchor. Attempt 2 workflow `36620218381` deterministic proof PASS but production capture failed because ground/wilderness `revealTier="none"` skipped the merged crowd presentation and the card auto-refresh could hide when no timestamp-key accessor existed. Final Attempt 3 exact head `162c1568edc2f2635186d7e5bdffc92c7ca6e93a` / workflow `36621681806` FUNCTIONAL PASS: 720 sampled 6-hour windows produced 48 rare encounters (6.67%), 18-hour cooldown blocks, same-SEED stable ordering with alternate-SEED divergence, bounded 1–4 exact actors, off-screen summary-only state, stable leave/return identity, one merged local draw call, `fullWorldScan=false`, `perFrameScan=false`, and measured encounter batch build <=18.7 ms. Fresh artifacts: landscape `11058911865`, portrait `11059106883`. All 8 screenshots directly inspected; VISUAL 3.4/10 FAIL because the 1/10000 ground view was dominated by a flat blue field, exact actors were mostly tiny diamond markers with unreadable bodies/composition, and the encounter card was hidden/occluded in most captured frames. Three-attempt cap exhausted; no fourth improvement loop. Unaccepted product/service/UI/test/workflow integration removed from main through reconciliation `fc05e9a5f1e0d00bd558e37a52c68273cfdd2f3a`. NOT COMPLETED.)

**TO BE CONTINUED AFTER CURRENT ROADMAP STAGES ARE IMPLEMENTED AND REVIEWED**