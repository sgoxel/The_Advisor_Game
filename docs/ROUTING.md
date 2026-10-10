# Walking routes and the 60-minute village minimum (WP-S002-004-008)

Source: `src/routing.ts` (pure bounded planner), `src/village-routes.ts` (runtime-traversal binder, cache and all-pairs acceptance summary), `src/route-overlay.ts` + `src/travel-ui.ts` (map route and travel panel). Tests: `tests/routing.test.ts`, `tests/routing-final-surface.test.ts` and `tests/browser/routes.spec.js`.

## Contract

- **Authority boundary.** Player-facing village routes are accepted and costed against `cellAt()`, the same final runtime query used for composed biome/elevation/walkability and collision. `src/routing.ts` remains a deterministic bounded search engine, but its macro sampler is only a coarse candidate generator. `src/village-routes.ts` validates every accepted candidate at bounded intervals against final runtime cells; a candidate that crosses a final blocked cell is repaired with A* using the final-cell sampler itself. Camera, zoom, renderer backend, timing and loading order never become route inputs.
- **Road truth.** Runtime walkability/elevation still comes from `cellAt()`. Surface costing also checks the canonical `roadAt()` corridor so a settlement mask cannot hide an underlying legal road. Direct seeded-road metadata is never accepted as an unvalidated route shortcut.
- **Speeds** (fantasy time, from `travel.ts`): good road/bridge 3.6 km/h, open ground 3.0 km/h, difficult terrain 1.8 km/h. Real time is fantasy time / 24.
- **Surfaces.** Final non-walkable cells are blocked. Natural water is blocked unless final composition makes a legal crossing walkable. Final road/bridge cells use good-road speed; highland/volcanic cells use difficult-ground speed; other walkable cells use open-ground speed. The pure planner retains its slope/bridge/graded-road rules for coarse search and deterministic repair.
- **60-minute rule.** Every pair of distinct village centres needs at least 3,600 fantasy seconds on any walk. No legal walk is faster than 1 m/s, so a geodesic separation of at least 3,600 m is a sound lower-bound proof. The seeded siting currently keeps at least 6 km, so every generated pair is lower-bound proven without running whole-world pathfinding during generation. The 60 minutes is a minimum, never a clamp: displayed routes report their actual final-cell-derived cost.
- **Actual-registry acceptance.** `routingAcceptanceSummary()` enumerates the generated village registry and returns machine-readable village count, total unordered pairs, lower-bound-proven/routed pair counts, minimum proven/observed fantasy seconds, invalid/unreachable counts, bounded-search limits and cache status. Pair coverage is always `n(n-1)/2`; it is not hard-coded to 270 villages or 36,315 pairs.
- **Bounds and cache.** The planner uses 16-direction local-tangent A* with at most 48,000 cells and 150,000 expansions per attempt, up to three growing search margins and a 120 km local-planner separation cap. Coarse routes are final-validated no more than 300 m apart. Village routes are cached by canonical endpoint pair with a 256-entry bound and are solved on demand for travel UI/inspection, never per render frame.

## Determinism and presentation

- Same Campaign SEED, foundation/runtime traversal inputs and endpoints reproduce the same route result and cost regardless of query order, cache state, WebGPU/WebGL2 selection or worker completion order.
- The travel panel and route overlay are presentation/inspection only. Selecting or framing a route does not move the protagonist and does not create a Simulation action.
- `tests/browser/routes.spec.js` verifies deterministic cached selection, truthful distance/fantasy/real-time data, the visible canonical route overlay and no page errors.

## Current limits

- The bounded local grid remains an approximation to a mathematically exact continuous shortest path; route geometry is discretized by the planner. Final acceptance/cost sampling prevents the UI from certifying a path through runtime-blocked cells, but it does not turn the planner into continuous computational geometry.
- `cellAt()` is the closure authority for the runtime composition currently available on `main`. Future work may enrich that same authority with additional hydrology, earthworks, bridges or site-access modifiers; routing must consume those through the shared final traversal query rather than introducing a second independent world truth.
- Maritime/ferry travel is separate from walking-time checks and is not modelled as a walkable road.
