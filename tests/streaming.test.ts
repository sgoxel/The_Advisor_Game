import { test } from "node:test";
import assert from "node:assert/strict";
import { WORLD_FOUNDATION_VERSION } from "../src/config.ts";
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
  STREAMING_MEMORY_POLICY,
  shouldTrimStreamingCache,
  streamingMemoryReservationFits,
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

test("owner memory policy retains cache through 1 GB and enforces one combined 1 GB ceiling", () => {
 assert.deepEqual(STREAMING_MEMORY_POLICY,{cacheTrimStartBytes:1_000_000_000,combinedBytes:1_000_000_000});
 for(const budget of Object.values(STREAMING_BUDGETS)){
  assert.equal(budget.combinedBytes,1_000_000_000);assert.equal(budget.cacheTrimStartBytes,1_000_000_000);
  const state={generationReady:budget.generationReady,activePatches:budget.activePatches,cachedPatches:10_000,cpuBytes:200_000_000,gpuBytes:56_000_000};
  assert.equal(shouldTrimStreamingCache(state.cpuBytes,state.gpuBytes,budget),false);
  assert.equal(withinStreamingBudget(state,budget),true,"patch count alone cannot discard useful small cached data");
  assert.equal(shouldTrimStreamingCache(600_000_000,350_000_000,budget),false);
  assert.equal(shouldTrimStreamingCache(600_000_000,400_000_000,budget),false);
  assert.equal(shouldTrimStreamingCache(600_000_001,400_000_000,budget),true);
  assert.equal(shouldTrimStreamingCache(600_000_000,350_000_000,budget,50_000_000),false);
  assert.equal(shouldTrimStreamingCache(600_000_000,350_000_000,budget,50_000_001),true,"required work may reclaim only the space it needs");
  assert.equal(withinStreamingBudget({...state,cpuBytes:600_000_000,gpuBytes:400_000_000},budget),true);
  assert.equal(withinStreamingBudget({...state,cpuBytes:600_000_001,gpuBytes:400_000_000},budget),false,"CPU and GPU share one ceiling");
  assert.equal(streamingMemoryReservationFits(600_000_000,350_000_000,50_000_000,budget),true);
  assert.equal(streamingMemoryReservationFits(600_000_000,350_000_000,50_000_001,budget),false);
  assert.equal(withinStreamingBudget({...state,generationReady:budget.generationReady+1},budget),false);
  assert.equal(withinStreamingBudget({...state,activePatches:budget.activePatches+1},budget),false);
 }
 for(const [w,h,kind] of [[390,844,'phone'],[844,390,'phone'],[768,1024,'tablet'],[1280,720,'desktop']] as const)assert.equal(streamingBudgetForViewport(w,h).deviceClass,kind);
});

test("render patch cache keys are canonical global IDs rather than planar tile addresses", () => {
  for (const [level, x, z] of [
    [0, 0, 0],
    [2, 1, 1],
    [8, 127, 128],
    [MAX_LEVEL, 65535, 65536],
  ] as const) {
    const tile = tileAt(level, x, z);
    assert.match(
      tile.key,
      /^ADVISOR-0126-ALDERWICK\/PLANET\/v\d+\/F[0-5]\/L\d+\/\d+\/\d+\/PATCH$/,
    );
    assert.ok(tile.key.includes(`/PLANET/${WORLD_FOUNDATION_VERSION}/`));
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
    assert.ok(tiles.length > 0 && tiles.length <= 16);
    assert.equal(new Set(tiles.map((tile) => tile.key)).size, tiles.length);
    for (const tile of tiles) {
      assert.ok(tile.minZ >= -SOURCE_PRESENTATION_POLE_DISTANCE);
      assert.ok(tile.minZ + tile.size <= SOURCE_PRESENTATION_POLE_DISTANCE);
    }
  }
  assert.deepEqual(sortedKeys(northA), sortedKeys(northB));
});
