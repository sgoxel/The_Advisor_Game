# Phase 2 Summary: Seeded Checks and RNG Contract

## What is Phase 2?

**Phase 2 (P02)** is called **"Seeded Checks and RNG Contract"**. It was completed and released as **v0.2.0-dev.1**.

In simple terms: Phase 2 built a **fair, reproducible random number system** that the game uses for all chance-based events. Neither the player nor the AI can cheat the dice rolls.

---

## The Core Problem It Solves

In games with randomness (dice rolls, loot drops, success/failure checks), you need to answer:

1. **Is it fair?** — Can anyone manipulate the outcome?
2. **Is it reproducible?** — If you replay the exact same situation, do you get the same result?
3. **Is it auditable?** — Can you prove the roll wasn't rigged?

Phase 2 answers **YES** to all three.

---

## What Was Built

### 1. Deterministic RNG (Random Number Generator)
**File:** `js/deterministic-rng.js`

- Uses a **Mulberry32** algorithm (fast, high-quality pseudorandom)
- Seeded by **FNV-1a hash** of all deterministic inputs
- **Zero ambient entropy** — no `Math.random()`, no timestamps, no external sources
- Each RNG instance is **completely independent** — no shared state

### 2. Seeded-Check Contract
**File:** `js/seeded-check-contract.js`

A formal contract that defines:
- **Allowed inputs only**: `worldSeed`, `generationVersion`, `checkId`, `context`
- **Forbidden inputs**: `desiredOutcome`, `forcedResult`, `timestamp`, `randomValue`, `providerOutput`
- **Authority**: Always `"simulation"` — the UI/caller cannot force results
- **Rule**: *"Identical compatible deterministic inputs must resolve to the same RNG value and seeded-check result."*

### 3. Seeded-Check Resolution
**File:** `js/seeded-check-resolution.js`

The actual function that:
1. Validates inputs against the contract (rejects forbidden fields)
2. Creates a deterministic RNG from those inputs
3. Draws one `uint32` value → converts to `unitRoll` (0.0–1.0) → `percentile` (1–100)
4. Returns an **immutable, frozen result object** with:
   - `rollUint32` — the raw 32-bit integer
   - `unitRoll` — normalized 0.0–1.0
   - `percentile` — 1–100 for display
   - `authority: "simulation"` — proof of origin
   - `checkId` — which check was run

### 4. Public UI Integration
**Files:** `js/app.js`, `index.html`, `css/p02-shell.css`

A public web interface where anyone can:
- See the **exact deterministic inputs** (seed, generation version, turn, check identity)
- Click **"Run deterministic check"**
- Watch the **simulation-owned result** appear
- Re-run and see the **identical result every time**
- Switch check identities (P02-A vs P02-B) to see different deterministic outcomes
- Toggle **EN/TR localization** without affecting the authoritative state
- **Export/Import/Reset** campaign saves (preserving Phase 1 behavior)

---

## Key Guarantees (The "For Dummies" Version)

| Guarantee | What It Means |
|-----------|---------------|
| **No cheating** | No code path lets the player, UI, AI, or server pick "success" or "failure" |
| **Same inputs = same result** | Run the same check twice → identical roll, guaranteed |
| **Different context = different result** | Change the turn, region, or difficulty → new deterministic roll |
| **Auditable** | The inputs and algorithm are visible in the code; anyone can verify |
| **No hidden state** | Each check is independent; no "streak" memory or hidden RNG state |
| **Localization-safe** | Switching language (EN ↔ TR) never changes the campaign seed or roll |

---

## How It Works (Step by Step)

```
1. Game needs a random check (e.g., "forage for food")
        │
        ▼
2. Collect DETERMINISTIC inputs only:
   - worldSeed: "ADVISOR-P01-DEMO" (the world's DNA)
   - generationVersion: "worldgen-1" (which world generator)
   - checkId: "forage-check-1" (which specific check)
   - context: { turn: 5, actorId: "character-1", difficulty: 12, ... }
        │
        ▼
3. Hash all inputs → single 32-bit seed (FNV-1a)
        │
        ▼
4. Create Mulberry32 RNG from that seed
        │
        ▼
5. Draw ONE uint32 → normalize to 0.0–1.0 → percentile 1–100
        │
        ▼
6. Return FROZEN result: { rollUint32, unitRoll, percentile, authority: "simulation" }
        │
        ▼
7. UI displays result. Caller CANNOT change it.
```

---

## Tests That Prove It Works

**81 unit tests pass**, including:
- ✅ Same inputs → same sequence (reproducibility)
- ✅ Key order in context doesn't matter (canonicalization)
- ✅ Different seeds/contexts → different sequences (variation)
- ✅ Forbidden fields rejected (`desiredOutcome`, `timestamp`, etc.)
- ✅ Non-finite numbers rejected (`NaN`, `Infinity`)
- ✅ Non-plain objects rejected (functions, Dates, prototypes)
- ✅ Result is immutable (`Object.frozen`)
- ✅ No state mutation commands in result

**28 browser tests pass** across:
- Desktop, Tablet, Phone Portrait, Phone Landscape
- EN and TR localization
- Accessibility (axe-core, WCAG 2.1 AA)
- No console errors, no horizontal overflow
- P01 save/import/export/reset still works perfectly

---

## Why This Matters for the Game

1. **Trust**: The player knows the AI character's success/failure is fair
2. **Replayability**: Same seed = same world, same checks, same story
3. **Debugging**: Developers can reproduce any check by logging the inputs
4. **Multiplayer-ready**: Deterministic simulation enables future sync
5. **No backend needed**: Runs entirely in the browser, offline-capable
6. **Foundation for Phase 3+**: Legal actions, AI decisions, and world simulation will all build on this deterministic authority

---

## Release Info

- **Release**: v0.2.0-dev.1
- **Commit**: `bb7dc08ff560efa8eef2c5e54f1531325707183f`
- **GitHub Release ID**: 378007272
- **Live Demo**: https://sgoxel.github.io/The_Advisor_Game/

---

## TL;DR

**Phase 2 built an unhackable dice roller.** You give it a world seed + a check name + context, it gives you a number. Same inputs = same number, forever. No one — not the player, not the AI, not the server — can force a "critical success" or avoid a "critical failure." The simulation owns the truth.