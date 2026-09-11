# The Advisor Game — Atomic Issue Standard

## 1. Purpose

This file defines the mandatory structure and lifecycle for atomic GitHub issues used by routine workers and manually activated roles in **The Advisor Game**.

It exists to keep work small, executable, auditable, and directly transferable between the current project roles without introducing a separate planning gate.

Authority remains:

**Admin > README.md > ROADMAP.md > TODO > issues > code/assets > tests.**

`README.md` remains product truth for scope, principles, invariants, and high-level governance. This file must never be used to override README or explicit Admin direction.

---

## 2. Scope

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

## 3. Mandatory issue header

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
- Identifies the role allowed to claim the issue.
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
- `READY` = atomic scope is actionable and dependencies are satisfied.
- `ACTIVE` = currently being worked under a valid claim.
- `VERIFY` = implementation/asset/UI work is complete and independent testing is the next required step.
- `DONE` = the atomic issue is complete for its defined scope.

`BLOCKED` is not a valid status.

---

## 4. Mandatory issue body

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

## 5. Atomicity rules

An issue is atomic only when all of the following are true:

1. It has one primary role owner.
2. It has one concrete completion objective.
3. It can reasonably be completed in one work cycle.
4. Its acceptance criteria are independently verifiable.
5. It does not bundle unrelated systems, assets, interfaces, or defects.
6. It does not require another role to complete hidden work inside the same claim.
7. Its dependencies are explicit.

If one issue requires significant coding, a new asset, UI redesign, and independent verification, those must normally be separate atomic issues connected by dependencies or `Next` routing.

Do not create technical microtasks that have no meaningful executable or verifiable outcome merely to increase issue count.

---

## 6. Role routing

Atomic work is routed directly to the role responsible for producing or verifying it.

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

## 7. Claim lifecycle

Before claiming an issue, a worker must verify:

- the issue is open;
- `Status: READY`;
- `Claim: NONE`;
- the issue Role matches the worker's current role;
- all listed dependencies are complete;
- the scope is small enough for one cycle;
- no higher-authority instruction makes the issue invalid.

After claiming:

1. set `Claim` to an active claim with timestamp;
2. set `Status: ACTIVE`;
3. perform only that claimed task;
4. do not switch roles or start another issue;
5. record actual evidence only;
6. finish the issue immediately.

When complete:

- production work requiring independent verification normally moves to `Status: VERIFY`, clears its claim, and states `Next: Tester`;
- a standalone Tester issue that passes becomes `Status: DONE`;
- design/maintenance work that requires no separate verification may become `DONE` when its own acceptance criteria are fully met;
- close the GitHub issue when its atomic scope is complete and the required next step is recorded.

A worker must never keep several active claims.

---

## 8. Error and non-blocking rule

Workers must never mark work `BLOCKED` or abandon an active claim merely because an error occurred.

For the active claimed issue, the worker must continue diagnosing and resolving the problem within the issue's scope and capabilities, while recording truthful evidence.

If a distinct matter belongs to another role or separate scope:

- open a separate atomic issue;
- assign the appropriate **Role**, not a specific worker number;
- record the dependency if required;
- continue and finish the current claimed issue as far as its defined scope allows.

If the current issue itself is structurally invalid or oversized, Game Designer must revise/split it according to project rules rather than preserving an unusable task indefinitely.

---

## 9. Issue age and stale work

Game Designer reviews unresolved issues older than **2 hours**.

For such issues, Game Designer must determine whether the issue should be:

- clarified;
- reduced in scope;
- split into smaller atomic issues;
- reprioritized;
- closed as duplicate, obsolete, or invalid.

Age alone is not a reason to discard valid product work.

The **2-hour unresolved-issue review rule does not replace the 3-hour claim expiry rule**. An active claim becomes stale only after 3 hours unless Admin explicitly overrides the rule.

---

## 10. Dependency rules

Dependencies exist only when one atomic issue genuinely cannot be completed correctly before another concrete issue finishes.

Workers must:

- check dependencies before claiming;
- avoid circular dependencies;
- avoid broad dependencies such as an entire WP when only one atomic prerequisite is required;
- avoid using dependencies as a substitute for issue decomposition;
- update/remove obsolete dependency references when upstream work changes.

When dependencies are unresolved, the worker should skip that issue and select another eligible issue for the same role after any prior active claim has been completed/cleared.

---

## 11. Tester handoff

Production work should be independently testable.

When coding, UI, or asset work needs verification, the producing role must leave concrete evidence and specify the required test scope in `Next`.

The Tester must verify actual behavior/evidence and must not merely accept the producer's claims.

Tester checks may include, where relevant:

- functional behavior;
- Simulation authority boundaries;
- Advisor -> Character -> Simulation -> World continuity;
- regression behavior;
- persistence/SEED/time behavior;
- rendering/camera/NPC/world performance;
- responsive/accessibility behavior;
- asset integration and visual correctness.

If testing reveals a separate defect, create a new atomic issue for the responsible role rather than rewriting unrelated scope into the current test issue.

---

## 12. Audit standard

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

## 13. Recommended issue template

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

## 14. Worker selection rule

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

## 15. Release relationship

A passing atomic test issue does not automatically mean the entire application is release-ready.

When final tested output is actually ready for release, the Game Designer may publish the verified functional build to:

https://sgoxel.github.io/The_Advisor_Game/

Release claims must be backed by actual repository/build/test evidence.

---

## 16. Precedence and maintenance

If this standard conflicts with:

1. explicit Admin direction — Admin wins;
2. `README.md` — README wins;
3. `ROADMAP.md` product decomposition — repair this standard or subordinate issue data as needed.

Do not modify `README.md` to make it conform to this file.

Workers must not invent alternate atomic issue formats unless Admin explicitly changes the standard.
