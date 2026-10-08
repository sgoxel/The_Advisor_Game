import { test, expect } from "@playwright/test";

test("WebGPU wrap and pole streaming uses the same canonical bounded policy", async ({ page }) => {
  test.setTimeout(420000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForFunction(() => window.advisorRenderer?.phase !== "starting");
  expect(await page.evaluate(() => window.advisorRenderer)).toMatchObject({
    backend: "webgpu",
    phase: "ready",
    error: "",
  });
  await page.waitForFunction(() => window.advisorWorld?.state.settled);

  const assertBounds = async () => {
    const s = await page.evaluate(() => window.advisorWorld.state.streaming);
    expect(s.deviceClass).toBe("phone");
    expect(s.generationReadyQueue).toBeLessThanOrEqual(s.budget.queue);
    expect(s.pendingGeneration + s.readyUploads).toBeLessThanOrEqual(s.budget.queue);
    expect(s.activePatches).toBeLessThanOrEqual(s.budget.active);
    expect(s.cachedPatches).toBeLessThanOrEqual(s.budget.cached);
    expect(s.cpuResourceBytesEstimated).toBeLessThanOrEqual(s.budget.cpuBytes);
    expect(s.gpuResourceBytesEstimated).toBeLessThanOrEqual(s.budget.gpuBytes);
    expect(s.maxUploadsPerFrameObserved).toBeLessThanOrEqual(1);
    expect(new Set(s.activeCanonicalKeys).size).toBe(s.activeCanonicalKeys.length);
    return s;
  };

  await page.evaluate(() => {
    window.advisorWorld.setHalfHeight(97);
    window.advisorWorld.navigation.setFocus(Math.PI - 0.003, 0.15);
  });
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  await assertBounds();

  await page.evaluate(() =>
    window.advisorWorld.navigation.setFocus(-Math.PI + 0.003, 0.15),
  );
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  await assertBounds();

  await page.evaluate(() =>
    window.advisorWorld.navigation.setFocus(0.25, Math.PI),
  );
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  let state = await page.evaluate(() => window.advisorWorld.state);
  expect(state.navigation.poleLimit).toBe("north");
  expect(state.navigation.focus.lat).toBeCloseTo(Math.PI / 2, 10);
  await assertBounds();

  await page.evaluate(() =>
    window.advisorWorld.navigation.setFocus(0.25, -Math.PI),
  );
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  state = await page.evaluate(() => window.advisorWorld.state);
  expect(state.navigation.poleLimit).toBe("south");
  expect(state.navigation.focus.lat).toBeCloseTo(-Math.PI / 2, 10);
  await assertBounds();
  await expect(page.locator("#error")).toBeHidden();
});
