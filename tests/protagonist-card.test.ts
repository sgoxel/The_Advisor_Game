/**
 * The resident card must offer the protagonist action (owner request): any NPC
 * can become the person the player advises. The row is pure markup, so it is
 * testable without a browser.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { protagonistRow } from "../src/npc-popup.ts";

test("a resident who is not the protagonist is offered assignment", () => {
  const row = protagonistRow(false);
  assert.match(row, /data-set-protagonist/);
  assert.doesNotMatch(row, /data-focus-protagonist/);
  assert.match(row, /Make this resident your protagonist/);
});

test("the current protagonist can be re-focused but not re-assigned", () => {
  const row = protagonistRow(true);
  assert.match(row, /data-focus-protagonist/);
  assert.doesNotMatch(row, /data-set-protagonist/);
  assert.match(row, /Your protagonist/);
});

test("both variants are real buttons, not links or spans", () => {
  for (const row of [protagonistRow(true), protagonistRow(false)]) {
    assert.match(row, /<button type="button"/, "action must be a button for keyboard/touch use");
    assert.doesNotMatch(row, /<a\s/, "no navigation semantics");
    assert.doesNotMatch(row, /onclick=/i, "no inline handlers");
  }
});
