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
- `WP-S003-010-003-019` — Focus-Centric Layered World Streaming + Center-First Detail Refinement — IN PROGRESS (AGENT #6; continuation three-attempt cap exhausted 2026-09-29; final exact-head workflow 36497918021 / artifact 11004770562 on fa84ba589254e150b6e93752235afec1c09f524c SUCCESS; functional two-SEED canonical 1×/3×/6× focus streaming, <=8-resource / 48 MiB cache, pan-back grace reuse, parent fallback with missingCoverageCount=0, atomic handoff, bounded single-job preparation, desktop+phone, fullWorldScan=false and globalHighDetailMaterialized=false PASS; all 9 final screenshots directly inspected VISUAL 6.8/10 FAIL because 1/500 and throttled parent fallback remain too flat/low-information and 1/2500 remains diagrammatic despite improved footprint wash/road readability; final tested presentation retained; NOT COMPLETED)
- `WP-S003-010-003-020` — World-Map Navigation Performance Budget + Main-Thread Stutter Elimination — IN PROGRESS (AGENT #6; continuation three-attempt cap exhausted 2026-09-29; final exact-head workflow 36503009969 / artifact 11006465554 on fe1e3317bb6f7c7f93048e85b6882ccfeda914eb FUNCTIONAL PASS: trusted 36-move drag -> 1 semantic rebuild, 0 >50 ms game-side frame/resident slices, max frame 3.3 ms, semantic 26.9 ms, preparation 34.0 ms, swap 33.7 ms, fixed-SEED signature and fullWorldScan=false PASS; all 10 fresh production screenshots directly inspected VISUAL 6.8/10 FAIL because 1/375–1/500 remain dominated by broad low-information gray relief/tonal boundaries and 1/2500 remains a diagrammatic ring/cross settlement target; NOT COMPLETED)
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
- `WP-S003-021` — Campaign-State Environmental Wear, Damage + Recovery Projection — IN PROGRESS (Phase 5 canonical-roof continuation capped 2026-09-28; Attempt 1 workflow 36459665370 directly inspected VISUAL 6.3/10 FAIL with worn visibility assertion failure, Attempt 2 workflow 36460855267 VISUAL 7.0/10 FAIL with repaired visibility assertion failure, final Attempt 3 workflow 36462243148 VISUAL 7.5/10 FAIL and FUNCTIONAL FAIL on the worn visibility assertion; bounded WorldState/reload-persistence/mobile/performance telemetry remained green throughout with <=14/16 local queries, one merged accessory draw/shared material and <=5.4 ms observed wear builds; no fourth Phase 5 attempt; prior overall-best directly inspected 7.7/10 production presentation restored after WP-S003-020 via commit 89cb1f830e2c93cb7eb3d5cacacac25a50d38529; NOT COMPLETED)
- `WP-S003-022` — Crossroads Direction Signposts + Named Route Wayfinding — COMPLETED

# Stage 4 — Starting Village Population + Indoor Activity Foundation

- `WP-S004-001` — Deterministic Starting Village Resident Roster — COMPLETED
- `WP-S004-002` — Homes, Professions + Indoor Workplace Assignment — COMPLETED
- `WP-S004-003` — Deterministic Daily Activity + Action Targets — COMPLETED
- `WP-S004-004` — Autonomous Indoor/Outdoor Route Execution + Visible Movement — COMPLETED
- `WP-S004-004-001` — NPC Building Approach, Occlusion + Separation — COMPLETED
- `WP-S004-005` — Interior Action Execution + Character State Presentation — COMPLETED
- `WP-S004-006` — Local NPC Social Encounters + Group Activity — COMPLETED
- `WP-S004-007` — Profession-Specific Visible Work Cycles + Workplace Choreography — IN PROGRESS (AGENT #6 continuation three-attempt cap exhausted 2026-09-29; final evaluated product head 35a902e69cc793cd604315d8013260d42d45e8a6 / functional workflow 36506048347 PASS / Pages 36506047067 SUCCESS; exact-head visual workflow 36506048392 PARTIAL: portrait artifact 11007421406 captured smith/shopkeeper/guard/woodcutter, landscape artifact 11006928699 captured smith/shopkeeper then guard resource-readiness timeout failed the job; all 6 exact fresh screenshots were directly inspected VISUAL 7.2/10 FAIL; outdoor visibility and centered-work declutter remain correct and top-down tool/prop silhouettes improved, but professions are still not reliably identifiable without evidence text at 1/5000 and landscape indoor/outdoor coverage is incomplete; NOT COMPLETED)
- `WP-S004-008` — Contextual NPC Reactions + Local Social Boundaries
- `WP-S004-009` — Time-of-Day Settlement Activity Rhythm
- `WP-S004-010` — Density-Scaled Local Crowd Presentation

# Stage 5 — Advisor Interaction + Social Foundation

- `WP-S005-001` — Advisor Interface + Persistent Advice Channel — COMPLETED
- `WP-S005-002` — Character Memory, Observation Log + World Fact Model — COMPLETED
- `WP-S005-003` — Local Dialogue, Social Context + Trust Framing — COMPLETED
- `WP-S005-004` — Advice Acceptance, Rejection + Influence Resolution — COMPLETED
- `WP-S005-005` — Relationship, Reputation + Duty State Foundation — COMPLETED
- `WP-S005-006` — NPC Recognition + Personal Interaction Memory — COMPLETED
- `WP-S005-007` — Local Rumors, Knowledge Exchange + Discoverable Leads

# Stage 6 — Political Geography + Settlement Diversity Foundation

- `WP-S006-001` — Deterministic Country Territories + Political Centers — COMPLETED
- `WP-S006-002` — Country Profile: Wealth, Governance + Strategic Orientation — COMPLETED
- `WP-S006-003` — Region/Province Profiles + Terrain/Resource Identity — COMPLETED
- `WP-S006-004` — Country Relations + Diplomacy Baseline — COMPLETED
- `WP-S006-005` — Settlement Archetypes + Country/Region/Terrain Inheritance — COMPLETED
- `WP-S006-005-001` — Population-Scaled Settlement Footprints + Realistic Urban Morphology
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
- `WP-S007-010` — World Simulation Budgets, Backpressure + Runtime Telemetry
- `WP-S007-011` — Local Dynamic Event Vignettes + Reactive Scheduling
- `WP-S007-012` — Persistent World Consequence Projection + Local Recovery
- `WP-S007-013` — Rare Traveling Encounters + Surprise Event Stream

**TO BE CONTINUED AFTER CURRENT ROADMAP STAGES ARE IMPLEMENTED AND REVIEWED**