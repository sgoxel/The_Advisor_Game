---
name: Work Package
about: Small vertical product slice for the five-lane production pipeline
title: "[WP-NNN] "
labels: ""
assignees: ""
---

# Work Package Control

- **WP:** WP-NNN
- **Stage:** DESIGN
- **State:** READY
- **Priority:** P0 | P1 | P2 | P3 | P4 | P5
- **Lane owner:** Design
- **Claim:** NONE
- **Parent/refs:**

> `README.md` is product truth. `WORKFLOW.md` defines process. On conflict, README wins.

## Purpose

Describe the single player-visible or independently testable outcome this WP exists to deliver.

## Product alignment

- README principle/invariant supported:
- Core loop impact: Advisor → Character → Simulation → World
- Why this belongs now:

## Dependencies

- Blocking dependencies:
- Downstream work unlocked:
- Legacy issue references, if deliberately converted:

---

# Design Contract

## Objective

## Player-visible behavior

## Simulation/world implications

## UI/interaction expectations

## Asset needs

## Acceptance scenarios

1.
2.
3.

## Non-goals

- 

## Performance-sensitive concerns

## Persistence / time / SEED implications

## Design gate

- [ ] Scope is one small vertical slice.
- [ ] Acceptance scenarios are observable and testable.
- [ ] README conflicts were checked.
- [ ] Dependencies are explicit.
- [ ] Asset need is identified.
- [ ] Ready for Planning.

---

# Planning Contract

## Scope / out of scope

## Authoritative state affected

## Presentation-only state affected

## Expected files/modules/interfaces

## Data structures/contracts

## Execution sequence

## Persistence/migration implications

## Performance constraints/budgets

## Determinism / SEED requirements

## Instrumentation/logging

## Asset Manifest

Use `GRAPHICS: N/A` when no new or modified final asset is required.

For each required asset:

- **Asset ID:**
- **Type/role:**
- **States/variants:**
- **Perspective/projection:**
- **Dimensions/scale:**
- **Transparency/background:**
- **Anchor/origin:**
- **Atlas/naming/format:**
- **Animation states:**
- **Integration path:**
- **Placeholder contract:**

## Test plan

### Functional

### Simulation authority

### World integration

### Regression

### Performance

### Persistence / SEED / time

### Accessibility / responsiveness / localization

## Failure/rollback considerations

## Definition of Done

- [ ]
- [ ]
- [ ]

## Planning gate

- [ ] Current code was inspected before implementation instructions were written.
- [ ] Design ambiguity is resolved or explicitly returned to Design.
- [ ] Authoritative vs presentation state is clear.
- [ ] Graphics can be bypassed or placeholder-integrated without blocking Development.
- [ ] Test evidence requirements are explicit.
- [ ] Ready for Development.

---

# Development Evidence

## Changes implemented

## Files changed

## Automated tests added/updated

## Smoke/regression checks run

## Instrumentation/logging evidence

## Deviations from Planning Contract

## Development gate

- [ ] Planned behavior is implemented.
- [ ] Simulation remains authoritative.
- [ ] AI/presentation did not gain authoritative mutation paths.
- [ ] Required tests/checks passed for Development handoff.
- [ ] Asset placeholders/final asset interfaces are integrated when required.
- [ ] Ready for Graphics or Test.

---

# Graphics Evidence

Use `GRAPHICS: N/A` if bypassed.

## Assets created/modified

## Source/generation notes

## Technical conformance

- [ ] Correct stable asset IDs.
- [ ] Scale/dimensions conform.
- [ ] Anchors/origins conform.
- [ ] Transparency/background conform.
- [ ] Atlas/naming/format conform.
- [ ] Required visual/animation states exist.
- [ ] Asset replacement did not alter authoritative mechanics.

## Integration evidence

## Graphics gate

- [ ] Asset Manifest satisfied.
- [ ] Placeholders replaced where required.
- [ ] Ready for Test.

---

# Test Evidence

## Environment/build/commit tested

## Functional result

## Simulation authority result

## World integration result

## Regression result

## Performance result

## Persistence / SEED / time result

## Accessibility / responsiveness / localization result

## Failures

For every failure record:

- failing acceptance criterion;
- observed evidence;
- responsible lane;
- exact expected correction;
- retest scope.

## Test gate

- [ ] All applicable acceptance scenarios passed.
- [ ] No unresolved required evidence remains.
- [ ] Any failure was routed only to the responsible lane.
- [ ] WP may be marked VERIFIED / DONE.

---

# Audit

**Purpose:**

**Change:**

**Refs:**

**Checks:**

**Result:**

**Risks:**

**Next:**
