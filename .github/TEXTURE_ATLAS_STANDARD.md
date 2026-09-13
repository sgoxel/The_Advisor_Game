# TEXTURE_ATLAS_STANDARD

AUTHORITY: Admin > README > ROADMAP > TODO > issues > code/assets > tests.
README is product truth. This file defines implementation HOW.

ROLE:
- Texture Artist DOES NOT create images.
- New visual source images require explicit Admin authorization.
- Texture Artist may discover, validate, process, metadata-map, publish, register, integrate, and verify Admin-provided assets.
- Missing artwork must be recorded; do not create placeholders or substitutes.

FORMAT:
- Production visual assets: PNG unless higher authority says otherwise.
- Reusable atlas: RGBA PNG.
- Canonical atlas: 1024x1024, 4x4, 256x256 cells.
- Canonical filename: `<family>_atlas_1024px.png`.
- Derived filename: `<family>_<semantic-type>_256px.png`.
- Family path: `textures/tiles/<family>/`.

MANDATORY_TOOL:
- Use actual `tools/tile_atlas_tool.py` for reusable 4x4 atlas processing.
- Manual reproduction of tool logic is NOT equivalent production evidence.
- Exact tool outputs are authoritative derived files.

TOOL_PROCESS:
1. Input Admin-provided atlas + 16-cell metadata.
2. Normalize whole atlas to 1024x1024 RGBA using approved mode.
3. Keep canonical atlas.
4. For each occupied 256x256 cell: crop -> trim 1 px each edge -> 254x254 -> resize to 256x256 LANCZOS -> save RGBA PNG.
5. Emit manifest and descriptions.
6. Preserve semantic identity and hashes.

METADATA_REQUIRED_PER_OCCUPIED_CELL:
- row
- col
- semantic_type
- description
Semantic types must be unique.

OUTPUT_REQUIRED:
- canonical atlas
- all occupied semantic PNG tiles
- `<family>_tiles.manifest.json`
- `<family>_tiles.descriptions.json`

GITHUB_BINARY_PUBLISH:
1. Upload EACH PNG FILE SEPARATELY as one GitHub binary blob.
2. Save each returned blob SHA.
3. Do NOT combine the whole family into one blob payload.
4. Aggregate family size is irrelevant to per-file upload capability.
5. After all file blobs exist, create one tree with final repository paths.
6. Create one commit.
7. Update target branch ref.
8. Text files may use normal UTF-8 operations.
9. Never store base64 text as `.png`.
10. See `tools/TILE_ATLAS_GITHUB_PUBLISH.md`.

VALIDATE_BEFORE_INTEGRATION:
- valid PNG decode
- RGBA mode
- canonical = 1024x1024
- derived tile = 256x256
- 4x4 organization valid
- transparency correct when required
- manifest/descriptions/file names consistent
- hashes match when present

RUNTIME_INTEGRATION:
- Register committed semantic assets in current runtime mapping.
- Non-NPC visuals must follow `.github/STATIC_TILE_COMPOSITION_STANDARD.md`.
- Reusable 256x256 PNGs are source assets, not persistent independent world layers.
- Remove superseded legacy mappings when safe and in scope.
- Preserve Simulation authority; visual metadata is presentation-only.

HANDOFF:
- If asset files + metadata + runtime integration are complete: Role=Tester, Claim=NONE, Status=VERIFY.
- If substantial separate code work is required: route to Game Programmer with concrete next step.

AUDIT:
Record source, source dimensions, Tile Tool command/action, normalization mode, semantic map, emitted paths, manifest, descriptions, hashes, Git commit, runtime mapping changes, checks, result, risks, next.
