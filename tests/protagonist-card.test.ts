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

test("the protagonist bar always centres on the resident, indoors or not grounded", async () => {
  const { residentFocusPoint, residentObservationPoint } = await import("../src/npc-popup.ts");
  const { lonLatToSource } = await import("../src/planet.ts");
  const position = { lon: 0.31, lat: -0.42 };
  const expected = lonLatToSource(position.lon, position.lat);
  assert.deepEqual(residentFocusPoint({ position }), expected);
  // The observation point declines indoors/ungrounded residents; the focus point must not.
  assert.equal(residentObservationPoint({ grounded: false, indoors: true, position }), undefined);
  assert.deepEqual(residentFocusPoint({ position }), expected);
});

test("the header clock shows the local fantasy date and time, not realm time", async () => {
  const { FantasyClock, timeZoneOffsetHours, formatFantasyDate } = await import("../src/clock.ts");
  const clock = new FantasyClock();
  const lon = 0.5, tick = 123456;
  assert.equal(clock.labelForLocalTick(tick, lon),
    formatFantasyDate(new Date(clock.origin + (tick + timeZoneOffsetHours(lon) * 3600) * 1000)));
  assert.notEqual(clock.labelForLocalTick(tick, lon), clock.labelForTick(tick));
  // The global label is untouched.
  assert.equal(clock.labelForTick(tick), formatFantasyDate(new Date(clock.origin + tick * 1000)));
});
