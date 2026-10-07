# Seeded world atlas and simulation

> **S002 status note:** this file records the implemented S001 atlas and transitional globe. It is historical/runtime documentation, not the authoritative target planet contract. The binding S002 scale, coordinate, projection, precision, compatibility, performance and telemetry rules are in [PLANET_ARCHITECTURE.md](PLANET_ARCHITECTURE.md) and `docs/README.md`. Where this file describes the 262.144 km planar atlas, 420 m village spacing, planar cells or flat-world authority, those are legacy implementation facts to be replaced by the open S002 WPs rather than alternative design rules.

The world opens through the root `index.html`, built with PlayCanvas 2.23.0, TypeScript and Vite. WebGPU initializes first; unavailable or failed adapters automatically select WebGL2. Both display identical seeded geometry and simulation without requiring experimental Chrome flags. Engine and tooling versions are locked in `package-lock.json`. See [renderer implementation](WEBGPU.md).

## Reference analysis: Google Earth

Google's public [KML Regions documentation](https://developers.google.com/kml/documentation/regions) describes view-dependent loading, projected screen-size thresholds and nested coarse/fine representations. Its super-overlay examples subdivide coverage into child tiles. Coarse coverage remains useful while finer data becomes relevant. [Google Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles) documents Google's public 3D tile delivery interface. These sources establish useful public patterns; they do not reveal every internal Google Earth implementation detail.

This project uses those patterns to generate fantasy data locally. It uses no Google imagery, geographic data, credentials or network tile service. The original S001 display coverage is an orthographic planar fantasy atlas; S002 replaces its authority model with the canonical sphere defined in `PLANET_ARCHITECTURE.md`. Generation identities and display tile addresses remain separate.

Root invariants:

- World data is a pure function of the fixed seed, version and absolute coordinates.
- Every child identity includes the entire ancestor code. A digest is a content parameter, never a unique identifier or a pseudorandom stream.
- Child rules refine parent constraints. Ocean regions stay underwater, island refinement remains inside a bounded coastline envelope, and smaller surface detail cannot change the parent's landform.
- Camera motion and rendering quality cannot alter logical terrain, settlement placement or simulation state.
- Generated features belong to one deterministic canonical owner. S001 used display-tile containment; S002 uses the canonical planet ID ownership rules.
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

These are S001 planar generation levels. S002 may reuse deterministic refinement ideas, but planet-wide identity and physical scale follow `PLANET_ARCHITECTURE.md`; local 2 m-or-finer sampling is a local gameplay/detail requirement rather than a planar world definition.

Negative coordinates use mathematical floor division. Child indices stay in their parent's bounds. Codes contain coordinates and preserve uniqueness even if their integer digests collide. Cells are addressable without storing billions of objects. The cell inspector exposes the full ancestry.

## Realm scale and settlements

The implemented S001 atlas is 262.144 km square. It contains three continental masses, ten countries per continent, three cities per country and three villages per city: 30 countries, 90 cities and 270 villages. Lightweight geographic metadata is available immediately; terrain, geometry and residents are generated as needed. The 262.144 km extent is not the canonical S002 planet size.

City geometry contains a keep, an extended house district and farmland. Village geometry contains a smaller keep, homes, a well and farmland. These are initial procedural low-poly settlements rather than completed RPG interiors or a historically accurate urban population model. Political borders are metadata, with destination selection and map labels; border meshes are not implemented.

The S001 prototype places neighbouring village centres exactly 420 m apart at 1.4 real-world metres per second. This is obsolete for S002. The binding S002 rule is at least 60 fantasy minutes along every distinct village pair's shortest legal walk, using the fantasy-time speeds and final composed terrain/roads in `README.md` and `WORLD_REQUIREMENTS.md`.

## Rendering and lazy streaming

The current display quadtree has levels 0–17, with a finest S001 tile of 2 × 2 m. Tile addresses are rendering/streaming structures, not S002 world identity.

The visible orthographic footprint plus a prefetch margin drives tile selection. Projected size controls refinement, with a bounded visible tile budget. A worker prepares geometry from global coordinate functions. The main thread uploads at most one tile group per frame. Queued generation plus completed uploads is bounded. The last complete coverage and a root fallback remain until a replacement view is ready, preventing holes during asynchronous refinement. Resident tiles are reused and obsolete mesh instances release their buffers on eviction.

There are separate terrain, structures, nature and small-detail meshes per tile. Buildings appear only at suitable tile scales; trees, timber frames, windows, fences and crop rows progressively add detail. Meshes merge geometry rather than allocating an entity per logical cell. Terrain skirts conceal mixed-resolution edges. Coarse coastlines may visibly change shape as they refine; geomorphing is future work.

The steady S001 cache budget is 200 tile records. S002 performance limits are the device-class budgets in `PLANET_ARCHITECTURE.md` and are validated/tuned by WP-S002-005-001. Software-rendered CI frames do not establish physical-device FPS.

## Realm globe view

The completed globe WP added a transitional Realm presentation to the S001 atlas. It is a valid historical implementation, but its dimensions and immediate flat/globe switch are not the final S002 contract.

- **Legacy mapping** (`src/planet.ts`): the current runtime derives circumference from `WORLD_SIZE = 262144 m` (radius about 41.7 km). This is explicitly noncanonical for S002; WP-S002-004-002 must rescale runtime authority to radius 637.1 km / circumference 4,003.01736 km.
- **Current appearance threshold**: the prototype switches to the globe at a view half-height of 0.9 legacy planet radii. S002 handoff instead follows the continuous pure-zoom/projection contract in `PLANET_ARCHITECTURE.md`.
- **Surface** (`src/globe-surface.ts`, `src/globe-worker.ts`): an equirectangular image whose every texel is the current flat terrain's own colour (`terrainTint`) with hill shading from `heightAt`. It adds no rules and no features of its own.
- **Drawing** (`src/globe-view.ts`): one unlit sphere, one shading fan and bounded textures. Built-in PlayCanvas materials support WebGPU and WebGL2.
- **Turning**: dragging changes focus, east-west wraps on the globe and north-south stops at the poles. Zoom currently changes scale only.

Still open in S002: canonical scale, continuous handoff, wrapped local coordinates/streaming, natural planet geography/climate, canonical labels/HUD and complete performance telemetry. Those are separate WPs, not defects in the historical closure of the globe presentation WP.

## Lazy simulation

`LazySimulation` is independent of PlayCanvas. The current country has a detailed resident pool, including settlements outside the visible viewport. City populations are initially 2400 and village populations 80, yielding 7920 tracked residents per country. Only the current country allocates these resident objects. At most 96 nearby resident billboards appear in the renderer.

- Current country: all residents and its economic summary update once per real second.
- Explicitly inspected country: summary refreshes at most every 30 fantasy seconds.
- Other countries: summary refreshes every 300 fantasy seconds.

Switching countries releases the previous detailed pool. Resident schedules and grain summaries are analytical functions of seed identity and fantasy tick, so refining an old area catches up directly instead of replaying every missed tick. Interest cannot produce a different result for the same tick.

This remains an S001 implementation record. `README.md` currently defines Stage 1 of the planet-first rebuild with local population detail dormant until the corresponding S002 settlement/NPC packages reintroduce it against canonical planet authority.

## Reaffirmed natural-world and village-time requirements — Stage S002

[Binding world requirements](WORLD_REQUIREMENTS.md) specify at least 60 fantasy minutes for every village pair's shortest legal walk, allowing terrain to lengthen it, and one SEED-owned geography/environment shared by the Realm sphere and all closer views. Natural, non-lattice continent/island placement, visible major terrain/biome/water features and both frozen poles belong to the existing scale/geography/climate/route packages. The current globe's completion does not imply those natural-generation and village-scale packages are complete.

## Planned settlement housing — Stage S002

The current resident `home` field identifies a settlement, not an owned house. Current decorative houses and keeps do not implement individual ownership, required village services, enclosed borders or staffed gates. See [settlement contracts](SETTLEMENT_PLAN.md) and [the binding design](README.md#seeded-settlement-design-and-npc-homes). WP-S002-004-009 covers layouts and building/gate infrastructure; WP-S002-004-011 covers individual houses, staffed workplaces and real resident guard duties.

## Planned connected road network — Stage S002

[Canonical road/transport contracts](ROAD_NETWORK_PLAN.md) require road access for all villages/cities, country backbones, ruins, bridges and critical structures/areas. Alignment uses river bridges, lake detours, hill grading and low mountain passes, with exact SEED-defined endpoints, profiles and joined junctions preserved through lazy regeneration. The owner approved road-connected harbors and ferry/ship links between landmasses. WP-S002-004-014 covers this network foundation.

## Planned world-building priorities — Stage S002

The owner's foundation sequence is oceans 0 → continents 1 → islands 2 → natural biomes/mountains 3 → lakes/rivers 4 → countries 5 → capitals/big cities 6 → villages 7 → roads 8 → ruins/critical quest places 9. [Priority and terrain-earthwork contracts](WORLD_BUILDING_PRIORITY.md) define bounded cuts/fills, dirt roadbeds, housing perimeters, final vegetation/walkability and lazy cross-tile composition.

## Shared fantasy clock

The fixed real epoch is `2026-10-07T08:48:29Z` (11:48:29 in Europe/Istanbul). Its fantasy origin is `07.10.0126 11:48:29`. The explicitly requested year offset is 1900.

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

Current functional/browser checks validate the S001 runtime plus completed renderer/globe work. As S002 packages replace legacy assumptions, tests must be rewritten to assert the canonical contracts rather than preserve obsolete 262.144 km / 420 m behavior.
