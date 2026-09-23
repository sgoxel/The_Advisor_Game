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
- `WP-S002-004` — Deterministic Local Route Planning — COMPLETED

# Stage 3 — PlayCanvas 3D World + 2D Character Billboard Foundation

- `WP-S003-001` — Legacy PixiJS GPU 2.5D Renderer Foundation — COMPLETED
- `WP-S003-001-001` — PlayCanvas Engine 2 Renderer Migration Foundation — COMPLETED
- `WP-S003-001-002` — Orthographic 3D Scene + Mobile WebGL2/WebGPU Baseline — COMPLETED
- `WP-S003-002` — Authoritative Enterable Building Interiors — COMPLETED
- `WP-S003-003` — Interior Objects + Interaction Points — COMPLETED
- `WP-S003-004` — Layered 2.5D Building Presentation + Interior Visibility — COMPLETED
- `WP-S003-004-001` — Tall 2.5D Building Mass + Local Character Occlusion Cutouts — COMPLETED
- `WP-S003-004-002` — 2D Character Billboard Rendering in the 3D World — COMPLETED
- `WP-S003-005` — PlayCanvas 3D Asset + Material Preparation Pipeline
- `WP-S003-005-001` — Adaptive 3D Texture Quality + Mobile GPU Budget
- `WP-S003-005-002` — GLB Mesh, Material, LOD + Instancing Asset Standard — COMPLETED
- `WP-S003-006` — PlayCanvas 3D Terrain Chunk Mesh + Background Preparation
- `WP-S003-006-001` — Adjustable Terrain Chunk Size
- `WP-S003-006-002` — Adjustable Terrain Preload + Chunk Cache Budget — COMPLETED
- `WP-S003-006-003` — Chunk-Native World Data + Complete 3D Background Preparation
- `WP-S003-006-004` — Persistent PlayCanvas Scene Graph + Navigation Hot-Path Elimination
- `WP-S003-006-005` — 3D Culling, Static Batching + Hardware Instancing
- `WP-S003-007` — Orthographic 3D Camera + Depth, Lighting + Interior Visibility
- `WP-S003-007-001` — Mobile Adaptive Quality + Dynamic Render Scale
- `WP-S003-008` — Responsive Gameplay Control Deck + Multimodal Navigation

# Stage 4 — Starting Village Population + Indoor Activity Foundation

- `WP-S004-001` — Deterministic Starting Village Resident Roster
- `WP-S004-002` — Homes, Professions + Indoor Workplace Assignment
- `WP-S004-003` — Deterministic Daily Activity + Action Targets
- `WP-S004-004` — Autonomous Indoor/Outdoor Route Execution + Visible Movement
- `WP-S004-005` — Interior Action Execution + Character State Presentation

# Stage 5 — Advisor Interaction + Social Foundation

- `WP-S005-001` — Advisor Interface + Persistent Advice Channel
- `WP-S005-002` — Character Memory, Observation Log + World Fact Model
- `WP-S005-003` — Local Dialogue, Social Context + Trust Framing
- `WP-S005-004` — Advice Acceptance, Rejection + Influence Resolution
- `WP-S005-005` — Relationship, Reputation + Duty State Foundation

# Stage 6 — Political Geography + Settlement Diversity Foundation

- `WP-S006-001` — Deterministic Country Territories + Political Centers
- `WP-S006-002` — Country Profile: Wealth, Governance + Strategic Orientation
- `WP-S006-003` — Region/Province Profiles + Terrain/Resource Identity
- `WP-S006-004` — Country Relations + Diplomacy Baseline
- `WP-S006-005` — Settlement Archetypes + Country/Region/Terrain Inheritance
- `WP-S006-006` — Settlement Building Catalog + Contextual Composition Rules

# Stage 7 — Hierarchical Lazy World Simulation + Deterministic Persistence

- `WP-S007-001` — Immutable SEED Foundation + Campaign Delta State Model
- `WP-S007-002` — Hierarchical World Context Resolver + Influence Inheritance
- `WP-S007-003` — Multi-Resolution Lazy Simulation Tiers + Relevance Activation
- `WP-S007-004` — Deterministic Event Scheduler + Stable Random Streams
- `WP-S007-005` — Global Country/Diplomacy Aggregate Simulation
- `WP-S007-006` — Regional + Settlement Aggregate Simulation with Lazy Revision Propagation
- `WP-S007-007` — NPC Materialization, Dematerialization + Schedule Reconstruction
- `WP-S007-008` — Deterministic Lazy Catch-Up + Offline World Progression
- `WP-S007-009` — Versioned Save/Load, Deterministic Resume + World Compatibility
- `WP-S007-010` — World Simulation Budgets, Backpressure + Runtime Telemetry

**TO BE CONTINUED AFTER CURRENT ROADMAP STAGES ARE IMPLEMENTED AND REVIEWED**