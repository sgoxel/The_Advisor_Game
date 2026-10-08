import { test, expect } from "@playwright/test";

function collectWebGpuErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /webgpu|gpuvalidation|shader|wgsl|device.*lost/i.test(message.text())
    )
      errors.push(message.text());
  });
  return errors;
}

async function expectReady(page) {
  await page.waitForFunction(() => window.advisorRenderer?.phase !== "starting");
  expect(await page.evaluate(() => window.advisorRenderer)).toMatchObject({
    requested: "webgpu",
    backend: "webgpu",
    phase: "ready",
    error: "",
  });
  await page.waitForFunction(() => window.advisorWorld?.state.settled);
}

async function assertBounds(page, expectedClass) {
  const state = await page.evaluate(() => window.advisorWorld.state);
  const streaming = state.streaming;
  expect(streaming.deviceClass).toBe(expectedClass);
  expect(streaming.activePatches).toBeLessThanOrEqual(streaming.budget.active);
  expect(streaming.cachedPatches).toBeLessThanOrEqual(streaming.budget.cached);
  expect(streaming.generationReadyQueue).toBeLessThanOrEqual(streaming.budget.queue);
  expect(streaming.pendingGeneration + streaming.readyUploads).toBeLessThanOrEqual(
    streaming.budget.queue,
  );
  expect(streaming.cpuResourceBytesEstimated).toBeLessThanOrEqual(
    streaming.budget.cpuBytes,
  );
  expect(streaming.gpuResourceBytesEstimated).toBeLessThanOrEqual(
    streaming.budget.gpuBytes,
  );
  expect(streaming.maxUploadsPerFrameObserved).toBeLessThanOrEqual(1);
  expect(new Set(streaming.activeCanonicalKeys).size).toBe(
    streaming.activeCanonicalKeys.length,
  );
  expect(new Set(streaming.wantedCanonicalKeys).size).toBe(
    streaming.wantedCanonicalKeys.length,
  );
  expect(state.error).toBe("");
  return state;
}

test("WebGPU desktop wrap crossings keep one canonical bounded cache", async ({
  page,
}) => {
  test.setTimeout(420000);
  const errors = collectWebGpuErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expectReady(page);

  await page.evaluate(() => {
    window.advisorWorld.setHalfHeight(97);
    window.advisorWorld.navigation.setFocus(0.42, 0.2);
  });
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  const before = await page.evaluate(() => ({
    focus: window.advisorWorld.state.navigation.focus,
    keys: [...window.advisorWorld.state.streaming.activeCanonicalKeys].sort(),
    hits: window.advisorWorld.state.streaming.cacheHits,
  }));
  await page.evaluate(() =>
    window.advisorWorld.navigation.setFocus(0.42 + Math.PI * 2, 0.2),
  );
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  let state = await assertBounds(page, "desktop");
  expect(state.navigation.focus.lon).toBeCloseTo(before.focus.lon, 10);
  expect(state.navigation.focus.lat).toBeCloseTo(before.focus.lat, 10);
  expect([...state.streaming.activeCanonicalKeys].sort()).toEqual(before.keys);
  expect(state.streaming.cacheHits).toBeGreaterThan(before.hits);

  const seam = Math.PI - 0.00025;
  for (const lon of [seam, -seam, seam, -seam]) {
    await page.evaluate(
      (value) => window.advisorWorld.navigation.setFocus(value, 0.08),
      lon,
    );
    await page.waitForTimeout(40);
  }
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  state = await assertBounds(page, "desktop");
  expect(state.streaming.cacheMisses).toBeGreaterThan(0);
  expect(state.visibleMeshes.terrain).toBeGreaterThan(0);
  await page.locator("#grid").check();
  await page.screenshot({ path: "test-results/streaming-webgpu-desktop-wrap.png" });
  expect(errors).toEqual([]);
});

test("WebGPU phone pole navigation stays covered and within phone budgets", async ({
  page,
}) => {
  test.setTimeout(420000);
  const errors = collectWebGpuErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expectReady(page);
  await page.locator("#grid").check();

  for (const [lat, pole, name] of [
    [Math.PI, "north", "north"],
    [-Math.PI, "south", "south"],
  ]) {
    await page.evaluate(
      ({ lat }) => window.advisorWorld.navigation.setFocus(0.7, lat),
      { lat },
    );
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    const state = await assertBounds(page, "phone");
    expect(state.navigation.poleLimit).toBe(pole);
    expect(state.navigation.focus.lat).toBeCloseTo(
      pole === "north" ? Math.PI / 2 : -Math.PI / 2,
      10,
    );
    expect(state.visibleMeshes.terrain).toBeGreaterThan(0);
    await expect(page.locator("#tile-status")).toContainText(
      pole === "north" ? "North pole limit" : "South pole limit",
    );
    await page.screenshot({
      path: `test-results/streaming-webgpu-phone-${name}-pole.png`,
    });
  }
  expect(errors).toEqual([]);
});
