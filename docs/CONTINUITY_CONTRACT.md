# Invisible-world continuity contract

WP-S003-002-001 establishes the common definition/query contract for world facts that must remain coherent when neighboring detail is not resident. It extends the canonical planet and natural-world rules; it does not create a second world authority.

## Reference refresh — 2026-10-13

Two reference lessons were re-checked immediately before implementation:

- Epic Games, **World Partition in Unreal Engine 5.8**: runtime grid cells are loaded/unloaded from streaming sources such as the player, while the persistent world remains conceptually separate from cell residency. The Advisor adopts only this separation of *world definition* from *loaded presentation*. It does not adopt Unreal grid identity or actor ownership.
- Red Blob Games, **Introduction to A*** and the implementation guide updated August 2026: route search consumes a graph of nodes/edges and does not require the visual map grid to be the route graph. The Advisor therefore keeps compact coarse connectivity/query work separate from fine render patches; a returned graph edge still must be validated against canonical terrain/traversal truth.

References:
- https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine
- https://www.redblobgames.com/pathfinding/a-star/introduction.html
- https://www.redblobgames.com/pathfinding/a-star/implementation.html

## Authority layers

1. **Canonical definition** — `WORLD_SEED`, `WORLD_FOUNDATION_VERSION`, canonical cube-sphere coordinates/cells, compact topology and persisted campaign revision. Cache residency, device, camera, renderer, worker order and wall clock are forbidden inputs.
2. **Query/evaluation** — bounded region recipes, shared boundary records, terrain profile samples and road corridor recipes. Queries may sample declared coarse support without creating neighbor meshes.
3. **Presentation** — meshes, textures, entities, collision representations and LOD. Presentation can be cancelled or evicted and must reconstruct from the definition/query layers.

A fact can exist without a resident object. A hash alone is not a fact: the recipe must expose enough canonical data to reconstruct the same terrain/connection result.

## Canonical region and boundary identity

`src/continuity.ts` uses the existing cube-sphere fabric at canonical **L7**. This level is independent of render tile LOD. A region is identified by the existing canonical cell ID.

A shared edge is normalized by:

- sorting the two adjacent canonical cell IDs;
- assigning semantic ownership to the lexicographically lower cell;
- deriving the geometric edge from that owner's cube face and edge coordinates;
- quantizing canonical longitude/latitude to **1e-10 rad** before it enters a record;
- deriving the edge code from SEED + foundation version + the normalized pair.

The same edge record is therefore returned from A→B and B→A, including across cube-face orientation changes. Exact poles remain one canonical point under the existing `lonLatToUnit` pole rule. Longitude wrap is represented by canonical spherical coordinates, not planar wrap aliases.

## Stateless samples and domain separation

Every variation lookup is an addressed digest of:

`WORLD_SEED / WORLD_FOUNDATION_VERSION / CONTINUITY / domain / canonical IDs / slot / candidate`

Road-port sampling uses its own `ROAD_PORT` domain and road width uses `ROAD_WIDTH`. Adding vegetation, a building candidate or a renderer option cannot consume a shared RNG stream and move a road.

Initial fixed-world facts use SEED only. Persisted Simulation changes are represented separately by the campaign revision/timestamp. The fixed road `foundationDigest` is unchanged by a campaign revision; `stateDigest` includes the persisted revision so an unload/rebuild keeps the changed state rather than recreating the initial state.

## Numeric work limits

These limits are binding for this contract and are intentionally below/orthogonal to the existing `src/streaming.ts` presentation budgets:

| Limit | Value | Meaning |
| --- | ---: | --- |
| Continuity region | cube-sphere L7 | Logical identity only; never a render-patch size |
| Coarse terrain dependencies | 5 regions | owner + four edge neighbors |
| Road boundary candidates | 7 | finite ordered candidate set |
| Road coarse search expansions | 192 | hard A* cap |
| Road corridor logical regions | 48 | hard retained result cap |
| Continuity recipe cache | 128 entries | rebuildable LRU; cache is never authority |
| Canonical coordinate quantization | 1e-10 rad | sub-centimeter physical agreement on this planet |
| Profile elevation quantization | 0.01 m | one-centimeter profile contract |
| Road nominal half width | 4.5 m | query/profile support; presentation may add bounded shoulder support |
| Main-thread uploads | ≤1 group/frame | unchanged existing presentation limit |
| Generation+ready jobs | phone 4 / tablet 6 / desktop 8 | unchanged existing streaming limits |
| CPU / GPU ceilings | phone 96 / tablet 160 / desktop 256 MiB each | unchanged existing streaming limits |

Budget exhaustion must not pick a different candidate. Query work either completes the same deterministic recipe or returns/retains the prior valid fallback; scheduling never becomes a seed input.

## Terrain recipe

A continuity region recipe evaluates the existing `macroSampleAt` authority at the canonical region center and records the owner plus four canonical neighbors as its complete coarse dependency set. This does **not** generate a fine neighbor mesh, settlement, building, vegetation instance or actor.

Fine/current terrain truth remains `world.ts`/the final surface pipeline. `continuity-runtime.ts` evaluates current `heightAt` and `biomeAt` only at compact continuity points when a diagnostic/explicit query asks for them. This means the proof uses the same terrain/traversal authority as ordinary runtime sampling; the diagnostic does not own an alternate height field.

## Shared road port recipe

A road edge query enumerates exactly **7** SEED-ordered positions along the normalized shared edge. The first candidate that is dry, outside a lake and below the coarse relief ceiling wins. The ordinary case is intentionally not forced to `t=0.5`.

If all seven candidates fail, the bounded canonical repair chooses the candidate with the lowest deterministic terrain penalty and marks `fallback=true`. One side never moves the endpoint independently. Width and grade limits are carried in the shared port record.

A compact road corridor uses bounded A* over L7 canonical regions. Search cost uses great-circle step cost plus canonical macro terrain penalties; it never requests fine meshes. If the hard expansion cap is exhausted, the documented repair samples the canonical great-circle sequence under the same fixed region cap. A diagonal/corner repair step does not invent a fake edge port.

This package demonstrates the contract against the existing seeded road registry. Later transport-network work may replace local centerline refinement, but it must consume the same shared-edge/recipe rules instead of creating a different continuity authority.

## Cache, eviction and persistence

The recipe cache key includes:

- WORLD_SEED;
- foundation/generator version;
- feature ID;
- canonical endpoint coordinates;
- persisted campaign revision.

LRU order affects only memory residency. The cache is capped at 128 entries and is safe to clear at any time; a cold rebuild reproduces the same foundation/state digests. Device quality is not part of the key.

Persisted changes are represented by the caller-provided campaign revision, which follows the project rule that later decisions/actions are interpreted under **SEED + Fantasy Game Time**. A revision such as `0126-04-07 12:00:00/bridge-open` survives cache eviction because it is an input to state reconstruction, not a cache mutation.

## Remote query rule

`continuityRemoteRoadQuery` evaluates only compact canonical records. Its telemetry is required to report:

- `presentationBytes = 0`;
- `materializedPresentationResources = 0`.

No remote mesh, texture, entity, actor, collision object or intermediate visible region may be created merely to answer a route/inspection fact query.

## Work-set diagnostics

The **Continuity contracts** layer is opt-in and hidden during normal play. When enabled it reports:

- current canonical logical region;
- declared dependency count/cap;
- nearest seeded road recipe, logical region count and shared-port count;
- selected candidate and current runtime terrain profile at a port;
- foundation/state digests;
- search and cache high-water information;
- remote presentation resource count/bytes.

The selected-point canonical inspector also shows a `planet-continuity` ancestry row. This is diagnostic presentation only; toggling it cannot change a recipe.

## Consumer rules after this WP

- **Hydrology**: retain basin/outlet/channel identity as compact definition; use shared ports for bounded regional channel refinement. Never independently roll a river endpoint per tile.
- **Vegetation**: candidate slots remain SEED-addressed; only evaluate accepted instances in the relevant support region. A new tree sample uses a separate domain and cannot perturb road/water samples.
- **Settlement/buildings**: settlement/plot/entrance recipes are persistent identities; detailed footprint/model/interior is requested on demand. Features crossing a region boundary enumerate their complete finite support.
- **Residents**: identity/home/work links and persisted events survive detail eviction; actor entities are presentation. Arrival of the camera cannot create/reset a resident.

## Evidence expectations

Automated coverage in `tests/continuity.test.ts` checks fixed support, orientation-independent edges, non-midpoint road ports, ten fixed road fixtures under reverse/shuffled request order and cache eviction, one-centimeter shared terrain profile identity, campaign revision reconstruction, zero-resource remote queries, cache bounds, longitude wrap, exact poles and cube-neighbor edge reconstruction.

Browser/CI validation additionally checks the normal game and opt-in diagnostics under WebGPU and WebGL2. Visual acceptance still requires inspection of the generated screenshots; telemetry is not a visual score.
