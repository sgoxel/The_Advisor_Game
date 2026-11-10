/**
 * WP-S009-002-001 — idle DOM-write guard.
 *
 * Measured on a settled camera the page performed 97 text writes in 15 s of idle,
 * 40% of them identical no-ops. Each no-op still makes the browser invalidate the
 * node. These tests pin the guard that removed them, and pin that it can never
 * swallow a real change.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { TextSlot, WriteTelemetry, sameText, setText } from "../src/idle-write-guard.ts";

/** Minimal text node stand-in that records writes. */
function node(initial: string | null = null) {
  const state = { textContent: initial, writes: 0 };
  return {
    get textContent() { return state.textContent; },
    set textContent(value: string | null) { state.textContent = value; state.writes++; },
    get writes() { return state.writes; },
  };
}

test("setText writes the first value and suppresses an identical repeat", () => {
  const el = node("");
  assert.equal(setText(el, "3 tiles · ready"), true, "the first write must happen");
  assert.equal(el.writes, 1);
  assert.equal(setText(el, "3 tiles · ready"), false, "an identical value must not write");
  assert.equal(el.writes, 1, "no second DOM write for identical content");
  assert.equal(el.textContent, "3 tiles · ready");
});

test("setText still writes a genuine change", () => {
  const el = node("3 tiles · ready");
  assert.equal(setText(el, "4 tiles · refining"), true);
  assert.equal(el.textContent, "4 tiles · refining");
  assert.equal(el.writes, 1);
});

test("setText tolerates a missing node", () => {
  assert.equal(setText(null, "x"), false);
  assert.equal(setText(undefined, "x"), false);
});

test("a settled status string repeated 60 times causes exactly one write", () => {
  const el = node("");
  let written = 0;
  for (let frame = 0; frame < 60; frame++) if (setText(el, "12 tiles · ready · residents pending")) written++;
  assert.equal(written, 1, "an unchanging HUD must be written once, not once per frame");
});

test("TextSlot tracks its own last value and reports whether it wrote", () => {
  const el = node(null);
  const slot = new TextSlot(el);
  assert.equal(slot.set("a"), true);
  assert.equal(slot.set("a"), false);
  assert.equal(slot.set("b"), true);
  assert.equal(el.writes, 2);
  assert.equal(slot.current, "b");
});

test("TextSlot adopts an external write so it cannot suppress the next real change", () => {
  const el = node("initial");
  const slot = new TextSlot(el);
  // Another subsystem writes directly.
  el.textContent = "external";
  // Without sync the slot still thinks it owns "initial" and would let "external"
  // through — which is correct — but syncing keeps its view truthful.
  slot.sync(el.textContent);
  assert.equal(slot.current, "external");
  assert.equal(slot.set("external"), false, "no redundant write after sync");
  assert.equal(slot.set("changed"), true, "a real change still lands");
});

test("TextSlot on a missing node never throws and never claims a write", () => {
  const slot = new TextSlot(null);
  assert.equal(slot.set("anything"), false);
  assert.equal(slot.current, null);
});

test("telemetry separates real writes from suppressed no-ops", () => {
  const el = node("");
  const telemetry = new WriteTelemetry();
  for (let i = 0; i < 10; i++) {
    if (setText(el, "stable")) telemetry.recordWrote();
    else telemetry.recordSuppressed();
  }
  assert.deepEqual(telemetry.stats, { writes: 1, suppressed: 9 });
  telemetry.reset();
  assert.deepEqual(telemetry.stats, { writes: 0, suppressed: 0 });
});

test("sameText treats null and empty as equal, but real text as different", () => {
  assert.equal(sameText(null, ""), true);
  assert.equal(sameText(undefined, null), true);
  assert.equal(sameText("a", "a"), true);
  assert.equal(sameText("a", "b"), false);
});

test("guarding never changes what the player actually sees", () => {
  const el = node("");
  const sequence = ["1 tiles · ready", "1 tiles · ready", "5 tiles · refining", "5 tiles · refining", "5 tiles · ready"];
  for (const value of sequence) setText(el, value);
  // The DOM ends on the same value an unguarded writer would have left.
  assert.equal(el.textContent, sequence[sequence.length - 1]);
});
