# The Advisor Game — ROADMAP

## Development Rule

Build from the smallest visible working component upward.

Every Work Package must:

- be narrowly scoped;
- be visible or directly observable in the running game;
- have a simple pass/fail test;
- work from local `index.html`;
- avoid unrelated features.

**Player advises → AI Character decides → Simulation validates → World reacts.**

---

## Project Structure Rule

The repository root contains only:

```text
/index.html
```

All other files belong in subfolders such as:

```text
/docs/
/styles/
/scripts/
/assets/
/saves/
```

The base game must not require a backend server.

---

## Base Screen Rule

The first browser viewport contains exactly three gameplay rows:

1. **Top Ribbon Bar**
2. **Gameplay Area**
3. **Status Area**

Technical, development and verification information starts only after the Status Area and is shown in accordion panels below the first viewport.

The game must remain playable in portrait and landscape layouts.

---

## Development Tooling — GitHub Visual Evidence — COMPLETE

- `tools/screenshot_tool.py` is adapted from the prior project screenshot utility.
- Selenium/headless Chrome captures landscape or portrait screenshots into `tools/screenshots/`.
- The current game is auto-started for evidence when no campaign is active.
- Runtime evidence records campaign state, game date/time, protagonist sprite/load state, terrain counts/types and geographic hierarchy.
- GitHub Actions workflow: `.github/workflows/visual-evidence.yml`.
- Manual workflow runs and authorized Issue comments support visual evidence capture.
- Issue trigger syntax: `/visual-evidence <scenario>`.
- Pushes that change the screenshot tool/workflow self-test against a local HTTP server using the exact checked-out commit.
- GitHub Actions uploads screenshots/evidence as a 14-day artifact by default.
- Publishing screenshots into `main` remains an explicit trusted/manual option.
- Current-build readiness failures are test failures rather than successful blank screenshots.
- Legacy camera/NPC scenario names remain available and safely degrade until those runtime APIs exist.
- Verified GitHub Actions self-test: run **35600673452** completed successfully against the local checkout and produced a screenshot plus JSON evidence.
- Verified evidence contained **253 visible terrain tiles**, loaded Protagonist sprite at **(0,0)**, populated fantasy date/time, and populated continent/realm/region/city/district/village data.

---

# Stage 1 — Deterministic World Foundation

## WP-001 — Base Game, Campaign SEED and Game Clock — COMPLETE

### Goal

Create the smallest runnable campaign foundation.

### Current rules

- default SEED: `The_Advisor_Game_20260924`;
- SEED is edited inside the full-screen **Settings** popup;
- **Main Menu** and **Settings** open from the Top Ribbon Bar;
- the Top Ribbon Bar shows the fantasy date and time;
- new campaign fantasy date starts from the real local date with **year − 900**;
- new campaign fantasy time starts from the current real local time;
- **1 real hour = 1 game day**;
- therefore game time advances at **24× real time**;
- campaign state persists through browser reload.

### In-game proof

The player can start a campaign, see the fantasy clock advance, open Settings, see the SEED, reload the page and continue the same campaign time.

### Pass condition

- local `index.html` opens successfully;
- only `index.html` is a root file;
- three-row play layout fills the first viewport;
- portrait and landscape layouts work;
- Settings opens full screen;
- default SEED is available;
- fantasy start year equals real year − 900;
- clock advances at 24× real time;
- campaign reload preserves start state.

---

## WP-002 — Deterministic Foundation and Live Randomness — COMPLETE

### Goal

Provide reproducible randomness while keeping static world generation independent from game time.

### Core rules

There are two deterministic random modes.

#### A. World Foundation Randomness

Used only for:

- terrain generation;
- environment generation;
- initial NPC generation;
- other fixed world-foundation generation.

The random source is **Campaign SEED based** and must never use fantasy time.

Stable structural keys such as tile coordinates or an NPC generation slot may select a deterministic sample, but they are not entropy sources and may not introduce real randomness.

Examples:

- `terrain:x:y`
- `environment:x:y`
- `npc:0001`

The same Campaign SEED and same structural location/slot must always reproduce the same foundation result.

#### B. Live Simulation Randomness

Used for:

- NPC live actions;
- NPC decisions;
- dynamic events;
- changing simulation behavior;
- other actions resolved during active simulation.

Every live random result is:

**Random Result = Random(Campaign SEED, Fantasy Game Timestamp)**

FantasyTimestamp uses exactly:

**date + hour + minute + second**

Canonical form:

`YYYY-MM-DD HH:MM:SS`

Milliseconds are never part of the random input.

If the SEED and FantasyTimestamp are the same, the result must be exactly the same.

### Forbidden everywhere

- `Math.random()`;
- browser/OS cryptographic randomness;
- device randomness;
- uncontrolled entropy;
- real-world time as a random input.

### Implemented

- `PRNG.foundationUint32(seed, stableKey)` for time-independent world foundation generation;
- `PRNG.liveUint32(seed, fantasyTimestamp)` for live simulation actions;
- live FantasyTimestamp has second precision only: `YYYY-MM-DD HH:MM:SS`;
- milliseconds are rejected and cannot influence a live random result;
- both functions are stateless and deterministic;
- the random module never reads the real clock itself;
- the WP-002 accordion verifies both modes separately.

### Pass condition

- terrain/environment/initial NPC generation can use deterministic SEED-based foundation values without fantasy time;
- same foundation SEED + same stable structural key gives the same result;
- same live SEED + same second-precision FantasyTimestamp gives the same result;
- milliseconds cannot change a live result;
- changing the FantasyTimestamp second can change a live result;
- no real-random source exists.

---

## WP-003 — Infinite World Coordinates + Protagonist Origin — COMPLETE

### Goal

Define the world coordinate system before rendering terrain.

### Core rules

- the Protagonist is created at world coordinate **(0,0)** when a new campaign starts;
- **(0,0)** is the initial center of the gameplay view;
- X may extend indefinitely in the negative or positive direction;
- Y may extend indefinitely in the negative or positive direction;
- the game defines no minimum or maximum X/Y world coordinate;
- coordinates are signed arbitrary-size integers stored without floating-point rounding;
- restarting a campaign resets the Protagonist to **(0,0)**.

Examples of valid coordinates:

- `(0,0)`
- `(-1,0)`
- `(0,-1)`
- `(250,-900)`
- extremely large positive or negative integer coordinates.

### Implementation

- `scripts/world/coordinates.js` owns coordinate normalization and arithmetic;
- coordinates use arbitrary-size integer handling;
- campaign state stores the Protagonist coordinate;
- `scripts/entities/protagonist.js` exposes the authoritative Protagonist position;
- the gameplay area visibly centers the Protagonist at **(0,0)**;
- the transparent male protagonist asset `assets/characters/protagonist_male.png` is rendered inside the centered 100×100 origin-tile footprint;
- runtime UI verification confirms the PNG loads, with a small fallback marker only if the asset fails to load.

### In-game proof

After starting a campaign, the Protagonist marker appears at the exact center of the Gameplay Area and shows **(0,0)**. The WP-003 accordion verifies positive and negative arbitrary-size coordinates.

### Pass condition

- new campaign creates Protagonist at **(0,0)**;
- initial gameplay view is centered on **(0,0)**;
- coordinate system accepts positive arbitrary-size X/Y values;
- coordinate system accepts negative arbitrary-size X/Y values;
- no gameplay-defined outer coordinate boundary exists;
- saved/reloaded campaigns preserve the Protagonist coordinate;
- the male protagonist PNG renders on the **(0,0)** tile without replacing terrain identity.

---

## WP-004 — SEED-Generated Geographic Hierarchy + Realistic Settlement Spacing — COMPLETE

### Goal

Define a realistic, deterministic geographic structure before rendering terrain.

### Geographic hierarchy

The Campaign SEED determines the fixed world foundation from general to specific:

- continent;
- country / realm;
- region / province;
- city;
- district;
- town where applicable;
- village;
- avenue / major road;
- street / local road;
- terrain and elevation;
- rivers, lakes, coastline and water;
- biome and vegetation;
- climate and local environmental conditions;
- settlement placement;
- roads, paths and travel connections;
- other fixed geographic/environmental details.

The same Campaign SEED and the same structural location must reproduce the same geographic foundation.

### Realism constraints

SEED generation is not allowed to ignore world-scale realism.

For distinct villages:

- village centers must not be connected by any valid walking route requiring less than **1 fantasy game hour**;
- this is based on the **shortest valid walkable route**, not straight-line distance;
- terrain, elevation, rivers, bridges, roads, paths and other movement constraints must affect travel time;
- if a generated candidate violates the minimum travel-time rule, deterministic generation must reject it and choose the next deterministic candidate from the same SEED process;
- the result must remain fully reproducible from the same Campaign SEED.

The minimum is therefore:

**Village A center → shortest valid walking route → Village B center >= 1 fantasy hour**

### Generation rule

This WP uses **foundation randomness only**.

Fantasy time must not influence continent, country, region, settlement, street, terrain, environment, or initial geographic generation.

### Implemented

- `scripts/world/geography.js` provides deterministic geographic hierarchy and environment foundation;
- starting world coordinate **(0,0)** belongs to a deterministic continent → realm → region → city → district → village → avenue → street chain;
- terrain classification now consumes the geography foundation;
- village centers use deterministic spatial cells with bounded jitter;
- every village pair has a geometric minimum separation that cannot be walked in under 1 fantasy hour even at the fastest walking speed;
- a terrain-aware A* walking-route check verifies the nearest distinct village from the starting village;
- authoritative world scale is **2 meters per logical tile**;
- fastest normal walking surface used by village-spacing proof is **3.6 km/h**.

### In-game proof

The WP-004 accordion shows the generated starting geographic hierarchy around **(0,0)**, environmental conditions, nearest distinct village, and deterministic shortest valid walking time.

### Pass condition

- same SEED reproduces the same hierarchy;
- starting coordinate belongs to a deterministic geographic chain;
- geography ranges from continent-level down to street-level structure;
- environmental foundation is SEED-generated;
- nearest distinct village has no valid walking route under 1 fantasy hour;
- no real-random source is used;
- changing fantasy time alone does not alter the world foundation.

---

## WP-005 — Viewport-Filling Solid-Color Tiles — COMPLETE

### Goal

Fill the complete Gameplay Area around the current world center with SEED-generated tiles using solid colors only.

### Basic terrain color palette

Before production textures exist, terrain and structural tiles use distinct muted colors:

- grass — #6F8A4C;
- forest — #315B3A;
- dirt — #9B7448;
- mud — #66503B;
- road — #B09A73;
- building — #7C6252;
- water — #3F7190;
- rock — #74756F;
- sand — #BDA66F;
- farmland — #7C8147.

These colors are presentation-only. Terrain identity remains Simulation/world-foundation data.

The palette is implemented in `scripts/data/terrain-palette.js`. The renderer consumes the completed WP-004 geography foundation and WP-005 now owns viewport-fill behavior.

### Rules

- no textures;
- no tile atlas;
- no props or decorative artwork;
- tile count is calculated from the actual browser gameplay viewport;
- rendered row/column counts stay odd so the current world-center tile remains exactly centered;
- portrait and landscape sizes are handled automatically.

Example:

If the Gameplay Area currently shows **16 × 9 tiles**, at least **144 visible tiles** are generated.

### Implemented

- logical terrain tiles remain **100×100 px** in the current presentation layer;
- row/column counts derive from the actual Gameplay Area size with an additional edge buffer;
- row/column counts are forced odd so the authoritative world-center coordinate remains the exact center tile;
- a `ResizeObserver` recalculates terrain when the Gameplay Area dimensions change;
- terrain-grid runtime metadata exposes viewport size, rows, columns, tile size, total grid coverage and center validity;
- GitHub visual evidence records the same coverage metrics for landscape and portrait verification;
- no terrain textures or tile atlas are used.

### Verified evidence

GitHub Actions run **35601738723** used the `responsive-cycle` scenario on the exact checked-out commit:

- landscape Gameplay Area: **1920×839 px**;
- landscape grid: **23×11 = 253 tiles**, **2300×1100 px** coverage;
- portrait Gameplay Area: **1080×1679 px**;
- portrait grid: **13×19 = 247 tiles**, **1300×1900 px** coverage;
- returning to landscape reproduced **23×11 = 253 tiles**;
- all three frames reported `coveragePass=true`;
- all three frames reported `centerPass=true`;
- Protagonist remained at **(0,0)**;
- visual inspection showed no blank Gameplay Area in landscape or portrait.

### Pass condition

- no blank gameplay area is visible;
- resizing recalculates required rows and columns;
- rendered grid dimensions are at least as large as the Gameplay Area in both axes;
- the world-center tile remains exactly centered;
- same SEED and coordinates reproduce the same terrain type and color;
- every supported basic terrain type has a distinct solid color.

---

## WP-006 — Camera Movement Through the Infinite World — COMPLETE

### Goal

Move through the unbounded tile world without creating a finite full map.

### Implemented

- camera state is separate from Protagonist world position;
- new/restored/restarted campaigns initially center the camera on the Protagonist;
- drag gestures pan the camera in tile increments;
- Arrow keys and WASD pan the camera one tile per key press;
- **Center on Protagonist** returns the camera to the Protagonist coordinate;
- the terrain renderer generates only the current viewport-sized tile window plus its existing edge buffer around the camera center;
- the Protagonist sprite is positioned relative to the camera and may move off-screen while the Protagonist world coordinate remains unchanged;
- camera coordinates use the same arbitrary-size signed integer coordinate system as the world;
- deterministic terrain signatures verify that revisiting the same camera coordinate reproduces the same SEED terrain;
- visual-evidence `camera-pan` automatically asserts that Camera moves, Protagonist Simulation coordinates remain unchanged, Camera returns to its starting coordinate, and returned terrain evidence matches the starting terrain;
- camera zoom is presentation-only with a supported range of **0.5× to 2.0×** and default **1.0×**;
- desktop mouse wheel: wheel up zooms in, wheel down zooms out;
- touch screens support two-finger pinch: fingers apart zoom in, fingers together zoom out;
- zoom dynamically changes rendered tile size and visible tile count while Camera world coordinate, Protagonist world coordinate and SEED terrain identity remain unchanged;
- `touch-action:none` is scoped to the Gameplay Area so browser pinch/scroll gestures do not steal in-game camera interaction.

### In-game proof

Panning changes the Camera coordinate and reveals newly required solid-color tiles while the Protagonist remains at its Simulation coordinate.

### Verified evidence

GitHub Actions run **35602541946** completed successfully with strict `camera-pan` assertions:

- Camera started at **(0,0)**;
- automated drag moved Camera away from the starting coordinate;
- Protagonist Simulation coordinate remained **(0,0)**;
- reverse drag returned Camera to **(0,0)**;
- terrain evidence after returning matched the starting terrain;
- viewport coverage and centered-camera-tile checks remained valid throughout;
- only the viewport-sized terrain window plus its existing edge buffer was rendered.

Additional camera-zoom acceptance passed on GitHub Actions run **35606140004**:

- starting zoom: **1.00×**;
- mouse wheel zoom-in: **1.10×**;
- mouse wheel reverse returned to **1.00×**;
- synthetic two-finger pinch-open: **1.20×**;
- synthetic two-finger pinch-close: **0.96×** after pixel-rounded pointer coordinates;
- Camera coordinate remained **(0,0)** through all five frames;
- Protagonist Simulation coordinate remained **(0,0)** through all five frames;
- terrain viewport coverage remained valid at every zoom level;
- rendered tile count changed with presentation scale as expected.

### Pass condition

- no gaps appear while moving;
- only the visible area and a small edge buffer are required;
- Protagonist world coordinates do not change when the camera pans;
- camera coordinates can move in positive or negative X/Y directions;
- returning to the same coordinates reproduces the same SEED foundation;
- wheel and pinch zoom change only presentation scale and do not change Simulation/world coordinates;
- environmental terrain regions must have natural irregular boundaries rather than visible macro-cell rectangles;
- terrain/environment generation uses deterministic interpolated multi-scale SEED fields instead of fixed rectangular terrain blocks;
- temporary village roads use deterministic meandering offsets instead of a perfect axis-aligned cross;
- visible per-tile grid seams are removed during normal play so same-type neighboring cells read as one continuous terrain region; the hovered cell and authoritative center cell may still show a diagnostic outline.
- verified natural-terrain evidence: GitHub Actions run **35607407473** passed at **0.50×** zoom with **0 suspicious large rectangular natural-terrain components**; the largest large interior natural component filled only **0.555** of its bounding box, confirming an irregular boundary rather than a rectangle.
- main roads are authoritative infrastructure and cannot be removed by water, forest, mountain, settlement parcels or buildings;
- the currently rendered starting-village main road is a deterministic **connected irregular ring road plus connected central avenues**; it has no arbitrary terrain-caused cut or fake regional highway across open water;
- Stage 2 secondary roads and footpaths must attach to this authoritative main-road network rather than replace or sever it;
- water inside the inhabited village foundation is shaped around coherent buildable land; only bounded road crossings remain **Bridge** tiles;
- the Stage 2 measurement standard supersedes the earlier prototype road scale: road/bridge walking now uses **3.6 km/h** and **1 tile = 2 m**;
- rural bridges are limited by the stricter **120 m / 60-tile practical cap** as well as the **10 fantasy-minute** time cap;
- current village main roads can widen up to **3 tiles** near the settlement center and narrow gradually as context becomes less urban or more difficult;
- rough forest/mountain/mud road sections may narrow to **1 tile**, while ordinary non-urban main-road sections use up to **2 tiles**;
- the width policy reserves up to **4 tiles for towns**, **6 for cities**, and **10 tiles only for capital-city main roads** when those settlement scales are physically implemented; this 10-tile allowance is not a general wilderness/international-road width;
- starting-village bridges are kept narrower than future city bridges; future normal 2-lane bridges may use about **4 tiles = 8 m** where context supports it;
- Stage 1 road continuity remained verified, while all physical distances and speeds are now governed by the Stage 2 World Measurement Standard.

---

# Stage 1 Review — COMPLETE

WP-001 through WP-006 are implemented and verified. The project now has:

- deterministic Campaign SEED foundation;
- deterministic live-randomness rules;
- unbounded signed world coordinates;
- Protagonist origin at **(0,0)**;
- deterministic geography/environment foundation;
- responsive viewport-filling terrain;
- independent infinite-world camera movement;
- GitHub Actions visual-evidence testing.

The next stage may now introduce the physical starting settlement foundation, but not autonomous NPC population, economy, combat or external LLM behavior yet.

---

# World Measurement Standard

These measurements are authoritative for all Stage 2+ world geometry and travel calculations.

- **1 logical world tile = 2 meters × 2 meters = 4 m²**.
- Tile coordinates remain integer world coordinates; rendering pixel size is camera presentation only.
- Normal NPC walking is intentionally slower/readable for gameplay:
  - good road / bridge: **3.6 km/h** = **1.00 m/s** = **0.50 tile/s**;
  - dirt road: **3.2 km/h**;
  - grass/open ground: **3.0 km/h**;
  - farmland: **2.8 km/h**;
  - sand: **2.3 km/h**;
  - forest: **2.2 km/h**;
  - mud: **1.8 km/h**;
  - rock/mountain ground: **1.6 km/h**.
- Future ordinary running should normally stay around **5.5–6.0 km/h**, not arcade-fast.
- The 24× fantasy clock must not make on-screen NPC locomotion visually 24× faster; off-screen schedule/travel simulation and visible movement presentation must be reconciled in the later movement WP.
- Distinct village centers must remain at least **1 fantasy walking hour** apart using the fastest normal walking surface.
- At **3.6 km/h**, one fantasy walking hour is **3.6 km = 1,800 tiles**.
- Village placement uses a larger safety spacing so jitter cannot violate that minimum.
- Practical rural bridge cap: **120 meters = 60 tiles**.
- Existing bridge-time hard limit remains **≤10 fantasy walking minutes**. At 3.6 km/h that time limit is 600 m, so the stricter **120 m / 60-tile practical cap** controls rural bridges.
- Typical road widths:
  - rough forest/mountain path: **1 tile = 2 m**;
  - ordinary rural/wilderness road: **2 tiles = 4 m**;
  - village main road: **2–3 tiles = 4–6 m**;
  - town main road: up to **4 tiles = 8 m**;
  - city main road: up to **6 tiles = 12 m**;
  - capital-city main road: up to **10 tiles = 20 m**.
- A normal 2-lane bridge should generally be **4 tiles = 8 m** wide when that settlement/road scale exists; small village bridges may be narrower.

---

# Authoritative World Planning Order

All generated settlements and world cells must use this reservation order:

1. **Roads and public infrastructure first**
   - main roads;
   - bridges/causeways;
   - local roads and paths;
   - public squares/gate corridors.
2. **Buildings second**
   - building plots and footprints may use only cells not reserved by Step 1;
   - a generated building is never cut, replaced or overwritten by a later road.
3. **Important objects third**
   - wells, monuments, gates, market objects and similar important objects may use only cells not reserved by roads or buildings.
4. **Terrain/background fill last**
   - grass, forest, dirt, farmland, water and other terrain fill all remaining unreserved cells;
   - terrain may influence material/bridge presentation, but it may not erase an already planned road, building or important object.

This is a **planning rule**, not merely a render z-index. Later systems must query earlier reservations before accepting a placement.

### Verified reservation evidence

- deterministic stress test across **12 SEEDs** produced all **6 required Starting Village plots** for every tested SEED;
- all tested SEEDs reported **0 road/plot overlaps**;
- all tested SEEDs reported **0 local-path/plot overlaps**;
- all tested SEEDs reported **0 public-square/plot overlaps**;
- GitHub Actions run **35615843410** completed successfully;
- its runtime evidence reported planning order exactly as `roads → buildings → important-objects → terrain`;
- `buildingReservationPass=true`, `plotRoadOverlapCount=0`, `plotPathOverlapCount=0`, and `plotSquareOverlapCount=0`;
- visual review confirmed reserved building areas remain intact instead of being cut by road-colored cells.

---

# Stage 2 — Starting Village Physical Foundation

The README requires every new campaign to begin with the Protagonist as an ordinary low-rank character in a **SEED-generated inhabited village**. Before population behavior is introduced, the village needs one coherent physical world layout that future homes, workplaces, NPCs and interactions can use.

All Stage 2 generation remains **foundation randomness only**. Fantasy time does not alter the generated starting layout.

## WP-007A — Starting Village Core + Mainland Connection — COMPLETE

### Goal

Make the default campaign visibly begin inside a real **Starting Village** around the Protagonist at **(0,0)**, with one authoritative main-road connection to a broader mainland land mass.

### Scope

Generate from the Campaign SEED:

- deterministic Starting Village boundary around **(0,0)**, sized as a plausible small settlement rather than a single screen-sized marker;
- central public/gathering square around the Protagonist;
- connected authoritative village main-road ring/avenues;
- secondary local paths attached to the main-road network;
- reserved house/building plots;
- farm/work parcels near the village edge;
- one deterministic village gateway;
- one continuous main-road/causeway/short-bridge connection from the village gateway to a broader deterministic mainland land mass;
- a deterministic mainland land mass beyond the gateway connection;
- short bridges only when a water crossing is necessary.

### Mainland and road rules

- the Starting Village must never be visually isolated with its main road ending in water;
- the gateway main road must reach mainland continuously;
- terrain, parcels and later buildings may not cut the main road;
- wide water must be avoided or reshaped into a logical land/causeway connection;
- a bridge is allowed only when the crossing is short enough;
- bridge walking time must be **<= 10 fantasy game minutes**;
- rural bridges use the stricter **120 m / 60-tile practical cap** and must also remain within **10 fantasy walking minutes**;
- village main roads may be up to **3 tiles** wide;
- wilderness/rough-terrain roads narrow naturally;
- the width policy reserves up to **4 tiles for towns**, **6 for cities**, and **10 for capital-city main roads** in future settlement-scale WPs.

### Rules

- **(0,0)** remains the Starting Village center;
- the Protagonist starts inside the visible village core;
- the first village core is roughly **100–130 m across** before irregular edge transition, large enough for roads, plots and farms without pretending to be a city;
- generation uses Campaign-SEED foundation randomness only;
- same SEED + same coordinates reproduce exactly the same village layout and mainland connection;
- no production textures or tile atlas yet;
- no NPC population yet;
- house interiors and wall plans are **not** implemented in WP-007A;
- the existing >= 1 fantasy-hour village-spacing rule remains valid.

### In-game proof

At broad zoom the player can clearly identify:

- the Starting Village around the Protagonist;
- the public center;
- reserved plots/parcels;
- a connected village road network;
- a continuous gateway road reaching mainland;
- no road ending arbitrarily in water.

### Implemented

- authoritative **1 tile = 2 m** world scale is live in code via `scripts/data/world-standards.js`;
- Starting Village is generated deterministically around **(0,0)**;
- default small-village core is approximately **104 m across** before irregular edge transition;
- a **14 m** public square surrounds the initial Protagonist position;
- six deterministic reserved building plots are visible but contain no house interiors yet;
- connected ring/avenue roads and local paths form the village circulation foundation;
- one deterministic gateway direction leads out of the village;
- the gateway road remains continuous through public square, causeway/short bridge, and into broader mainland terrain;
- mainland terrain is guaranteed beyond the gateway instead of allowing the road to terminate in open water;
- default-SEED gateway is **South**, with mainland edge beginning at roughly **58 m** from village center;
- default generated bridge crossing in proof is only **6 m / 3 tiles / 0.1 fantasy minutes**;
- village-placement scale changed to a **2,200-tile (4.4 km)** nominal cell with ±100-tile (±200 m) jitter;
- default nearest distinct village is about **4.53 km** away, giving a **≥75.6 fantasy-minute** straight-line lower bound at the fastest normal 3.6 km/h walk.

### Verified evidence

GitHub Actions run **35614323669** completed successfully with the `starting-village` scenario:

- deterministic Starting Village proof PASS;
- Protagonist origin inside village PASS;
- reserved plot count **6**;
- mainland connection PASS with **roadGapCount = 0**;
- bridge physical/time limits PASS;
- viewport coverage PASS;
- center frame clearly shows public square, road network and reserved plots around the Protagonist;
- gateway-focused frame moves the camera toward the deterministic mainland connection and shows the road continuing into broad land rather than ending in water;
- artifact: `visual-evidence-starting-village-35614323669` (**112,079 bytes**).

### Pass condition

- Starting Village boundary exists around **(0,0)**;
- Protagonist is inside the village core;
- public center and reserved plots are visible;
- all local roads attach to the authoritative main-road network;
- gateway road reaches deterministic mainland;
- no main-road gap exists;
- all bridge spans remain within the 10-fantasy-minute cap;
- repeated generation from the same SEED is identical;
- no real randomness or fantasy-time input is used.

---

## WP-007B — Tile-Based House Plans + Wall Foundation

### Goal

Turn reserved village plots into old-school RPG top-down building plans using tile-based walls and rooms.

### Minimum building rules

- smallest basic cabin: at least **3×2 interior/floor tiles = 6 tiles = 24 m²**;
- a 3×2 cabin interior therefore measures **6 m × 4 m** before wall/door presentation;
- normal house: at least **1 bedroom + 1 living room**;
- no room may be smaller than **6 floor tiles = 24 m²**;
- every house has an outer border-wall tile layer;
- because one tile is 2 m wide, a wall tile is a grid/occupancy cell whose top-down artwork draws a realistic thin wall along the appropriate edge; it does **not** represent a literal 2-meter-thick wall;
- multi-room houses have interior wall tiles;
- doors/entrances must connect building interior to reachable village ground;
- building walls, floors and rooms are deterministic from the Campaign SEED;
- top-down presentation must be compatible with later border-wall / floor / roofless interior textures.

### Scope

Define:

- cabin footprint;
- normal-house footprints;
- room partition rules;
- border-wall tiles;
- interior-wall tiles;
- floor tiles;
- doorway/entrance placement;
- plot-to-road access;
- deterministic room metadata;
- house generation starts from a deterministic plot boundary and entrance side, then places the building plan inside it so walls/rooms never block the road;
- roads/paths/public-space reservations are finalized before any building footprint is accepted;
- building placement must reject and deterministically try another valid placement whenever any wall/floor cell would overlap a reserved road/path/public-space cell.

### Pass condition

- every generated house respects its minimum size;
- every normal house contains a bedroom and living room;
- every room is at least 6 tiles;
- outer walls fully enclose the house except valid doors;
- multi-room houses contain interior wall separation;
- entrances reach a village road/path;
- same SEED reproduces the same house plans.

---

## WP-008 — Special Buildings + Functional Lots

### Goal

Extend the WP-007B house-plan foundation to deterministic non-residential structures and work lots that future residents and workplaces can occupy.

### Scope

Add foundation data for:

- tavern / lodging;
- shop / market structure;
- craft / work buildings;
- storage / service structures;
- barns or farm-related structures where appropriate;
- public or civic structure where appropriate;
- outdoor functional lots.

### Rules

- every building has a stable world footprint;
- every enterable building has at least one reachable entrance;
- building footprints do not overlap roads, water or each other;
- building type must be plausible for the generated village/environment;
- no resident/NPC ownership is assigned yet;
- presentation remains solid-color/simple geometry until later art stages.

### Pass condition

- same SEED reproduces the same structures;
- structures occupy coherent parcels;
- entrances face reachable walkable space;
- no invalid overlap exists.

---

## WP-009 — Authoritative Walkability and Collision Foundation

### Goal

Define what physical space can and cannot be traversed before any autonomous character movement is implemented.

### Scope

Classify world positions as:

- walkable ground;
- road/path;
- difficult but walkable terrain;
- building interior/entrance;
- solid building footprint/wall;
- blocked water or impassable terrain where applicable.

### Rules

- walkability is authoritative Simulation data, not inferred only from color;
- terrain and building rules remain deterministic from the Campaign SEED;
- camera movement remains presentation-only and ignores collision;
- later Protagonist/NPC movement must obey this layer.

### Pass condition

- every visible tile has an authoritative movement classification;
- building walls/blocked water cannot be traversed;
- entrances and roads are reachable;
- same SEED + coordinate reproduces the same classification.

---

## WP-010 — Deterministic Local Route Planning

### Goal

Provide the route-planning foundation needed by future autonomous Protagonist/NPC movement.

### Scope

Find valid walking routes between local world coordinates using:

- WP-009 walkability;
- existing terrain movement costs;
- roads and paths;
- building entrances;
- deterministic tie-breaking.

### Rules

- this WP plans routes but does **not** give the player direct control of the Protagonist;
- identical world state + identical start/destination produce the same route;
- route planning may cross current camera boundaries;
- only required local route-search data should be evaluated.

### In-game proof

A development verification can display a deterministic route from the starting point to a valid SEED-generated village destination without actually moving the Protagonist.

### Pass condition

- valid reachable destinations receive a route;
- blocked destinations are rejected;
- routes obey WP-009 collision/walkability;
- repeated route calculation is identical.

---

# Stage 2 Review Gate

Do not add autonomous NPC population, resident schedules, Advisor conversation, economy, combat or external LLM integration until WP-007A, WP-007B and WP-008 through WP-010 are implemented and reviewed.

**TO BE CONTINUED AFTER CURRENT ROADMAP STAGES ARE IMPLEMENTED AND REVIEWED**
