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

## WP-002 — Deterministic SEED + Fantasy-Time Randomness — COMPLETE

### Goal

Provide reproducible simulation randomness with exactly two authoritative inputs.

### Core rule

Every random result is:

**Random Result = Random(Campaign SEED, Fantasy Game Timestamp)**

No other random input is allowed.

The random function must not read or depend on:

- real-world time;
- `Math.random()`;
- browser or OS cryptographic randomness;
- device state;
- mutable PRNG state;
- call order;
- hidden counters;
- system keys;
- sub-seeds;
- entity IDs;
- coordinates.

The authoritative fantasy timestamp is supplied by the game-time system. The random module never reads the real clock itself.

### Implemented

- stateless deterministic 32-bit random function;
- exact API: `PRNG.randomUint32(seed, fantasyTimestampMs)`;
- normalized fantasy timestamp uses integer fantasy milliseconds;
- same SEED + same fantasy timestamp always returns the same value;
- changing the fantasy timestamp can change the value;
- random output is unavailable before a campaign has an authoritative fantasy timestamp;
- development accordion displays the active SEED, fantasy timestamp and deterministic value.

### In-game proof

The WP-002 accordion displays one deterministic value tied to the campaign's current fantasy timestamp.

### Pass condition

- same SEED + same fantasy timestamp produces exactly the same result;
- result does not depend on previous random calls;
- no real-random source exists;
- no hidden random state exists;
- the random function accepts only SEED and fantasy timestamp.

---

## WP-003 — Infinite Tile Coordinates

### Goal

Define an unbounded tile-coordinate world.

### Rule

Every base tile is identified by:

**Campaign SEED + tileX + tileY**

Positive and negative integer coordinates must work.

### In-game proof

The development accordion shows the current center tile coordinate.

### Pass condition

The same SEED and coordinate always resolve to the same base tile result.

---

## WP-004 — Viewport-Filling Solid-Color Tiles

### Goal

Fill the complete Gameplay Area with SEED-generated tiles using solid colors only.

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
