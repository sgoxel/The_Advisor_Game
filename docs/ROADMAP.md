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
- `WP-S003-010-003-019` — Focus-Centric Layered World Streaming + Center-First Detail Refinement — IN PROGRESS (AGENT #6; 2026-09-29 09:43 +03:00 continuation reached the three-attempt cap. Attempt 1 exact head 1f8951e1de7e348d109856cbce447160c157106c / workflow 36533147162 / artifact 11017543147 FUNCTIONAL PASS + VISUAL 7.0/10 FAIL: shared per-SLOD authority raster removed the obvious ring-specific reconstruction mismatch, but 1/500 retained the broad soft terrain band, 1/2500 remained target-like, and fallback was low-information. Attempt 2 exact head de6a9e87365d83f92a174845ae95e62fc9ab6167 / workflow 36534157757 / artifact 11017379932 FUNCTIONAL PASS + VISUAL 7.5/10 FAIL: stronger real occupied-lot/gateway context improved 1/2500 and fallback, but boosted cover remained blocky/mosaic and the pale 1/500 band persisted. Attempt 3/final exact head 75a9e63643bf8cdba0596031de78730c0f7c8dc5 / workflow 36535037611 / artifact 11018630685 FUNCTIONAL PASS + VISUAL 7.6/10 FAIL after all 9 fresh frames were directly inspected: ring/center locator dominance is substantially reduced and warped cover is less grid-like, but desktop/phone 1/500 still show a conspicuous pale low-frequency terrain band and soft map-scale landforms; settlement approach still lacks enough irregular lot/path readability at screen scale; throttled parent fallback remains mostly flat despite authoritative gateway/lot context. Canonical two-SEED 1×/3×/6× streaming, <=8 / 48 MiB cache, single cooperative build job, pan-back reuse, atomic parent fallback, missingCoverageCount=0, fullWorldScan=false and globalHighDetailMaterialized=false remain green; NOT COMPLETED)
- `WP-S003-010-003-020` — World-Map Navigation Performance Budget + Main-Thread Stutter Elimination — IN PROGRESS (AGENT #6; 2026-09-29 11:40 +03:00 continuation reached the three-attempt cap. Attempt 1 exact head `fdc1e866c0a7fd90d83907c57f84f7473c49b8a8` / workflow `36539975983` / artifact `11019784615`: FUNCTIONAL PASS, VISUAL 6.0/10 FAIL. Attempt 2 exact head `ba35ec1490fabecf9680287475ebb0c9eac7eb3f` / workflow `36541504400` / artifact `11021156501`: FUNCTIONAL FAIL with one 74.1 ms resident slice isolated to R01 route planning at 73.8 ms; VISUAL 6.5/10 FAIL. Final Attempt 3 exact head `e2f0ffe3941025b1e696f8bb2992180b8a92b91e` / workflow `36543413881` / artifact `11022285739`: FUNCTIONAL PASS with exact canonical signature, residentSchedulerMaxMs=5.5, routePlan max=3.7 ms, maxFrameUpdateMs=3.8, maxSemanticUpdateMs=24.3, maxPreparationSliceMs=24.0, maxSwapMs=5.5, bounded=true and fullWorldScan=false. All 10 fresh production frames directly inspected at VISUAL 7.0/10 FAIL: far globe/rotation and settled 1/500 improved, but the animated 1/250→1/500 handoff still exposes broad gray low-information frames, a pale macro band remains visible at 1/500, and 1/2500 remains sparse/diagrammatic. Three-attempt cap exhausted; NOT COMPLETED)
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
- `WP-S006-007` — Deterministic World Destinations + Points-of-Interest Foundation
- `WP-S006-007-001` — Discoverable Micro-Locations + Wilderness POI Composition
- `WP-S006-008` — Deterministic Place Naming + Toponym Hierarchy
- `WP-S006-009` — Hierarchical Inter-Settlement Road Graph + Geography-Aware Main Routes

# Stage 7 — Hierarchical Lazy World Simulation + Deterministic Persistence

- `WP-S007-001` — Immutable SEED Foundation + Campaign Delta State Model — COMPLETED
- `WP-S007-002` — Hierarchical World Context Resolver + Influence Inheritance — COMPLETED
- `WP-S007-003` — Multi-Resolution Lazy Simulation Tiers + Relevance Activation — COMPLETED
- `WP-S007-004` — Deterministic Event Scheduler + Stable Random Streams — COMPLETED
- `WP-S007-005` — Global Country/Diplomacy Aggregate Simulation — COMPLETED
- `WP-S007-006` — Regional + Settlement Aggregate Simulation with Lazy Revision Propagation — COMPLETED
- `WP-S007-007` — NPC Materialization, Dematerialization + Schedule Reconstruction — COMPLETED
- `WP-S007-008` — Deterministic Lazy Catch-Up + Offline World Progression — COMPLETED
- `WP-S007-009` — Versioned Save/Load, Deterministic Resume + World Compatibility
- `WP-S007-009-001` — Persistent Generated-World Cache + Incremental Campaign Resume Store
- `WP-S007-010` — World Simulation Budgets, Backpressure + Runtime Telemetry — COMPLETED (AGENT #6; exact accepted implementation head 2183c06c72c02d6a34fdc25515fbc0464f7b0f82; exact-head workflow 36526269883 SUCCESS with 10.0/10 deterministic functional verification, 160 due events preserving identical authoritative order/outcomes, constrained background max 8 events/slice vs current-authority max 32, aggregateRefreshTelemetry=true, bounded tier/exact-NPC/background work, persistence telemetry hooks, visible-frame correlation, telemetryAuthority=false, fullWorldScan=false, perFrameWorldScan=false; VISUAL: N/A because this WP is runtime scheduling/backpressure/telemetry; implementation + acceptance-docs descendant 68b7913807a73634a215ecb47132c44f1b5a9f58 deployed successfully via Pages 36526546062)
- `WP-S007-011` — Local Dynamic Event Vignettes + Reactive Scheduling
- `WP-S007-012` — Persistent World Consequence Projection + Local Recovery
- `WP-S007-013` — Rare Traveling Encounters + Surprise Event Stream

**TO BE CONTINUED AFTER CURRENT ROADMAP STAGES ARE IMPLEMENTED AND REVIEWED**