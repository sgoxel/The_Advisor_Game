import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LEVEL,
  WORLD_MIN,
  WORLD_SIZE,
  selectTiles,
  tileAt,
  type View,
} from "../src/world.ts";
import {
  SOURCE_PRESENTATION_POLE_DISTANCE,
  wrapSourceX,
} from "../src/planet.ts";
import {
  STREAMING_BUDGETS,
  streamingBudgetForViewport,
  withinStreamingBudget,
} from "../src/streaming.ts";

const localView = (x: number, z: number): View => ({
  x,
  z,
  halfHeight: 97,
  aspect: 1280 / 720,
  yaw: 0,
  pixels: 720,
});

const sortedKeys = (
  view: View,
  limit = STREAMING_BUDGETS.desktop.activePatches,
) =>
  selectTiles(view, 190, limit)
    .map((tile) => tile.key)
    .sort();

test("Stage S002 streaming budgets stay within binding envelopes and reserve rollover headroom", () => {
  assert.deepEqual(STREAMING_BUDGETS.phone, {
    deviceClass: "phone",
    generationReady: 4,
    activePatches: 89,
    cachedPatches: 180,
    cpuBytes: 96 * 1024 * 1024,
    gpuBytes: 96 * 1024 * 1024,
  });
  assert.deepEqual(STREAMING_BUDGETS.tablet, {
    deviceClass: "tablet",
    generationReady: 6,
    activePatches: 119,
    cachedPatches: 240,
    cpuBytes: 160 * 1024 * 1024,
    gpuBytes: 160 * 1024 * 1024,
  });
  assert.deepEqual(STREAMING_BUDGETS.desktop, {
    deviceClass: "desktop",
    generationReady: 4,
    activePatches: 89,
    cachedPatches: 180,
    cpuBytes: 256 * 1024 * 1024,
    gpuBytes: 256 * 1024 * 1024,
  });
  for (const budget of Object.values(STREAMING_BUDGETS))
    assert.ok(
      budget.activePatches * 2 + 1 <= budget.cachedPatches,
      `${budget.deviceClass} must fit previous + destination active sets + root`,
    );
  assert.deepEqual(
    {
      generationReady: STREAMING_BUDGETS.desktop.generationReady,
      activePatches: STREAMING_BUDGETS.desktop.activePatches,
      cachedPatches: STREAMING_BUDGETS.desktop.cachedPatches,
    },
    {
      generationReady: STREAMING_BUDGETS.phone.generationReady,
      activePatches: STREAMING_BUDGETS.phone.activePatches,
      cachedPatches: STREAMING_BUDGETS.phone.cachedPatches,
    },
    "desktop keeps the sustained-rollover patch envelope proven on phone while retaining its larger byte ceiling",
  );
  assert.equal(streamingBudgetForViewport(390, 844).deviceClass, "phone");
  assert.equal(streamingBudgetForViewport(844, 390).deviceClass, "phone");
  assert.equal(streamingBudgetForViewport(768, 1024).deviceClass, "tablet");
  assert.equal(streamingBudgetForViewport(1024, 768).deviceClass, "tablet");
  assert.equal(streamingBudgetForViewport(1280, 720).deviceClass, "desktop");
  assert.equal(streamingBudgetForViewport(1440, 900).deviceClass, "desktop");
  assert.equal(
    withinStreamingBudget(
      {
        generationReady: 4,
        activePatches: 89,
        cachedPatches: 180,
        cpuBytes: 96 * 1024 * 1024,
        gpuBytes: 96 * 1024 * 1024,
      },
      STREAMING_BUDGETS.phone,
    ),
    true,
  );
});

test("render patch cache keys are canonical global IDs rather than planar tile addresses", () => {
  for (const [level, x, z] of [
    [0, 0, 0],
    [2, 1, 1],
    [8, 127, 128],
    [MAX_LEVEL, 65535, 65536],
  ] as const) {
    const tile = tileAt(level, x, z);
    assert.match(tile.key, /^ADVISOR-0126-ALDERWICK\/PLANET\/v1\/F[0-5]\/L\d+\/\d+\/\d+\/PATCH$/);
    assert.doesNotMatch(tile.key, /\/T\//);
    assert.equal(tileAt(level, x, z).key, tile.key);
  }
});

test("a seam-straddling local view streams both longitude edges exactly once", () => {
  const limit = STREAMING_BUDGETS.desktop.activePatches,
    view = localView(-WORLD_MIN - 10, 0),
    tiles = selectTiles(view, 190, limit),
    keys = tiles.map((tile) => tile.key);
  assert.ok(tiles.length > 0 && tiles.length <= limit);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(
    tiles.some((tile) => tile.minX <= WORLD_MIN + tile.size),
    "wrapped coverage must include the left source edge",
  );
  assert.ok(
    tiles.some((tile) => tile.minX + tile.size >= -WORLD_MIN - tile.size),
    "wrapped coverage must include the right source edge",
  );
});

test("one full circumference returns identical canonical streaming ownership", () => {
  const x = 12345.25,
    base = localView(x, 321),
    wrapped = localView(wrapSourceX(x + WORLD_SIZE), 321);
  assert.equal(wrapped.x, wrapSourceX(x));
  assert.deepEqual(sortedKeys(base), sortedKeys(wrapped));
});

test("exact pole coverage is unique bounded and independent of degenerate longitude", () => {
  const limit = STREAMING_BUDGETS.desktop.activePatches,
    northA = localView(0, -SOURCE_PRESENTATION_POLE_DISTANCE),
    northB = localView(74123, -SOURCE_PRESENTATION_POLE_DISTANCE),
    south = localView(-52177, SOURCE_PRESENTATION_POLE_DISTANCE);
  for (const view of [northA, northB, south]) {
    const tiles = selectTiles(view, 190, limit);
    assert.ok(tiles.length > 0 && tiles.length <= limit);
    assert.equal(new Set(tiles.map((tile) => tile.key)).size, tiles.length);
    for (const tile of tiles) {
      assert.ok(tile.minZ >= -SOURCE_PRESENTATION_POLE_DISTANCE);
      assert.ok(tile.minZ + tile.size <= SOURCE_PRESENTATION_POLE_DISTANCE);
    }
  }
  assert.deepEqual(sortedKeys(northA), sortedKeys(northB));
});
