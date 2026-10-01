# The Advisor Game — ROADMAP

## Roadmap Rule

Keep only Stage headings and WP code/title/status lines here. WP details, evidence and implementation notes belong in the corresponding GitHub Issue.

# Stage 1 — Deterministic World Foundation

- `WP-S001-001` — Base Game, Campaign SEED and Game Clock — COMPLETED
- `WP-S001-002` — Deterministic Foundation and Live Randomness — COMPLETED
- `WP-S001-003` — Infinite World Coordinates + Protagonist Origin — COMPLETED
- `WP-S001-004` — SEED-Generated Geographic Hierarchy + Realistic Settlement Spacing — COMPLETED
- `WP-S001-005` — Viewport-Filling Solid-Color Tiles — COMPLETED
- `WP-S001-006` — Camera Movement Through the Infinite World — COMPLETED

# Stage 2 — Starting Village Physical + Spatial Foundation

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

# Stage 3 — World Rendering, Visual Style + Planet-to-Ground Foundation

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
- `WP-S003-008-004` — Responsive Startup Work Slicing + Main-Thread Stall Prevention
- `WP-S003-008-005` — World Destination Navigator + Nearby Places Popup — COMPLETED
- `WP-S003-009` — Loading-Screen-Inspired Living World Visual Direction Foundation
- `WP-S003-009-001` — Starting Village Environmental Dressing + Semantic Prop Placement
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
- `WP-S003-010-003-005-002` — True Cross-LOD Surface Refinement + Texel/Geometry Density Continuity
- `WP-S003-010-003-006` — Streaming-Safe Scale Ladder + Ready-LOD Semantic Handoffs
- `WP-S003-010-003-007` — Progressive Local/Settlement World Reveal Before Ground
- `WP-S003-010-003-008` — Canonical Zoom-Aware Globe Atlas Labels + Visible-Screen Culling
- `WP-S003-010-003-009` — Canonical Planet/World Coordinate Registration + Political Atlas Integrity — COMPLETED
- `WP-S003-010-003-010` — TOP PRIORITY BUG: SEED-Only Canonical Political Boundaries + SEED-Only Important-Place Placement — COMPLETED
- `WP-S003-010-003-011` — TOP PRIORITY BUG: Pure Zoom + Canonical 1/N Scale Ladder + Scale-Aware Navigation
- `WP-S003-010-003-012` — TOP PRIORITY BUG: SEED Coordinate Fabric + Gameplay-Center Marker + Landmark Callouts — COMPLETED
- `WP-S003-010-003-013` — Screen-Space-Error Hierarchical Spatial LOD + Canonical Cell Refinement — COMPLETED
- `WP-S003-010-003-014` — Physical-Scale Semantic Layer Ladder + Stable Label/Border/Route Decluttering
- `WP-S003-010-003-015` — TOP PRIORITY BUG: SEED-Only Settlement Hierarchy + Realistic Physical Spacing — COMPLETED
- `WP-S003-010-003-016` — Temporal-Coherent Detail Residency + Ready-Child Handoff + Navigation Prefetch
- `WP-S003-010-003-017` — TOP PRIORITY REGRESSION: Planet-Scale Semantic Cleanup + Explainable Marker Visibility
- `WP-S003-010-003-018` — Smooth Animated Zoom + Intermediate Physical Scale Ladder
- `WP-S003-010-003-019` — Focus-Centric Layered World Streaming + Center-First Detail Refinement — COMPLETED
- `WP-S003-010-003-020` — World-Map Navigation Performance Budget + Main-Thread Stutter Elimination
- `WP-S003-010-003-021` — World-Map Interaction Coherence + Streaming Stutter Cleanup
- `WP-S003-010-004` — Ground-Level Static World Projection + 3D Gameplay Area
- `WP-S003-010-005` — Zero-Movement Planet-to-Ground Zoom End-to-End Acceptance
- `WP-S003-011` — Clickable NPC + Building Inspection Tooltips — COMPLETED
- `WP-S003-012` — Day/Night Atmospheric Color + Lighting Palette — COMPLETED
- `WP-S003-013` — Biome-Aware Wilderness Dressing + Ambient Fauna
- `WP-S003-014` — Reactive Ambient Wildlife Behavior — COMPLETED
- `WP-S003-015` — Contextual Building Activity Indicators — COMPLETED
- `WP-S003-016` — Local Environmental Reaction Effects — COMPLETED
- `WP-S003-017` — Positional Ambient Soundscape + Activity Audio — COMPLETED
- `WP-S003-018` — Regional Weather Presentation + Local Behavior Hooks — COMPLETED
- `WP-S003-019` — Seasonal World Presentation + Vegetation State
- `WP-S003-020` — Function-Readable Building Surroundings + Ownership Cues — COMPLETED
- `WP-S003-021` — Campaign-State Environmental Wear, Damage + Recovery Projection — COMPLETED
- `WP-S003-022` — Crossroads Direction Signposts + Named Route Wayfinding — COMPLETED

# Stage 4 — Starting Village Population + Visible Activity Foundation

- `WP-S004-001` — Deterministic Starting Village Resident Roster — COMPLETED
- `WP-S004-002` — Homes, Professions + Indoor Workplace Assignment — COMPLETED
- `WP-S004-003` — Deterministic Daily Activity + Action Targets — COMPLETED
- `WP-S004-004` — Autonomous Indoor/Outdoor Route Execution + Visible Movement — COMPLETED
- `WP-S004-004-001` — NPC Building Approach, Occlusion + Separation — COMPLETED
- `WP-S004-005` — Interior Action Execution + Character State Presentation — COMPLETED
- `WP-S004-006` — Profession-Specific Visible Work Cycles + Workplace Choreography — COMPLETED
- `WP-S004-007` — Time-of-Day Settlement Activity Rhythm — COMPLETED
- `WP-S004-008` — Density-Scaled Local Crowd Presentation — COMPLETED
- `WP-S004-009` — Local NPC Social Encounters + Group Activity — COMPLETED
- `WP-S004-010` — Contextual NPC Reactions + Local Social Boundaries — COMPLETED

# Stage 5 — World Geography, Settlements/Cities, Roads + Focused Environment Foundation

- `WP-S005-001` — Deterministic Country Territories + Political Centers — COMPLETED
- `WP-S005-002` — Region/Province Profiles + Terrain/Resource Identity — COMPLETED
- `WP-S005-003` — Settlement Archetypes + Country/Region/Terrain Inheritance — COMPLETED
- `WP-S005-003-001` — Population-Scaled Settlement Footprints + Realistic Urban Morphology — COMPLETED
- `WP-S005-004` — Settlement Building Catalog + Contextual Composition Rules — COMPLETED
- `WP-S005-005` — Hierarchical Inter-Settlement Road Graph + Geography-Aware Main Routes — COMPLETED
- `WP-S005-006` — Deterministic World Destinations + Points-of-Interest Foundation — COMPLETED
- `WP-S005-006-001` — Discoverable Micro-Locations + Wilderness POI Composition — COMPLETED
- `WP-S005-007` — Deterministic Place Naming + Toponym Hierarchy — COMPLETED
- `WP-S005-008` — Country Profile: Wealth, Governance + Strategic Orientation — COMPLETED
- `WP-S005-009` — Country Relations + Diplomacy Baseline — COMPLETED

# Stage 6 — Advisor Interaction + Social Foundation

- `WP-S006-001` — Advisor Interface + Persistent Advice Channel — COMPLETED
- `WP-S006-002` — Character Memory, Observation Log + World Fact Model — COMPLETED
- `WP-S006-003` — Local Dialogue, Social Context + Trust Framing — COMPLETED
- `WP-S006-004` — Advice Acceptance, Rejection + Influence Resolution — COMPLETED
- `WP-S006-005` — Relationship, Reputation + Duty State Foundation — COMPLETED
- `WP-S006-006` — NPC Recognition + Personal Interaction Memory — COMPLETED
- `WP-S006-007` — Local Rumors, Knowledge Exchange + Discoverable Leads — COMPLETED

# Stage 7 — Hierarchical Lazy World Simulation + Deterministic Persistence

- `WP-S007-001` — Immutable SEED Foundation + Campaign Delta State Model — COMPLETED
- `WP-S007-002` — Hierarchical World Context Resolver + Influence Inheritance — COMPLETED
- `WP-S007-003` — Multi-Resolution Lazy Simulation Tiers + Relevance Activation — COMPLETED
- `WP-S007-004` — Deterministic Event Scheduler + Stable Random Streams — COMPLETED
- `WP-S007-005` — Global Country/Diplomacy Aggregate Simulation — COMPLETED
- `WP-S007-006` — Regional + Settlement Aggregate Simulation with Lazy Revision Propagation — COMPLETED
- `WP-S007-007` — NPC Materialization, Dematerialization + Schedule Reconstruction — COMPLETED
- `WP-S007-008` — Deterministic Lazy Catch-Up + Offline World Progression — COMPLETED
- `WP-S007-009` — Versioned Save/Load, Deterministic Resume + World Compatibility — COMPLETED
- `WP-S007-009-001` — Persistent Generated-World Cache + Incremental Campaign Resume Store — COMPLETED
- `WP-S007-010` — World Simulation Budgets, Backpressure + Runtime Telemetry — COMPLETED
- `WP-S007-011` — Local Dynamic Event Vignettes + Reactive Scheduling — COMPLETED
- `WP-S007-012` — Persistent World Consequence Projection + Local Recovery — COMPLETED
- `WP-S007-013` — Rare Traveling Encounters + Surprise Event Stream — COMPLETED

# Stage 8 — Hybrid Advisor Conversation + Character Decision Interface

- `WP-S008-001` — Deterministic Input Normalization + Sentence Library Matching — COMPLETED
- `WP-S008-002` — Context-Bounded Command Set Interface + Authoritative Target Filtering — COMPLETED
- `WP-S008-003` — Deterministic Local Conversation Router + Offline Fallback — COMPLETED
- `WP-S008-004` — External LLM Adapter + Structured Proposal Validation — COMPLETED
- `WP-S008-005` — Protagonist Command Proposal Evaluation + Simulation Execution Boundary — COMPLETED
- `WP-S008-006` — Persistent Conversation Transactions + Memory/Outcome Linking — COMPLETED
- `WP-S008-007` — Advisor Chat Interaction Surface + Routing/Decision Trace — COMPLETED

# Stage 9 — Autonomous Protagonist Life, Goals + Authority Foundation

- `WP-S009-001` — Persistent Protagonist Identity + Personality Profile — COMPLETED
- `WP-S009-002` — Deterministic Protagonist Needs + Condition State — COMPLETED
- `WP-S009-003` — Persistent Goals, Priorities + Commitments — COMPLETED
- `WP-S009-004` — Protagonist Inventory, Possessions + Ownership State — COMPLETED
- `WP-S009-005` — Health, Injury, Fatigue + Recovery State — COMPLETED
- `WP-S009-006` — Social Rank, Role + Legitimate Authority State — COMPLETED
- `WP-S009-007` — Goal/Need-Aware Decision Context + Explainable Evaluation Factors — COMPLETED
- `WP-S009-008` — Autonomous Goal Selection + Replanning Queue — COMPLETED
- `WP-S009-009` — Persistent Behavioral Guidance + Conditional Advice Rules — COMPLETED
- `WP-S009-010` — Protagonist Status, Goals + Needs Advisor Readout — COMPLETED

# Stage 10 — Autonomous Protagonist Action + Daily Life Continuity

- `WP-S010-001` — Autonomous Protagonist Action Runtime + Bounded Execution Tick — COMPLETED
- `WP-S010-002` — Persistent Journey State + Physical Travel Progress — COMPLETED
- `WP-S010-003` — Autonomous Interaction Attempt + Simulation Outcome Pipeline — COMPLETED
- `WP-S010-004` — Needs-Driven Food, Rest + Safety Self-Care — COMPLETED
- `WP-S010-005` — Profession Work Routine + Duty-Aware Action Selection — COMPLETED
- `WP-S010-006` — Autonomous Social Contact + Relationship-Conscious Initiative — COMPLETED
- `WP-S010-007` — Goal Commitment Progress + Failure/Replan Consequences — COMPLETED
- `WP-S010-008` — Offline Protagonist Catch-Up + Resume Continuity — COMPLETED
- `WP-S010-009` — Visible Protagonist Activity + Advisor Intent/Outcome Presentation — COMPLETED
- `WP-S010-010` — End-to-End Advice → Decision → World Action Acceptance — COMPLETED

# Stage 11 — Advisor Progression, Investigation + Influence Tools

- `WP-S011-001` — Persistent Advisor Skill Profile + Progression Ledger — COMPLETED
- `WP-S011-002` — Insight Investigation Action + Evidence Quality — COMPLETED
- `WP-S011-003` — Rhetoric Persuasion Tool + Bounded Influence Modifier — COMPLETED
- `WP-S011-004` — Diplomacy Leverage Tool + Relationship-Aware Outcomes — COMPLETED
- `WP-S011-005` — Stewardship Situation Analysis + Settlement/Resource Report — COMPLETED
- `WP-S011-006` — Command Readiness + Risk Analysis Tool — COMPLETED
- `WP-S011-007` — Intrigue Lead Analysis + Source Confidence — COMPLETED
- `WP-S011-008` — Accessible Advisor Tool Auto-Resolution + Mini-Game Authority Boundary — COMPLETED
- `WP-S011-009` — Advisor Progression + Toolbelt Outcome UI — COMPLETED
- `WP-S011-010` — End-to-End Investigate → Advise → World Outcome Acceptance — COMPLETED

# Stage 12 — Local Economy, Employment + Material Progression Foundation

- `WP-S012-001` — Authoritative Currency, Wealth + Transaction Ledger — COMPLETED
- `WP-S012-002` — SEED-Grounded Local Goods, Prices + Availability — COMPLETED
- `WP-S012-003` — Employment Contract, Wage + Work Compensation — COMPLETED
- `WP-S012-004` — Buy, Sell + Service Transaction Validation — COMPLETED
- `WP-S012-005` — Household Housing, Rent + Shelter Obligations — COMPLETED
- `WP-S012-006` — Profession Change, Apprenticeship + Work Opportunity Pipeline — COMPLETED
- `WP-S012-007` — Autonomous Economic Need + Spending Priority Selection — COMPLETED
- `WP-S012-008` — Local Market Stock Revision + Economic Consequence Persistence — COMPLETED
- `WP-S012-009` — Advisor Economy, Work + Purchase Readout — COMPLETED
- `WP-S012-010` — End-to-End Work → Pay → Purchase → Persistent Outcome Acceptance — COMPLETED

# Stage 13 — Legitimate Advancement, Patronage + Social Rank Foundation

- `WP-S013-001` — Protagonist Skills, Practice + Qualification State — COMPLETED
- `WP-S013-002` — Social Standing, Service Merit + Recognition Ledger — COMPLETED
- `WP-S013-003` — Patronage, Mentorship + Sponsorship Opportunity Pipeline — COMPLETED
- `WP-S013-004` — Squire/Retainer Service + Duty Contract Validation — COMPLETED
- `WP-S013-005` — Legitimate Rank/Role Eligibility + Appointment Resolution — COMPLETED
- `WP-S013-006` — Oath, Allegiance + Authority Scope Transition — COMPLETED
- `WP-S013-007` — Status-Bound Duties, Privileges + Obligation State — COMPLETED
- `WP-S013-008` — Autonomous Advancement Goal + Opportunity Selection — COMPLETED
- `WP-S013-009` — Advisor Rank, Patronage + Advancement Readout — COMPLETED
- `WP-S013-010` — Rank-Aware Local Access, NPC Reactions + Social Consequences — COMPLETED

# Stage 14 — Knighthood, Local Security + Simulation-Resolved Conflict Foundation

- `WP-S014-001` — Grounded Local Threat, Crime + Security Incident Ledger — COMPLETED
- `WP-S014-002` — Martial Equipment + Personal Readiness Context — COMPLETED
- `WP-S014-003` — Autonomous Fight, Defend, Protect, Yield + Retreat Selection — COMPLETED
- `WP-S014-004` — Simulation-Authoritative Personal Combat Exchange Resolution — COMPLETED
- `WP-S014-005` — Guard Patrol, Escort + Local Protection Duty Selection — COMPLETED
- `WP-S014-006` — Squire-to-Knight Qualification + Legitimate Martial Appointment — COMPLETED
- `WP-S014-007` — Tournament, Sparring + Martial Training Opportunity Pipeline — COMPLETED
- `WP-S014-008` — Conflict Injury, Standing + Service Consequence Integration — COMPLETED
- `WP-S014-009` — Advisor Threat, Martial Readiness + Security Readout — COMPLETED
- `WP-S014-010` — Visible Local Conflict, Outcome + Recovery Presentation

**TO BE CONTINUED AFTER CURRENT ROADMAP STAGES ARE IMPLEMENTED AND REVIEWED**
