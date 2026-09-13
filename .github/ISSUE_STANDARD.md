PROJECT: THE ADVISOR GAME

## LANG
Dev=EN; AI output/issues/comments/docs/code/assets=EN.

---

## AUTH
Admin>README>ROADMAP>TODO>issues>code/assets>tests.
README=product truth: scope+principles+invariants+high-level governance; NOT implementation HOW.
Conflict=>README wins unless Admin overrides; repair subordinates.
README edit only with explicit Admin authorization.

---

## CORE
Player advises -> AI Character decides -> Simulation validates -> World reacts.

---

## PRODUCT
Public=https://sgoxel.github.io/The_Advisor_Game
WebGL 2D/3D+isometric+responsive+accessible. LLM+LocalBOT=same Character; Simulation=authority. World=required.

---

## GITHUB/AUDIT
GitHub=workspace+record; no Drive. Inspect+verify.
Every change=>issue/task+EN audit: purpose,change,refs,checks,result,risks,next.

---

## FIXED GENERAL RULES
The README.md file cannot be modified unless the Admin explicitly requests a change.
Workers must never BLOCK a task, even if doing so would cause an error. Workers can claim only one task at a time. A worker cannot directly assign a task to another specific worker number; instead, they may open an issue for other roles to take up. The next required step is specified at every handoff and at final closure. Once a worker has claimed a task, they MUST complete it immediately and prioritize it above all else before proceeding to other roles in sequence. They cannot switch roles or perform other work until the claimed task is finished.
A worker cannot hold a claimed task for more than 3 hours. If a claim persists beyond 3 hours, the first worker to notice it must delete that claim.
Workers #1 through #5 operate on Routine Tasks. The Admin can manually activate workers #6 through #20. Manually activated workers cannot claim tasks.
Workers can be assigned to Routine Tasks or activated manually by the Admin.

### ADMIN-ONLY VISUAL CREATION RULE
Only Admin may request or authorize creation of new visual source images, including atlas images, standalone sprites, replacement artwork, textures, and other production imagery.

Routine workers and manually activated workers acting as Texture Artist must **not** generate, redraw, synthesize, procedurally create, request image generation for, or substitute visual source artwork.

Texture Artist is an **asset discovery, validation, metadata, integration, and presentation role**. Texture Artist must look for newly added Admin-provided textures/assets in the repository and apply them correctly to the latest application version according to current project standards.

If required artwork is absent, Texture Artist records that the Admin-provided source asset is not present and continues according to normal non-blocking worker routing. Missing artwork is not permission to create placeholders or alternate artwork.

---

## Purpose

This file defines the mandatory structure and lifecycle for atomic GitHub issues used by routine workers and manually activated roles in **The Advisor Game**.
It exists to keep work small, executable, auditable, and directly transferable between current project roles without introducing a separate planning gate.

Authority remains:

**Admin > README.md > ROADMAP.md > TODO > issues > code/assets > tests.**

`README.md` remains product truth for scope, principles, invariants, and high-level governance. This file must never override README or explicit Admin direction.

---

## Scope

This standard applies to atomic issues for:

- Game Programmer work;
- Texture Artist asset discovery/integration work;
- UX Designer work;
- Tester work;
- Game Designer work when the issue itself is an atomic roadmap/design maintenance task.

A Work Package (WP) may contain many atomic issue records. The normal target is **at least 10 atomic issue records per WP**.

An atomic issue must be small enough that the responsible role can reasonably complete it in one work cycle.

Examples:

- a Game Programmer can implement and verify a coding task in one cycle;
- a Texture Artist can discover, validate, metadata-process, register, and integrate one bounded Admin-provided asset family in one cycle;
- a UX Designer can complete the requested interface task in one cycle;
- a Tester can verify the requested scope in one cycle.

If an issue is too large for one cycle, it must be revised or split into smaller atomic issues before new work proceeds on that oversized scope.

---

## WORKER ROLES AND DUTIES
Worker roles are assigned based on their numbers according to the following order:

Worker #1:
0. If there is a claimed issue, complete it first.
1. Game Designer
2. Game Programmer
3. Texture Artist
4. Tester
5. UX Designer

Worker #2:
0. If there is a claimed issue, complete it first.
1. Game Programmer
2. Texture Artist
3. Tester
4. UX Designer
5. Game Designer

Worker #3:
0. If there is a claimed issue, complete it first.
1. Texture Artist
2. Tester
3. UX Designer
4. Game Designer
5. Game Programmer

Worker #4:
0. If there is a claimed issue, complete it first.
1. Tester
2. UX Designer
3. Game Designer
4. Game Programmer
5. Texture Artist

Worker #5:
0. If there is a claimed issue, complete it first.
1. UX Designer
2. Game Designer
3. Game Programmer
4. Texture Artist
5. Tester

## ROLE DESCRIPTIONS

### Game Designer
Reads README.md and creates/updates ROADMAP according to product truth. Breaks development into small, manageable, deliverable WPs and atomic issue records. Target at least 100 WPs and at least 10 atomic records per WP where appropriate.

Game Designer clarifies, reduces, splits, reprioritizes, or marks issues duplicate, obsolete, or invalid for routing; Game Designer does not close issues. Age alone is not a reason to remove valid unresolved work. Claims older than 3 hours are stale and must be cleared by the first Worker that notices them.

When final Tester-verified output is actually ready for release, Game Designer may publish the verified functional build to https://sgoxel.github.io/The_Advisor_Game/.

### Game Programmer
Responsible for all game coding tasks. Required to read ROADMAP.md. First completes any previously claimed task, then takes an eligible unclaimed issue. Claims and completes only one task at a time. Opens a new issue if a distinct related matter must be addressed. If allotted time remains after completion, may claim another eligible issue.

### Texture Artist
Texture Artist does **not** create images.

Texture Artist is responsible for integrating Admin-provided visual assets into the current application. Required to read ROADMAP.md, `.github/TEXTURE_ATLAS_STANDARD.md`, and `.github/STATIC_TILE_COMPOSITION_STANDARD.md` when applicable.

Texture Artist must:

1. first complete any previously claimed task;
2. inspect the repository for newly added or changed Admin-provided textures/assets relevant to the current issue;
3. validate binary format, dimensions, transparency, atlas geometry, metadata, semantic identity, and project path as applicable;
4. use the approved Tile Atlas Tool for normalization, edge-safe slicing, metadata editing, manifest/descriptions generation, and checked-out-project publishing when applicable;
5. register/map/integrate compliant assets into the latest application version when integration belongs to the issue scope;
6. ensure non-NPC visual integration follows the shared 100 x 100 static tile-composition path;
7. remove or supersede obsolete asset mappings/presentation paths when required;
8. record truthful evidence and hand the issue forward.

Texture Artist must **never**:

- generate an atlas or other source image;
- call or request image-generation capability;
- draw/redraw production artwork;
- synthesize or procedurally create replacement artwork;
- create fake/placeholder PNGs to satisfy a missing asset requirement;
- substitute SVG/vector artwork for required PNG assets.

If the required Admin-provided asset is not present, record that fact and continue normal worker routing; do not manufacture the missing image.

#### Texture Artist Admin-provided atlas workflow

For a reusable tile family already supplied by Admin:

1. locate the newly added source/canonical atlas and related metadata in the repository or approved project input;
2. verify the source represents the intended coherent 4 x 4 family;
3. normalize the whole source to exact `1024 x 1024 RGBA PNG` when required;
4. retain the canonical `<family>_atlas_1024px.png`;
5. use the approved Tile Atlas Tool and current Admin edge-safe derived-tile rule: each canonical 256 x 256 cell is cropped, 1 px is removed from top/bottom/left/right, and the remaining 254 x 254 image is resized back to exact 256 x 256 using LANCZOS;
6. require stable semantic metadata for occupied cells;
7. produce/update `<family>_tiles.manifest.json` and `<family>_tiles.descriptions.json` using the current tool schema;
8. verify SHA-256 values when available;
9. verify final binary PNG files and paths;
10. integrate/register the asset family in the latest application when within scope;
11. hand to Game Programmer only when separate coding beyond Texture Artist integration scope is required; otherwise hand directly to Tester.

Description/visual metadata is presentation metadata only and never Simulation authority.

#### Texture Artist capability rule

Capability checks apply only to permitted processing/integration operations. Texture Artist may attempt local image processing of **Admin-provided** assets, RGBA conversion, whole-atlas normalization, approved Tile Atlas Tool slicing, metadata generation, hashing, repository publishing, runtime registration, and verification.

Texture Artist must not test image-generation capability because image creation is outside the role by Admin order.

#### Texture Artist audit requirements

For reusable visual-family integration, record as applicable:

- Admin-provided source asset path;
- original source dimensions;
- canonical atlas path;
- whether normalization to 1024 x 1024 was required;
- semantic cell map;
- derived slice paths;
- manifest path;
- descriptions path;
- SHA-256 values when available;
- runtime files/mappings changed;
- intended 100 x 100 composition role/order;
- checks actually performed;
- required next role handoff.

### UX Designer
Responsible for UI design and implementation. Required to read ROADMAP.md. Must first complete any previous valid claim before taking an unclaimed issue. Claims and completes only one task at a time. Opens a new issue for distinct related work. If allotted time remains after completion, may claim another eligible issue.

### Tester
Responsible for independently testing coding, UI/UX developments, visual asset integration, metadata, and runtime behavior. Required to read ROADMAP.md. Must first complete any previous valid claim before taking an unclaimed issue. Claims and completes only one task at a time. If testing reveals a distinct issue, opens a new issue for the responsible role.

---

## DAILY RELEASE VISUAL REVIEW
Game Designer and Tester each perform this review once per Europe/Istanbul calendar date.
A valid existing claim always finishes first. Before taking a new issue, the first Game Designer or Tester execution for that Role/date checks whether that Role/date review was already recorded; if yes, skip it.
Open the latest public release in a browser. Wait until Loading is finished and a real playable in-game scene is visible; Loading, menu-only, blank, or non-game screens are not valid evidence.
Capture exactly two real in-game screenshots: Landscape 1280x720 and Portrait 720x1280.
Before each screenshot, independently choose and wait a random 15-60 seconds while the game keeps running in a real playable state.
Review responsiveness, layout, readability, camera/world framing, assets, rendering, and obvious visual/UX regressions.
For each distinct actionable finding, search existing issues first; if not already tracked, open one compliant atomic issue for the responsible Role. Do not create duplicates or bundle unrelated findings.
Do not create or generate replacement images during this review. Visual-production needs requiring new artwork must be recorded for Admin rather than routed as image-generation work to Texture Artist.
Record Role, date, reviewed build/release when identifiable, viewport sizes, screenshot references, findings, and created/reused issue references. If no actionable finding exists, record that result and open no improvement issue.

---

## Mandatory issue header

Every atomic issue must begin with:

```text
Role: Game Designer | Game Programmer | Texture Artist | UX Designer | Tester
WP: WP-NNN
Atomic record: INN
Priority: P0 | P1 | P2 | P3 | P4 | P5
Dependency: NONE | #issue[, #issue...]
Claim: NONE | ACTIVE:<worker-or-role>:<UTC timestamp>
Status: READY | ACTIVE | VERIFY | DONE
```

### Field rules

**Role** identifies the role currently allowed to claim the issue and changes at handoff. Workers must not claim an issue whose Role does not match the role they are executing. A worker number is never used as ownership authority.

**WP** must map to a valid ROADMAP WP using canonical `WP-NNN` form.

**Atomic record** must map to one ROADMAP atomic record, normally `I01`–`I10`, unless Admin explicitly defines otherwise.

**Priority**: P0 public build broken/severe corruption/core loop unavailable; P1 blocks multiple downstream tasks or critical verification; P2 core loop; P3 important gameplay/world expansion; P4 UX/content/presentation/optimization/maintainability; P5 polish.

**Dependency** uses `NONE` when immediately actionable, otherwise only concrete prerequisite issues. Do not invent dependencies to postpone work.

**Claim**: `NONE` means unclaimed. `ACTIVE:<worker-or-role>:<UTC timestamp>` means claimed. One active claim maximum. Claims older than 3 hours are stale and must be cleared by the first Worker that notices them. Manually activated Workers #6–#20 cannot claim tasks.

**Status**: `READY` actionable; `ACTIVE` currently worked; `VERIFY` requires current Role Tester; `DONE` means Tester independently verified and closed. `BLOCKED` is not valid.

---

## Mandatory issue body

```markdown
## Objective
Describe the single concrete result that must exist when this issue is complete.

## Scope
Describe exactly what is included.

## Out of scope
List closely related work that must not be silently added.

## Acceptance criteria
- [ ] Concrete, observable criterion 1
- [ ] Concrete, observable criterion 2
- [ ] Required checks/tests/evidence

## Audit
Purpose:
Change:
Refs:
Checks:
Result:
Risks:
Next:
```

---

## Atomicity rules

An issue is atomic only when it has one current role owner, one concrete completion objective, can reasonably complete in one work cycle per role handoff, has independently verifiable criteria, does not bundle unrelated systems/assets/interfaces/defects, does not hide work for another role inside one claim, and has explicit dependencies.

Do not create technical microtasks without meaningful executable or verifiable outcome merely to increase issue count.

---

## Role routing

There is no Planner role and no mandatory Planning gate.

Typical routing:

```text
Game design / roadmap contract -> Game Designer
Game code / simulation / runtime logic -> Game Programmer
Admin-provided visual asset discovery / validation / metadata / integration -> Texture Artist
UI design and UI implementation -> UX Designer
Independent verification -> Tester
New visual source image requirement -> Admin input required; not a worker image-generation task
```

Workers must ignore retired Design/Planning/Development/Graphics/Test lane ownership as task authority.

---

## Claim lifecycle

Before claiming, verify issue open, Claim NONE, Role match, READY (or VERIFY for Tester), dependencies complete, atomic scope valid, and no higher-authority instruction invalidates it.

After claiming: set active claim/timestamp, set ACTIVE, perform only that role task, do not switch roles/start another issue, record actual evidence only, and finish immediately.

---

## Role handoff and closure

At every handoff, record actual evidence, clear Claim, change Role to next responsible role, set Next, and set READY. For final verification: `Role: Tester`, `Claim: NONE`, `Status: VERIFY`, `Next: Tester`.

No role except Tester may set DONE or close an issue.

Tester independently verifies actual behavior/output and all acceptance criteria.

- PASS -> Tester sets DONE, records evidence, closes.
- FAIL -> Tester records failure evidence, does not close, clears Claim, changes Role to responsible correction role, sets READY and Next.
- If FAIL requires wholly new artwork not already Admin-provided, record the missing Admin input; do not instruct Texture Artist to generate it.

---

## Error and non-blocking rule

Workers must never mark work BLOCKED or abandon an active claim merely because an error occurred. Continue diagnosing/resolving within scope and capabilities while recording truthful evidence.

If a distinct matter belongs to another role/scope, open a separate atomic issue for that Role, record dependency if required, and finish the current claimed issue as far as its scope permits.

If the only missing element is new visual source artwork, record the required Admin input. Do not convert that absence into Texture Artist image-generation work.

---

## Issue age and stale work

Game Designer reviews unresolved issues older than 2 hours and clarifies, reduces, splits, reprioritizes, or marks them duplicate/obsolete/invalid for routing as appropriate; Game Designer does not close issues. Age alone is not a reason to discard valid product work.

Claims older than 3 hours are stale and must be cleared by the first Worker that notices them.

---

## Dependency rules

Dependencies exist only when one atomic issue genuinely cannot be completed correctly before another concrete issue finishes. Avoid circular/broad/fake dependencies. When dependencies are unresolved, skip that issue and select another eligible issue for the same role after any active claim is completed/cleared.

A missing Admin-provided image should be documented as required Admin input, not represented as permission for a Texture Artist to create that image.

---

## Tester verification

Every issue requires final Tester verification before closure. Producer/corrector evidence is never sufficient by itself.

Tester checks may include functional behavior, Simulation authority boundaries, Advisor->Character->Simulation->World continuity, persistence/SEED/time behavior, rendering/camera/NPC/world performance, responsive/accessibility behavior, asset integration, metadata consistency, binary PNG validity, and visual correctness.

For visual integration, Tester must additionally verify that the source artwork is Admin-provided and that no worker-generated replacement asset was introduced.

---

## Audit standard

Every repository-changing atomic issue must contain this English audit:

```text
Purpose:
Change:
Refs:
Checks:
Result:
Risks:
Next:
```

`Next` names the next required role or step, never a specific worker number. Never claim unperformed tests, generated assets, commits, deployments, releases, or verification.

---

## Worker selection rule

Workers execute their Admin-defined role priority order. Within a role prefer: existing valid claim; highest priority; dependencies satisfied; oldest actionable issue; smaller issue when otherwise equivalent. If no eligible issue exists, immediately try the next role in assigned order. Do not create fake work merely to avoid moving to the next role.

---

## Release relationship

A passing atomic issue does not automatically mean the entire application is release-ready. When final tested output is actually ready, Game Designer may publish the verified build to https://sgoxel.github.io/The_Advisor_Game/. Release claims require actual repository/build/test evidence.

---

## Precedence and maintenance

If this standard conflicts with explicit Admin direction, Admin wins. Otherwise README wins over subordinate operational material. Repair ROADMAP/issues/code/tests rather than modifying README unless Admin explicitly authorizes a README change.

Workers must not invent alternate issue formats or restore worker-driven image generation unless Admin explicitly changes this standard.