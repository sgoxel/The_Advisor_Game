# STATIC_TILE_COMPOSITION_STANDARD

AUTHORITY: Admin > README > ROADMAP > TODO > issues > code/assets > tests.

SOURCE:
- Only Admin may request or authorize creation of new visual source images, including atlas images, standalone sprites, replacement artwork, textures, and other production imagery.
- Texture Artist integrates and processes Admin-provided visual assets only and MUST NOT generate, redraw, synthesize, procedurally create, request image generation for, or substitute source artwork.
- Missing required artwork must be recorded as required Admin input; workers must not manufacture placeholders or alternate production art.

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
- **ATLAS IMAGE** has the exact meaning defined by `.github/TEXTURE_ATLAS_STANDARD.md`: a production tile-source sheet for one coherent requested visual family, not a world map, region map, scene illustration, poster, splash image, UI, infographic, or labeled presentation graphic.
- An issue number supplied with an atlas request is lookup/context metadata only and must never be rendered into the atlas artwork.
- `Top-down atlas` means direct overhead/orthographic tile artwork with no horizon and no perspective/isometric tilt unless the governing issue explicitly requires another projection.
- Atlas artwork must be independently sliceable on exact cell boundaries; no accidental artwork may cross from one cell into another.
- Canonical atlas: `1000x1000`.
- Grid: `10x10`.
- Cell: `100x100`.
- Visible grid lines, tile numbers, coordinates, labels, titles, legends, decorative frames, watermarks, and other presentation text are prohibited in production atlas artwork.
- Unused cells are fully transparent.
- Use actual `tools/tile_atlas_tool.py` outputs.
- Runtime maps committed semantic 100x100 PNG files.

GITHUB:
- Each PNG is one binary Git blob.
- Collect blob SHAs.
- Create one tree, one commit, then update branch ref.
- If direct binary publishing is unavailable for an existing Admin-provided asset, follow `WORKFLOW.md` and `.github/DRIVE_BINARY_FALLBACK.md`; connector capability is not a missing-artwork condition.
- Fallback staging is not GitHub completion. Verify the committed files before Tester handoff.

CACHE:
- Use bounded/sparse composition.
- Do not allocate one permanent world-sized canvas.

TEST:
- Final tile is 100x100 RGBA.
- No duplicate static layer.
- Semantic mapping matches committed files.
- Camera motion/zoom keeps valid visuals.
- Simulation authority remains in Simulation state.
