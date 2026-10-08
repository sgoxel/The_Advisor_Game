import { test, expect } from "@playwright/test";

const settle = (page) =>
  page.waitForFunction(
    () => window.advisorWorld?.state.settled && !window.advisorWorld.state.error,
  );

function verifyBounds(streaming) {
  expect(streaming.activePatches).toBeLessThanOrEqual(
    streaming.budget.activePatches,
  );
  expect(streaming.cachedPatches).toBeLessThanOrEqual(
    streaming.budget.cachedPatches,
  );
  expect(streaming.queuedTotal).toBeLessThanOrEqual(
    streaming.budget.generationReadyQueue,
  );
  expect(streaming.pendingGeneration).toBeLessThanOrEqual(
    streaming.budget.generationReadyQueue,
  );
  expect(streaming.readyUploads).toBeLessThanOrEqual(
    streaming.budget.generationReadyQueue,
  );
  expect(streaming.gpuBytesEstimated).toBeLessThanOrEqual(
    streaming.budget.gpuBytes,
  );
  expect(streaming.cpuBytesEstimated).toBeLessThanOrEqual(
    streaming.budget.cpuBytes,
  );
  expect(streaming.uploadsThisFrame).toBeLessThanOrEqual(1);
  expect(new Set(streaming.activeCanonicalKeys).size).toBe(
    streaming.activeCanonicalKeys.length,
  );
}

test("sustained wrap churn remains bounded and revisit identity is stable", async ({
  page,
}) => {
  test.setTimeout(300000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await settle(page);
  await page.locator("#map-scale").selectOption("100");

  const startLon = Math.PI - 0.003,
    startLat = 0.35;
  await page.evaluate(
    ([lon, lat]) => window.advisorWorld.navigation.setFocus(lon, lat),
    [startLon, startLat],
  );
  await settle(page);
  const first = await page.evaluate(() => window.advisorWorld.state.streaming);
  verifyBounds(first);
  const firstKeys = [...first.activeCanonicalKeys].sort();

  // Repeatedly cross the wrap in both directions and visit enough distant
  // longitudes to exercise cache eviction without changing canonical authority.
  const visits = [
    -Math.PI + 0.003,
    Math.PI - 0.006,
    -Math.PI + 0.006,
    -2.4,
    -1.6,
    -0.8,
    0,
    0.8,
    1.6,
    2.4,
    Math.PI - 0.009,
    -Math.PI + 0.009,
  ];
  for (const lon of visits) {
    await page.evaluate(
      ([nextLon, lat]) => window.advisorWorld.navigation.setFocus(nextLon, lat),
      [lon, startLat],
    );
    await settle(page);
    verifyBounds(await page.evaluate(() => window.advisorWorld.state.streaming));
  }

  // Rapid reverse-direction churn: deliberately move again before replacement
  // coverage can settle. Queue and upload work must remain bounded throughout.
  for (let i = 0; i < 18; i++) {
    const lon = i % 2 ? Math.PI - 0.012 : -Math.PI + 0.012;
    await page.evaluate(
      ([nextLon, lat]) => window.advisorWorld.navigation.setFocus(nextLon, lat),
      [lon, startLat + ((i % 3) - 1) * 0.002],
    );
    await page.waitForTimeout(30);
    verifyBounds(await page.evaluate(() => window.advisorWorld.state.streaming));
  }
  await settle(page);

  const beforeRevisit = await page.evaluate(() => window.advisorWorld.state.streaming);
  expect(beforeRevisit.evictions).toBeGreaterThan(0);
  await page.evaluate(
    ([lon, lat]) => window.advisorWorld.navigation.setFocus(lon, lat),
    [startLon + Math.PI * 2, startLat],
  );
  await settle(page);
  const revisit = await page.evaluate(() => window.advisorWorld.state.streaming);
  verifyBounds(revisit);
  expect([...revisit.activeCanonicalKeys].sort()).toEqual(firstKeys);
  expect(revisit.cacheMisses).toBeGreaterThanOrEqual(first.cacheMisses);
  expect(revisit.evictions).toBeGreaterThanOrEqual(beforeRevisit.evictions);
  expect(errors).toEqual([]);
});
