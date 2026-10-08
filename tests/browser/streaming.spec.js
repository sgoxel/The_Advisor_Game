import { test, expect } from "@playwright/test";

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function assertStreamingBounds(page, expectedClass) {
  const state = await page.evaluate(() => window.advisorWorld.state);
  const streaming = state.streaming;
  expect(streaming.deviceClass).toBe(expectedClass);
  expect(streaming.activePatches).toBeLessThanOrEqual(streaming.budget.active);
  expect(streaming.cachedPatches).toBeLessThanOrEqual(streaming.budget.cached);
  expect(streaming.generationReadyQueue).toBeLessThanOrEqual(streaming.budget.queue);
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

async function churnAcrossWrap(page) {
  const seam = Math.PI - 0.00025;
  for (const lon of [seam, -seam, seam, -seam, seam, -seam]) {
    await page.evaluate(
      (value) => window.advisorWorld.navigation.setFocus(value, 0.08),
      lon,
    );
    await page.waitForTimeout(30);
  }
  await page.waitForFunction(() => window.advisorWorld.state.settled);
}

test("WebGL2 wrap churn keeps canonical streaming bounded on desktop", async ({
  page,
}) => {
  test.setTimeout(300000);
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.settled);

  await churnAcrossWrap(page);
  const seamState = await assertStreamingBounds(page, "desktop");
  expect(seamState.streaming.cacheMisses).toBeGreaterThan(0);
  await page.locator("#grid").check();
  await page.screenshot({ path: "test-results/streaming-webgl2-desktop-wrap.png" });

  await page.evaluate(() => window.advisorWorld.navigation.setFocus(0.42, 0.3));
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  const before = await page.evaluate(() => ({
    focus: window.advisorWorld.state.navigation.focus,
    keys: [...window.advisorWorld.state.streaming.activeCanonicalKeys],
    labels: window.advisorWorld.state.navigation.labels.map((label) => label.id),
  }));
  await page.evaluate(() =>
    window.advisorWorld.navigation.setFocus(0.42 + Math.PI * 2, 0.3),
  );
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  const after = await page.evaluate(() => ({
    focus: window.advisorWorld.state.navigation.focus,
    keys: [...window.advisorWorld.state.streaming.activeCanonicalKeys],
    labels: window.advisorWorld.state.navigation.labels.map((label) => label.id),
  }));
  expect(after.focus.lon).toBeCloseTo(before.focus.lon, 10);
  expect(after.focus.lat).toBeCloseTo(before.focus.lat, 10);
  expect(after.keys).toEqual(before.keys);
  expect(after.labels).toEqual(before.labels);
  expect(errors).toEqual([]);
});

test("WebGL2 phone pole limits stay bounded and visibly covered", async ({ page }) => {
  test.setTimeout(300000);
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.settled);
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
    const state = await assertStreamingBounds(page, "phone");
    expect(state.navigation.poleLimit).toBe(pole);
    expect(state.visibleMeshes.terrain).toBeGreaterThan(0);
    await expect(page.locator("#tile-status")).toContainText(
      pole === "north" ? "North pole limit" : "South pole limit",
    );
    await page.screenshot({
      path: `test-results/streaming-webgl2-phone-${name}-pole.png`,
    });
  }
  expect(errors).toEqual([]);
});
