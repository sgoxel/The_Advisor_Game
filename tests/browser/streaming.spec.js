import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "phone", width: 390, height: 844 },
];

async function expectStreamingBudget(page) {
  const state = await page.evaluate(() => window.advisorWorld.state);
  const p = state.performance;
  expect(p).toBeTruthy();
  expect(p.generationReady).toBeLessThanOrEqual(p.budget.generationReady);
  expect(p.activePatches).toBeLessThanOrEqual(p.budget.activePatches);
  expect(p.cachedPatches).toBeLessThanOrEqual(p.budget.cachedPatches);
  expect(p.cpuResourceBytesEstimated).toBeLessThanOrEqual(p.budget.cpuBytes);
  expect(p.gpuResourceBytesEstimated).toBeLessThanOrEqual(p.budget.gpuBytes);
  expect(p.maxUploadsPerFrame).toBeLessThanOrEqual(1);
  expect(p.canonicalKeysUnique).toBeTruthy();
  expect(p.withinBudget).toBeTruthy();
  return state;
}

async function navigateAndSettleWithinBudget(page, lon, lat) {
  await page.evaluate(
    ({ lon, lat }) => window.advisorWorld.navigation.setFocus(lon, lat),
    { lon, lat },
  );
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => window.advisorWorld.state);
    const p = state.performance;
    expect(p.generationReady).toBeLessThanOrEqual(p.budget.generationReady);
    expect(p.activePatches).toBeLessThanOrEqual(p.budget.activePatches);
    expect(p.cachedPatches).toBeLessThanOrEqual(p.budget.cachedPatches);
    expect(p.cpuResourceBytesEstimated).toBeLessThanOrEqual(p.budget.cpuBytes);
    expect(p.gpuResourceBytesEstimated).toBeLessThanOrEqual(p.budget.gpuBytes);
    expect(p.maxUploadsPerFrame).toBeLessThanOrEqual(1);
    expect(p.canonicalKeysUnique).toBeTruthy();
    expect(p.withinBudget).toBeTruthy();
    if (state.settled) return state;
  }
  throw new Error("streaming did not settle within 120 seconds");
}

for (const viewport of VIEWPORTS) {
  test(`WebGL2 canonical streaming ${viewport.name}`, async ({ page }) => {
    test.setTimeout(600000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "gpu", {
        value: undefined,
        configurable: true,
      }),
    );
    await page.goto("/");
    await page.waitForFunction(() => window.advisorWorld?.state.settled);
    await page.locator("#map-scale").selectOption("20");
    await page.evaluate(() => window.advisorWorld.navigation.setFocus(Math.PI - 0.001, 0.22));
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    await page.locator("#grid").check();
    const seam = await expectStreamingBudget(page);
    expect(seam.performance.deviceClass).toBe(viewport.name);
    expect(seam.performance.activeCanonicalKeys.some((key) => key.includes("/PLANET/"))).toBeTruthy();
    const baselineKeys = [...seam.performance.activeCanonicalKeys].sort();
    const baselineLabels = seam.navigation.labels.map((label) => label.id).sort();
    const baselineFocus = seam.navigation.focus;
    await page.screenshot({
      path: `test-results/streaming-${viewport.name}-wrap-webgl2.png`,
      fullPage: true,
    });

    for (let i = 1; i <= 16; i++) {
      const lon = Math.PI - 0.001 + (i * Math.PI * 2) / 16;
      await page.evaluate((value) => window.advisorWorld.navigation.setFocus(value, 0.22), lon);
      await page.waitForTimeout(20);
      const p = await page.evaluate(() => window.advisorWorld.state.performance);
      expect(p.generationReady).toBeLessThanOrEqual(p.budget.generationReady);
      expect(p.activePatches).toBeLessThanOrEqual(p.budget.activePatches);
      expect(p.maxUploadsPerFrame).toBeLessThanOrEqual(1);
    }
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    const returned = await expectStreamingBudget(page);
    expect(returned.navigation.focus.lon).toBeCloseTo(baselineFocus.lon, 9);
    expect(returned.navigation.focus.lat).toBeCloseTo(baselineFocus.lat, 9);
    expect([...returned.performance.activeCanonicalKeys].sort()).toEqual(baselineKeys);
    expect(returned.navigation.labels.map((label) => label.id).sort()).toEqual(baselineLabels);

    const north = await navigateAndSettleWithinBudget(page, 0.8, Math.PI);
    const poleFeedback = north.navigation.poleLimit;
    expect(poleFeedback.side).toBe("north");
    expect(poleFeedback.stops).toBeGreaterThan(0);
    expect(north.navigation.focus.lat).toBeCloseTo(Math.PI / 2, 9);
    const northKeys = [...north.performance.activeCanonicalKeys].sort();
    await page.screenshot({
      path: `test-results/streaming-${viewport.name}-north-pole-webgl2.png`,
      fullPage: true,
    });

    const south = await navigateAndSettleWithinBudget(page, -0.8, -Math.PI);
    expect(south.navigation.poleLimit.side).toBe("south");
    expect(south.navigation.focus.lat).toBeCloseTo(-Math.PI / 2, 9);
    await page.screenshot({
      path: `test-results/streaming-${viewport.name}-south-pole-webgl2.png`,
      fullPage: true,
    });

    const northReturn = await navigateAndSettleWithinBudget(page, 1.4, Math.PI);
    expect(northReturn.navigation.focus.lat).toBeCloseTo(Math.PI / 2, 9);
    expect([...northReturn.performance.activeCanonicalKeys].sort()).toEqual(northKeys);
    expect(northReturn.performance.pendingGeneration).toBe(0);
    expect(northReturn.performance.readyUploads).toBe(0);
    await page.screenshot({
      path: `test-results/streaming-${viewport.name}-north-return-webgl2.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
