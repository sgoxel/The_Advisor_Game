# TILE_ATLAS_TOOL

FORMAT:
- Canonical atlas: `1000x1000 RGBA PNG`.
- Grid: `10x10`.
- Cell/runtime tile: `100x100 RGBA PNG`.
- Ordering: row-major.
- Source artwork needs no borders/numbers/grid.
- Normalize source to 1000x1000 before slicing.
- Slice directly; border trim = 0.

TOOL:
- Production processing MUST execute `tools/tile_atlas_tool.py`.
- Default semantic IDs: `r00_c00` ... `r09_c09`.
- Optional metadata may override semantic fields.
- Outputs: `<family>_atlas_1000px.png`, 100px tile PNGs, manifest JSON, descriptions JSON.
- Default project target: `textures/tiles/<family>/`.

CLI_EXPORT:
`python tools/tile_atlas_tool.py INPUT --family grass --output OUTPUT --mode fit`

CLI_PROJECT:
`python tools/tile_atlas_tool.py INPUT --family grass --project-root PROJECT --mode fit`

CLI_GITHUB:
`GITHUB_TOKEN=... python tools/tile_atlas_tool.py INPUT --family grass --output OUTPUT --github-publish --github-repo owner/repo --github-branch main`

GITHUB:
- Token source default: environment variable `GITHUB_TOKEN`.
- Never store token in repository/output/manifest.
- EACH PNG is uploaded as one independent base64 Git blob.
- JSON outputs are uploaded as independent UTF-8 Git blobs.
- After all blobs exist: one tree -> one commit -> branch ref update.
- Default remote path: `textures/tiles/<family>/`.

VERIFY:
- Master exact `1000x1000 RGBA`.
- Every emitted tile exact `100x100 RGBA`.
- Expected occupied tile count matches manifest.
- SHA-256 values match files.
- GitHub tree paths point to returned blob SHAs.
