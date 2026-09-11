# Starting Village grass ground family

WP-102/I01 production source assets.

## Files

- `grass_base_256px.svg` — normal village grass base.
- `grass_meadow_256px.svg` — slightly lighter organic variation.
- `grass_worn_256px.svg` — subtly worn variation for repetition control; it is not a road/path semantic.

All three sources use an explicit 256×256 view box and repeatable pattern units. Their edge background is uniform and all decorative marks are fully contained inside repeating pattern cells, so adjacent copies do not require edge-specific variants. They contain no collision, route, selection, debug, text, or authoritative gameplay markers and no baked directional light/shadow.

## Pipeline note

The current legacy terrain configuration still references `textures/grass_tile_texture.png`. These SVG files are integration-ready production sources and intentionally do not change runtime selection from the Texture Artist role. A later integration atomic may raster-export a chosen source to the canonical PNG target or register an SVG source after verifying loader support. Runtime semantics, walkability, and Simulation truth must remain unchanged by that integration.

## Visual intent

Use the base tile for ordinary Starting Village ground. Meadow and worn variants exist only to reduce obvious repetition when the renderer supports deterministic visual variation. They must never be selected from renderer timing, FPS, or other presentation state that could affect Simulation truth.
