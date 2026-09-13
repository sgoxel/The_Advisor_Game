# STATIC_TILE_COMPOSITION_STANDARD

AUTHORITY: Admin > README > ROADMAP > TODO > issues > code/assets > tests.
README is product truth. This file defines presentation HOW.

CORE_PRESENTATION_RULE:
- NPC world sprites are the only normal independently dynamic world-image exception.
- Every non-NPC world visual must resolve into a 100x100 RGBA logical-tile composite before presentation.
- Simulation remains authoritative for terrain, collision, topology, buildings, objects, ownership, state, interactions, and outcomes.

ASSET_SOURCE:
- Reusable visual families follow `.github/TEXTURE_ATLAS_STANDARD.md`.
- Admin-provided 4x4 atlases must be processed by actual `tools/tile_atlas_tool.py`.
- Derived source tile = 256x256 RGBA PNG.
- Runtime destination tile = 100x100 RGBA composite.

GITHUB_PUBLISH:
- Upload each Tile Tool PNG separately as one binary blob.
- Collect blob SHAs.
- Create final tree after required files are uploaded.
- Create commit.
- Update branch ref.
- Do not combine the whole family into one blob payload.
- Do not treat aggregate family size as per-file upload failure.
- See `tools/TILE_ATLAS_GITHUB_PUBLISH.md`.

COMPOSITION_ORDER:
1. terrain/base
2. terrain transition/path/road
3. structure/building/interior
4. vegetation/tree/object/prop
5. other static presentation effects

STATIC_LAYER_RULE:
- No persistent non-NPC road/building/object overlay canvas.
- No persistent non-NPC per-object sprite/image layer.
- No SVG/vector production world art.
- No duplicate static presentation outside tile composites.
- UI is outside this rule.

NPC_EXCEPTION:
- NPCs may use independent dynamic PNG presentation.
- NPC state/movement remains Simulation-backed.

NON_NPC_MOVEMENT:
- If a non-NPC entity changes tile, invalidate/recompose affected old/new tiles.
- Do not create a permanent independent world layer unless Admin explicitly authorizes an exception.

CACHE:
- Use bounded/sparse tile composition.
- Do not allocate one giant texture only because region size is 100x100 logical tiles.
- Recompose only invalidated tiles.
- Camera pan/zoom and NPC interpolation do not invalidate static tiles.

MULTI_TILE_OBJECT:
- Keep Simulation footprint authoritative.
- Resolve visual parts per logical tile.
- Composite each part into its corresponding 100x100 tile.
- Do not keep a giant persistent building/object sprite layer.

TEXTURE_ARTIST_INTEGRATION:
- Verify committed atlas/master/slices/metadata.
- Map semantic PNGs to correct runtime composition role.
- Integrate current asset family into latest app when in scope.
- Remove superseded legacy presentation mappings when safe and in scope.
- Record exact files, mappings, checks, commit, result, next.

GAME_PROGRAMMER_GATE:
- Load registered PNG source assets.
- Map authoritative world descriptors to semantic tile art.
- Composite into 100x100 RGBA tile output.
- Update only affected static tiles.
- Preserve Simulation authority.
- Preserve dynamic NPC presentation.

TESTER_GATE:
- Admin-provided source only.
- Actual Tile Tool processing for reusable atlases.
- Committed PNGs/metadata match intended outputs.
- Final non-NPC logical tile composite = 100x100 RGBA.
- Correct composition order.
- No prohibited persistent static layers.
- NPCs remain dynamic.
- Semantic mapping matches files.
- No Simulation authority moved into visual metadata.
