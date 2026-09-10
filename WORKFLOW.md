# The Advisor Game — Five-Lane Production Workflow

## 1. Authority and purpose

This file defines the implementation process for project work. It does not redefine product scope.

Authority order remains:

**Admin > README > ROADMAP > TODO > issues > code/assets > tests.**

`README.md` is product truth. If this workflow conflicts with README, README wins. README must not be edited as part of normal workflow maintenance unless Admin explicitly authorizes the edit.

This workflow intentionally replaces prior worker sequencing, role-fallback logic, central orchestration assumptions, and legacy work-claim behavior for new production work. Existing product requirements may still be useful, but legacy process state does not make an item READY in this pipeline.

Core production objective:

**Design → Planning → Development → Graphics → Test → VERIFIED**

The pipeline must maximize independent forward progress, minimize waiting, and keep the player-visible game loop aligned with:

**Player advises → AI Character decides → Simulation validates → World reacts.**

---

## 2. Atomic unit: Work Package

A Work Package (WP) is the smallest independently testable vertical slice of product value that can move through all required lanes.

Use one GitHub issue per WP. Do not create separate Design, Planning, Development, Graphics, and Test issues for the same slice.

A WP should normally contain one player-visible outcome plus the minimum simulation, presentation, assets, persistence, instrumentation, and tests needed to verify it.

Split a WP before Planning handoff if it:

- contains multiple independently testable player-visible outcomes;
- spans unrelated authoritative systems;
- requires unrelated asset families;
- cannot be reasonably completed under one Development claim;
- cannot be independently verified by Test;
- depends on another unfinished WP but can be separated cleanly.

Do not split into technical microtasks that produce no independently testable value. Prefer small vertical slices.

---

## 3. Work Package control fields

Every WP issue must keep these fields near the top of the issue body:

```text
WP: WP-NNN
Stage: DESIGN | PLANNING | DEVELOPMENT | GRAPHICS | TEST | VERIFIED
State: READY | ACTIVE | WAITING | REWORK | DONE
Priority: P0 | P1 | P2 | P3 | P4 | P5
Lane owner: Design | Planning | Development | Graphics | Test | None
Claim: NONE | ACTIVE:<lane>:<scope>
Parent/refs: issue/roadmap/todo references
```

During bootstrap, these body fields are authoritative for workflow discovery. GitHub labels may mirror them later but must never be the only way the pipeline can operate.

Recommended labels after label bootstrap:

- `stage:design`, `stage:planning`, `stage:development`, `stage:graphics`, `stage:test`, `stage:verified`
- `state:ready`, `state:active`, `state:waiting`, `state:rework`
- `priority:P0` through `priority:P5`

---

## 4. Pull model

There is no central scheduler required for normal operation.

Each routine pulls the highest-priority eligible WP for its own lane.

Priority order:

1. **P0** — public build broken, save corruption, core loop unavailable, severe data loss/regression.
2. **P1** — blocks multiple downstream WPs or prevents meaningful verification.
3. **P2** — strengthens the core Advisor → Character → Simulation → World loop.
4. **P3** — expands world/gameplay systems.
5. **P4** — UX/content/presentation improvements.
6. **P5** — polish and low-risk refinements.

Within equal priority, prefer:

1. targeted REWORK already blocking verification;
2. the oldest READY WP;
3. the smaller independently finishable WP;
4. work that unlocks more downstream packages.

A routine must not claim work belonging to another lane merely to stay busy. If its own queue is empty, it records `NO ELIGIBLE WORK` and exits cleanly.

---

## 5. WIP and claims

Maximum WIP is **one live claim per routine**.

Claims are target-scoped only. A claim on WP-A has zero effect on WP-B.

Before changing a WP, the routine must confirm that no conflicting active claim exists for the same WP and lane.

A claim must be cleared when the run ends in any of these states:

- handoff completed;
- work completed;
- waiting on a dependency;
- blocked by missing authority/requirement;
- no safe progress can be made.

Do not leave stale active claims.

If blocked:

1. record the exact blocker and evidence;
2. set `State: WAITING` or the appropriate targeted `REWORK` route;
3. clear the active claim;
4. do not block unrelated WPs.

No routine may keep several WPs ACTIVE simultaneously.

---

## 6. Lane 1 — Design

### Purpose
Define **what** the player should experience and **why** it belongs in the game.

### Design may

- select a new product slice from README/ROADMAP/TODO/Admin direction;
- deliberately convert a still-valid legacy product issue into a new WP;
- define player-visible behavior and gameplay meaning;
- define simulation/world implications;
- define UX expectations;
- identify required asset families;
- write acceptance scenarios and explicit non-goals;
- split oversized WPs.

### Design must not

- write production implementation code;
- prescribe unnecessary implementation details;
- inherit legacy worker claims, sequencing, or role fallbacks;
- invent product rules that conflict with README.

### Design gate output

A complete **Design Contract** containing:

- objective;
- player-visible behavior;
- core-loop relationship;
- authoritative simulation/world implications;
- UI/interaction expectations;
- asset needs;
- acceptance scenarios;
- non-goals;
- dependencies;
- performance-sensitive concerns;
- persistence/time/SEED implications where relevant.

On success: `Stage: PLANNING`, `State: READY`.

---

## 7. Lane 2 — Planning

### Purpose
Convert an approved Design Contract into an implementation contract with minimal ambiguity.

Planning must inspect current code before prescribing file/module changes.

### Planning gate output

A complete **Planning Contract** containing:

- exact scope and out-of-scope boundaries;
- authoritative state affected;
- presentation-only state affected;
- expected files/modules/interfaces;
- data structures/contracts;
- execution sequence;
- persistence and migration implications;
- performance constraints and budgets;
- deterministic/SEED requirements;
- instrumentation/logging requirements;
- automated/manual test plan;
- rollback/failure considerations;
- asset manifest or `GRAPHICS: N/A`;
- stable placeholder contract when final art is not yet available;
- Definition of Done.

Planning must design stable asset interfaces so Development is not blocked by final art production.

On success: `Stage: DEVELOPMENT`, `State: READY`.

---

## 8. Lane 3 — Development

### Purpose
Implement only an approved Planning Contract.

### Development responsibilities

- implement the planned behavior;
- preserve Simulation authority;
- keep AI/LLM and presentation layers non-authoritative;
- integrate required persistence/state transitions;
- add or update instrumentation;
- add or update automated tests where appropriate;
- integrate stable asset placeholders when final art is unavailable;
- run targeted smoke/regression checks;
- document deviations from the plan.

Development must not silently redesign the feature. If the contract is wrong or insufficient, route only that specific ambiguity back to Planning or Design.

Final art must not block gameplay implementation when a valid placeholder contract exists.

On success:

- if assets are required: `Stage: GRAPHICS`, `State: READY`;
- if `GRAPHICS: N/A`: `Stage: TEST`, `State: READY`.

---

## 9. Lane 4 — Graphics

### Purpose
Produce and integrate visual assets against the Asset Manifest without changing authoritative gameplay rules.

### Asset Manifest minimum fields

- stable asset ID;
- asset type and gameplay role;
- required visual states/variants;
- projection/perspective requirements;
- dimensions/scale rules;
- transparency/background rules;
- anchor/origin requirements;
- atlas/naming/file-format rules;
- animation states if relevant;
- integration path;
- fallback/placeholder relationship.

Graphics may create, refine, optimize, and integrate assets. It must not invent new game mechanics or mutate Simulation authority.

If no new asset is required, Graphics is bypassed by Planning/Development using `GRAPHICS: N/A`.

On success: `Stage: TEST`, `State: READY`.

---

## 10. Lane 5 — Test

### Purpose
Act as the verification and release-quality gate for the WP scope.

Every applicable WP must be checked across these evidence classes:

1. **Functional** — acceptance scenarios work.
2. **Simulation authority** — authoritative state remains owned and validated by Simulation.
3. **World integration** — the result is observable in the living world where the feature requires it.
4. **Regression** — relevant existing behavior still works.
5. **Performance** — no unacceptable rendering/camera/NPC/world-simulation regression.
6. **Persistence/SEED/time** — deterministic generation, resume, save/load, and time behavior remain correct where applicable.
7. **Accessibility/responsiveness/localization** — when the WP touches those surfaces.

A test failure must route only to the responsible lane:

- requirement/product error → `DESIGN / REWORK`;
- implementation contract ambiguity → `PLANNING / REWORK`;
- code/runtime defect → `DEVELOPMENT / REWORK`;
- visual/asset defect → `GRAPHICS / REWORK`;
- success → `VERIFIED / DONE`.

Do not recycle a WP through unrelated lanes.

---

## 11. Targeted rework

Rework is a direct loop, not a full pipeline restart.

Examples:

```text
TEST → DEVELOPMENT REWORK → TEST
TEST → GRAPHICS REWORK → TEST
TEST → PLANNING REWORK → DEVELOPMENT → TEST
TEST → DESIGN REWORK → PLANNING → DEVELOPMENT → ...
```

Only include the minimum lanes required by the failure.

The rework note must include:

- failing acceptance criterion;
- observed evidence;
- responsible lane;
- exact expected correction;
- retest scope.

---

## 12. Non-blocking graphics rule

Graphics and Development must be decoupled through stable asset contracts.

When final art is unavailable, Planning defines a placeholder with the same integration contract expected from the final asset. Development proceeds with the placeholder. Graphics replaces it later without requiring gameplay architecture changes.

A visual dependency may block Test of final presentation, but it must not block unrelated Development work.

---

## 13. Queue buffers

The desired steady-state buffer is small:

- Design/Planning should keep approximately 2–3 future slices understandable;
- `DEVELOPMENT READY`: target 2 WPs;
- `GRAPHICS READY`: target 1–2 WPs when applicable;
- `TEST READY`: target 1–2 WPs.

Do not fully specify dozens of future WPs. Excessive planning creates stale work and rework.

The objective is continuous feed, not backlog size.

---

## 14. Recommended routine cadence

Initial recommended stagger for hourly routines:

```text
HH:00 Design
HH:12 Planning
HH:24 Development
HH:36 Graphics
HH:48 Test
```

The order is intentional: each lane gets a chance to consume the previous lane's latest completed output while all five lanes may still work on different WPs simultaneously.

Cadence may be tuned later from measured queue health, but tuning must not introduce a mandatory central orchestrator.

---

## 15. Audit requirement

Every repository change requires an issue/task and an English audit record containing:

```text
Purpose:
Change:
Refs:
Checks:
Result:
Risks:
Next:
```

Each lane appends evidence relevant to its work. A WP is not VERIFIED when required evidence is missing.

Claims, comments, and audit records must describe actual completed work only. Never claim tests, assets, commits, releases, or verification that did not occur.

---

## 16. Legacy work migration

Legacy process state is ignored for work selection.

A still-valid legacy product issue may be reused only by deliberate conversion:

1. confirm it still aligns with README and higher-authority project direction;
2. create or repurpose a small WP with a new Design Contract;
3. reference the original issue for history;
4. do not inherit old worker claims, role assignment, sequence position, or READY status;
5. avoid duplicate implementation by checking current code and open WPs first.

Do not bulk-convert legacy issues merely to fill queues.

---

## 17. Pipeline health

Useful metrics, once the process has enough data:

- READY queue depth per lane;
- ACTIVE count per lane;
- WAITING age;
- cycle time from Design READY to VERIFIED;
- rework count and source lane;
- Test failure cause distribution;
- percentage of WPs requiring graphics;
- Development starvation frequency.

Metrics are observational. They must not become another authority layer or a sixth blocking routine.

---

## 18. Anti-patterns

Do not:

- create a mandatory orchestrator for routine work;
- let one blocked WP freeze a lane;
- let a claim on WP-A block WP-B;
- keep multiple live claims for one routine;
- make Graphics a prerequisite for coding when a placeholder contract can exist;
- send every Test failure back through all five lanes;
- combine unrelated features into one giant WP;
- split work into technical microtasks with no testable product value;
- let Design write implementation code;
- let Development invent product behavior silently;
- let Graphics invent authoritative mechanics;
- let Test alter implementation just to make tests pass;
- use legacy worker role-fallback rules in the new pipeline;
- change README without explicit Admin authorization.

---

## 19. Definition of pipeline success

The process is working when:

- all five routines can advance different WPs concurrently;
- a blocked WP does not block unrelated work;
- Development normally has at least one READY package;
- Graphics can be bypassed when not required;
- Test routes failures directly to the responsible lane;
- every verified feature has traceable Design, Planning, implementation/assets, checks, and audit evidence;
- product behavior remains aligned with README and Simulation authority.
