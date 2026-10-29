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
  canPrefetchStreamingJob,
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

test("tile generation uses every spare core, limited only by device memory", async () => {
  const { generationWorkerCount, streamingBudgetForPool, streamingBudgetForViewport } = await import("../src/streaming.ts");
  assert.equal(generationWorkerCount(12, 8), 11, "12-core PC: 11 workers");
  assert.equal(generationWorkerCount(8, 8), 7, "8-core phone with 8 GB: 7 workers");
  assert.equal(generationWorkerCount(8, 4), 7, "8-core phone with 4 GB: 7 workers");
  assert.equal(generationWorkerCount(8, 2), 4, "a 2 GB device is held back only by memory");
  assert.equal(generationWorkerCount(2, 8), 1, "two cores: one worker, one core left for rendering");
  assert.equal(generationWorkerCount(1, 1), 1, "always at least one worker");
  assert.equal(generationWorkerCount(undefined, undefined), 3, "unknown hardware is treated as 4 cores and 4 GB");
  assert.equal(generationWorkerCount(64, 8), 16, "memory caps very large core counts");
  for (const [width, height] of [[390, 844], [1024, 768], [1440, 900]]) {
    const base = streamingBudgetForViewport(width, height);
    assert.equal(streamingBudgetForPool(width, height, 1).generationReady, base.generationReady, "a single worker keeps the viewport budget");
    for (const workers of [1, 4, 11, 64])
      assert.equal(streamingBudgetForPool(width, height, workers).generationReady, base.generationReady, "high-core pools must not raise the 4/6/8 generating+ready ceiling");
    const memory = { cacheTrimStartBytes: 0, combinedBytes: 0, cpuBytes: 0, gpuBytes: 0 };
    assert.deepEqual({ ...streamingBudgetForPool(width, height, 11), generationReady: 0, ...memory }, { ...base, generationReady: 0, ...memory }, "the worker count changes neither job slots nor canonical geometry");
  }
});

test("urgent work owns the shared generating+ready cap while optional prefetch leaves a free slot and worker", () => {
  for (const [width,height,limit] of [[390,844,4],[1024,768,6],[1440,900,8]] as const) {
    const budget=streamingBudgetForViewport(width,height);
    assert.equal(budget.generationReady,limit);
    for (let generating=0;generating<=limit;generating++) {
      const ready=limit-generating;
      assert.equal(withinStreamingBudget({generationReady:generating+ready,activePatches:0,cachedPatches:0,cpuBytes:0,gpuBytes:0},budget),true);
      assert.equal(withinStreamingBudget({generationReady:generating+ready+1,activePatches:0,cachedPatches:0,cpuBytes:0,gpuBytes:0},budget),false);
      assert.equal(canPrefetchStreamingJob(generating,ready,11,budget),false,"a full ready+generating queue never admits prefetch");
    }
    assert.equal(canPrefetchStreamingJob(0,0,2,budget),true,"optional work may use idle capacity");
    assert.equal(canPrefetchStreamingJob(limit-2,0,2,budget),true,"prefetch stops before consuming the reserved slot");
    assert.equal(canPrefetchStreamingJob(limit-1,0,2,budget),false,"reserve one job slot for focus or inspect");
    assert.equal(canPrefetchStreamingJob(0,0,1,budget),false,"one idle worker is reserved for canonical work");
    assert.equal(canPrefetchStreamingJob(0,limit-1,2,budget),false,"ready uploads count against the same cap");
  }
});

test("owner 1 GB runtime cache limit is invariant across reported RAM, with one upload per frame", async () => {
  const { streamingMemoryBytesForDevice, streamingBudgetForPool, STREAMING_BUDGETS, UPLOAD_FRAME_BUDGET_MS } = await import("../src/streaming.ts");
  for (const device of ["desktop", "phone", "tablet"] as const)
    for (const memory of [undefined, 2, 4, 8, 32])
      assert.equal(streamingMemoryBytesForDevice(device, memory), 1e9, "hardware RAM cannot enlarge owner's combined limit");
  const desktop = streamingBudgetForPool(1440, 900, 11, 8);
  assert.equal(desktop.cacheTrimStartBytes, 1e9);
  assert.equal(desktop.combinedBytes, 1e9);
  for (const [w, h] of [[390, 844], [768, 1024], [1440, 900]]) {
    const pool = streamingBudgetForPool(w, h, 11, 32);
    assert.equal(pool.cacheTrimStartBytes, 1e9);
    assert.equal(pool.combinedBytes, 1e9);
  }
  assert.equal(desktop.maxUploadsPerFrame, 1, "each rendered frame admits at most one real GPU mesh group");
  assert.ok(Object.values(STREAMING_BUDGETS).every(budget => budget.maxUploadsPerFrame === 1), "no device class can burst multiple mesh-group uploads into one frame");
  assert.ok(UPLOAD_FRAME_BUDGET_MS > 0 && UPLOAD_FRAME_BUDGET_MS < 16, "uploads leave most of a 60 fps frame to drawing");
});

test("render resolution starts at native and steps down only when frames are slow", async () => {
  const { nextPixelRatio } = await import("../src/render-resolution.ts");
  assert.equal(nextPixelRatio(3, 16, 3), 3, "smooth: stay at native");
  assert.equal(nextPixelRatio(3, 30, 3), 2.75, "slow: one step down");
  assert.equal(nextPixelRatio(1, 40, 3), 1, "never below 1× on a high-DPI screen");
  assert.equal(nextPixelRatio(2, 12, 3), 2.25, "headroom: one step back up");
  assert.equal(nextPixelRatio(3, 12, 3), 3, "never above native");
  assert.equal(nextPixelRatio(1, 40, 1), 1, "a 1× screen stays at 1×");
  assert.equal(nextPixelRatio(2.5, 21, 3), 2.5, "in the comfortable band nothing changes");
});
