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

## WP-002 — Deterministic PRNG

### Goal

Create the deterministic random generator used by all future procedural systems.

### In-game proof

A development accordion shows a short repeatable sequence produced from the Campaign SEED.

### Pass condition

- same SEED produces the same sequence;
- different SEED produces a different sequence;
- no procedural system uses uncontrolled randomness.

---

## WP-003 — Deterministic Sub-SEED Function

### Goal

Keep procedural systems independent from each other.

### Rule

Derive stable sub-seeds from:

**Campaign SEED + system key + stable identifier**

Examples:

- `terrain`
- `settlement:001`
- `npc:001`

### Pass condition

Adding random calls to one system does not change another system's generated results.

---

## WP-004 — Infinite Tile Coordinates

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

## WP-005 — Viewport-Filling Solid-Color Tiles

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

## WP-006 — Camera Movement Through the Infinite World

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

Do not introduce textures, settlements, NPC populations, economy, combat or external LLM integration until WP-001 through WP-006 are implemented and reviewed.

**TO BE CONTINUED AFTER CURRENT ROADMAP STAGES ARE IMPLEMENTED AND REVIEWED**
