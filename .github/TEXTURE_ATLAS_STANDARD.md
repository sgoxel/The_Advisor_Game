# Texture Atlas Standard

This file defines the canonical production standard for reusable tile-atlas processing in The Advisor Game.

## Authority and scope

This standard governs production tile-atlas geometry, processing, outputs, staging, and binary publication. Agent operating behavior remains governed by `AGENTS.md` and the applicable `.agents/<role>.md`.

Task Issues may add family-specific content, semantics, source-art requirements, or acceptance criteria, but they must not redefine the canonical geometry or binary publication workflow in this standard unless Admin explicitly changes the standard.

## Canonical atlas contract

- Master atlas: exact `1000x1000 RGBA PNG`.
- Logical grid: exact `10x10`.
- Cell count: exactly `100`.
- Runtime tile: exact `100x100 RGBA PNG`.
- Ordering: row-major.
- Border trim: `0`.
- Cell boundaries are exact. Do not apply automatic trim, padding, or per-cell resampling after canonical reconstruction.
- The logical source grid may be normalized/repacked into the canonical `1000x1000` master before exact cell slicing.

## Source artwork

- Production visual art must use Admin-provided or otherwise explicitly authorized source artwork.
- Visual-source creation is outside the atlas processing tool unless a task Issue explicitly requires asset creation.
- Source atlas artwork must not contain visible grid lines, borders, separators, labels, numbers, text, UI, watermarks, or fake checkerboard transparency.
- Each logical asset must remain inside its intended cell unless a structural/tiling requirement explicitly requires edge contact.
- Use real transparency where required by the asset family or task contract.

## Canonical processing

Use `tools/tile_atlas_tool.py`.

The tool must preserve:

- exact `1000x1000 RGBA` canonical master output;
- fixed `10x10` logical grid;
- exact `100x100 RGBA` row-major runtime tiles;
- trim `0`;
- deterministic cell-boundary slicing;
- stable semantic metadata;
- manifest/descriptions output;
- QA output;
- file hashes where emitted;
- deterministic local export;
- exact-byte Google Drive mirror staging.

The production tool must not expose worker-facing direct GitHub PNG/binary publication through blob/tree/ref/base64 or equivalent GitHub binary APIs.

## Output contract

Default repository target:

`textures/tiles/<family>/`

Expected output family:

- `<family>_atlas_1000px.png`
- `<family>_<semantic>_100px.png`
- `<family>_tiles.manifest.json`
- `<family>_tiles.descriptions.json`
- `<family>_atlas.qa.json`

Default semantic IDs are `r00_c00` through `r09_c09` when task-specific metadata does not provide other semantics.

## Drive/Admin binary workflow

Workers must not directly publish PNG or other binary atlas outputs through GitHub APIs.

Required flow:

1. Process and verify outputs locally with `tools/tile_atlas_tool.py`.
2. Stage the exact outputs at their repository-relative paths inside the configured Google Drive repository mirror.
3. Preserve exact bytes and repository-relative destination paths during staging.
4. Admin performs the GitHub binary push.
5. After the Admin push, verify the expected GitHub paths and hashes.

The configured Drive mirror is a staging boundary, not a substitute for GitHub verification.

## Verification

A compliant atlas/tool run must verify, as applicable:

- master image is exact `1000x1000 RGBA`;
- grid is exact `10x10`;
- exactly `100` logical cells exist;
- every emitted runtime tile is exact `100x100 RGBA`;
- row-major ordering is preserved;
- trim remains `0`;
- occupied/unused semantics match the manifest;
- SHA-256 values match emitted files where checked;
- Drive staging preserves exact repository-relative paths and bytes;
- no worker-facing direct GitHub binary publication option exists;
- after Admin push, expected binary paths exist in GitHub.

## Prohibited legacy behavior

Do not reintroduce:

- alternate legacy atlas geometries;
- direct worker GitHub binary publication;
- automatic per-cell trim/padding that changes the canonical `100x100` boundary;
- publication rules that make a GitHub Issue the standards authority;
- dependencies on deleted historical governance documents.

Changes to this standard require an explicit Admin request.
