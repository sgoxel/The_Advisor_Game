import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SEPARATION_OFFSET_M, separateVisibleActors } from "../src/actor-separation.ts";

const actor = (code: string, x: number, z: number) => ({ code, x, z });

test("residents at distinct spots keep every authoritative centimetre", () => {
  const actors = [actor("B/RESIDENT/1", 10, 20), actor("B/RESIDENT/2", 10.9, 20)];
  const placed = separateVisibleActors(actors);
  assert.deepEqual(placed.get("B/RESIDENT/1"), { x: 10, z: 20 });
  assert.deepEqual(placed.get("B/RESIDENT/2"), { x: 10.9, z: 20 });
});

test("two cut-outs at the same doorway are drawn apart, deterministically", () => {
  const actors = [actor("B/RESIDENT/9", 4, -2), actor("B/RESIDENT/3", 4, -2), actor("B/RESIDENT/7", 4, -2)];
  for (let run = 0; run < 3; run++) {
    const placed = separateVisibleActors(actors);
    assert.equal(placed.size, 3);
    const points = [...placed.values()];
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++)
      assert.ok(Math.hypot(points[i].x - points[j].x, points[i].z - points[j].z) >= 0.42 - 1e-9,
        `pair ${i}/${j} still shares a pixel`);
    // The lowest resident code keeps its canonical feet.
    assert.deepEqual(placed.get("B/RESIDENT/3"), { x: 4, z: -2 });
    if (run === 0) globalThis.__first = JSON.stringify([...placed]);
    else assert.equal(JSON.stringify([...placed]), globalThis.__first, "layout is stable across runs");
  }
});

test("no drawn resident is moved beyond the picker tolerance", () => {
  // Eight co-located cut-outs is the worst case the actor pool can show.
  const actors = Array.from({ length: 8 }, (_, i) => actor(`B/RESIDENT/${i}`, 8, 3));
  for (const minDistanceM of [0.3, 0.42, 0.8, 2]) {
    const placed = separateVisibleActors(actors, minDistanceM);
    assert.equal(placed.size, 8);
    for (const point of placed.values())
      assert.ok(Math.hypot(point.x - 8, point.z - 3) <= MAX_SEPARATION_OFFSET_M + 1e-9,
        `offset ${Math.hypot(point.x - 8, point.z - 3).toFixed(2)} m exceeds the picker tolerance`);
  }
});

test("a normal crowd on distinct standing slots is never touched", () => {
  const actors = Array.from({ length: 8 }, (_, i) => actor(`B/RESIDENT/${i}`, i * 0.9, 0));
  const placed = separateVisibleActors(actors);
  for (const actor of actors)
    assert.deepEqual(placed.get(actor.code), { x: actor.x, z: actor.z });
});
