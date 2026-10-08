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

function streamingSample(state) {
  const p = state.performance;
  return {
    settled: state.settled,
    error: state.error,
    pendingSet: state.pending,
    pendingGeneration: p.pendingGeneration,
    readyUploads: p.readyUploads,
    generationReady: p.generationReady,
    activePatches: p.activePatches,
    cachedPatches: p.cachedPatches,
    wantedPatches: p.wantedCanonicalKeys.length,
    missingFromActive: p.wantedCanonicalKeys.filter(
      (key) => !p.activeCanonicalKeys.includes(key),
    ).length,
    withinBudget: p.withinBudget,
  };
}

async function navigateAndSettleWithinBudget(
  page,
  lon,
  lat,
  timeoutMs = 120000,
  label = "navigation",
) {
  await page.evaluate(
    ({ lon, lat }) => window.advisorWorld.navigation.setFocus(lon, lat),
    { lon, lat },
  );
  const deadline = Date.now() + timeoutMs;
  let nextSample = Date.now();
  const samples = [];
  let lastState;
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const state = (lastState = await page.evaluate(() => window.advisorWorld.state));
    const p = state.performance;
    expect(p.backend).toBe("webgpu");
    expect(p.generationReady).toBeLessThanOrEqual(p.budget.generationReady);
    expect(p.activePatches).toBeLessThanOrEqual(p.budget.activePatches);
    expect(p.cachedPatches).toBeLessThanOrEqual(p.budget.cachedPatches);
    expect(p.cpuResourceBytesEstimated).toBeLessThanOrEqual(p.budget.cpuBytes);
    expect(p.gpuResourceBytesEstimated).toBeLessThanOrEqual(p.budget.gpuBytes);
    expect(p.maxUploadsPerFrame).toBeLessThanOrEqual(1);
    expect(p.canonicalKeysUnique).toBeTruthy();
    expect(p.withinBudget).toBeTruthy();
    if (state.settled) return state;
    if (Date.now() >= nextSample) {
      samples.push(streamingSample(state));
      nextSample = Date.now() + 5000;
    }
  }
  throw new Error(
    `${label} did not settle within ${timeoutMs / 1000} seconds; ` +
      JSON.stringify({ samples, final: streamingSample(lastState) }),
  );
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
    await page.locator("#map-scale").selectOption("20");
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
      expect(p.backend).toBe("webgpu");
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

    const north = await navigateAndSettleWithinBudget(
      page,
      0.8,
      Math.PI,
      120000,
      "north rollover",
    );
    const poleFeedback = north.navigation.poleLimit;
    expect(poleFeedback.side).toBe("north");
    expect(poleFeedback.stops).toBeGreaterThan(0);
    expect(north.navigation.focus.lat).toBeCloseTo(Math.PI / 2, 9);
    const northKeys = [...north.performance.activeCanonicalKeys].sort();
    await page.screenshot({
      path: `test-results/streaming-${viewport.name}-north-pole-webgpu.png`,
      fullPage: true,
    });

    const south = await navigateAndSettleWithinBudget(
      page,
      -0.8,
      -Math.PI,
      30000,
      "south rollover diagnostic",
    );
    expect(south.navigation.poleLimit.side).toBe("south");
    expect(south.navigation.focus.lat).toBeCloseTo(-Math.PI / 2, 9);
    await page.screenshot({
      path: `test-results/streaming-${viewport.name}-south-pole-webgpu.png`,
      fullPage: true,
    });

    const northReturn = await navigateAndSettleWithinBudget(
      page,
      1.4,
      Math.PI,
      120000,
      "north return",
    );
    expect(northReturn.navigation.focus.lat).toBeCloseTo(Math.PI / 2, 9);
    expect([...northReturn.performance.activeCanonicalKeys].sort()).toEqual(northKeys);
    expect(northReturn.performance.pendingGeneration).toBe(0);
    expect(northReturn.performance.readyUploads).toBe(0);
    await page.screenshot({
      path: `test-results/streaming-${viewport.name}-north-return-webgpu.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
