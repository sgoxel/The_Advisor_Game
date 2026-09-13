# Tile Atlas Tool GitHub Publish Method

## Admin authority

This document is created by explicit Admin authority for The Advisor Game.

## Required processing method

For reusable 4x4 atlas families, use the actual repository tool:

`tools/tile_atlas_tool.py`

Do not replace this production step with an ad-hoc script that merely copies the same slicing or resizing logic.

The required workflow is:

1. Start with the Admin-provided atlas image.
2. Prepare the fixed metadata for the 16 cells.
3. Execute `tools/tile_atlas_tool.py` by CLI or GUI.
4. Use the canonical atlas, semantic PNG tiles, manifest, and descriptions produced by that tool as the authoritative derived asset set.
5. Do not manually re-slice or replace those generated PNG files after the tool run.

The current tool remains responsible for whole-atlas normalization, 4x4 cell handling, the Admin-approved 1px edge trim and LANCZOS resize, semantic filenames, metadata, and hashes.

## Required GitHub PNG publication method

PNG files are binary assets. When publishing through the connected GitHub API, use the Git data binary path:

`binary blob -> repository tree -> commit -> branch ref update`

In the available GitHub toolset this corresponds to the blob, tree, commit, and ref operations.

The UTF-8 contents operations used for ordinary text files are not the PNG binary publication path. A text-only contents operation must not be used as evidence that GitHub cannot accept PNG files when the binary Git-data path is available.

The repository tree entries for generated PNG files must point to the binary blobs created from the exact Tile Atlas Tool output bytes. Normal repository file mode is used for the final asset files.

Text metadata such as JSON or Markdown may use normal text-file operations or may be included in the same Git-data commit.

## Publication verification

After publication, verify:

- canonical atlas path exists in GitHub;
- every intended semantic PNG tile exists;
- PNG dimensions match the Tile Atlas Tool manifest;
- manifest hashes match the committed files when hashes are available;
- descriptions and semantic filenames remain consistent;
- no temporary transport files remain in the production asset tree;
- runtime mapping points at the committed family when integration belongs to the issue.

## Texture Artist audit

Record:

- Admin-provided source reference;
- actual Tile Atlas Tool command or GUI action;
- source dimensions and normalization mode;
- emitted tile count;
- output paths;
- Git commit SHA;
- target branch;
- verification checks;
- runtime mapping changes;
- next role.

Do not describe manually reproduced slicing logic as an actual Tile Atlas Tool execution.

## Relationship to project standards

This method supplements `.github/ISSUE_STANDARD.md`, `.github/TEXTURE_ATLAS_STANDARD.md`, `.github/STATIC_TILE_COMPOSITION_STANDARD.md`, and `tools/TILE_ATLAS_TOOL.md`.

Explicit Admin direction remains higher authority. README remains unchanged unless Admin separately authorizes a README edit.