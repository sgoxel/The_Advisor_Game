# PlayCanvas 3D Asset Standard

This standard defines runtime 3D presentation assets for The Advisor Game. It is renderer-only and cannot become Simulation authority.

## Runtime format

- Preferred runtime format: **glTF 2.0 / GLB**.
- GitHub Pages must load assets directly without requiring the PlayCanvas Editor service.
- Development proof assets may use embedded-buffer `.gltf`; production assets may be converted to optimized `.glb`.
- One authoritative logical tile remains **2 m × 2 m**.
- Coordinate mapping: world X → PlayCanvas +X, world Y → PlayCanvas +Z, height → PlayCanvas +Y.

## Pivots and units

- All geometry uses meters.
- Building root pivot: ground level at footprint center.
- Terrain/props/furniture root pivot: ground-center unless a documented interaction pivot is required.
- Doors use ground-center with the hinge/animation pivot provided separately when animation is introduced.
- Mesh transforms are presentation only. Simulation coordinates, building footprint, collision, routes, rooms and interaction cells remain authoritative.

## Logical asset keys

Runtime systems refer to stable logical keys, never raw URLs or PlayCanvas asset IDs.

Representative keys:

- `terrain.patch.prototype`
- `building.house.prototype`
- `interior.workbench.prototype`
- `environment.tree.prototype`

The canonical development set is:

`assets/models/wp-s003-005-002/representative_asset_set.gltf`

The runtime catalog is:

`scripts/render/playcanvas/asset-standard-catalog.js`

## Material families

Shared families are preferred over unique materials:

- `mat.wall.plaster.warm`
- `mat.roof.clay.dark`
- `mat.wood.oak`
- `mat.leaf.green`
- `mat.terrain.grass`
- `mat.stone.gray`

Objects that can share the same shader/material state should do so. Do not generate one material per placed object.

## Texture channels

Use glTF/PBR conventions:

- Base color: RGBA.
- Normal: tangent-space normal map.
- Metallic/Roughness: glTF combined convention when used.
- Occlusion: glTF occlusion channel when used.
- Emissive: optional and presentation-only.
- Alpha: use only where transparency is required.

Draft SVG source may be retained for texture-authoring workflows where applicable, but runtime 3D assets use optimized raster/compressed textures.

## Texture quality tiers

Maximum authoring/runtime target sizes:

| Tier | Base color | Normal | Auxiliary |
| --- | ---: | ---: | ---: |
| Low | 256 px | 256 px | 128 px |
| Standard | 512 px | 512 px | 256 px |
| High | 1024 px | 1024 px | 512 px |
| Ultra | 2048 px | 2048 px | 1024 px |

The active texture-budget WP may select a lower runtime tier. This standard does not override its memory-budget logic.

## Static, dynamic and instancing rules

- Terrain, buildings, roofs, doors that are not animating, furniture, trees and rocks are static presentation by default.
- NPC/Protagonist Simulation remains separate from world geometry.
- Identical repeated meshes with compatible material state are instancing-eligible.
- Trees, rocks, repeated fence parts and repeated interior props should use hardware instancing where measurable benefit exists.
- Do not instance objects whose visual state requires unique material/shader state unless the state can be represented by per-instance data.
- Avoid one PlayCanvas Entity per logical terrain tile.

## LOD

LOD is optional, not mandatory.

When used:

- LOD names are deterministic: `LOD0`, `LOD1`, `LOD2`.
- Distance thresholds are metadata, not inferred from current FPS.
- Identical asset + quality profile + distance must choose the same LOD.
- LOD switching cannot change Simulation collision, walkability or interaction identity.

The representative proof assets use only LOD0 because they are already low-poly and below the current mobile proof budget.

## Bounds and culling

Every runtime asset defines usable presentation bounds before integration.

Representative bounds:

- Terrain patch: 8 × 0.5 × 8 m.
- House including roof: 6.8 × 4.8 × 5.6 m.
- Workbench: 2.4 × 0.94 × 0.9 m.
- Tree: 3.2 × 4.5 × 3.2 m.

Chunk/object culling may use these presentation bounds. They cannot replace authoritative collision geometry.

## Collision and gameplay authority

3D mesh bounds, PlayCanvas collision components, render entities and material state are **never gameplay authority** unless a future WP explicitly establishes a renderer-neutral authoritative collision contract.

Current gameplay authority remains:

- SEED/world generation;
- logical terrain cells;
- building footprints;
- room/interior cells;
- Walkability;
- RoutePlanner;
- character coordinates;
- interaction points;
- save/load state.

## Missing-asset fallback

During development, a missing 3D presentation asset may fall back to a simple low-poly primitive using the same logical key and footprint metadata.

Fallback geometry must:

- preserve the same presentation anchor;
- not alter Simulation;
- be visibly marked in development telemetry;
- be replaceable without save-data migration.

## Representative development set

WP-S003-005-002 includes a real glTF 2.0 proof set containing:

- a 6 m × 5 m house body;
- a matching 6.8 m × 5.6 m dual-slab gable roof;
- a 1.2 m × 2.1 m door;
- a 2.4 m workbench;
- three repeated low-poly trees sharing the same mesh/material definition;
- an 8 m terrain-support patch;
- a small stone terrain marker.

The set demonstrates meter scale, shared material families, reusable mesh definitions, deterministic logical node names, bounds and repeated-asset instancing eligibility.
