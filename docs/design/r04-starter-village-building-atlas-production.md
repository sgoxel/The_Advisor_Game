# R04 Starter-Village Building Atlas Production

Issue: #348  
Authority: presentation-only Designer production. Simulation-owned building type, footprint, entrance, collision, occupancy and interior truth are unchanged.

## Canonical production contract

Every canonical starter-village building type has one deterministic 1024×1024 RGBA PNG arranged as a fixed 4×4 grid of 256×256 cells. The first 12 cells are semantically occupied; row 4 is intentionally fully transparent. Normal occupied pieces contain building-owned pixels only: no surrounding grass, road, water or other biome terrain is baked into the art. No tile pixel changes an authoritative footprint or entrance.

All families use the same composition vocabulary so #349 can reuse one deterministic runtime assembly contract:

| Cell | Semantic tile | Purpose |
| --- | --- | --- |
| r0c0 | `roof_corner_nw` | left roof/end cap |
| r0c1 | `roof_edge_n` | repeatable roof run |
| r0c2 | `roof_corner_ne` | right roof/end cap |
| r0c3 | `roof_ridge` | central/ridge roof form |
| r1c0 | `wall_edge_w` | west wall/end cap |
| r1c1 | `wall_center` | repeatable wall span |
| r1c2 | `wall_edge_e` | east wall/end cap |
| r1c3 | `wall_window` | readable occupied wall/window |
| r2c0 | `base_corner_sw` | lower left/base piece |
| r2c1 | `entrance` | visually explicit authoritative entrance piece |
| r2c2 | `base_corner_se` | lower right/base piece |
| r2c3 | `family_feature` | family-specific production/service cue |
| r3c0-r3c3 | unused | fully transparent |

Large authoritative footprints repeat `roof_edge_n` and `wall_center`; they never stretch one source tile across the whole structure. The `entrance` piece is anchored to the Simulation-provided entrance logical tile. Pieces have no intentional logical-cell overhang; later depth/roof-reveal presentation may layer them without changing collision.

## Complete current starter-village inventory

The current `starter_village_exteriors.js` semantic inventory is the source for the canonical set. The generated atlases preserve its established palette/cue direction:

| Canonical type | Visual language | Distinguishing feature |
| --- | --- | --- |
| `home` | warm timber/plaster residence | chimney |
| `inn` | richer lodging roof/walls | hanging sign |
| `village_hall` | civic stone/timber landmark | banner |
| `bakery` | warm food-production frontage | awning |
| `market` | green-roof trade frontage | awning/stall language |
| `smithy` | dark masonry/metal production | glowing forge |
| `workshop` | timber craft production | work awning |
| `guard_post` | cool service/watch structure | banner |
| `mill` | agricultural utility | mill wheel/blades |
| `farmstead` | agricultural timber building | fenced/farm cue |
| `storage` | utilitarian timber store | crates |
| `well` | compact service structure | roofed well |

Aliases do not duplicate art. `dwelling`/`house` resolve to `home`; `tavern`/`lodging` to `inn`; `hall`/`civic` to `village_hall`; `shop` to `market`; `food` to `bakery`; `production` to `workshop`; `guard`/`service` to `guard_post`; `farm`/`agricultural` to `farmstead`; `storehouse`/`barn` to `storage`.

## Representative assembly

A normal home at gameplay scale uses corner/end pieces around repeatable roof/wall spans rather than a whole-building sprite:

```text
roof_corner_nw | roof_edge_n | roof_edge_n | roof_corner_ne
wall_edge_w    | wall_window | wall_center | wall_edge_e
base_corner_sw | wall_center | entrance    | base_corner_se
```

A larger landmark keeps the same semantic grammar and inserts additional repeatable roof/wall cells. The authoritative footprint remains the only source of width/height. The authoritative entrance coordinate selects where the `entrance` visual piece is composed; the art never relocates it.

## Readability evidence contract

Independent visual inspection should cover both ordinary normal gameplay zoom and the #329 implicated zoom neighborhood. At normal zoom, silhouette/palette plus the family feature must distinguish residence, lodging, civic, food/trade, production, guard/service, agricultural, storage and well roles without relying solely on floating labels. At the zoom neighborhood, nearest-neighbor/cached raster presentation should retain crisp roof/wall/door cues without recreating viewport-spanning vector surfaces. Runtime adoption and capture of in-world screenshots belong to dependent Coder #349; #348 supplies the canonical source art and semantic composition truth it must consume.

## Regeneration and originality

`design/source/buildings/generate_starter_village_building_atlases.mjs` is the deterministic original source for all atlases. It uses the repository's existing canonical PNG encoder rather than external/protected assets. Regenerating from the same source produces the same semantic family set and grid contract. Generated PNGs/manifests are committed as production inputs so runtime code does not crop or synthesize whole buildings every frame.
