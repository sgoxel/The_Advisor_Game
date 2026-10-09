# Walking routes and the 60-minute village minimum (WP-S002-004-008)

Source: `src/routing.ts` (pure planner), `src/village-routes.ts` (villages, cache, all-pairs proof),
`src/route-overlay.ts` + `src/travel-ui.ts` (map route and travel panel). Tests: `tests/routing.test.ts`.

## Contract

- **Authority.** Route cost is computed from canonical lon/lat and a `TerrainSampler`; the default
  sampler is the seeded macro geography (`macroSampleAt`). Roads come from the seeded road list.
  Nothing reads camera, zoom, device, timing or loading order, and nothing is random.
  The same seed and inputs always give the same route (ties break on cell index).
- **Speeds** (fantasy time, from `travel.ts`): good road/bridge 3.6 km/h, open ground 3.0 km/h,
  difficult terrain 1.8 km/h. Real time is fantasy time / 24.
- **Surfaces.** Water is impassable unless a legal bridge (road segment flagged `bridge`, length
  ≤ 120 m) covers it. Slopes above 0.7 are cliffs (impassable off-road). Slopes above 0.25 or
  highland intensity ≥ 0.35 are difficult terrain. A road corridor is graded (cut and fill): it
  ignores slope/highland penalties and is walked at good-road speed.
- **60-minute rule.** Every pair of distinct village centres needs >= 3,600 fantasy seconds on any
  walk. No walk is faster than 1 m/s, so a straight-line (geodesic) distance of >= 3,600 m is a
  complete proof: no pathfinding is involved and nothing is computed during world generation.
  The seeded 6 km village siting spacing already exceeds it; `verifyVillageMinimumWalk()` checks all
  pairs with plain geodesics. The 60 minutes is a minimum, never a clamp: routes report their real cost.
- **Bounds.** 16-direction A* on a local tangent grid, ≤ 48,000 cells and ≤ 150,000 expansions per
  attempt, up to three growing search margins, separations ≤ 120 km. Larger boxes use coarser
  cells (≥ 40 m). The planner only runs for display, on demand: routes are cached per village pair (≤ 256 entries) and are only solved when the
  travel panel needs them, never per frame.

## Honest limits

- The grid approximates shortest paths: a routed length can exceed the true shortest length by
  up to ~2.7% (16 directions) plus tangent-plane distortion. Reported route distances are the grid
  path, not exact geodesy.
- The seeded macro surface is gentle at village scale (max slope ≈ 0.02) and carries no forest,
  river or cut/fill geometry yet. Routes therefore bend for lakes, seas and highland, and
  road corridors are *treated* as graded, but no earthwork mesh exists. Finer terrain, hydrology and
  earthworks belong to WP-S002-004-005 and WP-S002-004-012 and can replace the sampler without
  changing this module's contract.
- No seeded bridges exist yet; bridge handling is exercised with synthetic terrain in tests.
- Maritime/ferry travel is separate from walking time and is not modelled here.
