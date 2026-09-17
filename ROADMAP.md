# The Advisor Game — Product Roadmap

## Authority and purpose

`README.md` is product truth. `AGENTS.md` defines execution governance. GitHub Issues define executable work and live workflow state. `ROADMAP.md` is a Planner-owned product decomposition and sequencing document only.

The roadmap exists to let Planner create small, self-contained Issues without redesigning the feature from scratch. It must not contain live `Role`, `Priority`, `Status`, `Claim`, `Dependency`, or `Handoff` state. It must not assign permanent workers. It must not override README product rules or Simulation authority.

Existing WP identifiers are preserved because current Issues already reference them. Do not create fixed roadmap atomic identifiers for future work. Suggested subdivisions below are issue candidates, not permanent `Ixx` ownership.

## Product invariants used by every Work Package

- Player advises; the autonomous Character decides; Simulation validates; the world reacts.
- Simulation owns legality, authoritative position, resources, identity, occupancy, time, outcomes, persistence and world truth.
- UI, renderer, assets, external LLM, Local BOT and tests consume Simulation truth; they do not become authority.
- The Starting Village is a real inhabited world space with coherent terrain, roads, buildings, workplaces, homes, entrances, interiors and autonomous inhabitants.
- Accessible buildings are the same persistent world entities inside and outside; interiors are not disconnected menu scenes.
- The public game must remain usable on desktop, tablet and phone in relevant orientations.
- NPC world sprites are the normal independently dynamic world-image exception. Normal non-NPC world visuals are flattened into exact `100x100 RGBA` logical-tile composites before presentation.
- Current canonical reusable tile-atlas processing uses exact `1000x1000 RGBA`, `10x10`, exact `100x100` row-major cells and trim `0` where that toolchain applies.
- Production visual art must use approved source artwork. Presentation metadata must never invent Simulation facts.
- Visual evidence should use the current tested `main` commit. Standard review uses phone `720x1280` and tablet `1280x800`; action/NPC/flicker review uses two frames per viewport `0.2s` apart.

## Planner decomposition rules

When a Work Package is converted into Issues:

- Prefer one observable outcome or one architectural boundary per Issue.
- Split independent asset families, responsive surfaces, runtime behaviors and verification gates into separate Issues when they can proceed in parallel.
- Keep implementation and independent verification separate when verification materially matters.
- Copy all execution requirements needed by the worker into the Issue; workers must not need this roadmap.
- Use real dependencies only. Do not serialize unrelated visual, UI, code or verification work.
- Do not create a placeholder Issue merely to reserve future scope.
- If implementation evidence changes an architectural assumption, update this roadmap instead of forcing code to match stale planning.

## Integration and release policy

Completed, required-verification-passed Issues should reach `main` at the shortest safe interval. Do not leave verified work unnecessarily isolated from `main`.

`main` should remain runnable and suitable for automated visual/runtime review. Every integration must preserve repository safety, product authority and required tests; speed never justifies claiming incomplete work as complete.

Formal GitHub Releases represent meaningful playable/testable checkpoints, not every small Issue, unless Admin explicitly requests otherwise. A checkpoint release should normally represent an observable product step such as a stable visual shell, coherent Starting Village visual slice, first living-NPC slice, or first complete Advisor-to-world proof of concept.

# Current roadmap horizon — Visual/UI-first Starting Village proof of concept

The current fully specified roadmap horizon intentionally prioritizes what can be seen and tested. It creates a stable visual shell, coherent Starting Village, responsive UI and motion continuity before expanding deeper gameplay systems.

The numeric WP identifiers below are stable historical/product identifiers. Their order here is delivery order, not numeric order.

---

## Stage A — Rendering, observability and release foundations

### WP-091 — Render-first frame budget

**Purpose:** Keep interaction, camera movement and visible rendering responsive while background Simulation and maintenance work yield.

**Player-visible result:** Panning, zooming, resize and visible NPC/world presentation remain responsive under representative village load.

**Scope / components:** central frame budget; input/camera priority; visible render priority; bounded background slices; starvation prevention; render/background metrics; long-task detection; deterministic Simulation separation.

**Dependencies:** existing renderer/camera loop and background work schedulers; no dependency on final production art.

**Constraints:** render timing cannot become Simulation time or legality; background work may defer but cannot silently disappear; no FPS-dependent authoritative behavior.

**Suggested issue-sized subdivisions:** measure current frame phases; prioritize input/camera/visible render; bound optional slices; add starvation/fairness guard; expose diagnostics; stress-test under NPC/environment load.

**Checks / evidence:** deterministic scheduler tests plus runtime pan/zoom evidence with representative load; record frame/long-task metrics where available.

**Exit criteria:** visible interaction remains practical under load, deferred work resumes safely, and no authority path depends on render cadence.

**Out of scope:** NPC behavior design, new artwork, economy or generalized engine rewrite.

### WP-093 — Static composition cache and invalidation performance

**Purpose:** Make static-world presentation cheap enough for continuous camera movement and zoom.

**Player-visible result:** Buildings, roads, terrain details and other static visuals remain stable without repeated expensive rebuilds or duplicate layers.

**Scope / components:** sparse bounded cache; cache keys from authoritative presentation inputs + asset revision; dirty-tile invalidation; building/interior footprint invalidation; cache reuse across camera/zoom; upload/rebuild accounting.

**Dependencies:** WP-112 unified static-tile architecture; existing static presentation inputs.

**Constraints:** cache is presentation-only; unchanged tiles must not rebuild because camera/UI/NPC motion changed; no giant world-sized retained texture solely for convenience.

**Suggested issue-sized subdivisions:** cache key contract; bounded retention/eviction; dirty-tile invalidation; building/interior invalidation; duplicate-layer audit; performance regression fixture.

**Checks / evidence:** focused cache/invalidation tests and runtime camera/zoom evidence showing no missing or duplicate static imagery.

**Exit criteria:** static recomposition is bounded to changed logical tiles and camera/zoom reuse is demonstrably stable.

**Out of scope:** authoritative world generation or asset production.

### WP-112 — Unified static world composition and visual-slice certification

**Purpose:** Enforce one normal non-NPC world-image path and certify the integrated visual slice against real runtime evidence.

**Player-visible result:** Terrain, roads, buildings, interiors, vegetation, props and other static world art read as one continuous world without black gaps, detached overlays or duplicate static layers; NPCs remain independently dynamic.

**Scope / components:** exact `100x100 RGBA` logical-tile composition; terrain/base first; static overlays after base; one retained static result per logical tile; background upload path; world-edge/backdrop presentation; removal of duplicate static canvases/layers; integrated visual certification.

**Dependencies:** relevant WP-102–WP-110 content/UI inputs; WP-093 caching; renderer/background path. Certification waits for the visual slice it evaluates, but architecture corrections may proceed earlier.

**Constraints:** never extend or mutate authoritative world bounds merely to hide presentation gaps; never move NPCs into static composition; no duplicate persistent non-NPC image layer.

**Suggested issue-sized subdivisions:** compositor architecture; legacy static-layer retirement; world-edge/backdrop treatment; exact tile ordering; static-layer absence regression; integrated camera/zoom review; final visual certification.

**Checks / evidence:** source/regression tests plus exact-current-main phone/tablet Actions evidence; motion/zoom checks; verify NPC visibility and absence of black/missing/duplicate static presentation.

**Exit criteria:** unified path is the normal runtime path and integrated visual evidence shows continuous non-NPC presentation across required viewports.

**Out of scope:** redesigning Simulation topology, generating art, or making NPCs static.

### WP-092 — Stable NPC presentation identity

**Purpose:** Ensure visible NPC presentation remains attached to the same Simulation-backed person.

**Player-visible result:** NPCs do not rename, swap appearance, jump to unrelated identity, vanish due to presentation rebuild, or appear as edge-clamped ghosts.

**Scope / components:** stable presentation key from stable NPC identity; presentation object reuse; deterministic sprite/label lookup; culling reason diagnostics; missing-asset fallback policy; separation from authoritative NPC object lifetime.

**Dependencies:** current NPC identity/world presentation interfaces; may use later WP-011/WP-012 identity improvements without depending on them for the first slice.

**Constraints:** presentation may disappear when legitimately culled but cannot create/delete authoritative NPCs; labels/sprites do not define identity.

**Suggested issue-sized subdivisions:** stable key mapping; presentation reuse; label anchoring; missing asset behavior; identity-swap regression; mobile bounds verification.

**Checks / evidence:** multi-frame movement/camera evidence and deterministic tests keyed by stable NPC IDs.

**Exit criteria:** repeated rebuild/cull/materialization of visible presentation does not change the represented NPC identity.

**Out of scope:** full NPC memory/personality system.

### WP-111 — Render continuity during active motion

**Purpose:** Prevent flicker/disappearance while NPCs, camera, zoom, relevance and responsive layout are changing.

**Player-visible result:** Moving characters and the surrounding village remain visually continuous rather than blinking between valid states.

**Scope / components:** bounded retention of last valid presentation; interpolation handoff; viewport culling hysteresis; relevance promotion/demotion handoff; camera/zoom continuity; resize/orientation continuity; frame-pressure behavior.

**Dependencies:** WP-092 stable presentation identity; WP-091 scheduling; current NPC movement/presentation.

**Constraints:** retention/interpolation is presentation-only; never repopulate removed authoritative NPCs; off-screen entities must not be clamped visibly to viewport edges.

**Suggested issue-sized subdivisions:** transient-frame retention; culling hysteresis; relevance handoff; camera-pan continuity; zoom continuity; responsive-resize continuity; two-frame flicker regression.

**Checks / evidence:** NPC/action visual mode with two frames per viewport `0.2s` apart plus focused deterministic motion tests.

**Exit criteria:** representative movement/camera/zoom/relevance transitions show no material transient disappearance or edge-clamp artifact.

**Out of scope:** authoritative pathfinding and routine scheduling.

### WP-094 — Structured runtime diagnostics

**Purpose:** Make failures diagnosable without turning debug UI into normal gameplay chrome.

**Player-visible result:** Normal players are not burdened by diagnostics; developers/testers can identify renderer, Simulation and integration failures quickly.

**Scope / components:** bounded structured events; category/severity; game time + system time where useful; deduplication; relevant entity/tile identifiers; asset/load/render errors; export path; development-only presentation.

**Dependencies:** existing runtime logging and Development Mode surfaces.

**Constraints:** logs are observations, not authority; no unbounded growth; no sensitive external credentials; diagnostics hidden from ordinary play unless explicitly enabled.

**Suggested issue-sized subdivisions:** event schema; bounded retention; render/asset diagnostics; Simulation/action diagnostics; export format; development-only UI access.

**Checks / evidence:** deterministic log-format tests and manual error-path inspection.

**Exit criteria:** major visual/startup/runtime defects produce concise actionable evidence without persistent normal-play clutter.

**Out of scope:** telemetry service or analytics backend.

### WP-098 — Public-build startup resilience

**Purpose:** Ensure the latest integrated `main` becomes a usable public development build instead of blank/loading indefinitely when optional systems fail.

**Player-visible result:** The game starts into a usable local-fallback experience whenever core assets/code are valid, even if optional external AI is unavailable.

**Scope / components:** resource-load error handling; missing optional asset fallback; initialization order; Local BOT fallback; save-load failure handling; fatal vs recoverable startup classification; visible bounded startup status; no blank screen.

**Dependencies:** current boot/config/state initialization and asset registry.

**Constraints:** fallback cannot invent authoritative state; corrupted required assets/state must fail truthfully; external AI is optional to basic playability.

**Suggested issue-sized subdivisions:** boot-stage diagnostics; required/optional asset classification; Local BOT fallback; invalid save recovery; blank-screen guard; public-build smoke automation.

**Checks / evidence:** clean-start smoke, offline/AI-disabled smoke, controlled missing-optional-resource test and current-main runtime evidence.

**Exit criteria:** representative clean and degraded starts reach a truthful usable state or explicit recoverable error rather than hanging/blanking.

**Out of scope:** full save migration redesign.

### WP-099 — Performance regression gate

**Purpose:** Stop visible performance regressions from accumulating as the village gains content.

**Player-visible result:** New visual/UI/content work does not silently make camera, input or NPC motion materially worse.

**Scope / components:** representative fixtures; frame p95/long tasks; memory/object/draw counts where reliable; camera/NPC/world load scenarios; baseline comparison; CI/report artifact.

**Dependencies:** WP-091 metrics and stable representative runtime fixtures.

**Constraints:** gate measures presentation/performance, not game outcome; thresholds should be evidence-based and revised when architecture legitimately changes.

**Suggested issue-sized subdivisions:** baseline fixture; metric capture; regression comparison; CI artifact; mobile/tablet representative case.

**Checks / evidence:** automated performance report plus targeted runtime review when thresholds move.

**Exit criteria:** current-main performance has a repeatable regression signal suitable for release decisions.

**Out of scope:** speculative micro-optimization with no measured benefit.

### WP-100 — Playable checkpoint quality gate

**Purpose:** Define the minimum quality bar for a meaningful public proof-of-concept checkpoint.

**Player-visible result:** A checkpoint release demonstrates a coherent playable slice rather than a collection of individually merged features.

**Scope / components:** startup; visual continuity; responsive usability; one observable living-world behavior; one Advisor-to-world consequence when available; Local BOT playability; save/resume sanity where implemented; accessibility and performance sanity; exact-build evidence.

**Dependencies:** the WPs included in the checkpoint being certified.

**Constraints:** this WP verifies integration; it must not become a catch-all implementation Issue. Defects route back to the smallest owning WP/Issue.

**Suggested issue-sized subdivisions:** checkpoint definition; automated smoke; visual evidence bundle; interaction smoke; regression triage; formal release decision.

**Checks / evidence:** current-main CI, Actions visual artifact, focused interaction/runtime checks and release notes tied to exact commit.

**Exit criteria:** the selected checkpoint has no unresolved critical defect in its promised scope and is suitable for a formal GitHub Release.

**Out of scope:** certifying unfinished future systems.

---

## Stage B — Starting Village visual production

### WP-101 — Visual specification and factual reference set

**Purpose:** Give all later village visual work one coherent factual direction.

**Player-visible result:** Art added by different Issues reads as one grounded medieval-fantasy world instead of unrelated asset packs.

**Scope / components:** palette/material language; scale rules; top-down readability; day/night legibility; placeholder/debug inventory; approved source registry; representative real runtime reference captures; naming/provenance expectations.

**Dependencies:** current playable scene and README art direction.

**Constraints:** references are evidence, not production textures; no fabricated runtime screenshot; source art authority must remain truthful.

**Suggested issue-sized subdivisions:** asset inventory; placeholder inventory; palette/material spec; scale spec; silhouette/readability spec; day/night spec; source registry; factual runtime captures; independent spec review.

**Checks / evidence:** real current-main screenshots with commit/viewport/time metadata where possible; cross-check against README world rules.

**Exit criteria:** later Designers can create/integrate assets without redefining style, scale or provenance rules per Issue.

**Out of scope:** producing every required asset.

### WP-102 — Terrain, water, vegetation and ground-prop visual family

**Purpose:** Replace placeholder/flat ground presentation with a coherent Starting Village environmental base.

**Player-visible result:** Grass, soil, farm ground, water, banks, trees, low vegetation, rocks and transitions form a believable readable village environment.

**Scope / components:** canonical atlas families; semantic metadata; deterministic presentation variants; terrain adjacency transitions; shoreline/bank treatment; vegetation/prop placement presentation; static composition integration.

**Dependencies:** WP-101 style/scale rules; WP-112 composition; authoritative terrain/placement data.

**Constraints:** visuals cannot change terrain legality/resources; atlas semantics must be truthful; missing approved art cannot be replaced with invented production art.

**Suggested issue-sized subdivisions:** grass; soil/mud; farm/field; water; shoreline; trees; low vegetation; rock/ground props; transition semantics integration; full runtime verification.

**Checks / evidence:** atlas geometry/metadata checks, semantic-selection tests, exact-tile composition checks, zoom/motion visual evidence.

**Exit criteria:** all legitimately present environmental families render coherently without placeholder fallback, seams or duplicate static layers.

**Out of scope:** road topology, building assets, ecology behavior.

### WP-103 — Roads and paths visual family

**Purpose:** Make authoritative village connectivity visually clear and production-ready.

**Player-visible result:** Paths, road straights, corners, intersections, main roads, entrances and crossings form coherent routes between village locations.

**Scope / components:** one-tile paths; turns; T/cross intersections; wider/main-road parts; building connectors; bridge/crossing presentation where authoritative topology requires; terrain-edge transitions; semantic mapping and rotations.

**Dependencies:** WP-101; WP-102 terrain presentation; WP-112 static composition; authoritative road topology.

**Constraints:** road pixels do not define pathfinding; semantic mapping must be deterministic and producer-authored/truthful rather than guessed from art.

**Suggested issue-sized subdivisions:** straights; turns; intersections; main roads; entrances; crossings; terrain edges; semantic mapping; static-composition integration; full-village route visual verification.

**Checks / evidence:** topology-to-semantic regression plus runtime route continuity across pan/zoom.

**Exit criteria:** representative authoritative routes are visually connected, stable and readable with no fallback/debug road presentation.

**Out of scope:** redesigning route generation/pathfinding.

### WP-104 — Building exterior, interior and cutaway visual family

**Purpose:** Make village buildings readable, enterable-looking and consistent with character/road/tile scale.

**Player-visible result:** Homes, inn/tavern, market/shop, workshop/smithy, bakery, mill, village hall, farm/outbuildings and shared interior/cutaway pieces form believable places.

**Scope / components:** building-specific visual families; entrances; walls/floors/roof semantics; shared interior pieces; cutaway/open-roof presentation; semantic registry; static composition integration; scale consistency.

**Dependencies:** WP-101; WP-102/WP-103 context; WP-112 composition; authoritative building footprints/interiors.

**Constraints:** artwork cannot redefine building identity, rooms, collision or occupancy; inside/outside must represent the same authoritative building.

**Suggested issue-sized subdivisions:** one Issue per building family; shared interior/cutaway family; semantic mapping; entrance alignment; cutaway integration; final scale/integration verification.

**Checks / evidence:** exact asset/metadata checks, occupied/unoccupied cutaway tests, runtime entrance/room/road/character scale evidence.

**Exit criteria:** required village building families use approved production presentation and representative interiors remain readable without detached duplicate layers.

**Out of scope:** building economy or profession behavior.

### WP-105 — Protagonist visual identity and movement presentation

**Purpose:** Give the autonomous protagonist a stable readable world presence.

**Player-visible result:** The protagonist is easy to identify at normal zoom, faces/moves coherently and remains visually grounded in the same world scale as NPCs/buildings.

**Scope / components:** approved base visual; directional facing; idle; walk cycle; starter clothing/presentation; selection/focus treatment; ground contact/shadow if appropriate; zoom readability; presentation mapping by stable protagonist identity.

**Dependencies:** WP-101 scale/style; WP-092 stable presentation; approved protagonist art source.

**Constraints:** appearance does not grant profession/rank/equipment authority unless backed by Simulation; animation cannot change authoritative movement.

**Suggested issue-sized subdivisions:** base asset integration; facing states; idle; walk animation; starter appearance mapping; focus treatment; scale/zoom checks; camera/motion regression.

**Checks / evidence:** multi-frame movement screenshots/video-equivalent evidence, stable identity mapping tests and scale comparison near doors/roads/NPCs.

**Exit criteria:** protagonist remains recognizable and visually continuous through movement/camera/zoom at required viewports.

**Out of scope:** full equipment/cosmetic progression.

### WP-106 — Starting Village NPC profession/resident visual roster

**Purpose:** Make the inhabited village population visually differentiated enough to read as real occupations/roles rather than clones.

**Player-visible result:** Farmers/residents, hospitality workers, sellers, wood/charcoal workers, craftspeople, guards, travelers and laborers can be visually distinguished at gameplay scale where approved art exists.

**Scope / components:** approved role-family atlases; stable role-to-presentation metadata; world sprites and optional UI portraits/icons where supplied; fallback classification; scale consistency.

**Dependencies:** WP-101; WP-092 identity mapping; approved source art; authoritative NPC profession/role state.

**Constraints:** visual role cannot invent/change profession; workers must not synthesize missing production families; generic fallback remains explicitly non-final where a required family is absent.

**Suggested issue-sized subdivisions:** one Issue per approved role-family source; runtime role mapping; fallback audit; final profession-readability verification.

**Checks / evidence:** asset/metadata checks plus representative mixed-population runtime evidence.

**Exit criteria:** required available role families are integrated truthfully and no approved family is replaced by a misleading generic alias.

**Out of scope:** profession logic, schedules or dialogue.

### WP-107 — NPC animation and visual continuity

**Purpose:** Turn the NPC roster into readable moving inhabitants rather than static markers.

**Player-visible result:** NPCs idle, face and walk coherently while retaining identity through tile movement and camera changes.

**Scope / components:** idle/facing/walk state presentation; tile-to-tile interpolation; turn transitions; animation-state carry; relevance/cull handoff integration; bounded visible-NPC animation cost.

**Dependencies:** WP-092; WP-111; WP-106 asset families; current authoritative NPC movement.

**Constraints:** animation follows authoritative action/movement; never advances world position itself; missing animation state must degrade predictably without deleting identity.

**Suggested issue-sized subdivisions:** idle/facing mapping; walk-cycle mapping; interpolation bridge; route-turn continuity; relevance/camera handoff; performance bound; motion regression suite.

**Checks / evidence:** two-frame/action visual evidence plus deterministic state-to-animation tests under movement/turn/cull/relevance cases.

**Exit criteria:** representative NPC motion is continuous, readable and bounded without changing Simulation truth.

**Out of scope:** new routine scheduling or pathfinding.

---

## Stage C — Responsive gameplay UI

### WP-108 — Responsive game-area layout matrix

**Purpose:** Establish one tested responsive shell from desktop through phone without duplicating game state.

**Player-visible result:** The world remains practical to view and interact with on desktop, tablet landscape/portrait, phone landscape and phone portrait.

**Scope / components:** desktop landscape; narrow desktop; tablet landscape; tablet portrait; phone landscape; phone portrait base; safe areas/browser chrome; touch targets; resize/orientation state preservation.

**Dependencies:** current DOM/UI shell and game canvas; WP-110 viewport-budget rules may refine later geometry.

**Constraints:** responsive CSS/presentation must not recreate/reset authoritative state; tests must follow current accepted layout rather than freeze obsolete geometry.

**Suggested issue-sized subdivisions:** one Issue per device/orientation class; safe-area contract; orientation-state preservation; cross-device regression gate.

**Checks / evidence:** focused responsive tests and Actions/runtime captures for representative dimensions.

**Exit criteria:** every required class has an explicit usable layout with no clipped essential controls and preserved state across resize/orientation.

**Out of scope:** changing game mechanics by device.

### WP-109 — Phone portrait Game Area / Control Panel switching

**Purpose:** Make phone portrait usable without permanently squeezing world and controls into one short viewport.

**Player-visible result:** Game Area and Control Panel are separate mounted major surfaces; the player can move predictably between them while state is preserved.

**Scope / components:** primary Game Area; primary Control Panel; off-screen isolation; Down control; Up control; scroll/snap/settling behavior; focus/keyboard/touch accessibility; resize/orientation behavior.

**Dependencies:** WP-108 phone portrait base layout.

**Constraints:** only one major surface is primary/visible at a time; both remain mounted; switching is presentation navigation, not Simulation mutation; helper-control transforms must not replace major surfaces.

**Suggested issue-sized subdivisions:** surface isolation; Down control; Up control; focus/state persistence; resize/orientation settling; interaction regression.

**Checks / evidence:** real phone portrait touch/keyboard behavior, focused surface tests and screenshot evidence.

**Exit criteria:** repeated Game/Control switching preserves world and control state with no dual-surface overlap or accidental reset.

**Out of scope:** redesigning all Control Panel content.

### WP-110 — Gameplay HUD declutter and viewport budget

**Purpose:** Give gameplay space to the world while keeping continuously useful information accessible.

**Player-visible result:** Normal play is not covered by redundant instructions, inactive panels or development controls; essential status remains readable.

**Scope / components:** current overlay inventory; redundant chrome removal/merge; contextual-panel collapse; measurable device-class viewport budget; compact essential status; temporary modal behavior; Development Mode gating; touch/accessibility affordances.

**Dependencies:** WP-108 layout matrix; WP-109 phone portrait structure.

**Constraints:** do not hide required information without an accessible path; diagnostics remain available deliberately but not persistent in normal play; budget must not force unusably small controls.

**Suggested issue-sized subdivisions:** factual overlay inventory; persistent instruction treatment; contextual panels; viewport-budget contract; compact status; modal behavior; development diagnostics gating; cross-device coverage verification.

**Checks / evidence:** DOM/CSS regressions plus representative desktop/tablet/phone viewport-occupation evidence.

**Exit criteria:** persistent non-game UI fits the defined budget and no known normal-play debug/redundant overlay materially obscures the world.

**Out of scope:** feature-specific dialog redesign unrelated to viewport occupation.

### WP-095 — Responsive shell integration

**Purpose:** Keep the responsive pieces operating as one shell rather than independent CSS exceptions.

**Player-visible result:** Device/orientation transitions feel like one application with consistent controls and state.

**Scope / components:** breakpoint ownership; stylesheet precedence; shared spacing/safe-area tokens; dialog/context behavior; game viewport sizing; orientation transitions; overflow strategy.

**Dependencies:** WP-108–WP-110 detailed responsive behaviors.

**Constraints:** avoid conflicting breakpoint rules and device-specific duplicate DOM/state; one authoritative game instance remains mounted.

**Suggested issue-sized subdivisions:** breakpoint audit; shared tokens; overflow/dialog integration; orientation transition; cross-device shell regression.

**Checks / evidence:** matrix test across representative viewports and orientation changes.

**Exit criteria:** responsive styles form a deterministic precedence model with no major overlap/conflict/reset defect.

**Out of scope:** visual asset creation.

### WP-096 — Keyboard and focus accessibility

**Purpose:** Ensure the Advisor/game shell remains usable without relying exclusively on pointer/touch interaction.

**Player-visible result:** Menus, panels, dialogs, Advisor input and major phone-surface controls can be reached and operated with predictable focus.

**Scope / components:** tab order; visible focus; semantic buttons; dialog focus trap/return; Escape behavior; Advisor input; panel tabs; alternatives for pointer-only controls.

**Dependencies:** stable WP-108–WP-110 structure.

**Constraints:** keyboard behavior must not create direct gameplay authority; hidden/off-screen UI must not trap focus.

**Suggested issue-sized subdivisions:** global focus contract; dialog behavior; panel controls; phone major-surface focus; map/camera alternatives; accessibility regression.

**Checks / evidence:** keyboard-only interaction smoke and DOM accessibility assertions.

**Exit criteria:** core visible UI can be traversed and operated without focus loss/traps across required layouts.

**Out of scope:** full screen-reader narrative design.

### WP-097 — EN/TR localization integrity

**Purpose:** Keep player-visible UI text structurally localizable as the visual shell evolves.

**Player-visible result:** Supported language switching does not leave obvious hard-coded mixed-language UI or break layout with normal text expansion.

**Scope / components:** key registry; English/Turkish coverage; fallback; interpolation; dynamic labels; dates/times; responsive text stress; no hard-coded player-facing strings in touched surfaces.

**Dependencies:** stable near-term UI surfaces.

**Constraints:** localization cannot change authoritative values; missing translation falls back predictably; internal/debug identifiers need not become player text.

**Suggested issue-sized subdivisions:** key inventory; missing-key repair; dynamic-label routing; date/time formatting; responsive text stress; localization regression.

**Checks / evidence:** automated key parity and representative UI inspection in both supported languages.

**Exit criteria:** current proof-of-concept UI has no material untranslated/hard-coded player-facing gaps and remains usable under text expansion.

**Out of scope:** adding new languages.

---

## Stage D — Visual proof-of-concept exit gate

The visual/UI horizon is complete only when current-main evidence confirms:

- no critical black, missing, duplicated or detached non-NPC world presentation;
- coherent terrain, roads, buildings, interiors, vegetation and props at gameplay scale;
- protagonist and NPC presentation remains identifiable and stable during movement;
- character/building/room/entrance/road scale is plausible;
- desktop, tablet and phone layouts preserve a practical game area;
- phone portrait major-surface switching preserves state and focus without dual-surface overlap;
- contextual/debug UI does not permanently consume excessive gameplay space;
- camera movement, zoom, resize and orientation do not create material presentation discontinuity;
- startup and Local BOT fallback allow the proof of concept to run without an external AI provider;
- current-main visual evidence matches the exact tested commit;
- performance checks show no critical interaction/render regression in the promised slice;
- there is no unresolved critical defect that invalidates the visual proof of concept.

At this point Planner may create a meaningful formal checkpoint release if the integrated slice is verified.

# Next roadmap expansion order

The following WP ranges remain reserved by existing project history and current Issues. Do not renumber them. They are intentionally not decomposed to the same depth yet; Planner must expand them only after the visual/UI proof-of-concept above is implemented and reviewed.

## Next Stage 1 — Physical Starting Village and enterable-world foundations

`WP-021`–`WP-030`: origin-region generation; starter home; enterable-house continuity; inn/tavern; market; workshop/smithy; bakery; mill; village hall; building top-down/interior presentation.

Expansion goal: turn the visual village into a coherent authoritative settlement where buildings, entrances, rooms, collision and presentation describe the same world entities.

## Next Stage 2 — Visible local NPC life

`WP-031`–`WP-040`: resident homes; workplace assignment; routine legality; terrain-aware routing; exclusive occupancy; adjacent NPC dialogue; guard shifts; outdoor worksites; smooth movement; lazy relevance-tier Simulation.

Expansion goal: make the village visibly inhabited with lawful home/work/travel/social behavior while keeping render-first performance.

## Next Stage 3 — Core Advisor → Character → Simulation → World proof of concept

`WP-001`–`WP-010`: bounded tavern travel advice; innkeeper work inquiry; opportunity inspection; recommendation; autonomous acceptance; lawful workplace travel; bounded work action; lawful reward; hazard warning; one persistent behavioral-advice rule.

Expansion goal: demonstrate one complete observable chain where advice influences—but never commands—the same autonomous Character and lawful consequences reach the visible world.

## Next Stage 4 — Character identity, autonomy, memory and emotion

`WP-011`–`WP-020`: deterministic protagonist/NPC identity; fantasy age; personality; Advisor Trust; goals; promises; mood; salient memory; Local BOT/external-LLM parity.

Expansion goal: make autonomous choices belong to persistent people with stable history rather than stateless action selectors.

## Next Stage 5 — Time, persistence and campaign continuity

`WP-051`–`WP-060`: authoritative game clock; day/night; fantasy date; save snapshot; load/resume; offline/off-screen reconciliation; persistent damage/construction/ownership; campaign history.

Expansion goal: ensure the same world and same people continue coherently across sessions and time passage.

## Next Stage 6 — Local economy, work depth and settlement progression

`WP-061`–`WP-070`: currency; items; local trade; population; prosperity; security; settlement growth/decline; initial Advisor progression.

Expansion goal: add local consequences and progression only after the visible world, autonomous decisions and persistence foundations are proven.

## Reserved broader-world areas

`WP-041`–`WP-050`: neighboring-region/world continuity, terrain/biomes, rivers, roads, ecology, landmarks and map.

`WP-071`–`WP-080`: realms, factions, diplomacy, rank, authority and political evolution.

`WP-081`–`WP-090`: military systems, conflict and world events.

These areas may contain existing historical/current verification Issues, but broad new feature decomposition should not outrun the proven Starting Village/core-loop foundation unless Admin explicitly changes priority.

# Continuation boundary

**TO BE CONTINUED AFTER CURRENT ROADMAP STAGES ARE IMPLEMENTED AND REVIEWED**

When the visual/UI proof of concept is complete, Planner should re-read current `README.md`, inspect factual implementation/runtime evidence and the live Issue queue, then expand the next stage in the same per-WP format:

- Purpose
- Player-visible result
- Scope / components
- Dependencies
- Architectural/product constraints
- Suggested issue-sized subdivisions
- Required checks / evidence
- Exit criteria
- Explicit out of scope

Do not mechanically restore old atomic roadmap records. Implementation results, test evidence and current product truth must determine the next detailed decomposition.

## Roadmap maintenance rules

- Preserve established WP identifiers referenced by live/historical Issues unless Admin explicitly authorizes a migration.
- Keep executable workflow state exclusively in Issues.
- Change an Issue when one atomic task changes; change this roadmap when product sequencing or WP-level intent changes.
- Remove obsolete assumptions rather than accumulating contradictory historical instructions.
- Do not add speculative late-game detail merely to make the roadmap look complete.
- Prefer the smallest next set of WPs that produces a visibly testable integrated result.
- Real blockers belong in affected Issues with exact resume conditions; they do not freeze unrelated roadmap planning.
- Only mandatory Admin execution step under current governance is the required Admin push of Admin-created texture-tile binaries already staged in the configured Drive mirror.
