/**
 * WP-S009-003-001 — renderer loss/recovery contract.
 *
 * Two guarantees are tested here:
 *  1. the player is told the truth (no "reload the page" when recovery is possible);
 *  2. a recovered scene preserves SEED, fantasy tick, focus, heading, selection
 *     and campaign identity — only renderer-owned resources are rebuilt.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  RECOVERY_ORDER,
  comparePreservedState,
  describeDeviceLoss,
  describeRecovery,
  isRecoverableLoss,
  type PreservedState,
} from "../src/renderer-recovery.ts";

const state = (over: Partial<PreservedState> = {}): PreservedState => ({
  seed: "ADVISOR-0126-ALDERWICK",
  fantasyTick: 72584024,
  focusLon: -1.1733065102661904,
  focusLat: -0.27830339108551627,
  heading: 0.22,
  selectedCanonicalId: "…/RESIDENT/12",
  campaignId: "69fe765d36a9a80b",
  ...over,
});

test("a loss message never demands a reload while recovery is possible", () => {
  const report = describeDeviceLoss(state());
  assert.equal(report.pauseRendering, true, "rendering must pause while the device is gone");
  assert.doesNotMatch(report.message, /reload/i, "recovery is automatic, so a reload must not be demanded");
  assert.match(report.message, /untouched|unchanged|resume/i);
});

test("the loss report captures the exact state that must survive", () => {
  const before = state();
  const report = describeDeviceLoss(before);
  assert.deepEqual(report.snapshot, before);
  // The snapshot must be a copy, not the live object.
  assert.notEqual(report.snapshot, before);
});

test("an identical restored state compares clean", () => {
  assert.deepEqual(comparePreservedState(state(), state()), []);
});

test("every preserved field is individually detected when it changes", () => {
  const base = state();
  const cases: [Partial<PreservedState>, string][] = [
    [{ seed: "OTHER-SEED" }, "seed"],
    [{ fantasyTick: 72584025 }, "fantasyTick"],
    [{ focusLon: -1.17 }, "focusLon"],
    [{ focusLat: -0.27 }, "focusLat"],
    [{ heading: 0.23 }, "heading"],
    [{ selectedCanonicalId: null }, "selectedCanonicalId"],
    [{ campaignId: null }, "campaignId"],
  ];
  for (const [override, field] of cases) {
    assert.deepEqual(comparePreservedState(base, state(override)), [field], `${field} change was not detected`);
  }
});

test("sub-nanometre focus drift is not treated as a state change", () => {
  const drift = state({ focusLon: state().focusLon + 1e-12 });
  assert.deepEqual(comparePreservedState(state(), drift), [], "floating point noise must not read as a jump");
});

test("a clean recovery reports success only when everything was rebuilt and state held", () => {
  const report = describeRecovery(state(), state(), RECOVERY_ORDER);
  assert.equal(report.ok, true);
  assert.equal(report.statePreserved, true);
  assert.deepEqual(report.changed, []);
  assert.match(report.message, /unchanged/);
});

test("a recovery that lost the selection is reported as a failure, not success", () => {
  const report = describeRecovery(state(), state({ selectedCanonicalId: null }), RECOVERY_ORDER);
  assert.equal(report.ok, false);
  assert.equal(report.statePreserved, false);
  assert.deepEqual(report.changed, ["selectedCanonicalId"]);
  assert.match(report.message, /state changed/i);
});

test("a recovery that skipped resources is reported honestly", () => {
  const partial = RECOVERY_ORDER.slice(0, 2);
  const report = describeRecovery(state(), state(), partial);
  assert.equal(report.ok, false);
  assert.match(report.message, /not rebuilt/i);
  assert.deepEqual(report.rebuilt, partial);
});

test("recovery rebuilds presentation classes in a fixed documented order", () => {
  assert.deepEqual([...RECOVERY_ORDER], [
    "render-targets",
    "globe-surface",
    "materials",
    "terrain-meshes",
    "actor-textures",
  ]);
  // Nothing in the rebuild list may be a world/Simulation concept.
  for (const target of RECOVERY_ORDER) {
    assert.doesNotMatch(target, /resident|route|settlement|resource|inventory|actor-identity/);
  }
});

test("only genuinely unrecoverable losses take the failure path", () => {
  assert.equal(isRecoverableLoss("Device lost"), true);
  assert.equal(isRecoverableLoss("context lost"), true);
  assert.equal(isRecoverableLoss("device destroyed"), false, "a destroyed device cannot come back");
});
