# The Advisor Game — Issue and Role Standard

## 1. Authority

Use this order when rules conflict:

**Admin > README.md > ROADMAP.md > TODO > issues > code/assets > tests**

- Read `README.md` first every run.
- `README.md` is product truth.
- Do not edit `README.md` unless Admin explicitly asks.
- Core rule: **Player advises -> AI Character decides -> Simulation validates -> World reacts.**
- Simulation owns authoritative game state, legality, resources, position, and outcomes.
- Development language is English. Issues, comments, docs, code, and assets use English.

## 2. General worker rules

- Never use `BLOCKED` as an issue status.
- Finish an existing valid claim before taking new work.
- Claim only one issue at a time.
- After claiming an issue, complete that issue before switching roles or taking another issue.
- A claim older than 3 hours is stale. The first worker that sees it clears it.
- Do not assign work to a specific worker number. Route by `Role`.
- Workers #1-#5 may run as routine workers.
- Workers #6-#20 are manually activated by Admin and cannot claim issues.
- Record only actions, tests, uploads, commits, notifications, and results that actually happened.

### Reusable tools

- Workers are encouraged to create or improve reusable deterministic development/test tools under `tools/` when repeated work in the current issue benefits from standardization. Python (`.py`) is preferred when appropriate.
- Prefer extending an existing suitable tool over creating an overlapping tool.
- Tool work must stay within the authorized issue scope and must not bypass acceptance criteria, Tester verification, Simulation authority, Admin-only artwork authorization, or binary-file rules.
- Each tool must be usable by another worker and document required usage through `--help`, a module docstring, or `tools/README.md`. Record commands and meaningful results when used as issue evidence.
- Tool-specific standards belong with the tool or `tools/README.md`. Workers may propose project-wide standardization, but only Admin may make a tool mandatory in this file.
- Tools explicitly required by this file remain mandatory.

## 3. Routine worker execution — mandatory

Every Worker #1-#5 routine run must execute this loop:

1. Connect to GitHub and scan **all open issues from oldest to newest**. Use ascending issue creation time; ascending issue number is the normal equivalent for repository issues.
2. Clear every stale claim encountered.
3. Complete this worker's existing valid claim first, if any.
4. Otherwise follow this worker's role order and select the first real eligible issue.
5. Claim it and set `Status: ACTIVE`.
6. Perform the actual role work. Do not stop at analysis or planning.
7. Run required checks/tests and record real evidence.
8. Finish with the correct handoff, Tester closure, or required Admin/binary gate.
9. If safe run capacity remains, repeat from step 1.

The oldest-to-newest order is mandatory for issue inspection on every routine scan. Do not begin from the newest issues or skip older open issues. This inspection order does not override claim ownership, role order, priority, dependency, eligibility, or repository-state rules used to select work.

A routine run must not silently do nothing. It may end only when no eligible issue exists across all roles, or when required external/Admin input or unavailable capability makes further valid progress impossible. In that case record the exact reason/evidence where applicable. An execution error must be diagnosed; it is not a reason to silently exit or disable the routine.

## 4. Worker role order

If there is no active claim, use the worker's role order and take the first eligible issue.

| Worker | Role order |
| --- | --- |
| #1 | Game Designer -> Game Programmer -> Texture Artist -> Tester -> UX Designer |
| #2 | Game Programmer -> Texture Artist -> Tester -> UX Designer -> Game Designer |
| #3 | Texture Artist -> Tester -> UX Designer -> Game Designer -> Game Programmer |
| #4 | Tester -> UX Designer -> Game Designer -> Game Programmer -> Texture Artist |
| #5 | UX Designer -> Game Designer -> Game Programmer -> Texture Artist -> Tester |

Within a role, prefer: valid existing claim -> highest priority -> dependencies complete -> oldest actionable issue -> smaller issue when otherwise equal.

If no eligible issue exists for that role, immediately try the next role. Do not create fake work.

## 5. Role duties

### Game Designer

- Read `README.md` and `ROADMAP.md`.
- Keep ROADMAP aligned with product truth.
- Create small WPs and atomic issue records.
- Clarify, split, reduce, reprioritize, or mark issues duplicate/obsolete/invalid when needed.
- Do not close issues.
- Age alone is not a reason to remove valid work.
- May publish a final build only after Tester verification and real release evidence exist.

### Game Programmer

- Read `README.md`, `ROADMAP.md`, and the issue.
- Implement game code, Simulation logic, runtime logic, and related tests.
- Work on one claimed issue at a time.
- Open a separate issue for distinct extra work instead of silently expanding scope.

### Texture Artist

**Texture Artist does not create artwork.**

- Read `README.md`, `ROADMAP.md`, the issue, `.github/TEXTURE_ATLAS_STANDARD.md`, and `.github/STATIC_TILE_COMPOSITION_STANDARD.md` when relevant.
- Find newly added Admin-provided visual assets.
- Validate format, dimensions, transparency, atlas geometry, semantics, metadata, and paths when applicable.
- Use `tools/tile_atlas_tool.py` for production atlas processing.
- Integrate valid Admin-provided assets into the latest app.
- Use the shared 100x100 static tile-composition path for non-NPC world art.
- Remove obsolete mappings when the issue requires it.
- Record real evidence and hand off correctly.

Texture Artist must never:

- generate an atlas, sprite, texture, or replacement image;
- call image generation for worker work;
- redraw or synthesize production artwork;
- create placeholder/fake PNGs;
- substitute SVG/vector art for required PNG artwork.

If required artwork is missing, notify Admin and record the missing Admin input. Do not manufacture it.

### UX Designer

- Read `README.md`, `ROADMAP.md`, and the issue.
- Design and implement UI/UX work in the issue scope.
- Work on one claimed issue at a time.
- Open a separate issue for distinct extra work.

### Tester

- Read `README.md`, `ROADMAP.md`, and the issue.
- Independently test code, UI/UX, visual integration, metadata, runtime behavior, and acceptance criteria.
- Producer evidence is not enough by itself.
- PASS: record evidence, set `DONE`, and close the issue.
- FAIL: record evidence, do not close, route back to the responsible role, set `READY`.
- If a failure requires new artwork, record required Admin input. Do not ask Texture Artist to generate it.

## 6. New visual creation rule

Only Admin may request or authorize creation of new production visual source images.

An Admin image-generation request is allowed. A worker acting as Texture Artist may only process and integrate the resulting Admin-provided image.

## 7. Binary file rule — mandatory

**Never upload images or other binary files to GitHub using GitHub Blob, Create Blob, base64 upload, binary-upload APIs, Git trees, or similar GitHub binary methods.**

This includes PNG, JPG/JPEG, WEBP, GIF, ZIP, and other binary files.

For every binary file:

1. Put it in the configured Google Drive `The_Advisor_Game/` folder that mirrors the GitHub repository.
2. Use the exact repository-relative path and filename.
3. If the Drive file already exists, update/replace it. Do not create a duplicate filename.
4. Set `Repository state: DRIVE_PENDING_ADMIN_PUSH`.
5. Clear the worker claim.
6. Send `ADMIN ACTION REQUIRED` with the issue number and exact paths.
7. Workers skip that issue while Admin commit/push is pending.
8. After Admin pushes, verify the files in GitHub.
9. Set `Repository state: GITHUB_VERIFIED`.
10. Continue the normal role handoff.

Drive staging is not GitHub completion. Tester must not pass or close repository-changing work while it is `DRIVE_PENDING_ADMIN_PUSH`.

Text/code files may be written directly to GitHub when supported.

## 8. Mandatory issue header

Every atomic issue begins with:

```text
Role: Game Designer | Game Programmer | Texture Artist | UX Designer | Tester
WP: WP-NNN
Atomic record: INN
Priority: P0 | P1 | P2 | P3 | P4 | P5
Dependency: NONE | #issue[, #issue...]
Claim: NONE | ACTIVE:<worker-or-role>:<UTC timestamp>
Status: READY | ACTIVE | VERIFY | DONE
Repository state: NONE | DRIVE_PENDING_ADMIN_PUSH | GITHUB_VERIFIED
```

### Field meaning

- `Role`: role currently responsible for the issue.
- `WP`: matching ROADMAP work package.
- `Atomic record`: matching ROADMAP item, normally `I01`-`I10`.
- `Priority`: `P0` public build/core failure; `P1` critical blocker; `P2` core loop; `P3` important gameplay/world work; `P4` UX/content/presentation/optimization/maintenance; `P5` polish.
- `Dependency`: use `NONE` unless a real prerequisite issue exists.
- `Claim`: one active claim maximum. #6-#20 cannot claim. Clear stale claims after 3 hours.
- `Status`: `READY`, `ACTIVE`, `VERIFY`, or `DONE`. `BLOCKED` is invalid.
- `Repository state`:
  - `NONE`: no applicable repository result yet.
  - `DRIVE_PENDING_ADMIN_PUSH`: required binary files are staged in Drive but not yet verified in GitHub. Claim must be `NONE`; workers skip the issue.
  - `GITHUB_VERIFIED`: required repository paths are visible and verified in GitHub.

## 9. Mandatory issue body

```markdown
## Objective
One concrete result.

## Scope
Exactly what is included.

## Out of scope
Related work that is not included.

## Acceptance criteria
- [ ] Observable criterion 1
- [ ] Observable criterion 2
- [ ] Required tests/evidence

## Audit
Purpose:
Change:
Refs:
Checks:
Result:
Risks:
Next:
```

`Next` names the next role or step, never a specific worker number.

## 10. Atomic issue rule

An issue is atomic when it has:

- one current role;
- one concrete objective;
- one-cycle scope for each role handoff;
- independently verifiable acceptance criteria;
- no unrelated bundled work;
- only real dependencies.

If it is too large, split it before production work.

## 11. Claim flow

Before claiming, confirm:

- issue is open;
- `Claim: NONE`;
- worker role matches `Role`;
- status is eligible;
- dependencies are complete;
- repository state is not `DRIVE_PENDING_ADMIN_PUSH`;
- no higher-authority rule invalidates the work.

After claiming:

- set `Claim: ACTIVE:<...>`;
- set `Status: ACTIVE`;
- perform only that issue/role work;
- record real evidence;
- finish or correctly hand off before taking other work.

## 12. Handoff and closure

For a normal handoff:

1. Record evidence.
2. Clear `Claim`.
3. Change `Role` to the next responsible role.
4. Set `Next`.
5. Set `Status: READY`.

For final verification use:

```text
Role: Tester
Claim: NONE
Status: VERIFY
Next: Tester
```

Only Tester may set `DONE` and close an issue.

## 13. Dependencies and errors

- Use dependencies only for real prerequisites.
- Do not invent dependencies to postpone work.
- Do not create circular dependencies.
- An error does not create a `BLOCKED` status.
- Diagnose and continue within scope when possible.
- If a distinct problem belongs to another role, open a separate atomic issue and continue the current issue as far as validly possible.
- `DRIVE_PENDING_ADMIN_PUSH` is a repository-state gate, not a dependency.

## 14. Daily visual review

Game Designer and Tester each perform this review once per Europe/Istanbul calendar date, after finishing any valid current claim.

1. Check whether that role/date review was already recorded. If yes, skip it.
2. Open the latest public build and wait for a real playable scene.
3. Capture exactly two in-game screenshots: `1280x720` landscape and `720x1280` portrait.
4. Before each screenshot, let the real game run for a random 15-60 seconds.
5. Check responsiveness, layout, readability, camera/world framing, assets, rendering, and obvious visual/UX regressions.
6. Search existing issues before creating a new one.
7. Create one atomic issue per distinct new finding. Do not bundle unrelated findings.
8. Do not generate replacement artwork during this review. New artwork needs Admin authorization/input.
9. Record role, date, build, viewport sizes, screenshot references, findings, and reused/created issue numbers.

## 15. Tester verification scope

As applicable, Tester checks:

- acceptance criteria;
- functional behavior;
- Advisor -> Character -> Simulation -> World continuity;
- Simulation authority boundaries;
- persistence, SEED, and time behavior;
- rendering, camera, NPC, and world performance;
- responsive/accessibility behavior;
- asset integration and metadata;
- binary PNG validity and visual correctness;
- that worker-generated replacement artwork was not introduced.

## 16. Release rule

A completed issue does not automatically make the application release-ready.

Game Designer may publish the public build only after required Tester verification and real repository/build evidence exist.

Public build: https://sgoxel.github.io/The_Advisor_Game/

## 17. Final precedence rule

If this file conflicts with Admin, Admin wins.

Otherwise, `README.md` wins over this file and all lower-authority material. Repair lower-authority files instead of changing README unless Admin explicitly authorizes a README change.