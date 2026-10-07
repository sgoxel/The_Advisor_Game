# Seeded world atlas and simulation

The world opens through the root `index.html`, built with PlayCanvas 2.23.0, TypeScript and Vite. WebGPU initializes first; unavailable or failed adapters automatically select WebGL2. Both display identical seeded geometry and simulation without requiring experimental Chrome flags. Engine and tooling versions are locked in `package-lock.json`. See [renderer implementation](WEBGPU.md).

## Reference analysis: Google Earth

Google's public [KML Regions documentation](https://developers.google.com/kml/documentation/regions) describes view-dependent loading, projected screen-size thresholds and nested coarse/fine representations. Its super-overlay examples subdivide coverage into child tiles. Coarse coverage remains useful while finer data becomes relevant. [Google Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles) documents Google's public 3D tile delivery interface. These sources establish useful public patterns; they do not reveal every internal Google Earth implementation detail.

This project uses those patterns to generate fantasy data locally. It uses no Google imagery, geographic data, credentials or network tile service. Display coverage is an orthographic map of a planar fantasy realm, not an Earth globe. Generation identities and display tile addresses are separate.

Root invariants:

- World data is a pure function of the fixed seed, version and absolute coordinates.
- Every child identity includes the entire ancestor code. A digest is a content parameter, never a unique identifier or a pseudorandom stream.
- Child rules refine parent constraints. Ocean regions stay underwater, island refinement remains inside a bounded coastline envelope, and smaller surface detail cannot change the parent's landform.
- Camera motion and rendering quality cannot alter logical terrain, settlement placement or simulation state.
- Generated features belong to the tile containing their anchor. They retain the same identity at every rendering level.
- Changing interest affects work cadence and allocated detail, not the result at a given fantasy tick.

## Five generation levels

The seed is `ADVISOR-0126-ALDERWICK`, generator `v1`.

| Level       | Footprint                       | Responsibility                                             |
| ----------- | ------------------------------- | ---------------------------------------------------------- |
| L1 province | 1000 × 1000 cells / 2 km × 2 km | Mainland or coastal archipelago domain; elevation envelope |
| L2 region   | 100 × 100 cells / 200 m × 200 m | Mainland, island or ocean; bounded island radius           |
| L3 district | 10 × 10 cells / 20 m × 20 m     | Coastline controls and allowable beach width               |
| L4 patch    | 2 × 2 cells / 4 m × 4 m         | Local surface grain within district constraints            |
| L5 cell     | 1 cell / 2 m × 2 m              | Canonical identity and bounded surface refinement          |

Negative coordinates use mathematical floor division. Child indices stay in their parent's bounds. Codes contain coordinates and preserve uniqueness even if their integer digests collide. Cells are addressable without storing billions of objects. The cell inspector exposes the full ancestry.

## Realm scale and settlements

The bounded realm is 262.144 km square. It contains three continental masses, ten countries per continent, three cities per country and three villages per city: 30 countries, 90 cities and 270 villages. Lightweight geographic metadata is available immediately; terrain, geometry and residents are generated as needed.

City geometry contains a keep, an extended house district and farmland. Village geometry contains a smaller keep, homes, a well and farmland. These are initial procedural low-poly settlements rather than completed RPG interiors or a historically accurate urban population model. Political borders are metadata, with destination selection and map labels; border meshes are not implemented.

Neighbouring village centres along each city group's road are exactly 420 m apart. The design walking speed is 1.4 real-world metres per second: five real minutes. River crossings have deterministic bridge decks and logical walkability. With the accelerated calendar, that journey spans two fantasy hours. The engine uses fantasy ticks for its movement schedule, dividing movement speed by 24 to preserve the requested real walking duration.

## Rendering and lazy streaming

The display quadtree has levels 0–17, with a finest tile of 2 × 2 m. Tile addresses contain level and absolute tile indices. A tile's terrain samples never become finer than the logical two-metre cell scale.

The visible orthographic footprint plus a prefetch margin drives tile selection. Projected size controls refinement, with a bounded visible tile budget. A worker prepares geometry from global coordinate functions. The main thread uploads at most one tile group per frame. Queued generation plus completed uploads is bounded. The last complete coverage and a root fallback remain until a replacement view is ready, preventing holes during asynchronous refinement. Resident tiles are reused and obsolete mesh instances release their buffers on eviction.

There are separate terrain, structures, nature and small-detail meshes per tile. Buildings appear only at suitable tile scales; trees, timber frames, windows, fences and crop rows progressively add detail. Meshes merge geometry rather than allocating an entity per logical cell. Terrain skirts conceal mixed-resolution edges. Coarse coastlines may visibly change shape as they refine; geomorphing is future work.

The steady cache budget is 200 tile records. A transition may temporarily retain both complete representations, bounded by the combined selected/active budget plus the root. The cache returns to its normal budget after the swap. Quality must be benchmarked on actual mobile GPUs; software-rendered CI frames do not establish a production FPS target.

## Lazy simulation

`LazySimulation` is independent of PlayCanvas. The current country has a detailed resident pool, including settlements outside the visible viewport. City populations are initially 2400 and village populations 80, yielding 7920 tracked residents per country. Only the current country allocates these resident objects. At most 96 nearby resident billboards appear in the renderer.

- Current country: all residents and its economic summary update once per real second.
- Explicitly inspected country: summary refreshes at most every 30 fantasy seconds.
- Other countries: summary refreshes every 300 fantasy seconds.

Switching countries releases the previous detailed pool. Resident schedules and grain summaries are analytical functions of seed identity and fantasy tick, so refining an old area catches up directly instead of replaying every missed tick. Interest cannot produce a different result for the same tick.

This is an implemented foundation with walking/trading/patrol schedules and a simple grain-production summary. It does not yet simulate diplomacy, wars, complex decision-making, births/deaths, inventory transactions, collision-aware destinations inside buildings, or save mutations. Those systems need authoritative event/state contracts before adding real gameplay. Treating every country's arbitrary future gameplay interactions as analytically recoverable would be incorrect; persisted events will be necessary for those systems.

## Planned settlement housing — Stage S002

The current resident `home` field identifies a settlement, not an owned house. Current decorative houses and keeps do not implement individual ownership, required village services, enclosed borders or staffed gates. The owner selected updating the Stage S002 plan with these requirements; see [settlement contracts and acceptance evidence](SETTLEMENT_PLAN.md) and [the binding design](README.md#seeded-settlement-design-and-npc-homes). WP-S002-004-009 covers layouts and building/gate infrastructure; WP-S002-004-011 covers individual houses, staffed workplaces and real resident guard duties. Neither package is marked implemented by this planning update.

## Planned world-building priorities — Stage S002

The owner's foundation sequence is oceans 0 → continents 1 → islands 2 → natural biomes/mountains 3 → lakes/rivers 4 → countries 5 → capitals/big cities 6 → villages 7 → roads 8 → ruins/critical quest places 9. [Priority and terrain-earthwork contracts](WORLD_BUILDING_PRIORITY.md) define bounded cuts/fills, dirt roadbeds, housing perimeters, final vegetation/walkability and lazy cross-tile composition. WP-S002-004-012 covers the shared compositor and road/housing edits; WP-S002-004-013 covers ruin/critical-site reservations. These are planned requirements, separate from the current build and from rendering detail levels.

## Shared fantasy clock

The fixed real epoch is `2026-10-07T08:48:29Z` (11:48:29 in Europe/Istanbul). Its fantasy origin is `07.10.0126 11:48:29`. The explicitly requested year offset is 1900, superseding the earlier README's 900-year example.

One real second advances 24 fantasy seconds. One real hour advances one fantasy day; one real day advances 24 fantasy days. Date arithmetic crosses midnight and calendar boundaries. Every reload derives the same elapsed fantasy tick from the fixed epoch, including time away.

The browser's wall clock is read only at the time boundary. World generation has no time dependency; simulation receives the resulting tick explicitly. No application code calls random-number APIs. For a multiplayer server, replace client wall-clock authority with an authenticated server clock and persist authoritative events.

## Run and verify

```
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Serve the application through Vite or a deployed build. Opening the source `index.html` as a `file://` URL cannot run TypeScript and workers correctly. A GitHub Actions workflow builds `dist/` and deploys it to GitHub Pages.

Functional checks cover seed inheritance, negative boundaries, island constraints, tile coverage, feature identity, settlement counts, route walkability, clock acceleration and interest-independent simulation catch-up. Browser checks exercise the actual rendered world, destination navigation, cell inspection, layer controls, zoom transitions, caching and responsive layouts.
