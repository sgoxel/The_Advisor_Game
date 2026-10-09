import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cellAt, biomeAt, heightAt, naturalHeightAt, surfaceAt } from "../src/world.ts";
import {
  EARTHWORK_LIMITS,
  WORLD_PRIORITIES,
  clearSurfaceCaches,
  earthworkExamples,
  modifiersAt,
  reservedUseAt,
  surfaceModifiers,
  surfaceSampleAt,
  type NaturalSampler,
} from "../src/surface-compositor.ts";
import { SOURCE_PRESENTATION_WIDTH } from "../src/planet.ts";
import { roads } from "../src/geography.ts";

const L = EARTHWORK_LIMITS;

// One bounded scan of plan data, shared by every example-driven test.
let examplesCache: ReturnType<typeof earthworkExamples> | undefined;
function examples() {
  if (!examplesCache) examplesCache = earthworkExamples(naturalHeightAt);
  const { road, pad } = examplesCache;
  assert.ok(road, "SEED has an open-country road cut example");
  assert.ok(pad, "SEED has a village pad example");
  return { road, pad };
}

const codesOf = (modifiers: readonly { code: string }[]) => modifiers.map((m) => m.code);

test("WORLD_PRIORITIES lists owner priorities 0-9 in order", () => {
  assert.deepEqual(
    WORLD_PRIORITIES.map((entry) => entry.priority),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.deepEqual(
    WORLD_PRIORITIES.map((entry) => entry.key),
    [
      "oceans",
      "continents",
      "islands",
      "natural-biomes",
      "fresh-water",
      "countries",
      "cities",
      "villages",
      "roads",
      "critical-sites",
    ],
  );
});

test("surfaceModifiers ranks are canonical (priority, code) and codes are unique", () => {
  const plan = surfaceModifiers();
  assert.ok(plan.length > 0);
  assert.deepEqual(
    plan.map((modifier) => modifier.rank),
    plan.map((_, index) => index),
  );
  for (let i = 1; i < plan.length; i++) {
    const a = plan[i - 1],
      b = plan[i];
    const order = a.priority - b.priority || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    assert.ok(order <= 0, `modifiers ${i - 1} and ${i} are out of canonical order`);
  }
  const codes = plan.map((modifier) => modifier.code);
  assert.equal(new Set(codes).size, codes.length, "modifier codes are unique");

  const priorityByKind = new Map<string, Set<number>>();
  for (const modifier of plan) {
    const set = priorityByKind.get(modifier.kind) ?? new Set<number>();
    set.add(modifier.priority);
    priorityByKind.set(modifier.kind, set);
  }
  assert.deepEqual([...priorityByKind.get("city")!], [6], "city pads sit at priority 6");
  assert.deepEqual([...priorityByKind.get("village")!], [7], "village pads sit at priority 7");
  assert.deepEqual([...priorityByKind.get("road")!], [8], "roads sit at priority 8");
});

test("surfaceAt is independent of visit order and agrees with heightAt", () => {
  const { road, pad } = examples();
  const points: Array<{ x: number; z: number }> = [];
  // Road: along-span offsets -30..30 and across offsets -25..25.
  for (const dx of [-30, -20, -10, 0, 10, 20, 30])
    for (const dz of [-25, -12, 0, 5, 12, 25]) points.push({ x: road.x + dx, z: road.z + dz });
  // Pad: grid offsets within the village pad radius (200).
  for (const dx of [-150, -100, -50, 0, 50, 100, 150])
    for (const dz of [-150, -100, -50, 0, 50, 100, 150])
      if (Math.hypot(dx, dz) <= 200) points.push({ x: pad.x + dx, z: pad.z + dz });
  assert.ok(points.length >= 40, `expected ~40+ sample points, got ${points.length}`);

  const record = ({ x, z }: { x: number; z: number }) => {
    const s = surfaceAt(x, z);
    return {
      height: s.height,
      material: s.material,
      vegetationExcluded: s.vegetationExcluded,
      walk: s.walk,
      modifiers: codesOf(s.modifiers),
    };
  };

  clearSurfaceCaches();
  const forward = points.map(record);
  clearSurfaceCaches();
  const reversed = [...points].reverse().map(record).reverse();
  assert.deepEqual(reversed, forward);

  // Warm caches must not change the answer either.
  assert.deepEqual(points.map(record), forward);

  for (const point of points) {
    assert.equal(
      heightAt(point.x, point.z),
      surfaceAt(point.x, point.z).height,
      `heightAt and surfaceAt disagree at ${point.x}, ${point.z}`,
    );
  }
});

test("road earthwork: surface, shoulder, and unchanged natural ground outside support", () => {
  const { road } = examples();
  const at = (dz: number) => surfaceAt(road.x, road.z + dz);

  const centre = at(0);
  assert.equal(centre.material, "road-surface");
  assert.equal(centre.walk, "road");
  assert.equal(centre.vegetationExcluded, true);
  assert.equal(centre.reservedUse, "road");

  const shoulder = at(5.5);
  assert.equal(shoulder.material, "dirt-foundation");

  const outside = at(L.roadShoulderHalfWidth + L.roadFalloffMax + 10);
  assert.equal(outside.height, naturalHeightAt(road.x, road.z + L.roadShoulderHalfWidth + L.roadFalloffMax + 10));
  assert.equal(outside.height, outside.naturalHeight);
  assert.equal(outside.cutFill, 0);
  assert.ok(!outside.modifiers.some((m) => m.kind === "road"), "no road entry outside support");

  const surfaceHeights = [0, 1, 2, 3, 4].map((dz) => at(dz).height);
  for (const height of surfaceHeights) {
    assert.ok(
      Math.abs(height - surfaceHeights[0]) <= 0.05,
      `road surface is not level across offsets 0..4: ${surfaceHeights.join(", ")}`,
    );
  }
  for (const dz of [0, 1, 2, 3, 4]) assert.equal(at(dz).material, "road-surface");
});

test("village pad earthwork: prepared ground, flat pad, settlement biome, and natural ground beyond support", () => {
  const { pad } = examples();
  const candidates = [
    [40, 50],
    [-40, 50],
    [40, -50],
    [-40, -50],
  ] as const;
  const settled = candidates.find(([dx, dz]) => reservedUseAt(pad.x + dx, pad.z + dz) === "village");
  assert.ok(settled, "a village-reserved point exists inside the pad radius");
  const [dx, dz] = settled;
  const x = pad.x + dx,
    z = pad.z + dz;

  const sample = surfaceAt(x, z);
  assert.equal(sample.material, "prepared-ground");
  assert.equal(sample.vegetationExcluded, true);
  assert.equal(sample.reservedUse, "village");
  assert.equal(biomeAt(x, z), "Settlement");

  // Two prepared-ground points inside the radius, off the road, sit at one flat height.
  const flat = candidates
    .filter(([cx, cz]) => reservedUseAt(pad.x + cx, pad.z + cz) === "village")
    .map(([cx, cz]) => surfaceAt(pad.x + cx, pad.z + cz));
  assert.ok(flat.length >= 2);
  assert.equal(flat[0].material, "prepared-ground");
  assert.equal(flat[1].material, "prepared-ground");
  assert.ok(
    Math.abs(flat[0].height - flat[1].height) <= 0.01,
    `pad interior is not flat: ${flat[0].height} vs ${flat[1].height}`,
  );

  // Beyond radius + falloff (+5) there is no modifier, so ground is the natural height.
  const beyond = L.villagePadRadius + L.padFalloff + 5;
  assert.equal(beyond, 175);
  const farX = pad.x,
    farZ = pad.z + beyond;
  assert.equal(modifiersAt(farX, farZ).length, 0, "precondition: no other modifier at the far point");
  assert.equal(surfaceAt(farX, farZ).height, naturalHeightAt(farX, farZ));
});

test("pad earthwork is identical across one source-width wrap", () => {
  const { pad } = examples();
  for (const [dx, dz] of [
    [0, 0],
    [40, 50],
    [-40, -50],
  ]) {
    const x = pad.x + dx,
      z = pad.z + dz;
    const a = surfaceAt(x, z),
      b = surfaceAt(x + SOURCE_PRESENTATION_WIDTH, z);
    assert.equal(b.height, a.height, `height wraps at ${dx}, ${dz}`);
    assert.deepEqual(codesOf(b.modifiers), codesOf(a.modifiers), `modifiers wrap at ${dx}, ${dz}`);
  }
});

test("bridge decks over SEED water (scan of road centrelines)", (t) => {
  const SAMPLE_CAP = 200_000;
  let samples = 0;
  let found: { x: number; z: number } | undefined;
  scan: for (const road of roads) {
    for (let x = Math.floor(road.minX); x <= Math.ceil(road.maxX); x += 2) {
      if (++samples > SAMPLE_CAP) break scan;
      if (surfaceAt(x, road.z).bridge) {
        found = { x, z: road.z };
        break scan;
      }
    }
  }
  if (!found) {
    t.skip(
      `no road centreline crosses water in the SEED (${samples} samples); bridge rule is covered by the synthetic test below`,
    );
    return;
  }
  const sample = surfaceAt(found.x, found.z);
  assert.equal(sample.water, true);
  assert.equal(sample.height, sample.naturalHeight, "water is not filled by the bridge");
  assert.ok(sample.deckHeight >= L.roadMinimumHeight);
  assert.equal(sample.material, "bridge-deck");
});

test("bridge rule over water with a synthetic natural sampler", () => {
  const road = roads[0];
  const mid = (road.minX + road.maxX) / 2;
  // A river band across the road: water (-1.5) inside, land (6) outside.
  const river: NaturalSampler = (x) => (Math.abs(x - mid) < 40 ? -1.5 : 6);
  clearSurfaceCaches();
  try {
    const sample = surfaceSampleAt(mid, road.z, river);
    assert.equal(sample.water, true);
    assert.equal(sample.bridge, true);
    assert.equal(sample.height, sample.naturalHeight, "water is not filled");
    assert.equal(sample.naturalHeight, -1.5);
    assert.ok(sample.deckHeight >= L.roadMinimumHeight, `deck ${sample.deckHeight} below minimum`);
    assert.equal(sample.material, "bridge-deck");
    assert.equal(sample.walk, "bridge");
    assert.equal(sample.reservedUse, "bridge");
  } finally {
    // Station and pad caches are keyed without the sampler, so drop what this test wrote.
    clearSurfaceCaches();
  }
});

test("cellAt exposes the surface sample of the cell centre", () => {
  const { road, pad } = examples();
  for (const [x, z] of [
    [road.x, road.z],
    [road.x, road.z + 5.5],
    [pad.x + 40, pad.z + 50],
  ]) {
    const cell = cellAt(x, z);
    const cx = Math.floor(x / 2) * 2 + 1,
      cz = Math.floor(z / 2) * 2 + 1;
    const expected = surfaceAt(cx, cz);
    assert.equal(cell.surface.material, expected.material);
    assert.equal(cell.surface.cutFill, expected.cutFill);
    assert.equal(cell.surface.naturalElevation, expected.naturalHeight);
    assert.equal(cell.surface.reservedUse, expected.reservedUse);
    assert.equal(cell.surface.vegetationExcluded, expected.vegetationExcluded);
    assert.equal(cell.surface.walk, expected.walk);
    assert.deepEqual(
      cell.surface.modifiers,
      expected.modifiers.map(({ code, priority }) => ({ code, priority })),
    );
  }
});

test("reservedUseAt is road at the road example", () => {
  const { road } = examples();
  assert.equal(reservedUseAt(road.x, road.z), "road");
});

test("surface compositor source is deterministic (no RNG or wall clock)", () => {
  const source = readFileSync(new URL("../src/surface-compositor.ts", import.meta.url), "utf8");
  for (const forbidden of ["Math.random", "Date.now", "performance.now", "crypto"]) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not appear in surface-compositor.ts`);
  }
});
