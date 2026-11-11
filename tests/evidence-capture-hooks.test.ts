/**
 * Evidence capture hooks (WP-S003-004-001 instrumentation).
 *
 * Two independent defects made every terrain capture unable to satisfy a visual
 * gate: shots landed at night (the clock derives from real wall-clock time) and
 * adaptive resolution silently halved the canvas on a slow GPU, so a "1080p"
 * PNG was a 540p upscale. These are the bounds the evidence hooks must respect.
 *
 * The hooks themselves live in main.ts and are only reachable through
 * `window.advisorWorld`; gameplay never calls them and nothing is persisted.
 */
import test from "node:test";
import assert from "node:assert/strict";

/** Mirrors the validation in `setEvidenceTick`. */
function acceptsHour(hour: number | undefined): boolean {
  if (hour === undefined) return true;
  return Number.isFinite(hour) && hour >= 0 && hour <= 24;
}

/** Mirrors the validation in `setEvidenceRenderScale`. */
function acceptsScale(scale: number | undefined): boolean {
  if (scale === undefined) return true;
  return Number.isFinite(scale) && scale > 0 && scale <= 4;
}

/**
 * Mirrors the tick calculation: move to `hour` on the same fantasy day by
 * shifting a whole number of seconds from the current realm tick.
 */
function tickForHour(nowTick: number, hour: number): number {
  const secondOfDay = ((nowTick % 86400) + 86400) % 86400;
  return Math.max(0, nowTick + Math.round(hour * 3600 - secondOfDay));
}

test("the hour pin accepts only a real 0-24 hour", () => {
  assert.equal(acceptsHour(0), true);
  assert.equal(acceptsHour(12), true);
  assert.equal(acceptsHour(24), true);
  assert.equal(acceptsHour(-1), false);
  assert.equal(acceptsHour(25), false);
  assert.equal(acceptsHour(Number.NaN), false);
  assert.equal(acceptsHour(Number.POSITIVE_INFINITY), false);
  assert.equal(acceptsHour(undefined), true, "undefined is the documented 'release' value");
});

test("the render-scale pin accepts only a sane positive scale", () => {
  assert.equal(acceptsScale(1), true);
  assert.equal(acceptsScale(0.5), true);
  assert.equal(acceptsScale(4), true);
  assert.equal(acceptsScale(0), false);
  assert.equal(acceptsScale(-1), false);
  assert.equal(acceptsScale(5), false);
  assert.equal(acceptsScale(Number.NaN), false);
  assert.equal(acceptsScale(undefined), true, "undefined restores adaptive behaviour");
});

test("pinning an hour lands on that hour of the same fantasy day", () => {
  const nowTick = 100_000; // arbitrary realm tick
  for (const hour of [0, 6, 12, 18]) {
    const tick = tickForHour(nowTick, hour);
    const secondOfDay = ((tick % 86400) + 86400) % 86400;
    assert.equal(secondOfDay, hour * 3600, `hour ${hour} did not resolve to ${hour}:00`);
  }
});

test("pinning an hour never moves by more than one day", () => {
  const nowTick = 100_000;
  const tick = tickForHour(nowTick, 12);
  assert.ok(Math.abs(tick - nowTick) <= 86_400, "the pin must stay within the same calendar day");
  assert.ok(tick >= 0, "a pinned tick can never be negative");
});

test("daylight hours are reachable and night hours are distinguishable", () => {
  const nowTick = 100_000;
  // The scene must be capturable in conditions where relief is readable.
  const noon = tickForHour(nowTick, 12);
  const midnight = tickForHour(nowTick, 0);
  const noonSecond = ((noon % 86400) + 86400) % 86400;
  const midnightSecond = ((midnight % 86400) + 86400) % 86400;
  assert.equal(noonSecond, 43_200);
  assert.equal(midnightSecond, 0);
});
