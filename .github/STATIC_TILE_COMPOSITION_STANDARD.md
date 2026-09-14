# Static Tile Composition Standard

## Authority

**Admin > README.md > ROADMAP.md > TODO > issues > code/assets > tests**

## Source artwork

Only Admin may request or authorize new production artwork.

Texture Artist may process and integrate Admin-provided artwork only. Do not generate, redraw, synthesize, or substitute missing source art.

If artwork is missing, report required Admin input. Do not create a placeholder.

## Tile size

- Runtime static tile: exact `100x100 RGBA`.
- Atlas slice: exact `100x100 RGBA`.
- Do not resize atlas slices at runtime.

## Composition order

Build each static tile in this order:

1. terrain/base
2. road/path/transition
3. building/structure/interior
4. vegetation/prop/object
5. other static visuals

## Static world rule

- NPC world sprites are the normal dynamic image exception.
- All non-NPC world visuals are composited into the 100x100 static tile.
- Do not keep duplicate persistent image layers for roads, buildings, trees, props, or other static objects.
- Camera pan or zoom does not rebuild unchanged static tiles.
- Rebuild only tiles whose authoritative static inputs changed.
- Pixels are presentation only. Simulation remains authoritative.

## Atlas rule

Follow `.github/TEXTURE_ATLAS_STANDARD.md`.

For atlas families:

- master = `1000x1000 RGBA PNG`;
- grid = `10x10`;
- cell = `100x100`;
- unused cells = transparent;
- no visible grid, labels, numbers, titles, legends, frames, watermarks, or issue numbers;
- top-down = direct overhead/orthographic unless the issue says otherwise;
- use actual `tools/tile_atlas_tool.py` outputs;
- runtime maps committed semantic 100x100 PNG files.

## Binary upload rule — mandatory

**Never upload PNGs or other binary files to GitHub using GitHub Blob, Create Blob, base64 upload, binary-upload APIs, Git trees, or similar GitHub binary methods.**

Put binary files in the Google Drive `The_Advisor_Game/` repository mirror using exact repository-relative paths. Update/replace existing Drive files instead of creating duplicates.

Then use `DRIVE_PENDING_ADMIN_PUSH` until Admin commits/pushes and the files are verified in GitHub. See `WORKFLOW.md` and `.github/DRIVE_BINARY_FALLBACK.md`.

## Cache rule

Use bounded/sparse static composition. Do not allocate one permanent world-sized canvas or texture.

## Test

Verify:

- final static tile is 100x100 RGBA;
- no duplicate static layer exists;
- semantic mapping matches committed files;
- camera motion and zoom keep valid visuals;
- Simulation authority remains in Simulation state;
- Tester independently verifies final integration.