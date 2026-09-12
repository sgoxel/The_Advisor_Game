# Texture Artist PNG Atlas Standard

## Authority and scope

This operational standard defines the mandatory production workflow for visual assets created, corrected, integrated, routed, or verified through the Texture Artist role.

Authority remains:

**Admin > README.md > ROADMAP.md > TODO > issues > code/assets > tests.**

README product truth remains authoritative.

This file defines implementation and production HOW. It must not override README or explicit Admin direction.

This standard applies to:

- reusable tile families;
- terrain and environmental artwork;
- roads and paths;
- vegetation;
- trees;
- buildings and building parts;
- furniture and props;
- visual world objects;
- standalone PNG sprites;
- atlas metadata;
- application integration of Texture Artist output;
- verification of Texture Artist output.

The production workflow must be:

- reproducible;
- deterministic;
- auditable;
- usable by Routine workers;
- suitable for application integration;
- independently verifiable by Tester.

---

# 1. Hard production-format rule

Texture Artist runtime visual deliverables must be PNG.

Allowed production outputs include:

- RGBA PNG master atlases;
- RGBA PNG tile slices;
- standalone PNG sprites;
- JSON manifests;
- JSON semantic-description metadata;
- Markdown audit/documentation where required.

The following are not valid completed Texture Artist runtime artwork:

- SVG;
- vector-only artwork;
- HTML canvas drawing instructions;
- CSS drawings;
- JSON vector paths;
- placeholder geometry;
- textual descriptions instead of required artwork;
- procedural mockups presented as final artwork.

SVG/vector-only output must never be treated as completed Texture Artist production.

SVG/vector-only output must never be handed to Tester as completed visual work.

Existing SVG artwork does not satisfy a new or corrected PNG asset requirement.

Standalone sprites that do not require an atlas must also be PNG at the dimensions required by their issue/runtime contract.

---

# 2. Reusable visual-family rule

A reusable tile-based visual family must normally be produced as one coherent atlas rather than as unrelated individually generated images.

Examples include:

- trees;
- roads;
- paths;
- terrain transitions;
- grass;
- soil;
- mud;
- water;
- farm fields;
- fences;
- walls;
- roofs;
- building parts;
- furniture;
- props;
- vegetation;
- rocks;
- ruins;
- environmental decoration.

The atlas approach exists to preserve consistency in:

- palette;
- style;
- perspective;
- lighting;
- visual density;
- scale;
- material language;
- edge treatment;
- detail level.

---

# 3. Canonical reusable atlas

Every reusable tile-based visual family must have one retained canonical master atlas.

The canonical atlas requirements are:

- format: PNG;
- color mode: RGBA;
- exact width: `1024 px`;
- exact height: `1024 px`;
- grid: `4 x 4`;
- exact cell width: `256 px`;
- exact cell height: `256 px`;
- total cells: `16`;
- metadata row/column indexing: zero-based;
- default ordering: left-to-right, top-to-bottom.

The atlas must not contain:

- visible grid lines;
- labels;
- numbers;
- captions;
- cell borders;
- debug marks;
- watermarks;
- UI;
- artwork intentionally crossing cell boundaries.

The retained canonical master filename must be:

`<family>_atlas_1024px.png`

Example:

`tree_atlas_1024px.png`

The canonical master must remain in the repository.

It is the authoritative visual source for deterministic slicing of that family.

---

# 4. Transparent-background rule

When a family is intended to be composited over another world surface, the atlas background must use alpha transparency.

Typical transparent families include:

- trees;
- bushes;
- road/path overlays;
- fences;
- props;
- furniture;
- building-local parts;
- roof components;
- decorative environmental objects.

Pixels outside intended artwork must remain transparent.

Unused cells must be fully transparent across the complete `256 x 256` cell:

`alpha = 0`

Do not bake unrelated terrain into transparent overlay families merely to imitate the final runtime composition.

The runtime composition system owns base + overlay combination.

---

# 5. Semantic cell planning

Before generating a reusable atlas, define the semantic meaning of each intended occupied cell.

Use row-major ordering unless an existing compatible manifest defines another stable order.

Example:

| Row | Col | Semantic tile |
| --- | --- | --- |
| 0 | 0 | oak_broadleaf |
| 0 | 1 | spruce_evergreen |
| 0 | 2 | willow_drooping |
| 0 | 3 | cherry_blossom |
| 1 | 0 | apple_fruit |
| 1 | 1 | birch_yellow |
| 1 | 2 | maple_green |
| 1 | 3 | pine_windswept |
| 2 | 0 | sapling_light |
| 2 | 1 | elder_gnarled |
| 2 | 2 | oak_autumn |
| 2 | 3 | blossom_white |
| 3 | 0 | bushy_multi_stem |
| 3 | 1 | poplar_columnar |
| 3 | 2 | spruce_snow |
| 3 | 3 | dead_leafless |

Different families may use different semantic names.

The canonical atlas geometry does not change.

---

# 6. Mandatory image-generation workflow

When new artwork is required and image-generation capability is available, Texture Artist must actively use it rather than replacing required artwork with placeholders or descriptions.

The normal reusable-family workflow is:

1. define the semantic cell map;
2. generate one coherent family image;
3. preserve transparency where required;
4. inspect the generated source;
5. normalize the complete accepted source to exact `1024 x 1024 RGBA` when required;
6. retain the normalized canonical master;
7. slice the canonical master deterministically into exact `256 x 256` PNG files;
8. generate structural manifest metadata;
9. generate semantic description metadata;
10. calculate hashes when available;
11. validate PNG files;
12. commit the complete family to the repository;
13. hand the work to Game Programmer when runtime integration remains;
14. hand the final integrated result to Tester.

Generation instructions should request, as applicable:

- game-ready medieval-fantasy artwork;
- consistency with existing game art;
- one coherent 4 x 4 family;
- one semantic variant per cell;
- transparent background where required;
- no labels;
- no text;
- no grid lines;
- no borders;
- no watermark;
- no UI;
- consistent perspective;
- consistent scale;
- consistent lighting;
- consistent palette;
- consistent material language;
- every item fully contained in its intended cell.

---

# 7. Generated-image normalization rule

Image-generation systems are not required to return exact requested pixel dimensions on the first generation.

A visually valid source image that is not already exact `1024 x 1024` must not cause the Texture Artist to abandon the task.

Instead, the whole accepted source atlas must be normalized once to the canonical dimensions.

Required process:

1. load the generated source as RGBA;
2. resize/normalize the complete source atlas to exact `1024 x 1024`;
3. preserve transparency;
4. save the result as:
   `<family>_atlas_1024px.png`;
5. use only that retained canonical master for final slicing;
6. record the original dimensions and normalization in the issue Audit.

Example:

Generated source:

`1254 x 1254 RGBA`

Canonical retained atlas:

`1024 x 1024 RGBA`

Final grid:

`4 x 4`

Final cells:

`256 x 256`

Normalization happens once at the complete-atlas level.

Do not resize individual final slices separately.

Do not regenerate individual final slices independently after the canonical master has been accepted.

---

# 8. Normalization acceptance gate

Normalization is permitted only when the source already represents the intended coherent atlas.

Before accepting the normalized master, inspect that:

- the intended 4 x 4 organization remains valid;
- each visual item remains inside its intended cell;
- important artwork was not lost;
- transparency was preserved;
- visual quality remains acceptable;
- visual style remains coherent;
- semantic identity remains clear.

If normalization materially damages the artwork, regenerate the source atlas instead of accepting a damaged master.

---

# 9. Deterministic slicing

Every final reusable tile PNG must be exported from the retained canonical atlas by exact pixel crop.

For:

`row`

and:

`col`

use:

`left = col * 256`

`top = row * 256`

`right = left + 256`

`bottom = top + 256`

The result must be exactly:

`256 x 256 px`

and saved as PNG.

During slicing, do not:

- resize;
- resample;
- redraw;
- regenerate;
- stretch;
- shift artwork;
- crop inside the cell;
- alter aspect ratio;
- apply per-slice color changes;
- apply per-slice effects.

A final slice must be pixel-identical to the corresponding `256 x 256` region of the retained canonical atlas.

---

# 10. Stable semantic filenames

Each final sliced tile must use:

`<family>_<semantic-type>_256px.png`

Examples:

`tree_oak_broadleaf_256px.png`

`tree_spruce_evergreen_256px.png`

`tree_dead_leafless_256px.png`

Use stable semantic names.

Do not use meaningless production names such as:

- `tile01.png`
- `output3.png`
- `generated7.png`
- `final_new2.png`

when a semantic identity is known.

Once integrated, semantic filenames should remain stable unless a deliberate migration changes them.

---

# 11. Standard repository layout

Unless a specific issue defines another valid path, reusable atlas families must use:

`textures/tiles/<family>/`

Example:

~~~text
textures/tiles/tree/
    tree_atlas_1024px.png

    tree_oak_broadleaf_256px.png
    tree_spruce_evergreen_256px.png
    tree_willow_drooping_256px.png
    tree_cherry_blossom_256px.png

    tree_apple_fruit_256px.png
    tree_birch_yellow_256px.png
    tree_maple_green_256px.png
    tree_pine_windswept_256px.png

    tree_sapling_light_256px.png
    tree_elder_gnarled_256px.png
    tree_oak_autumn_256px.png
    tree_blossom_white_256px.png

    tree_bushy_multi_stem_256px.png
    tree_poplar_columnar_256px.png
    tree_spruce_snow_256px.png
    tree_dead_leafless_256px.png

    tree_tiles.manifest.json
    tree_tiles.descriptions.json
~~~

The canonical atlas, slices, manifest, and description metadata belong to the same family.

---

# 12. Mandatory structural manifest

Every reusable atlas family must contain:

`<family>_tiles.manifest.json`

The manifest is the structural/runtime-oriented registry.

Minimum structure:

~~~json
{
  "version": 1,
  "family": "tree",
  "atlas": {
    "filename": "tree_atlas_1024px.png",
    "width": 1024,
    "height": 1024,
    "columns": 4,
    "rows": 4,
    "cellSize": 256
  },
  "tiles": [
    {
      "row": 0,
      "col": 0,
      "type": "oak_broadleaf",
      "filename": "tree_oak_broadleaf_256px.png",
      "sha256": "..."
    }
  ]
}
~~~

The manifest must record:

- version;
- family;
- atlas filename;
- atlas width;
- atlas height;
- columns;
- rows;
- cell size.

For every occupied runtime tile it must record:

- row;
- col;
- semantic type;
- filename;
- SHA-256 when available.

Unused transparent cells do not need runtime tile entries unless explicitly required.

---

# 13. Mandatory semantic-description metadata

Every reusable atlas family must also contain:

`<family>_tiles.descriptions.json`

This file stores human-readable semantic information.

Minimum structure:

~~~json
{
  "version": 1,
  "family": "tree",
  "descriptionFilePurpose": "Human-readable semantic descriptions for each tree tile in the canonical 4x4 tree atlas.",
  "tiles": [
    {
      "row": 0,
      "col": 0,
      "type": "oak_broadleaf",
      "filename": "tree_oak_broadleaf_256px.png",
      "description": "Large broadleaf oak-like tree with a dense rounded green canopy and thick gnarled trunk."
    }
  ]
}
~~~

Every description record must include:

- row;
- col;
- type;
- filename;
- description.

Descriptions should be concise but sufficiently clear that another worker can understand the visible meaning of the tile without reopening the atlas.

---

# 14. Metadata consistency rule

For every tile, the following must agree:

- atlas cell;
- row;
- column;
- semantic type;
- PNG filename;
- manifest entry;
- description entry.

Example:

~~~text
Atlas cell:
row 0, col 0

Manifest:
oak_broadleaf

Description:
oak_broadleaf

File:
tree_oak_broadleaf_256px.png
~~~

They must all refer to the same visual asset.

---

# 15. Description metadata is not Simulation authority

Descriptions and filenames are presentation metadata.

They must not create authoritative gameplay facts.

For example:

`tree_apple_fruit_256px.png`

does not by itself prove that a world tile:

- contains harvestable apples;
- produces food;
- owns resources;
- is interactable;
- is blocked or walkable;
- belongs to a profession;
- belongs to a settlement.

Simulation remains authoritative.

Visual metadata helps presentation systems select artwork.

It does not create world truth.

---

# 16. SHA-256 integrity records

When the execution environment can calculate hashes, calculate SHA-256 for every final `256 x 256` PNG and record it in the manifest.

SHA-256 supports:

- integrity checking;
- duplicate detection;
- change detection;
- provenance;
- runtime asset verification.

A regenerated or modified tile must receive the SHA-256 of the actual final PNG.

---

# 17. Binary PNG validation

Before handoff, verify the final assets are actual PNG binary files.

Do not trust the `.png` filename extension alone.

Verify as applicable:

- valid PNG signature;
- image decodes successfully;
- expected image mode;
- alpha channel where required;
- correct dimensions;
- intended non-empty artwork;
- transparency where required.

For reusable atlas families:

Master:

`1024 x 1024`

Slices:

`256 x 256`

Grid:

`4 x 4`

---

# 18. Mandatory capability-attempt rule

Texture Artist must not declare required visual production capability unavailable merely because one preferred shortcut or one tool action is unavailable.

Before recording a capability limitation for reusable atlas work, the worker must actually attempt every relevant available part of the bounded production path.

This includes, where available:

1. image generation;
2. local image processing;
3. RGBA conversion;
4. whole-atlas normalization;
5. deterministic slicing;
6. PNG decoding/validation;
7. SHA-256 calculation;
8. manifest generation;
9. description metadata generation;
10. binary repository upload;
11. repository tree creation;
12. repository commit creation;
13. target branch/ref update;
14. committed-file verification.

A limitation may be recorded only after the required available path has actually been attempted and a real technical failure or missing capability has been observed.

Do not infer capability absence from the failure or limitation of a different tool.

---

# 19. GitHub binary-upload rule

A UTF-8 text-file API is not a valid test of whether PNG upload capability exists.

If a normal text `create_file` or `update_file` action cannot accept PNG bytes, the worker must use the available binary-capable GitHub object workflow.

The expected conceptual path is:

~~~text
Generated/local PNG
        ↓
Read actual PNG bytes
        ↓
Base64 encode for binary blob transport when required
        ↓
Create GitHub blob
        ↓
Create tree using blob SHA
        ↓
Create commit
        ↓
Update target branch/ref
        ↓
Fetch/verify committed PNG
~~~

When the available GitHub connector exposes operations equivalent to:

- `create_blob`;
- `create_tree`;
- `create_commit`;
- `update_ref`;

the worker must attempt that path before declaring repository PNG upload unavailable.

Do not treat:

"UTF-8 create_file cannot write PNG"

as:

"GitHub cannot store PNG."

Those are different claims.

---

# 20. Binary repository integrity rule

PNG assets committed through GitHub object APIs must remain actual binary PNG files.

Do not commit:

- base64 text pretending to be a `.png`;
- JSON containing image bytes instead of the PNG;
- Markdown-embedded image data instead of the runtime file.

Base64 may be used only as the transport encoding required to create the binary blob.

The repository object at the final `.png` path must decode as an actual PNG.

---

# 21. Post-commit verification

After committing PNG assets, verify the repository state when the execution surface permits.

At minimum verify:

- expected path exists;
- repository object is present;
- expected filename is correct;
- committed file can be read/fetched;
- PNG remains binary;
- dimensions remain correct;
- manifest filename matches;
- descriptions filename matches;
- SHA-256 remains correct when practical.

Do not claim repository completion based only on local temporary files.

---

# 22. Existing road-family reference

The existing road family remains a structural reference for semantic atlas mapping.

Reference:

`textures/tiles/road/road_tiles.manifest.json`

New families should preserve the same deterministic mapping principles while using family-specific semantic tile names.

The descriptions metadata file extends the established structural model with human-readable semantic information.

---

# 23. Runtime integration principles

Visual asset existence alone does not complete an integration task.

When application integration is in scope, the application must actually select and render the intended PNG assets.

Runtime registry/loader references must point to:

- final PNG slices; or
- an explicitly supported canonical PNG atlas path.

Artwork remains presentation data.

Artwork must not become authority for:

- collision;
- walkability;
- route semantics;
- profession;
- NPC identity;
- building identity;
- resource ownership;
- Simulation state.

---

# 24. Mandatory 100 x 100 static composition

Except for NPC world sprites, final reusable PNG slices are source artwork.

They are not persistent independent world-image objects.

All applicable non-NPC world art must obey:

`.github/STATIC_TILE_COMPOSITION_STANDARD.md`

This includes:

- terrain transitions;
- roads;
- paths;
- buildings;
- walls;
- floors;
- roofs;
- trees;
- vegetation;
- furniture;
- props;
- resources;
- ruins;
- environmental artwork.

The standard runtime process is:

1. resolve authoritative logical terrain/base;
2. select the required transparent source PNG;
3. scale/compose it into the exact `100 x 100` logical tile composition surface;
4. let transparent pixels reveal already-resolved lower layers;
5. flatten the result into one exact `100 x 100 RGBA` static tile;
6. send that final composite through the shared static/background presentation path.

Example:

~~~text
grass base
    +
tree_oak_broadleaf_256px.png
    ↓
100 x 100 grass+tree composite
    ↓
shared static world presentation
~~~

The tree source PNG must not remain as an independent persistent tree layer.

---

# 25. Multi-tile object rule

Large buildings and other multi-tile objects may retain multi-tile authoritative Simulation footprints.

Their presentation must still be tile-local.

Texture Artist should provide suitable semantic parts such as:

- corners;
- edges;
- wall sections;
- roof parts;
- entrances;
- doors;
- center parts;
- transition pieces.

Each covered logical tile selects the appropriate source PNG and produces its own final `100 x 100` runtime composite.

Do not replace this model with one permanent giant building overlay unless explicitly authorized.

---

# 26. NPC exception

NPC world sprites are the normal dynamic exception to the static composition rule.

NPC PNG sprites may remain independent dynamic world-space presentation objects because NPC movement and interpolation require frequent visual updates.

This exception does not automatically apply to:

- trees;
- roads;
- buildings;
- props;
- furniture;
- vegetation;
- static animals;
- environmental decoration.

Any additional named exception requires explicit project authority.

---

# 27. Texture Artist audit requirements

For every reusable atlas-family issue, the Texture Artist Audit must record actual evidence.

Use the normal project Audit structure:

~~~text
Purpose:
Change:
Refs:
Checks:
Result:
Risks:
Next:
~~~

For reusable visual-family work, include as applicable:

- generated source details;
- original generated dimensions;
- whether normalization was required;
- canonical atlas path;
- canonical atlas dimensions;
- semantic cell map;
- every final slice path;
- manifest path;
- descriptions path;
- SHA-256 values;
- PNG validation results;
- transparency checks;
- binary repository commit result;
- committed repository paths;
- integration requirement;
- next role handoff.

Never invent evidence.

---

# 28. Texture Artist handoff gate

Texture Artist may hand a reusable visual-family issue forward only when all applicable requirements are satisfied.

Required checks:

1. No required visual deliverable is SVG/vector-only.
2. Canonical master exists as exact `1024 x 1024` PNG.
3. Master is RGBA where transparency is required.
4. Master uses exact `4 x 4` geometry.
5. Every final cell is exact `256 x 256`.
6. Required semantic variants exist.
7. Unused cells are transparent where applicable.
8. Every slice comes from exact canonical atlas crop.
9. No final slice was independently regenerated after canonicalization.
10. Stable semantic filenames are used.
11. Structural manifest exists.
12. Semantic descriptions file exists.
13. Manifest mappings are truthful.
14. Description mappings are truthful.
15. SHA-256 is recorded when available.
16. PNG files were actually validated.
17. Visual style was inspected.
18. Family consistency was inspected.
19. Normalization was recorded if used.
20. Binary repository commit was completed when repository persistence is in scope.
21. Repository paths were verified when possible.
22. Runtime composition requirements are documented.
23. Issue Audit contains actual evidence.

File existence alone is not sufficient for visual PASS.

---

# 29. Texture Artist to Game Programmer handoff

When artwork is complete but application integration remains, the normal handoff is:

`Texture Artist -> Game Programmer`

Set:

~~~text
Role: Game Programmer
Claim: NONE
Status: READY
Next: Game Programmer
~~~

The Texture Artist Audit must provide:

- family name;
- atlas path;
- manifest path;
- descriptions path;
- semantic slice paths;
- intended runtime selection behavior;
- intended static composition behavior.

Texture Artist must not close the issue.

---

# 30. Texture Artist to Tester handoff

If runtime integration is not required or was already completed and only independent verification remains, hand off as:

~~~text
Role: Tester
Claim: NONE
Status: VERIFY
Next: Tester
~~~

Texture Artist must not set `DONE`.

Only Tester may final-close after independent PASS.

---

# 31. Game Programmer integration gate

When Game Programmer receives a visual-family integration task, the implementation should use the provided semantic metadata instead of arbitrary hard-coded atlas positions when manifest data is available.

Game Programmer should, as applicable:

1. read the family manifest;
2. resolve the semantic tile;
3. load the matching PNG;
4. preserve Simulation authority;
5. route non-NPC visuals through exact `100 x 100` static composition;
6. avoid duplicate persistent visual layers;
7. preserve deterministic asset selection;
8. run actual checks;
9. record Audit evidence;
10. hand the result to Tester.

The descriptions file may support debugging and documentation.

It must not become authoritative Simulation logic.

---

# 32. Tester verification gate

Tester must independently verify the actual produced visual family and, where applicable, runtime integration.

Verify as applicable:

- valid PNG signature;
- actual image decodability;
- exact `1024 x 1024` master;
- expected RGBA/alpha;
- exact `4 x 4` layout;
- exact `256 x 256` cells;
- transparent unused cells;
- exact slice dimensions;
- slice-to-atlas pixel identity;
- correct row/column mapping;
- stable semantic filenames;
- manifest correctness;
- descriptions correctness;
- SHA-256 correctness;
- metadata/file consistency;
- absence of SVG production assets;
- visual style consistency;
- scale consistency;
- perspective consistency;
- seams/edge behavior;
- intended runtime rendering;
- correct semantic asset selection;
- correct `100 x 100` non-NPC static composition;
- absence of obsolete persistent static presentation layers.

If the source required normalization, Tester must verify that final slices derive from the retained normalized canonical master rather than from independently generated tile files.

---

# 33. Tester PASS / FAIL routing

## PASS

Tester must:

- record actual verification evidence;
- clear Claim;
- set `Status: DONE`;
- close the issue.

## FAIL

Tester must:

- record concrete failure evidence;
- not close the issue;
- clear Claim;
- change Role to the responsible correction role;
- set `Status: READY`;
- set the exact next step.

Examples:

Visual production problem:

`Tester -> Texture Artist`

Runtime integration problem:

`Tester -> Game Programmer`

After correction, the same issue returns as:

~~~text
Role: Tester
Claim: NONE
Status: VERIFY
Next: Tester
~~~

---

# 34. Successful tree-atlas reference workflow

The proven tree-atlas workflow is the reference production pattern for new reusable visual families.

The process is:

~~~text
Define 16 semantic variants
        ↓
Generate one coherent 4 x 4 transparent family image
        ↓
Inspect source
        ↓
Normalize whole source to exact 1024 x 1024 RGBA if needed
        ↓
Retain canonical master
        ↓
Exact deterministic 256 x 256 slicing
        ↓
Stable semantic filenames
        ↓
SHA-256
        ↓
Structural manifest
        ↓
Human-readable descriptions metadata
        ↓
Validate PNG binary output
        ↓
Commit binary PNGs to GitHub
        ↓
Verify committed files
        ↓
Game Programmer runtime integration when required
        ↓
100 x 100 static composition for non-NPC world art
        ↓
Independent Tester verification
~~~

A compliant tree family may contain:

~~~text
textures/tiles/tree/
    tree_atlas_1024px.png

    tree_oak_broadleaf_256px.png
    tree_spruce_evergreen_256px.png
    tree_willow_drooping_256px.png
    tree_cherry_blossom_256px.png

    tree_apple_fruit_256px.png
    tree_birch_yellow_256px.png
    tree_maple_green_256px.png
    tree_pine_windswept_256px.png

    tree_sapling_light_256px.png
    tree_elder_gnarled_256px.png
    tree_oak_autumn_256px.png
    tree_blossom_white_256px.png

    tree_bushy_multi_stem_256px.png
    tree_poplar_columnar_256px.png
    tree_spruce_snow_256px.png
    tree_dead_leafless_256px.png

    tree_tiles.manifest.json
    tree_tiles.descriptions.json
~~~

---

# 35. Invalid completion cases

The following must not be treated as completed reusable Texture Artist work:

- only a prompt exists;
- only an image-generation preview exists;
- only an SVG exists;
- only a source image exists without canonical master;
- source dimensions are non-canonical and were not normalized;
- no deterministic slices exist;
- slices were independently regenerated;
- slice dimensions are incorrect;
- manifest is missing;
- descriptions metadata is missing;
- semantic filenames conflict with metadata;
- repository `.png` files actually contain text/base64 instead of PNG binary;
- transparency requirements are violated;
- runtime integration still uses obsolete vector assets;
- non-NPC artwork remains as prohibited persistent world layers;
- binary repository upload was declared impossible without attempting the available binary GitHub workflow;
- required independent Tester verification has not occurred.

---

# 36. Capability limitation handling

A genuine capability limitation must be recorded truthfully.

However, workers must distinguish between:

- a preferred shortcut being unavailable;
- and the required capability actually being unavailable.

Use another available compliant method when it produces the required result.

Examples:

Generated source is not exact `1024 x 1024`:

`normalize the whole atlas`

Text-file API cannot write PNG:

`use GitHub binary blob/tree/commit/ref workflow`

Individual generated tiles are inconsistent:

`generate one coherent atlas and slice it`

One-step image export is unavailable:

`use local deterministic processing`

Do not substitute SVG.

Do not falsely claim completion.

Do not falsely claim capability absence.

Do not return an issue to READY merely because the first attempted shortcut was unsuitable.

---

# 37. Final production invariant

For reusable Texture Artist tile families, the canonical production invariant is:

**One coherent visual family -> one retained exact 1024 x 1024 RGBA master atlas -> fixed 4 x 4 grid -> exact deterministic 256 x 256 PNG slices -> stable semantic filenames -> structural manifest -> human-readable descriptions metadata -> binary repository commit -> runtime integration -> independent Tester verification.**

For non-NPC world presentation:

**Semantic PNG source -> authoritative base resolution -> exact 100 x 100 static composition -> shared world presentation.**

Artwork is presentation.

Simulation remains authority.
