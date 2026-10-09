# Stage S002 canonical planet architecture

Status: **binding architecture contract for Stage S002**. This document is the output of `WP-S002-001-001`. It defines world scale, coordinate authority, pure-zoom presentation, globe/local handoff, input behavior, precision, compatibility, performance budgets and telemetry. Later WPs may refine implementation details, but they may not contradict these invariants without an explicit owner-approved change to `docs/README.md` and this document.

## 1. Reference analysis

Research was refreshed on 2026-10-07. Public documentation is used for proven architectural patterns only; proprietary implementation details are not assumed.

### Mapbox GL JS — one data model, multiple projections

Mapbox GL JS exposes globe as a projection of the same map sources and styles, and documents globe behavior and projection changes at runtime. Its projection guide also describes adaptive projection behavior at different zoom levels.

Sources:
- https://docs.mapbox.com/mapbox-gl-js/guides/globe/
- https://docs.mapbox.com/mapbox-gl-js/guides/projections/
- https://docs.mapbox.com/mapbox-gl-js/api/map/

Applicable lessons:
- projection is presentation, not geography authority;
- the same source data should survive a projection change;
- pole handling and world-wrap behavior must be explicit;
- camera scale and geographic center are distinct state.

Trade-offs/failure modes:
- a globe naturally shows one hemisphere at once;
- flat projections distort the sphere, especially near poles;
- a projection switch that changes source data or camera focus creates visible discontinuity.

### MapLibre GL JS — explicit globe/flat projection interpolation

MapLibre GL JS exposes projection data containing both globe and Mercator matrices plus a `projectionTransition` value. Its style specification supports projection interpolation driven by zoom. Its globe implementation also documents antimeridian clipping as a special case.

Sources:
- https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/ProjectionData/
- https://maplibre.org/maplibre-style-spec/projection/
- https://maplibre.org/maplibre-style-spec/types/
- https://maplibre.org/roadmap/maplibre-gl-js/globe-view/

Applicable lessons:
- globe→flat should be a projection interpolation around the same geographic state, not a second world;
- the antimeridian must be handled in data/projection logic, not hidden with duplicate geometry;
- transition progress belongs to presentation state and must never become world-generation input.

Trade-offs/failure modes:
- two representations may coexist during a handoff, temporarily increasing rendering cost;
- seam handling is required even when the visual transition is smooth.

### CesiumJS — local reference frames and large-coordinate precision

Cesium documents 3D/2D/morphing scene modes, local east-north-up reference frames and relative-to-eye/high+low coordinate techniques for reducing jitter with large world coordinates.

Sources:
- https://cesium.com/learn/cesiumjs/ref-doc/global.html
- https://cesium.com/learn/cesiumjs/ref-doc/Camera.html
- https://cesium.com/learn/cesiumjs-learn/cesiumjs-camera/
- https://cesium.com/downloads/cesiumjs/releases/b20/Documentation/czm_translateRelativeToEye.html
- https://cesium.com/downloads/cesiumjs/releases/b29/Documentation/EncodedCartesian3.html

Applicable lessons:
- authoritative global coordinates should remain high precision;
- GPU/render coordinates should stay local to the camera/focus or use high/low encoding;
- local tangent frames provide intuitive east/north/up movement and camera controls;
- scene-mode changes must preserve the same geographic target.

Trade-offs/failure modes:
- sending million-meter absolute positions directly through float32 vertex paths causes precision loss and jitter;
- rebasing must move presentation only, never authoritative world state.

### Google Maps — explicit camera target and separate movement controls

Google Maps 3D documentation separates the camera target/center from heading, tilt, range and field of view. Its controls expose zoom, move, rotate, tilt and compass as distinct operations. Public docs do not expose proprietary globe-generation internals, so only the interaction/state separation is adopted.

Sources:
- https://developers.google.com/maps/documentation/javascript/3d/camera-position
- https://developers.google.com/maps/documentation/javascript/3d/map-controls
- https://developers.google.com/maps/documentation/javascript/vector-map

Applicable lessons:
- geographic focus must be explicit state;
- zoom/range and heading are independently controllable;
- a compass should reflect actual heading;
- navigation controls should communicate which state they change.

Unverified: Google’s internal globe↔local geometry, tiling and terrain algorithms are proprietary and are not treated as evidence.

### Browser input, rendering and accessibility

Pointer Events support multi-pointer pinch gestures. `touch-action` defines which gestures belong to the application before pointer cancellation occurs. WebGL guidance warns that high-DPI rendering directly increases pixel cost. WCAG guidance uses 44 × 44 CSS px as a robust touch-target target. WebGPU timestamp queries can provide GPU timings where the optional feature exists, but cannot be assumed on every browser/device.

Sources:
- https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action
- https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
- https://www.w3.org/WAI/WCAG21/Understanding/target-size
- https://developer.mozilla.org/en-US/docs/Web/API/GPUQuerySet

Applicable lessons:
- one pointer and two-pointer gestures need deterministic, separate meanings;
- render resolution must be budgeted independently from CSS layout size;
- touch controls should normally be at least 44 × 44 CSS px;
- GPU timing is optional telemetry and must have a null/unsupported path.

## 2. Canonical physical planet

The Stage S002 planet keeps the owner-approved **10% Earth linear scale** already stated by `docs/README.md`.

| Constant | Canonical value |
| --- | ---: |
| Reference Earth mean radius | 6,371,000 m |
| Fantasy planet radius `R` | **637,100 m** |
| Fantasy planet diameter `D` | **1,274,200 m** |
| Equatorial circumference `C = 2πR` | **4,003,017.36 m** |
| Equator→pole meridional arc `πR/2` | **1,000,754.34 m** |

These values are physical game-world measurements. A PlayCanvas sphere may use any convenient render-unit radius; render scale never changes physical distance.

The legacy S001 runtime values `WORLD_SIZE = 262144 m` and the derived ~41.7 km globe radius are **not canonical S002 scale**. They are transitional implementation values that must be removed by the world-rescale package. No later S002 package may infer physical world size from a render tile count or legacy atlas extent.

## 3. World authority and coordinate fabric

### 3.1 Authoritative position

A fixed world position is defined by canonical spherical coordinates plus physical elevation:

- longitude `lon` in radians, normalized to `[-π, π)`;
- latitude `lat` in radians, clamped to `[-π/2, π/2]`;
- elevation `h` in meters relative to the canonical sphere surface.

The corresponding planet-centered Cartesian position in meters is derived, never independently assigned:

`P = (R + h) × [cos(lat) sin(lon), sin(lat), cos(lat) cos(lon)]`

Longitude ± `2π` is the same world position. The north and south poles are single logical positions even though longitude becomes presentation-degenerate there.

### 3.2 Wrapped flat-meter helper coordinates

For deterministic indexing, navigation math and local flat presentation, define reversible helper coordinates:

- `wrappedX = R × lon`, normalized to `[-C/2, C/2)`;
- `northM = R × lat`, bounded to `[-πR/2, πR/2]`.

`wrappedX ± C` resolves to the identical authoritative location. These helper coordinates are not a planar world and do not make east-west physical spacing independent of latitude.

### 3.3 Stable global spatial IDs

Stable global address cells use a **six-face cube-sphere quadtree**. A cell ID contains generator version, face, level and integer `(u,v)` address, for example:

`<SEED>/PLANET/<GEN>/F<face>/L<level>/<u>/<v>`

Rules:
- face ownership at cube edges/corners is resolved by one documented deterministic tie-break;
- longitude wrap and pole sampling resolve to one owning ID;
- neighboring IDs are computable without camera state;
- content decisions use Campaign SEED + canonical ID/coordinates only;
- render patch/tile addresses may reuse these IDs but never become identity authority;
- finer cells refine the same parent foundation and may not contradict parent land/water/domain facts.

The Stage S001 2 m square cell is not retained as a planet-wide planar authority. When local 2 m gameplay sampling is required, the chosen quadtree level must have a worst-case surface sample spacing of **2 m or less**, and local gameplay/collision uses metric tangent coordinates. Logical cell geometry must never become a visible natural-world lattice.

### 3.4 Local tangent frame

Any closer flat/local view uses an east-north-up (ENU) tangent frame centered on the current authoritative focus coordinate:

- +X = local east;
- +Z = local south (negative ENU north), matching the globe and the right-handed PlayCanvas frame; ENU calculations themselves retain positive north;
- +Y = local up/elevation.

Local coordinates are derived from canonical planet coordinates. Moving/rebasing the tangent origin changes presentation coordinates only. Terrain, roads, actors, labels, collision and picking all resolve back to the same canonical world position.

## 4. Precision contract

Authoritative geographic calculations use JavaScript `number`/float64 or integer quantized IDs. GPU-facing vertex positions must not use raw planet-centered million-meter coordinates when local rendering is active.

Required strategy:
- terrain/structure mesh vertices are stored relative to their patch origin;
- patch origins are transformed into the active ENU/camera-relative frame;
- float32 positions sent to the GPU stay within **±8,192 m** of the active render origin during detailed local rendering;
- the render origin is rebased before the camera/focus exceeds **2,048 m** from it;
- worst-case presentation-position error at Street/local detail is **< 1 cm**;
- rebasing may not change canonical IDs, Simulation positions, SEED inputs, cache keys or route costs.

High/low split coordinates are permitted for globe-scale overlays that cannot use a local tangent origin efficiently, but the simpler patch-relative/local-origin path is preferred for local terrain.

## 5. Pure zoom invariant

Zoom input changes **only scale/detail**.

For wheel, pinch and zoom buttons:
- canonical focus `(lon, lat)` is unchanged;
- center marker remains on the same world coordinate and screen pixel;
- heading is unchanged;
- no tilt/orbit/recenter/fly animation is introduced;
- Simulation state and generated foundation are unchanged;
- only visible footprint, LOD/refinement and projection-blend progress may change.

Pinch midpoint does not become a new map center. One-finger drag/navigation and explicit rotate controls are separate operations.

Internal zoom is continuous. The player-facing scale label is discrete and follows the ladder below with hysteresis so a tiny input cannot flicker repeatedly between adjacent labels.

## 6. Canonical scale ladder

The exact player-facing ladder is:

`1/10 → 1/20 → 1/50 → 1/100 → 1/250 → 1/500 → 1/1000 → 1/2500 → 1/5000 → 1/10000`

For Stage S002, each denominator maps to a canonical **vertical ground-footprint target**:

`verticalFootprint = D × denominator / 10000`

| Scale | Vertical planet-space footprint |
| --- | ---: |
| 1/10 | 1,274.2 m |
| 1/20 | 2,548.4 m |
| 1/50 | 6,371 m |
| 1/100 | 12,742 m |
| 1/250 | 31,855 m |
| 1/500 | 63,710 m |
| 1/1000 | 127,420 m |
| 1/2500 | 318,550 m |
| 1/5000 | 637,100 m |
| 1/10000 | 1,274,200 m |

This ladder is a Stage S002 planet/world-construction presentation contract, not a declaration that later gameplay can never add a closer explicit scale. Any future extension requires an owner-approved README change; it must not silently introduce `x` multipliers.

The HUD shows only these labels. Internal interpolation between adjacent states remains continuous.

## 7. Globe ↔ local/tangent handoff

The same canonical world is drawn through two representations:

- **globe-dominant:** `1/2500`, `1/5000`, `1/10000`;
- **local/tangent-dominant:** `1/10` through `1/1000`;
- **transition interval:** continuous internal zoom between the `1/1000` and `1/2500` footprint anchors.

Transition progress is a presentation value `t ∈ [0,1]` derived only from current continuous zoom/footprint. It is never a SEED input.

Acceptance rules:
- focus coordinate, heading and center-marker screen position are bit-identical before/after the handoff after canonical normalization;
- both representations sample the same world features/IDs;
- flat/local coverage is prepared before it becomes visually dominant;
- there is no blank frame, flash, unrelated camera motion or missing terrain;
- reversing zoom mid-transition reverses the same transition rather than starting a new camera move;
- landmark labels keep the same canonical anchor through the transition;
- transition opacity/projection progress may change, but world state may not.

## 8. Navigation and HUD contract

### 8.1 Drag and keyboard movement

Pointer movement converts to a ground-distance request from the current measured vertical footprint:

`groundDelta ≈ pointerDeltaPx / viewportHeightPx × verticalFootprint`

The exact globe calculation uses ray/sphere or tangent-space mapping at the current focus so latitude convergence is handled correctly. Local flat navigation uses ENU meters. Browser acceptance tests compare expected versus measured ground movement with **≤5% error** at two globe scales and one local scale.

Longitude wraps indefinitely. Latitude stops at the poles without inventing a second copy of the pole.

### 8.2 Compass

The compass reflects actual screen-up heading. If the presentation rotates, the compass rotates correspondingly. A reset-north action may set heading to zero, but zoom never does.

### 8.3 Centre marker and coordinate readout

The authoritative focus coordinate is always visible while map/globe navigation is active.

- marker is world-anchored at the current focus;
- latitude/longitude text is derived from that coordinate;
- at wide scales show at least 4 decimal degrees; at local scales show at least 5 decimal degrees;
- zoom cannot change the value.

### 8.4 Truthful ruler

A ruler label is based on **measured canonical surface distance**, not a rounded assumption.

- globe mode: intersect ruler endpoints/rays with the canonical sphere and measure the shortest great-circle distance;
- local mode: measure ENU/canonical surface endpoints;
- choose a pleasant distance only by changing the ruler line length to match that distance;
- never keep a line length that no longer matches its text;
- browser acceptance error between displayed distance and measured distance is **≤2%**.

### 8.5 Labels and leaders

Every eligible landmark label owns a canonical world anchor.

- far-side globe labels are occluded by hemisphere/horizon rules;
- out-of-viewport and scale-ineligible labels may be hidden;
- collision handling may displace text but may not silently drop an otherwise eligible important landmark because another label consumed a shared placement budget;
- displacement greater than **4 CSS px** from the projected anchor shows a visible leader/arrow back to the anchor;
- layout/tie-breaking is deterministic for the same viewport and camera state.

## 9. Input, layout and accessibility contract

The canvas uses Pointer Events for mouse, pen and touch. `touch-action` must be declared deliberately so the browser and application do not fight over gestures.

Required mappings:
- wheel / two-pointer pinch: pure zoom only;
- one-pointer drag: geographic pan/turn only;
- explicit rotate or Q/E: heading only;
- arrow/WASD: scale-aware geographic movement;
- zoom buttons: same pure-zoom path as wheel/pinch.

Player controls intended for touch should normally provide at least **44 × 44 CSS px** activation targets. HUD layout must account for CSS safe-area insets. The minimum regression matrix is:

- 360 × 800 phone portrait;
- 390 × 844 phone portrait;
- 844 × 390 phone landscape;
- 768 × 1024 tablet portrait;
- 1024 × 768 tablet landscape;
- 1280 × 720 laptop;
- 1440 × 900 desktop.

No required control may be clipped, overlap the center marker, or make the globe/local focus unusable at these viewports.

## 10. Renderer compatibility contract

- PlayCanvas Engine 2 remains the renderer.
- WebGPU is requested first on supported secure-context default Chrome.
- Adapter/device/canvas initialization failure automatically falls back to WebGL2 without an experimental browser flag.
- A failed WebGPU device/context is released before fallback.
- WebGPU and WebGL2 render the same canonical world and expose the same Simulation behavior.
- If both fail, show an actionable renderer error and retry control.
- Device/backend affects render quality and telemetry only, never SEED/world values.

The backing render scale is:

`backingScale = min(devicePixelRatio, maxDPR) × adaptiveRenderScale`

Initial limits:
- phone `maxDPR = 1.25`, adaptive scale `0.75–1.0`;
- tablet `maxDPR = 1.5`, adaptive scale `0.75–1.0`;
- desktop `maxDPR = 1.5`, adaptive scale `0.85–1.0`.

Quality may step down only after sustained frame pressure; it must use hysteresis and may not alter Simulation. WP-S002-005-001 will measure/tune these limits on real hardware.

## 11. Performance architecture rules

### 11.1 Non-negotiable allocation rules

- No detailed planet-wide allocation at 2 m, 200 m or similar local resolution.
- No dense canonical array may grow linearly with every fine cell on the ~4,003 km circumference planet.
- Dense whole-planet presentation/summary tables are allowed only when bounded: combined dense global tables must stay **≤32 MiB** and any single scalar table **≤4 million entries**.
- Fine geography, terrain modifiers, roads, buildings, residents and meshes are generated/indexed sparsely by region/focus.
- unchanged prepared patches are reused;
- main thread uploads at most **one patch/mesh group per rendered frame**;
- generation queues, caches and active resources are bounded independently from world size.

### 11.2 Initial acceptance budgets

These are product budgets, not claims about the current prototype. Software-rendered CI verifies counters/invariants; physical-device FPS claims require real hardware evidence in WP-S002-005-001.

| Metric | Phone baseline | Tablet baseline | Desktop baseline |
| --- | ---: | ---: | ---: |
| Minimum sustained gameplay | 30 FPS | 30 FPS | 30 FPS |
| Capable-hardware target | 60 FPS | 60 FPS | 60 FPS |
| Frame-time p95 minimum budget | ≤33.3 ms | ≤33.3 ms | ≤33.3 ms |
| 60 FPS target p95 | ≤16.7 ms | ≤16.7 ms | ≤16.7 ms |
| Navigation/input handler p95 | ≤4 ms | ≤3 ms | ≤2 ms |
| Main-thread upload p95 | ≤4 ms | ≤3 ms | ≤2 ms |
| Worker generation task p95 | ≤50 ms | ≤35 ms | ≤25 ms |
| Uploads per rendered frame | ≤1 | ≤1 | ≤1 |
| Generation+ready queue | ≤4 | ≤6 | ≤8 |
| Active render patches | ≤160 | ≤220 | ≤260 |
| Cached prepared patches | ≤180 | ≤240 | ≤320 |
| App-owned CPU/geometry cache estimate | ≤96 MiB | ≤160 MiB | ≤256 MiB |
| App-owned GPU/texture estimate | ≤96 MiB | ≤160 MiB | ≤256 MiB |
| Final globe surface texture | ≤1024×512 | ≤2048×1024 | ≤2048×1024 |

Additional rules:
- no navigation frame should contain an avoidable synchronous generation burst;
- no per-frame texture decoding/creation for unchanged assets;
- no one-entity-per-logical-cell representation;
- adaptive quality may reduce render resolution/shadows/visual density, never Simulation fidelity;
- a transition may temporarily retain both globe/local resources, but the peak must remain inside the same device memory budget or deterministically defer lower-priority refinement.

## 12. Telemetry schema

`window.advisorWorld.state` exposes read-only deterministic diagnostics. Telemetry is observational and is forbidden as a foundation-generation input.

Required structure:

```text
state.performance = {
  backend,
  presentation,
  scaleLabel,
  continuousFootprintM,
  projectionTransition,
  renderScale,
  devicePixelRatio,
  cpuFrameMs: { latest, p50, p95, p99 },
  gpuFrameMs: { latest, p50, p95, p99 } | null,
  inputHandlerMs: { p95 },
  workerMs: { latest, p95, completed },
  uploadMs: { latest, p95, uploadsThisFrame },
  drawCalls,
  triangles,
  entities,
  activePatches,
  preparedPatches,
  cachedPatches,
  pendingGeneration,
  readyUploads,
  cacheHits,
  cacheMisses,
  evictions,
  cpuResourceBytesEstimated,
  gpuResourceBytesEstimated,
  longFrameCount,
  rendererLossCount
}
```

Rules:
- timing windows use a bounded rolling sample (recommended 300 rendered frames);
- GPU timing is `null` when timestamp queries/engine timing are unavailable;
- resource-byte values are explicit app-owned estimates, not falsely presented as total browser/GPU memory;
- telemetry collection must allocate no unbounded history;
- tests may assert telemetry, but generation code may not read it.

## 13. Automated acceptance checks

Every implementation WP that touches this architecture keeps or adds checks relevant to its scope. The integration performance WP verifies the complete matrix.

Minimum root checks:
- `lon` and `lon ± 2π` resolve to the same canonical ID/foundation sample;
- coordinate conversions round-trip within a stated numeric tolerance;
- pole ownership is unique;
- pure zoom preserves focus and heading exactly;
- globe/local handoff preserves focus and has no missing frame;
- ruler error ≤2%;
- drag ground-distance error ≤5%;
- far-coordinate local rendering stays <1 cm worst-case position error;
- queue/cache/resource counters remain bounded;
- WebGPU preference and automatic WebGL2 fallback remain functional;
- all regression viewports have usable non-overlapping controls.

## 14. Ownership boundaries for later WPs

This root package defines contracts; it does not implement the later systems.

- WP-S002-002-002 implements the projection handoff.
- WP-S002-002-003 implements navigation/HUD/ruler/labels against this contract.
- WP-S002-003-001 implements canonical wrapped coordinate helpers and IDs.
- WP-S002-003-002 implements local-origin/precision-safe rendering.
- WP-S002-003-003 implements wrap-aware streaming.
- WP-S002-004-002 performs the runtime world rescale from legacy S001 values to the canonical radius/circumference here.
- WP-S002-004-003 onward generate natural geography and settlement infrastructure from the same authority.
- WP-S002-005-001 implements, measures and tunes telemetry/performance budgets, and records physical-device limitations honestly.

These are scope boundaries, **not dependencies**: each Issue remains solvable in one pass and must implement any minimum missing contract required for its own acceptance.

## 15. Known current-runtime mismatches

At completion of this documentation WP, the following are expected implementation gaps, not contradictions in the target architecture:

- runtime still uses legacy `WORLD_SIZE = 262144 m` until WP-S002-004-002;
- current globe/local switch is immediate until WP-S002-002-002;
- flat-world wrap is incomplete until WP-S002-003-001/003;
- current HUD does not yet implement the canonical scale ladder, centre marker, truthful globe ruler, dynamic compass or label leaders until WP-S002-002-003;
- current performance telemetry is incomplete until WP-S002-005-001;
- natural geography/climate/settlement placement remains prototype data until the 004 packages.

These gaps must not be mistaken for alternative authority rules. The contract in `docs/README.md` plus this file is the target.
