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

---

## Purpose

This file defines the mandatory structure and lifecycle for atomic GitHub issues used by routine workers and manually activated roles in **The Advisor Game**.
It exists to keep work small, executable, auditable, and directly transferable between the current project roles without introducing a separate planning gate.

Authority remains:

**Admin > README.md > ROADMAP.md > TODO > issues > code/assets > tests.**
`README.md` remains product truth for scope, principles, invariants, and high-level governance. This file must never be used to override README or explicit Admin direction.

---

## Scope

This standard applies to atomic issues for:

- Game Programmer work;
- Texture Artist work;
- UX Designer work;
- Tester work;
- Game Designer work when the issue itself is an atomic roadmap/design maintenance task.

A Work Package (WP) may contain many atomic issue records. The normal target is **at least 10 atomic issue records per WP**.

An atomic issue must be small enough that the responsible role can reasonably complete it in one work cycle.

Examples:

- a Game Programmer can implement and verify the coding task in one cycle;
- a Texture Artist can create/integrate the requested asset in one cycle;
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
### Game Designer:
Reads the README.md file. Creates or updates a ROADMAP based on the concept outlined in the README file.
In the ROADMAP file, game development is broken down into very small, manageable, and deliverable work packages (WPs).
The Game Designer aims to divide the game development process into a total of at least 100 work packages.
The goal is to create at least 10 issue records per work package. 
Issue records represent the smallest units of work that can be resolved in a single cycle; for example, a Game Programmer should be able to code the task in one go, and a Texture Artist should be able to draw the required image in one go.
They clarify, reduce, split, reprioritize, or mark issues duplicate, obsolete, or invalid for routing; Game Designer does not close issues.
Age alone is not a reason to remove valid unresolved work.
Claims older than 3 hours are stale and must be cleared by the first Worker that notices them.
If the task output completed by the final tester is ready for release, they publish the verified, functional final version of the application at https://sgoxel.github.io/The_Advisor_Game/.


### Game Programmer:
Responsible for all game coding tasks. Required to read the ROADMAP.md file. First, completes any previously claimed tasks. Then, takes ownership of unclaimed issues.
Claims and completes only one task at a time.
Opens a new issue if there is a related matter that needs to be addressed.
If the allotted task time remains, claims and proceeds with a second task.

### Texture Artist:
Responsible for all visual asset production tasks. Required to read the ROADMAP.md file. First, completes any previously claimed tasks. Then, takes ownership of unclaimed issues.
Claims and completes only one task at a time.
Opens a new issue if there is a related matter that needs to be addressed. If their allotted time remains, they claim a second task and proceed.

#### TEXTURE ARTIST STANDARD
Before producing, evaluating, routing, accepting, or verifying Texture Artist work, read and obey `.github/TEXTURE_ATLAS_STANDARD.md`.
Texture Artist runtime visual output must satisfy that standard; SVG/vector-only output is never complete and must not be handed to Tester as finished work.
If compliant PNG generation/upload is unavailable, record the limitation and keep/return the issue to the correct Role/Status; never substitute SVG or claim completion.

##### Texture Artist end-to-end PNG production workflow

For reusable tile-family asset issues, Texture Artist must use the following end-to-end production workflow unless the issue explicitly requires a different bounded PNG deliverable.

1. Produce or generate one coherent source image for the requested family.
2. The canonical retained runtime master for a reusable family must be one exact `1024 x 1024` RGBA PNG atlas.
3. The canonical atlas must use a fixed `4 x 4` grid with exact `256 x 256` cells.
4. One semantic tile variant must be assigned per occupied cell in row-major order unless an existing family manifest defines a different compatible order.
5. Each final tile PNG must be created by exact pixel crop from the canonical atlas only. Do not redraw, resize per tile, stretch, or regenerate individual slices.
6. A reusable tile family must include:
   - `<family>_atlas_1024px.png`
   - `<family>_<semantic-type>_256px.png` for each occupied tile
   - `<family>_tiles.manifest.json`
   - `<family>_tiles.descriptions.json`
7. The manifest file is the runtime-oriented structural registry and must record at minimum:
   - family
   - atlas geometry
   - row
   - col
   - semantic type
   - filename
   - SHA-256 of each tile PNG when available
8. The descriptions file is the human-readable semantic registry and must record at minimum:
   - row
   - col
   - semantic type
   - filename
   - short description of the tile's visual meaning
9. Description metadata is documentation/provenance only and must never become Simulation authority.
10. Except for NPC world sprites, non-NPC runtime integration must use the shared exact `100 x 100` static tile-composition path defined by current project standards.

##### Generated-image normalization rule

If a generated or produced reusable-family source image does not initially match the canonical atlas size, the worker must not abandon the issue for that reason alone.

Instead:

1. convert the accepted source image into one exact canonical `1024 x 1024` RGBA PNG atlas;
2. record that normalization truthfully in the issue Audit;
3. use the normalized exact `1024 x 1024` atlas as the deterministic source for all `256 x 256` crops.

A worker must not claim that PNG production is unavailable merely because the first generated output was not already at the exact canonical size.

##### Capability verification rule for Texture Artist work

A worker may record a tooling/capability limitation only after attempting the actual bounded production path within the current execution surface.

For reusable tile-family work, this means the worker must, to the extent available in the current execution surface, attempt to:

1. generate or produce the source PNG;
2. normalize to the canonical atlas size when required;
3. create the deterministic crops;
4. validate PNG outputs and dimensions;
5. prepare the manifest and descriptions metadata.

Do not declare the work impossible merely because a preferred shortcut or one-step tool was unavailable.

##### Multi-role handoff for asset integration

When a Texture Artist issue also requires application integration, the same atomic issue may move through the following handoff chain when that remains the smallest valid scope:

`Texture Artist -> Game Programmer -> Tester`

Typical expectations:

- Texture Artist produces the compliant PNG source assets and required metadata.
- Game Programmer wires the asset family into runtime selection/registration/composition.
- Tester independently verifies file compliance and actual runtime use.

If production and runtime integration are too large to remain atomic together, split them into separate dependent issues.

##### Mandatory Audit content for reusable tile-family asset issues

For reusable tile-family asset production, the issue Audit must record, as applicable:

- source of the produced/generated family image;
- canonical atlas path;
- atlas dimensions and cell map;
- every slice path;
- manifest path;
- descriptions path;
- SHA-256 values when available;
- whether normalization to exact `1024 x 1024` was required;
- whether runtime integration is included in scope;
- required next role handoff.

##### Handoff rule for reusable tile-family production

Texture Artist may hand a reusable tile-family issue forward only when all applicable outputs exist and were actually checked:

- canonical `1024 x 1024` RGBA atlas;
- exact `256 x 256` PNG slices;
- truthful manifest;
- truthful descriptions metadata;
- issue Audit with actual evidence.

If runtime integration is still required and is in scope, hand off the same issue to `Role: Game Programmer`, `Claim: NONE`, `Status: READY`, and set `Next` accordingly.

If only independent verification remains, hand off to `Role: Tester`, `Claim: NONE`, `Status: VERIFY`, and set `Next: Tester`.

### UX Designer:
Responsible for all UI design and development tasks for the game. They are required to read ROADMAP.md. They must first complete any previously claimed task before taking on an unclaimed issue.
They claim and complete only one task at a time.
If an issue requires a specific matter to be resolved, they open a new issue for it.
If their allotted time remains, they claim a second task and proceed.

### Tester:
Responsible for testing all coding, UI/UX developments, and visual assets for the game. 
They are required to read ROADMAP.md. They must first complete any previously claimed task before taking on an unclaimed issue.
They claim and complete only one task at a time.
If an issue requires a specific matter to be resolved, they open a new issue for it.

## DAILY RELEASE VISUAL REVIEW
Game Designer and Tester each perform this review once per Europe/Istanbul calendar date.
A valid existing claim always finishes first. Before taking a new issue, the first Game Designer or Tester execution for that Role/date checks whether that Role/date review was already recorded; if yes, skip it.
Open the latest public release in a browser. Wait until Loading is finished and a real playable in-game scene is visible; Loading, menu-only, blank, or non-game screens are not valid evidence.
Capture exactly two real in-game screenshots: Landscape 1280x720 and Portrait 720x1280.
Before each screenshot, independently choose and wait a random 15-60 seconds while the game keeps running in a real playable state; each Worker must randomize its own delays so captures can sample different gameplay moments.
Review responsiveness, layout, readability, camera/world framing, assets, rendering, and obvious visual/UX regressions.
For each distinct actionable finding: search existing issues first; if not already tracked, open one compliant atomic issue for the Role responsible for the fix. Do not create duplicates or bundle unrelated findings.
Every issue opened from this review must include the relevant screenshot evidence. Attach the screenshot directly to the GitHub issue when supported; otherwise store it in the repository and embed/link it in the issue. If image attachment/storage is technically unavailable, record that limitation and never invent evidence.
Record Role, date, reviewed build/release when identifiable, viewport sizes, screenshot references, findings, and created/reused issue references. If no actionable finding exists, record that result and open no improvement issue.
This review is not a release gate, does not interrupt claimed work, and must not run more than once per Role/date.

---

## Mandatory issue header

Every atomic issue must begin with the following control block:

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

**Role**
- Identifies the role currently allowed to claim the issue and changes when responsibility is handed to another role.
- Workers must not claim an issue whose Role does not match the role they are currently executing.
- A worker number is never used as ownership authority.

**WP**
- Must map to a valid ROADMAP work package.
- Use the canonical form `WP-NNN`.

**Atomic record**
- Must map to one ROADMAP atomic record, normally `I01`–`I10` or another explicitly added atomic record.
- One live GitHub issue should represent one atomic record unless Admin explicitly directs otherwise.

**Priority**
- `P0` = public build broken, severe corruption/data-loss, core loop unavailable.
- `P1` = blocks multiple downstream tasks or critical verification.
- `P2` = core Advisor -> Character -> Simulation -> World functionality.
- `P3` = important gameplay/world expansion.
- `P4` = UX, content, presentation, optimization or maintainability improvement.
- `P5` = polish or low-risk refinement.

**Dependency**
- Use `NONE` when the task can be started immediately.
- Otherwise reference only concrete prerequisite issues.
- An issue is not eligible to be claimed while any required dependency remains unresolved.
- Workers must not invent dependencies merely to postpone work.

**Claim**
- `NONE` means unclaimed.
- `ACTIVE:<worker-or-role>:<UTC timestamp>` means the issue is currently claimed.
- Only one task may be claimed by a worker at a time.
- A worker with an active valid claim must finish that issue before switching roles or performing other work.
- Claims older than **3 hours** are stale and must be cleared by the first worker that notices them.
- Manually activated Workers #6–#20 cannot claim tasks.

**Status**
- `READY` = actionable by the current `Role` and available for claim.
- `ACTIVE` = currently being worked under a valid claim.
- `VERIFY` = current `Role` must be `Tester`; final independent verification is required.
- `DONE` = Tester independently verified the issue and closed it.

`BLOCKED` is not a valid status.

---

## Mandatory issue body

Every atomic issue must contain these sections:

```markdown
## Objective
Describe the single concrete result that must exist when this issue is complete.

## Scope
Describe exactly what is included.

## Out of scope
List closely related work that must not be silently added to this issue.

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

The issue may contain additional technical detail when useful, but workers must not replace these mandatory sections with an alternative format.

---

## Atomicity rules

An issue is atomic only when all of the following are true:

1. It has one current role owner at a time.
2. It has one concrete completion objective.
3. It can reasonably be completed in one work cycle per role handoff.
4. Its acceptance criteria are independently verifiable.
5. It does not bundle unrelated systems, assets, interfaces, or defects.
6. It does not require another role to complete hidden work inside the same claim.
7. Its dependencies are explicit.

If one issue requires significant coding, a new asset, UI redesign, and independent verification, those must normally be separate atomic issues connected by dependencies or `Next` routing unless the same atomic objective legitimately requires sequential role handoffs.

Do not create technical microtasks that have no meaningful executable or verifiable outcome merely to increase issue count.

---

## Role routing

Atomic work is routed directly to the role currently responsible for producing, correcting, or verifying it.

There is **no Planner role and no mandatory Planning gate**.

Typical routing:

```text
Game design / roadmap contract -> Game Designer
Game code / simulation / runtime logic -> Game Programmer
Visual asset production -> Texture Artist
UI design and UI implementation -> UX Designer
Independent verification -> Tester
```

Technical implementation planning performed by a Game Programmer is part of that coding task and does not require a separate planning issue unless a distinct product/design decision is genuinely required.

Workers must ignore retired Design/Planning/Development/Graphics/Test lane ownership as task authority.

---

## Claim lifecycle

Before claiming an issue, a worker must verify:

- the issue is open;
- `Claim: NONE`;
- the issue Role matches the worker's current role;
- `Status: READY`, or `Status: VERIFY` when the current Role is Tester;
- all listed dependencies are complete;
- the scope is small enough for one cycle;
- no higher-authority instruction makes the issue invalid.

After claiming:

1. set `Claim` to an active claim with timestamp;
2. set `Status: ACTIVE`;
3. perform only that claimed role task;
4. do not switch roles or start another issue;
5. record actual evidence only;
6. finish the current role task immediately.

When the current role task is complete, use the Role handoff rule below. A worker must never keep several active claims.

---

## Role handoff and closure

`Role` is the mutable handoff field for the same atomic issue.

At every handoff, the current role must record actual evidence, clear `Claim`, change `Role` to the next responsible role, set `Next` to that role/step, and set `Status: READY`. For final verification, hand off as `Role: Tester`, `Claim: NONE`, `Status: VERIFY`, `Next: Tester`.

No role except Tester may set `Status: DONE` or close an issue.

Tester must independently verify the actual behavior/output and all acceptance criteria; producer claims alone are never sufficient.

- PASS -> Tester sets `Status: DONE`, records evidence, and closes the issue.
- FAIL -> Tester does not close the issue; record failure evidence, clear `Claim`, change `Role` to the role responsible for the correction, set `Status: READY`, and set `Next` accordingly.
- After correction, that role hands the same issue back as `Role: Tester`, `Status: VERIFY`.

The same issue may move between any roles multiple times until Tester verifies a PASS.

---

## Error and non-blocking rule

Workers must never mark work `BLOCKED` or abandon an active claim merely because an error occurred.

For the active claimed issue, the worker must continue diagnosing and resolving the problem within the issue's scope and capabilities, while recording truthful evidence.

If a distinct matter belongs to another role or separate scope:

- open a separate atomic issue;
- assign the appropriate **Role**, not a specific worker number;
- record the dependency if required;
- continue and finish the current claimed issue as far as its defined scope allows.

If the current issue itself is structurally invalid or oversized, Game Designer must revise/split it according to project rules rather than preserving an unusable task indefinitely. Final closure still requires Tester verification.

---

## Issue age and stale work

Game Designer reviews unresolved issues older than **3 hours**.

For such issues, Game Designer must determine whether the issue should be:

- clarified;
- reduced in scope;
- split into smaller atomic issues;
- reprioritized;
- marked as duplicate, obsolete, or invalid for routing/review.

Age alone is not a reason to discard valid product work.

Game Designer reviews unresolved issues older than 2 hours. They clarify, reduce, split, reprioritize, or mark them duplicate, obsolete, or invalid; they do not close them.

Claims older than 3 hours are stale and must be cleared. Age alone is not a reason to remove valid unresolved work.

---

## Dependency rules

Dependencies exist only when one atomic issue genuinely cannot be completed correctly before another concrete issue finishes.

Workers must:

- check dependencies before claiming;
- avoid circular dependencies;
- avoid broad dependencies such as an entire WP when only one atomic prerequisite is required;
- avoid using dependencies as a substitute for issue decomposition;
- update/remove obsolete dependency references when upstream work changes.

When dependencies are unresolved, the worker should skip that issue and select another eligible issue for the same role after any prior active claim has been completed/cleared.

---

## Tester verification

Every issue requires final Tester verification before closure.

The producing/correcting role must leave concrete evidence and exact test scope in `Next`, then hand the same issue to `Role: Tester`, `Status: VERIFY`.

Tester must verify actual behavior/evidence and must not merely accept the producer's claims.

Tester checks may include, where relevant:

- functional behavior;
- Simulation authority boundaries;
- Advisor -> Character -> Simulation -> World continuity;
- regression behavior;
- persistence/SEED/time behavior;
- rendering/camera/NPC/world performance;
- responsive/accessibility behavior;
- asset integration and visual correctness.

If verification fails within the issue's acceptance scope, return the same issue to the responsible role using Role handoff. If testing reveals a truly separate defect outside the current atomic scope, create a new atomic issue for that defect without closing the current issue unless its own acceptance criteria independently PASS.

---

## Audit standard

Every repository-changing atomic issue must contain an English audit with these exact headings:

```text
Purpose:
Change:
Refs:
Checks:
Result:
Risks:
Next:
```

Rules:

- `Purpose` explains why the change exists.
- `Change` states what was actually changed.
- `Refs` references WP, atomic record, issues, files, commits, or Admin direction as applicable.
- `Checks` lists only checks/tests actually performed.
- `Result` records the actual outcome.
- `Risks` records known residual risks, or `None identified` when appropriate.
- `Next` names the next required **role or step**, never a specific worker number.

Never claim unperformed tests, generated assets, commits, deployments, releases, or verification.

---

## Recommended issue template

```markdown
Role: Game Programmer
WP: WP-040
Atomic record: I03
Priority: P1
Dependency: #401, #402
Claim: NONE
Status: READY

## Objective
Implement the visible-NPC update cadence defined by WP-040/I03 without making renderer FPS authoritative.

## Scope
- Add the bounded visible-NPC cadence required by the current authoritative simulation model.
- Reuse existing scheduler/relevance primitives where available.

## Out of scope
- Distant compact-state reconciliation.
- New NPC artwork.
- UI redesign.

## Acceptance criteria
- [ ] Visible/interaction-critical NPC cadence is implemented.
- [ ] Simulation authority remains independent of renderer FPS.
- [ ] Existing relevant automated/manual checks pass or actual failures are documented.
- [ ] Required audit is complete.

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

## Worker selection rule

Workers execute their Admin-defined role priority order.

Within a role, prefer eligible issues in this order unless Admin specifies otherwise:

1. existing valid claim;
2. highest priority (`P0` before `P1`, etc.);
3. issue with all dependencies satisfied;
4. oldest actionable issue;
5. smaller issue when priority/age are otherwise equivalent.

If no eligible issue exists for the current role, the worker immediately tries the next role in its assigned role order.

Workers must not create fake work merely to avoid moving to the next role.

---

## Release relationship

A passing atomic test issue does not automatically mean the entire application is release-ready.

When final tested output is actually ready for release, the Game Designer may publish the verified functional build to:

https://sgoxel.github.io/The_Advisor_Game/

Release claims must be backed by actual repository/build/test evidence.

---

## Precedence and maintenance

If this standard conflicts with:

1. explicit Admin direction — Admin wins;
2. `README.md` — README wins;
3. `ROADMAP.md` product decomposition — repair this standard or subordinate issue data as needed.

Do not modify `README.md` to make it conform to this file.

Workers must not invent alternate atomic issue formats unless Admin explicitly changes the standard.
