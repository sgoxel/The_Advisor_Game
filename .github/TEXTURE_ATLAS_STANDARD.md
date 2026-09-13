# Texture Artist PNG Atlas Standard

## Authority and scope

This operational standard defines the mandatory handling, validation, metadata, integration, routing, and verification workflow for visual assets in **The Advisor Game**.

Authority remains:

**Admin > README.md > ROADMAP.md > TODO > issues > code/assets > tests.**

README product truth remains authoritative. Explicit Admin direction overrides this operational standard.

This file defines implementation/production HOW and must not modify README product truth.

This standard applies to:

- reusable tile families;
- terrain and environmental artwork;
- roads and paths;
- vegetation and trees;
- buildings and building parts;
- furniture and props;
- visual world objects;
- standalone PNG sprites;
- atlas metadata;
- application integration of visual assets;
- verification of visual-asset integration.

The workflow must be reproducible, deterministic, auditable, usable by routine workers, suitable for application integration, and independently verifiable by Tester.

---

# 1. Admin-only image creation rule

**Only Admin may request, authorize, or initiate creation of new visual source images.**

This includes:

- new 4 x 4 atlas images;
- standalone sprites;
- replacement textures;
- terrain artwork;
- building artwork;
- NPC artwork;
- props, vegetation, roads, UI artwork, and other production imagery.

Texture Artist must not:

- generate images;
- call or request image-generation tools;
- redraw production artwork;
- synthesize replacement textures;
- procedurally create production artwork;
- create placeholder/fake PNGs to satisfy missing-art requirements;
- substitute SVG/vector-only content for missing PNG artwork.

All new image creation occurs only by explicit Admin order.

Texture Artist is responsible for **discovering newly added Admin-provided visual assets in the project, validating them, preparing approved metadata/derived assets, and applying them correctly to the latest application version**.

If a required visual source image is absent, Texture Artist records the missing Admin input and continues normal worker routing. Absence of artwork is never permission to create it.

---

# 2. Hard production-format rule

Production visual deliverables used by the application must be PNG unless a higher-authority contract explicitly says otherwise.

Allowed project visual outputs include:

- RGBA PNG master atlases supplied/authorized by Admin;
- RGBA PNG tile slices derived from Admin-provided atlases;
- standalone Admin-provided PNG sprites;
- JSON manifests;
- JSON semantic-description metadata;
- Markdown audit/documentation where required.

The following are not valid substitutes for required production artwork:

- SVG/vector-only artwork;
- HTML canvas drawing instructions;
- CSS drawings;
- JSON vector paths;
- placeholder geometry;
- textual descriptions instead of artwork;
- procedural mockups presented as final artwork.

---

# 3. Reusable visual-family rule

Reusable tile-based visual families use one coherent atlas rather than unrelated individually generated images.

Examples include trees, roads, paths, terrain transitions, grass, soil, mud, water, farm fields, fences, walls, roofs, building parts, furniture, props, vegetation, rocks, ruins, and environmental decoration.

The atlas approach preserves consistency in palette, style, perspective, lighting, density, scale, material language, edge treatment, and detail level.

Texture Artist does not author this source atlas. Texture Artist validates and integrates an Admin-provided atlas.

---

# 4. Canonical reusable atlas

Every reusable tile family must retain one canonical master atlas.

Canonical requirements:

- PNG;
- RGBA;
- exact `1024 x 1024 px` after normalization;
- fixed `4 x 4` grid;
- exact logical source cell size `256 x 256 px`;
- 16 cells;
- zero-based row/column metadata;
- default row-major ordering.

The canonical atlas must not intentionally contain labels, numbers, captions, watermarks, UI, debug marks, or artwork crossing cell boundaries.

Visible accidental separator/border lines are tolerated only as source defects because the approved derived-tile workflow removes one pixel from each cell edge. The canonical atlas itself remains retained and unchanged after normalization.

Canonical filename:

`<family>_atlas_1024px.png`

The canonical master remains in the repository and is the authoritative visual source for the family.

---

# 5. Transparent-background rule

When a family is intended as an overlay over another world surface, the atlas must preserve alpha transparency.

Typical transparent families include trees, bushes, roads/path overlays, fences, props, furniture, building-local parts, roof components, and decorative environmental objects.

Pixels outside intended artwork must remain transparent. Unused cells should be fully transparent when the family contract expects unused cells.

Do not bake unrelated terrain into transparent overlay families merely to imitate final runtime composition.

---

# 6. Texture Artist discovery workflow

When entering Texture Artist work, inspect the repository and latest application state for newly added or changed Admin-provided visual assets relevant to the issue.

For each discovered asset family:

1. identify the Admin-provided source/canonical image;
2. identify existing manifest/descriptions metadata, if any;
3. inspect current runtime mappings and whether the latest app actually consumes the asset;
4. validate format, dimensions, alpha/transparency, atlas organization, semantic identity, and destination path;
5. use the approved Tile Atlas Tool where applicable;
6. correct metadata and derived-file structure without altering the artistic content beyond permitted deterministic processing;
7. integrate/register the asset into the latest application version where the issue includes integration;
8. remove/supersede stale asset mappings or obsolete presentation paths where required;
9. record exact evidence in the issue Audit;
10. hand to Tester when integration is complete.

Texture Artist must not spend the cycle attempting image generation.

---

# 7. Whole-atlas normalization rule

Admin-provided atlas source images are not required to arrive at exact 1024 x 1024 dimensions.

Examples such as `1280 x 1280`, `960 x 960`, or another valid coherent atlas size must be normalized automatically by the approved Tile Atlas Tool before slicing.

Required process:

1. load the Admin-provided source as RGBA;
2. normalize the complete source image to exact `1024 x 1024` using the selected approved normalization mode;
3. preserve transparency where applicable;
4. retain the normalized result as `<family>_atlas_1024px.png`;
5. record original dimensions and normalization mode/provenance in metadata/audit;
6. perform all derived slicing from that retained canonical master.

Normalization happens once at complete-atlas level before cell extraction.

---

# 8. Normalization acceptance gate

Before accepting the normalized canonical master, verify that:

- the intended 4 x 4 organization remains valid;
- content remains inside its intended cells;
- important artwork was not lost;
- transparency was preserved where required;
- visual quality remains acceptable;
- semantic identity remains clear.

If normalization materially damages an Admin-provided image, do not redraw or regenerate it. Record the defect and required Admin replacement/correction.

---

# 9. Admin-approved edge-safe derived-tile policy

The previous pure pixel-identical crop rule is superseded by explicit Admin direction.

For every occupied canonical 256 x 256 cell:

1. crop the exact canonical cell using row/column boundaries;
2. remove exactly `1 px` from top, bottom, left, and right;
3. remaining content is exact `254 x 254`;
4. resize that 254 x 254 image back to exact `256 x 256` using LANCZOS;
5. save as RGBA PNG.

This policy applies whether visible border lines exist or not and avoids unreliable border detection.

The canonical 1024 x 1024 atlas is not modified by this per-cell operation.

Do not perform additional per-cell redraw, generation, color changes, artistic edits, shifts, or effects unless Admin explicitly orders them.

---

# 10. Mandatory Tile Atlas Tool use

For reusable 4 x 4 atlas families, use the approved repository Tile Atlas Tool as the normal deterministic processing/publishing boundary.

Current tool responsibilities include:

- normalize arbitrary valid source dimensions to exact 1024 x 1024 RGBA;
- present all 16 cells in row-major order;
- collect/validate metadata for each occupied cell;
- apply the 1 px trim + 254-to-256 LANCZOS edge-safe derived-tile policy;
- produce stable semantic filenames;
- calculate hashes;
- generate/update manifest and descriptions files;
- publish into a checked-out project tree under `textures/tiles/<family>/`.

Texture Artist uses the tool on Admin-provided images; Texture Artist does not use it to create artwork.

---

# 11. Mandatory per-cell metadata

Every occupied cell must have at minimum:

- row;
- column;
- stable semantic type;
- human-readable description.

Current tool schema may additionally include:

- display name;
- category;
- runtime usage/composition role;
- unused flag;
- source provenance;
- border-processing metadata;
- SHA-256.

Duplicate semantic types are invalid within one family.

Unused cells may be explicitly marked unused and omitted from runtime slice emission.

Visual metadata is presentation metadata only and never Simulation authority.

---

# 12. Stable semantic filenames

Each derived tile uses:

`<family>_<semantic-type>_256px.png`

Examples:

`tree_oak_broadleaf_256px.png`

`grass_lush_meadow_256px.png`

Once integrated, semantic filenames should remain stable unless a deliberate migration changes them.

Do not use meaningless production names when semantic identity is known.

---

# 13. Standard repository layout

Unless a specific higher-authority issue defines another valid path, reusable atlas families use:

`textures/tiles/<family>/`

Example:

```text
textures/tiles/tree/
    tree_atlas_1024px.png
    tree_oak_broadleaf_256px.png
    tree_spruce_evergreen_256px.png
    ...
    tree_tiles.manifest.json
    tree_tiles.descriptions.json
```

Canonical atlas, derived slices, manifest, and description metadata belong to the same family.

---

# 14. Structural manifest

Every reusable atlas family must contain:

`<family>_tiles.manifest.json`

The manifest is the runtime-oriented structural registry and must use the current Tile Atlas Tool schema version.

At minimum record:

- schema/version;
- family;
- canonical atlas filename;
- original source dimensions when available;
- normalization mode/provenance;
- atlas width/height;
- grid rows/columns;
- logical source cell size;
- derived border-processing rule;
- row/col for occupied tiles;
- semantic type;
- filename;
- emitted/unused state as applicable;
- SHA-256 when available.

---

# 15. Semantic descriptions metadata

Every reusable atlas family must also contain:

`<family>_tiles.descriptions.json`

Each occupied tile record must include enough human-readable metadata that another worker can understand the visual meaning without reopening the atlas.

At minimum:

- row;
- col;
- semantic type;
- filename;
- description.

Additional display/category/runtime-usage metadata from the current tool schema should be preserved when present.

---

# 16. Metadata consistency rule

For every emitted tile, the following must agree:

- atlas cell;
- row;
- column;
- semantic type;
- filename;
- manifest entry;
- description entry;
- runtime mapping where integrated.

Metadata inconsistencies must be corrected before Tester handoff.

---

# 17. Description metadata is not Simulation authority

Filenames/descriptions/categories/runtime-usage strings do not create authoritative gameplay facts.

They do not by themselves define walkability, harvestability, ownership, resources, profession capability, settlement membership, collision, or interaction legality.

Simulation remains authoritative.

---

# 18. SHA-256 integrity records

When available, calculate SHA-256 for final emitted PNGs and canonical master and record them in the manifest.

Hashes support integrity checking, duplicate/change detection, provenance, and runtime asset verification.

---

# 19. Binary PNG validation

Before handoff, verify actual binary PNG validity rather than trusting file extension alone.

Check as applicable:

- valid PNG signature/decoding;
- expected RGBA mode;
- canonical atlas exact 1024 x 1024;
- derived tiles exact 256 x 256;
- 4 x 4 source organization;
- expected alpha/transparency;
- intended non-empty artwork for occupied cells;
- unused-cell handling;
- matching metadata/hashes.

---

# 20. Texture Artist integration responsibility

Texture Artist must apply newly added Admin-provided textures to the latest application version rather than merely leaving assets in the repository.

Where integration is within scope, Texture Artist must:

- locate current runtime asset registries/mappings;
- add/update semantic mapping for the new family;
- map the family to the correct presentation role/order;
- ensure non-NPC assets enter the shared static 100 x 100 tile-composition path;
- preserve NPC dynamic presentation exception;
- remove obsolete fallback/placeholder mappings superseded by the Admin asset when safe and within scope;
- verify the latest app actually references the new family;
- record changed runtime files and checks.

If separate substantial programming work is genuinely required beyond bounded asset registration/integration, hand the same atomic issue or a dependent issue to Game Programmer according to `ISSUE_STANDARD.md`.

---

# 21. Static composition contract

Except for NPC world sprites, non-NPC visual assets must follow `.github/STATIC_TILE_COMPOSITION_STANDARD.md`.

Reusable 256 x 256 source tiles are scaled/composited into exact 100 x 100 logical static presentation composites at runtime. They must not create permanent independent world-image layers unless Admin explicitly grants a named exception.

---

# 22. Texture Artist audit requirements

For reusable family integration, issue Audit must record as applicable:

- Admin-provided source asset path;
- source dimensions;
- canonical atlas path;
- normalization mode and whether normalization was required;
- semantic cell map;
- every emitted slice path;
- manifest path;
- descriptions path;
- SHA-256 values when available;
- runtime files/mappings changed;
- intended 100 x 100 composition role/order;
- whether legacy mappings were removed/superseded;
- checks actually performed;
- next role.

Never state that Texture Artist generated the artwork.

---

# 23. Handoff rule

Texture Artist may hand an Admin-provided reusable family forward only when applicable outputs/checks exist:

- canonical 1024 x 1024 RGBA atlas;
- 256 x 256 edge-safe derived PNG tiles;
- truthful current-schema manifest;
- truthful descriptions metadata;
- runtime mapping/integration completed when in scope;
- issue Audit with actual evidence.

If only independent verification remains, hand to:

`Role: Tester`, `Claim: NONE`, `Status: VERIFY`, `Next: Tester`.

If separate coding remains, route to Game Programmer with a concrete bounded next step; Game Programmer later hands to Tester.

---

# 24. Missing-artwork rule

A Texture Artist issue requiring artwork that Admin has not yet supplied must not be treated as permission to create that artwork.

The worker must:

1. verify the asset is genuinely absent;
2. record the exact missing Admin input in Audit/Next;
3. avoid placeholders or substitutes;
4. complete any independent integration/cleanup work still possible within scope;
5. continue normal worker routing after the current valid claim is resolved according to `ISSUE_STANDARD.md`.

Do not use `BLOCKED` status.

---

# 25. Tester verification gate

Tester independently verifies:

- source artwork is Admin-provided/authorized;
- no worker-generated replacement image was introduced;
- canonical atlas geometry and RGBA format;
- source-size normalization where applicable;
- 1 px edge trim + 254-to-256 LANCZOS policy on derived tiles;
- final PNG dimensions and hashes;
- semantic metadata consistency;
- runtime use of the intended asset family;
- static 100 x 100 composition compliance for non-NPC imagery;
- absence of improper legacy/fallback presentation when superseded;
- no Simulation authority moved into visual metadata.

Tester must FAIL the issue if a required production image was created by a worker contrary to the Admin-only image creation rule.

---

# 26. Precedence and maintenance

Explicit Admin direction wins over this file. README product truth wins over subordinate operational material when Admin has not explicitly overridden it.

Do not modify README to make it conform to this standard.

Do not restore Texture Artist image-generation responsibility unless Admin explicitly changes this rule.