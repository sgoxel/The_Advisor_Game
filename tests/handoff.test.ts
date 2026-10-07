import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HANDOFF_LOCAL_FOOTPRINT,
  HANDOFF_GLOBE_FOOTPRINT,
  HANDOFF_LOCAL_HALF_HEIGHT,
  HANDOFF_GLOBE_HALF_HEIGHT,
  projectionTransitionForHalfHeight,
  advanceProjectionTransition,
  scaleLabelForHalfHeight,
} from "../src/handoff.ts";
import {
  CANONICAL_PLANET_RADIUS,
  CANONICAL_PLANET_CIRCUMFERENCE,
  canonicalFootprintForHalfHeight,
} from "../src/planet.ts";

test("handoff anchors are derived from the canonical 637.1 km planet", () => {
  assert.equal(CANONICAL_PLANET_RADIUS, 637100);
  assert.ok(Math.abs(CANONICAL_PLANET_CIRCUMFERENCE - 4003017.36) < 0.01);
  assert.ok(Math.abs(canonicalFootprintForHalfHeight(HANDOFF_LOCAL_HALF_HEIGHT) - HANDOFF_LOCAL_FOOTPRINT) < 1e-6);
  assert.ok(Math.abs(canonicalFootprintForHalfHeight(HANDOFF_GLOBE_HALF_HEIGHT) - HANDOFF_GLOBE_FOOTPRINT) < 1e-6);
  assert.equal(projectionTransitionForHalfHeight(HANDOFF_LOCAL_HALF_HEIGHT), 0);
  assert.equal(projectionTransitionForHalfHeight(HANDOFF_GLOBE_HALF_HEIGHT), 1);
});

test("projection blend is monotonic and reverses without resetting", () => {
  const mid = Math.sqrt(HANDOFF_LOCAL_HALF_HEIGHT * HANDOFF_GLOBE_HALF_HEIGHT);
  const target = projectionTransitionForHalfHeight(mid);
  assert.ok(target > 0 && target < 1);
  let value = 0;
  for (let i = 0; i < 20; i++) value = advanceProjectionTransition(value, target, 1 / 60);
  assert.ok(value > 0 && value < target);
  const before = value;
  for (let i = 0; i < 10; i++) value = advanceProjectionTransition(value, 0, 1 / 60);
  assert.ok(value < before && value >= 0);
});

test("player-facing labels use the canonical slash scale form", () => {
  for (const halfHeight of [HANDOFF_LOCAL_HALF_HEIGHT, HANDOFF_GLOBE_HALF_HEIGHT, 97])
    assert.match(scaleLabelForHalfHeight(halfHeight), /^1\/(10|20|50|100|250|500|1000|2500|5000|10000)$/);
});
