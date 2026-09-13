# STATIC_TILE_COMPOSITION_STANDARD

AUTHORITY: Admin > README > ROADMAP > TODO > issues > code/assets > tests.

TILE:
- Runtime tile: `100x100 RGBA`.
- Atlas slice: `100x100 RGBA`.
- Atlas slice requires no runtime size conversion.

ORDER:
1. terrain/base
2. road/path/transition
3. building/structure/interior
4. vegetation/prop/object
5. other static visuals

STATIC:
- Non-NPC static visuals resolve into the 100x100 tile composite.
- Do not keep duplicate persistent static image layers.
- NPC visuals may remain dynamic.
- Camera pan/zoom does not rebuild unchanged static tiles.
- Rebuild only tiles whose static inputs changed.

ATLAS:
- Follow `.github/TEXTURE_ATLAS_STANDARD.md`.
- Canonical atlas: `1000x1000`.
- Grid: `10x10`.
- Cell: `100x100`.
- Use actual `tools/tile_atlas_tool.py` outputs.
- Runtime maps committed semantic 100x100 PNG files.

GITHUB:
- Each PNG is one binary Git blob.
- Collect blob SHAs.
- Create one tree, one commit, then update branch ref.

CACHE:
- Use bounded/sparse composition.
- Do not allocate one permanent world-sized canvas.

TEST:
- Final tile is 100x100 RGBA.
- No duplicate static layer.
- Semantic mapping matches committed files.
- Camera motion/zoom keeps valid visuals.
- Simulation authority remains in Simulation state.
