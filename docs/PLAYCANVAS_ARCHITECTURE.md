# PlayCanvas Rendering Architecture

## Authority Boundary

The Advisor Game keeps gameplay authority outside the renderer.

```text
Campaign SEED + Simulation
          |
          v
Authoritative world/chunk data
          |
          v
Renderer-neutral presentation descriptors
          |
          v
PlayCanvas Engine 2 scene
```

PlayCanvas may visualize world state but must not become the authority for terrain identity, collision, routes, NPC decisions, inventory, time, buildings, save data or campaign history.

## Target Runtime Structure

```text
scripts/
  core/                  authoritative campaign/time/randomness
  world/                 authoritative geography, terrain, routing, buildings
  entities/              authoritative character state
  data/                  stable game configuration and logical asset metadata
  render/
    renderer-contract.js renderer-neutral input/output contract
    playcanvas/
      app.js              PlayCanvas Application/device setup
      scene.js            scene roots, layers and orthographic camera
      coordinates.js      world <-> PlayCanvas presentation mapping
      chunk-renderer.js   terrain/building/prop chunk presentation
      asset-cache.js      GLB/material/texture/sprite preparation
      character-sprites.js 2D character billboards
      quality-manager.js  phone/tablet/desktop presentation quality
      telemetry.js        draw calls, frame time, entities, cache metrics
  ui/                    responsive DOM control deck
```

The exact file split may be adjusted while implementing WPs, but responsibilities must remain separated.

## Scene Hierarchy

```text
WorldRoot
  TerrainRoot
    Chunk_x_y
      Terrain
      RoadsWater
  StructuresRoot
    Buildings
    Interiors
  PropsRoot
    StaticProps
    InstancedProps
  CharactersRoot
    ProtagonistBillboard
    NPCBillboards
  EffectsRoot
  LightingRoot
CameraRoot
  OrthographicGameplayCamera
```

UI remains HTML/DOM and is not required to live inside the PlayCanvas scene.

## World Scale and Coordinates

- Authoritative logical tile size remains 2 m × 2 m.
- Simulation remains X/Y based.
- Presentation maps authoritative X/Y onto the PlayCanvas ground plane.
- Visual elevation/height is renderer-only unless a Simulation system explicitly defines authoritative level/elevation.
- PlayCanvas physics is not gameplay authority.

## 3D World Content

Everything except character artwork is 3D presentation:

- terrain;
- roads and paths;
- water and bridges;
- buildings, walls, doors and roofs;
- interiors and furniture;
- trees, rocks and environmental props;
- landmarks and settlement structures.

Preferred runtime model format is GLB/glTF.

Avoid one PlayCanvas Entity per logical terrain tile. Terrain is prepared and rendered by chunk using a small bounded number of meshes/entities.

## Character Presentation

Characters remain 2D artwork.

Use PlayCanvas Sprite/billboard entities with:

- transparent sprite images/atlases;
- feet anchored to authoritative world coordinates;
- camera-facing orientation;
- depth testing/occlusion against 3D world geometry;
- animation through sprite frames where required;
- bounded activation so off-screen Simulation characters need no render entity.

## Chunk Lifecycle

Each chunk has one presentation state:

- **Active** — visible/immediately required;
- **Prepared** — nearby and GPU-ready before exposure;
- **Cached** — retained reusable chunk outside the immediate preparation ring.

A complete logical chunk is generated before it is marked Prepared.

Chunk identity is based on stable world chunk coordinates plus presentation signature, not exact camera center.

Normal navigation through prepared content should primarily:

1. move the orthographic camera;
2. activate prepared chunk entities;
3. deactivate departing chunk entities;
4. reuse retained meshes/materials/assets.

It should not regenerate the whole viewport.

## Mobile Performance Rules

WebGL2 is the compatibility baseline. WebGPU may be selected on validated devices/browsers.

Phone/tablet rendering must support:

- capped pixel ratio;
- adaptive render scale;
- bounded chunk preload/cache;
- shared materials;
- static batching;
- hardware instancing for repeated meshes;
- conservative lighting/shadows;
- LOD where evidence shows benefit;
- frustum/distance culling;
- minimal shader/material variants.

Simulation fidelity cannot be reduced as a graphics-quality setting.

Target 60 FPS on capable hardware and support a 30 FPS fallback target.

## Canonical Renderer Rule

The canonical public root launches PlayCanvas Engine 2 directly.

There is no supported PixiJS renderer mode, renderer-selection compatibility path, or silent legacy fallback. PlayCanvas startup failures must be surfaced so they can be fixed rather than hidden.

Completed historical PixiJS WPs remain historical records only. All current renderer-specific work targets the PlayCanvas architecture.
