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
- the gameplay area visibly centers the Protagonist at **(0,0)** before terrain rendering exists.

### In-game proof

After starting a campaign, the Protagonist marker appears at the exact center of the Gameplay Area and shows **(0,0)**. The WP-003 accordion verifies positive and negative arbitrary-size coordinates.

### Pass condition

- new campaign creates Protagonist at **(0,0)**;
- initial gameplay view is centered on **(0,0)**;
- coordinate system accepts positive arbitrary-size X/Y values;
- coordinate system accepts negative arbitrary-size X/Y values;
- no gameplay-defined outer coordinate boundary exists;
- saved/reloaded campaigns preserve the Protagonist coordinate.

---

## WP-004 — Viewport-Filling Solid-Color Tiles

### Goal

Fill the complete Gameplay Area around the current world center with SEED-generated tiles using solid colors only.

### Rules

- no textures;
- no tile atlas;
- no props or decorative artwork;
- tile count is calculated from the actual browser gameplay viewport;
- portrait and landscape sizes are handled automatically.

Example:

If the Gameplay Area currently shows **16 × 9 tiles**, at least **144 visible tiles** are generated.

### Pass condition

- no blank gameplay area is visible;
- resizing recalculates required rows and columns;
- same SEED and coordinates reproduce the same colors.

---

## WP-005 — Camera Movement Through the Infinite World

### Goal

Move through the unbounded tile world without creating a finite full map.

### In-game proof

Panning reveals newly required solid-color tiles.

### Pass condition

- no gaps appear while moving;
- only the visible area and a small edge buffer are required;
- returning to the same coordinates reproduces the same SEED foundation.

---

# Stage 1 Review Gate

Do not introduce textures, settlements, NPC populations, economy, combat or external LLM integration until WP-001 through WP-005 are implemented and reviewed.

**TO BE CONTINUED AFTER CURRENT ROADMAP STAGES ARE IMPLEMENTED AND REVIEWED**
