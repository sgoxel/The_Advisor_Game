import { test, expect } from "@playwright/test";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 720 },
  { name: "phone", width: 390, height: 844 },
];

async function expectStreamingBudget(page) {
  const state = await page.evaluate(() => window.advisorWorld.state);
  const p = state.performance;
  expect(p).toBeTruthy();
  expect(p.backend).toBe("webgpu");
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

for (const viewport of VIEWPORTS) {
  test(`real WebGPU canonical streaming ${viewport.name}`, async ({ page }) => {
    test.setTimeout(600000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await page.waitForFunction(
      () =>
        window.advisorWorld?.renderer?.phase === "ready" &&
        window.advisorWorld?.state?.ready,
    );
    expect(await page.evaluate(() => window.advisorWorld.renderer.backend)).toBe("webgpu");
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    await page.locator("#map-scale").selectOption("100");
    await page.evaluate(() => window.advisorWorld.navigation.setFocus(Math.PI - 0.001, 0.22));
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    await page.locator("#grid").check();
    const seam = await expectStreamingBudget(page);
    expect(seam.performance.deviceClass).toBe(viewport.name);
    const baselineKeys = [...seam.performance.activeCanonicalKeys].sort();
    const baselineLabels = seam.navigation.labels.map((label) => label.id).sort();
    const baselineFocus = seam.navigation.focus;
    await page.screenshot({
      path: `test-results/streaming-${viewport.name}-wrap-webgpu.png`,
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

    await page.evaluate(() => window.advisorWorld.navigation.setFocus(0.8, Math.PI));
    const poleFeedback = await page.evaluate(() => window.advisorWorld.state.navigation.poleLimit);
    expect(poleFeedback.side).toBe("north");
    expect(poleFeedback.stops).toBeGreaterThan(0);
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    const pole = await expectStreamingBudget(page);
    expect(pole.navigation.focus.lat).toBeCloseTo(Math.PI / 2, 9);
    await page.screenshot({
      path: `test-results/streaming-${viewport.name}-north-pole-webgpu.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
