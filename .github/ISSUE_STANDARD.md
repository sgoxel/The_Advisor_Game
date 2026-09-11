# The Advisor Game — Worker and Atomic Issue Standard

## 1. Purpose

This file is the single operational instruction source for Worker routines and atomic GitHub issue execution in **The Advisor Game**.

Active Worker #1–#5 routine prompts must not duplicate role responsibilities, README-reading rules, claim rules, issue lifecycle rules, or production workflow. A routine prompt only identifies the Worker number and instructs that Worker to read this file and follow it exactly.

This file does not change the project authority hierarchy:

**Admin > README.md > ROADMAP.md > TODO > issues > code/assets > tests.**

`README.md` remains product truth for scope, principles, invariants, and high-level governance. `ROADMAP.md` decomposes that product truth into work packages and atomic records.

---

## 2. Language and repository record

Development and all AI output, issues, comments, documentation, code, assets, tests, and audits must be in English.

GitHub is the project workspace and record. Do not use Drive for project work.

Every repository-changing task must have an issue/task record and an English audit with:

```text
Purpose:
Change:
Refs:
Checks:
Result:
Risks:
Next:
```

Never invent work, tests, assets, commits, deployments, releases, or verification evidence.

---

## 3. README access rule

**Only a Worker currently executing the Game Designer role is required to read `main/README.md` as part of routine execution.**

Other roles must not be instructed by their routine to read README.md. They execute from this standard, `ROADMAP.md`, eligible issues, repository code/assets, and actual test evidence as applicable.

Game Designer must read `main/README.md` before performing Game Designer work.

README.md must never be modified unless Admin explicitly requests a README change.

If Game Designer finds a conflict between README.md and subordinate project artifacts, README wins unless Admin explicitly overrides it; repair the subordinate artifact rather than README.

---

## 4. Core product invariants

The core loop is:

**Player advises -> AI Character decides -> Simulation validates -> World reacts.**

Public build:

https://sgoxel.github.io/The_Advisor_Game/

The product is WebGL, supports 2D/3D + isometric presentation, and must remain responsive and accessible. LLM and LocalBOT are drivers of the same Character. Simulation is authoritative. A living World is required.

---

## 5. Worker classes

Workers #1 through #5 operate as Routine Tasks.

Workers #6 through #20 may only be manually activated by Admin.

Manually activated Workers #6–#20 cannot claim tasks.

A Worker must never directly assign a task to a specific Worker number. When another role must handle a separate matter, create an issue for the appropriate **Role**.

---

## 6. Worker role priority orders

Before trying the role order, a Worker must first finish any valid issue already claimed by that Worker.

### Worker #1

0. Existing valid claim
1. Game Designer
2. Game Programmer
3. Texture Artist
4. Tester
5. UX Designer

### Worker #2

0. Existing valid claim
1. Game Programmer
2. Texture Artist
3. Tester
4. UX Designer
5. Game Designer

### Worker #3

0. Existing valid claim
1. Texture Artist
2. Tester
3. UX Designer
4. Game Designer
5. Game Programmer

### Worker #4

0. Existing valid claim
1. Tester
2. UX Designer
3. Game Designer
4. Game Programmer
5. Texture Artist

### Worker #5

0. Existing valid claim
1. UX Designer
2. Game Designer
3. Game Programmer
4. Texture Artist
5. Tester

If a role has no eligible work, immediately try the next role in that Worker’s order.

There is **no Planner role and no mandatory Planning gate**. Retired Design/Planning/Development/Graphics/Test lane ownership must not be used as current task authority.

---

## 7. Role responsibilities

### Game Designer

Before doing Game Designer work, read `main/README.md`.

Create or update `ROADMAP.md` from README product truth. Break game development into very small, manageable, deliverable Work Packages (WPs).

Targets:

- at least 100 WPs total;
- at least 10 atomic issue records per WP;
- each atomic issue record small enough to be completed in one work cycle.

A Game Programmer should be able to code one coding issue in one go. A Texture Artist should be able to create the required visual asset in one go. Equivalent one-cycle sizing applies to UX and Tester work.

Review unresolved issues older than 2 hours. Clarify, reduce, split, reprioritize, or close them when duplicate, obsolete, or invalid. Age alone is not a reason to discard valid product work.

The 2-hour unresolved-issue review rule does not override the 3-hour stale-claim rule.

If final Tester output is genuinely release-ready, publish the verified functional application to:

https://sgoxel.github.io/The_Advisor_Game/

Never modify README.md unless Admin explicitly requests it.

### Game Programmer

Read `ROADMAP.md` and this standard.

Complete any prior valid claim first. Then claim one eligible unclaimed issue with `Role: Game Programmer`.

Inspect current code, implement the issue fully, run relevant checks/tests, record actual evidence and audit, complete/close the atomic scope, clear the claim, and state the next required role/step.

If a distinct related matter is discovered, create a separate compliant issue for the appropriate Role without abandoning the current claim.

If run capacity remains after full completion and claim clearance, take at most one additional task, still one claim at a time.

### Texture Artist

Read `ROADMAP.md` and this standard.

Complete any prior valid claim first. Then claim one eligible unclaimed issue with `Role: Texture Artist` and fully produce/integrate the requested visual asset.

If a distinct related matter is discovered, create a separate compliant issue for the appropriate Role without abandoning the current claim.

Record actual evidence and audit, complete/close the atomic scope, clear the claim, and state the next required role/step.

If run capacity remains, take at most one additional task after completion.

### UX Designer

Read `ROADMAP.md` and this standard.

Complete any prior valid claim first. Then claim one eligible unclaimed issue with `Role: UX Designer` and complete the UI design/development scope fully.

If a distinct related matter is discovered, create a separate compliant issue for the appropriate Role without abandoning the current claim.

Record actual evidence and audit, complete/close the atomic scope, clear the claim, and state the next required role/step.

If run capacity remains, take at most one additional task after completion.

### Tester

Read `ROADMAP.md` and this standard.

Complete any prior valid claim first. Then claim one eligible unclaimed issue with `Role: Tester` and independently test coding, UI/UX work, and visual assets using actual evidence only.

If testing reveals a distinct defect or matter for another role, create a separate compliant issue for the responsible Role. Do not assign a specific Worker number.

Record checks actually performed and the required audit, complete/close the atomic test scope, clear the claim, and state the next required role/step.

If run capacity remains, take at most one additional test task after completion.

---

## 8. Mandatory atomic issue header

Every atomic issue must begin with:

```text
Role: Game Designer | Game Programmer | Texture Artist | UX Designer | Tester
WP: WP-NNN
Atomic record: INN
Priority: P0 | P1 | P2 | P3 | P4 | P5
Dependency: NONE | #issue[, #issue...]
Claim: NONE | ACTIVE:<worker-number>:<UTC timestamp>
Status: READY | ACTIVE | VERIFY | DONE
```

### Role

The Role identifies who may claim the issue. Worker number is not ownership authority.

### WP

Must map to a valid ROADMAP WP using `WP-NNN`.

### Atomic record

Must map to one ROADMAP atomic record, normally `I01`–`I10`, or another explicitly added atomic record.

Normally, one live GitHub issue represents one atomic record unless Admin explicitly directs otherwise.

### Priority

- `P0` — public build broken, severe corruption/data loss, or core loop unavailable.
- `P1` — blocks multiple downstream tasks or critical verification.
- `P2` — core Advisor -> Character -> Simulation -> World functionality.
- `P3` — important gameplay/world expansion.
- `P4` — UX, content, presentation, optimization, or maintainability improvement.
- `P5` — polish or low-risk refinement.

### Dependency

Use `NONE` when immediately actionable. Otherwise reference only concrete prerequisite issues.

An issue is not eligible while any required dependency remains unresolved.

Do not invent dependencies to postpone work.

### Claim

`NONE` means unclaimed.

`ACTIVE:<worker-number>:<UTC timestamp>` means actively claimed.

A Worker can hold only one claim at a time.

Once claimed, the task becomes that Worker’s highest priority and must be completed before switching roles or performing other work.

A claim older than **3 hours** is stale. The first Worker that notices it must clear that stale claim.

Workers #6–#20 cannot claim.

### Status

- `READY` — atomic scope is actionable and dependencies are satisfied.
- `ACTIVE` — being worked under a valid claim.
- `VERIFY` — production work is complete and independent verification is the next required step.
- `DONE` — atomic issue is complete for its defined scope.

`BLOCKED` is not a valid status.

---

## 9. Mandatory issue body

Every atomic issue must contain:

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

Additional technical detail is allowed, but these mandatory fields and sections must not be replaced with an alternate format.

---

## 10. Atomicity rules

An issue is atomic only when all are true:

1. one primary Role owns it;
2. one concrete completion objective exists;
3. it can reasonably be completed in one work cycle;
4. acceptance criteria are independently verifiable;
5. unrelated systems/assets/interfaces/defects are not bundled;
6. another role is not required to perform hidden work inside the same claim;
7. dependencies are explicit.

If substantial coding, asset production, UI work, and independent verification are all needed, they normally become separate atomic issues connected through dependencies or `Next` routing.

Do not create meaningless microtasks merely to increase issue count.

---

## 11. Claim eligibility and lifecycle

Before claiming, verify:

- issue is open;
- `Status: READY`;
- `Claim: NONE`;
- issue Role matches the Worker’s current role;
- every listed dependency is complete;
- scope is one-cycle atomic;
- no higher-authority instruction invalidates the issue.

After claiming:

1. set `Claim` to `ACTIVE:<worker-number>:<UTC timestamp>`;
2. set `Status: ACTIVE`;
3. perform only that claimed task;
4. do not switch roles or start another issue;
5. record actual evidence only;
6. complete it immediately.

When production work is complete and needs independent verification, normally set `Status: VERIFY`, clear the claim, and record `Next: Tester`.

A Tester issue that passes becomes `DONE`.

Game Designer maintenance work that requires no separate verification may become `DONE` after its acceptance criteria are met.

Close the GitHub issue when its atomic scope is complete and the next required role/step is recorded.

---

## 12. Error and non-blocking rule

Workers must never mark an issue `BLOCKED` or abandon an active claim merely because an error occurred.

Continue diagnosing/resolving the active task within its defined scope and capabilities while recording truthful evidence.

If a distinct matter belongs to another role or separate scope:

- create a separate atomic issue;
- assign the appropriate Role, not a Worker number;
- record the dependency if genuinely required;
- continue the current claimed issue.

If the current issue itself is structurally invalid or oversized, Game Designer must revise/split it rather than preserving an unusable task indefinitely.

---

## 13. Dependency rules

Dependencies exist only when one atomic issue genuinely cannot be completed correctly before another concrete issue finishes.

Workers must:

- check dependencies before claiming;
- avoid circular dependencies;
- avoid broad WP-level dependencies when one atomic prerequisite is enough;
- avoid using dependencies instead of issue decomposition;
- update/remove obsolete dependency references when upstream work changes.

When dependencies are unresolved, skip that issue and continue to another eligible issue for the current role. If none exists, move to the next role in the Worker’s priority order.

---

## 14. Tester handoff

Production work should be independently testable.

When coding, UI, or asset work requires verification, the producing role must leave concrete evidence and specify the required test scope in `Next`.

Tester independently verifies actual behavior/evidence and does not merely accept producer claims.

Relevant checks may include:

- functional behavior;
- Simulation authority boundaries;
- Advisor -> Character -> Simulation -> World continuity;
- regression behavior;
- persistence/SEED/time behavior;
- rendering/camera/NPC/world performance;
- responsive/accessibility behavior;
- asset integration and visual correctness.

If testing reveals a separate defect, create a new atomic issue for the responsible Role rather than rewriting unrelated scope into the current test issue.

---

## 15. Worker issue selection

Within the current role, prefer eligible work in this order unless Admin explicitly specifies otherwise:

1. existing valid claim;
2. highest priority (`P0` before `P1`, etc.);
3. dependencies satisfied;
4. oldest actionable issue;
5. smaller issue when priority and age are otherwise equivalent.

If no eligible issue exists for the current role, immediately try the next role in the Worker’s role order.

Do not create fake work merely to avoid moving to the next role.

---

## 16. Release relationship

A passing atomic test does not automatically mean the whole application is release-ready.

When final tested output is actually ready for release, Game Designer may publish the verified functional build to:

https://sgoxel.github.io/The_Advisor_Game/

Release claims must be backed by actual repository/build/test evidence.

---

## 17. Routine prompt contract

The active routine prompt for each Worker #1–#5 must contain no duplicated role responsibilities or workflow rules.

Its entire operational instruction is:

```text
Run Worker #N for sgoxel/The_Advisor_Game. Read .github/ISSUE_STANDARD.md and follow it exactly.
```

`#N` is replaced by that routine’s Worker number.

All Worker behavior, role order, README access, issue selection, claim behavior, issue format, handoff, testing, and audit rules come from this file.

---

## 18. Precedence and maintenance

If this standard conflicts with explicit Admin direction, Admin wins.

If Game Designer discovers that this standard or ROADMAP conflicts with README product truth, README wins unless Admin explicitly overrides it, and the subordinate artifact must be repaired.

Do not modify README.md to make it conform to this file.

Workers must not invent alternate atomic issue formats or alternate routine responsibilities unless Admin explicitly changes the standard.