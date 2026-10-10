# Walking routes and the 60-minute village minimum (WP-S002-004-008)

Source: `src/routing.ts` (pure planner), `src/village-routes.ts` (villages, cache, all-pairs proof),
`src/route-overlay.ts` + `src/travel-ui.ts` (map route and travel panel). Tests: `tests/routing.test.ts`.

## Contract

- **Authority.** Route cost is computed from canonical lon/lat and a `TerrainSampler`; the default
  sampler reads the final composed surface (`surfaceAt`) used by world height/traversal. Roads come
  from the seeded road list. Nothing reads camera, zoom, device, timing or loading order, and nothing
  is random. The same seed and inputs always give the same route (ties break on cell index).
- **Speeds** (fantasy time, from `travel.ts`): good road/bridge 3.6 km/h, open ground 3.0 km/h,
  difficult terrain 1.8 km/h. Real time is fantasy time / 24.
- **Surfaces.** Canonical water is impassable unless a legal bridge (road segment flagged `bridge`,
  length ≤ 120 m) covers it. Canonical blocked cliffs and sampled slopes above 0.7 are impassable
  off-road. Difficult final-surface terrain or slopes above 0.25 are slower. A road corridor is
  treated as graded cut/fill and is walked at good-road speed.
- **60-minute rule.** Every pair of distinct village centres needs >= 3,600 fantasy seconds on any
  walk. No walk is faster than 1 m/s, so a straight-line (geodesic) distance of >= 3,600 m is a
  complete lower-bound proof: no pathfinding is involved and nothing is computed during world
  generation. The seeded 6 km village siting spacing already exceeds it; `verifyVillageMinimumWalk()`
  checks all pairs with plain geodesics. The 60 minutes is a minimum, never a clamp: routes report
  their routed cost.
- **Bounds.** 16-direction A* on a local tangent grid, ≤ 48,000 cells and ≤ 150,000 expansions per
  attempt, up to three growing search margins, separations ≤ 120 km. Larger boxes use coarser cells
  (≥ 40 m). The planner only runs on demand: routes are cached per village pair (≤ 256 entries) and
  are only solved when the travel panel needs them, never per frame.

## Honest limits

- The grid approximates shortest paths: a routed length can exceed the true shortest length by
  roughly 3% from direction quantisation plus tangent-plane distortion. Reported route distances are
  the grid path, not exact geodesy.
- WP-S002-004-005 now supplies canonical hydrology, cliff/traversal classification and the shared
  final-surface adapter. WP-S002-004-012 may extend the generic priority 0–9 compositor, but route
  callers must continue to read the same final surface rather than reintroducing a parallel macro
  terrain authority.
- The current seeded road registry does not yet carry a complete global bridge/harbour/ferry graph;
  explicit bridge legality remains part of the routing contract and is exercised by tests. The open
  transport WP expands that graph without changing hydrology or shortest-route ownership.
- Maritime/ferry travel is separate from walking time and is not modelled as a walking surface here.
