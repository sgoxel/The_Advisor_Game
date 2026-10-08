import { test, expect } from "@playwright/test";

async function expectBounded(page) {
  const state = await page.evaluate(() => window.advisorWorld.state);
  const s = state.streaming;
  expect(s.generationReadyQueue).toBeLessThanOrEqual(s.budget.queue);
  expect(s.pendingGeneration + s.readyUploads).toBeLessThanOrEqual(s.budget.queue);
  expect(s.activePatches).toBeLessThanOrEqual(s.budget.active);
  expect(s.cachedPatches).toBeLessThanOrEqual(s.budget.cached);
  expect(s.cpuResourceBytesEstimated).toBeLessThanOrEqual(s.budget.cpuBytes);
  expect(s.gpuResourceBytesEstimated).toBeLessThanOrEqual(s.budget.gpuBytes);
  expect(s.maxUploadsPerFrameObserved).toBeLessThanOrEqual(1);
  expect(new Set(s.activeCanonicalKeys).size).toBe(s.activeCanonicalKeys.length);
  return state;
}

for (const profile of [
  { name: "phone", width: 390, height: 844, device: "phone" },
  { name: "desktop", width: 1440, height: 900, device: "desktop" },
]) {
  test(`WebGL2 wrap/pole streaming stays canonical and bounded on ${profile.name}`, async ({ page }) => {
    test.setTimeout(420000);
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "gpu", {
        value: undefined,
        configurable: true,
      }),
    );
    await page.goto("/");
    await page.waitForFunction(() => window.advisorWorld?.state.settled);
    expect(await page.evaluate(() => window.advisorRenderer.backend)).toBe("webgl2");
    expect((await expectBounded(page)).streaming.deviceClass).toBe(profile.device);

    await page.evaluate(() => {
      window.advisorWorld.setHalfHeight(97);
      window.advisorWorld.navigation.setFocus(0.42, 0.2);
    });
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    const canonical = await page.evaluate(() => ({
      focus: window.advisorWorld.state.navigation.focus,
      keys: [...window.advisorWorld.state.streaming.activeCanonicalKeys].sort(),
      misses: window.advisorWorld.state.streaming.cacheMisses,
    }));
    await page.evaluate(() =>
      window.advisorWorld.navigation.setFocus(0.42 + Math.PI * 2, 0.2),
    );
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    const fullTurn = await expectBounded(page);
    expect(fullTurn.navigation.focus.lon).toBeCloseTo(canonical.focus.lon, 10);
    expect(fullTurn.navigation.focus.lat).toBeCloseTo(canonical.focus.lat, 10);
    expect([...fullTurn.streaming.activeCanonicalKeys].sort()).toEqual(canonical.keys);
    expect(fullTurn.streaming.cacheMisses).toBe(canonical.misses);

    for (const lon of [
      Math.PI - 0.003,
      -Math.PI + 0.003,
      Math.PI - 0.002,
      -Math.PI + 0.002,
    ]) {
      await page.evaluate(
        (value) => window.advisorWorld.navigation.setFocus(value, 0),
        lon,
      );
      await page.waitForFunction(() => window.advisorWorld.state.settled);
      await expectBounded(page);
    }

    await page.evaluate(() => {
      for (let i = 0; i < 18; i++)
        window.advisorWorld.navigation.setFocus(
          i % 2 ? -Math.PI + 0.004 : Math.PI - 0.004,
          0.12,
        );
    });
    const churn = await expectBounded(page);
    expect(churn.visibleMeshes.terrain).toBeGreaterThan(0);
    await page.waitForFunction(() => window.advisorWorld.state.settled);

    await page.evaluate(() =>
      window.advisorWorld.navigation.setFocus(0.7, Math.PI),
    );
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    let pole = await expectBounded(page);
    expect(pole.navigation.focus.lat).toBeCloseTo(Math.PI / 2, 10);
    expect(pole.navigation.poleLimit).toBe("north");
    await expect(page.locator("#tile-status")).toContainText("North pole limit");

    await page.evaluate(() =>
      window.advisorWorld.navigation.setFocus(-1.1, -Math.PI),
    );
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    pole = await expectBounded(page);
    expect(pole.navigation.focus.lat).toBeCloseTo(-Math.PI / 2, 10);
    expect(pole.navigation.poleLimit).toBe("south");
    await expect(page.locator("#tile-status")).toContainText("South pole limit");

    if (profile.device === "phone") {
      const first = 0.15;
      for (let i = 0; i < 8; i++) {
        await page.evaluate(
          ({ lon, lat }) => window.advisorWorld.navigation.setFocus(lon, lat),
          { lon: first + i * 0.52, lat: (i % 3 - 1) * 0.22 },
        );
        await page.waitForFunction(() => window.advisorWorld.state.settled);
        await expectBounded(page);
      }
      const beforeRevisit = await page.evaluate(
        () => window.advisorWorld.state.streaming.evictions,
      );
      expect(beforeRevisit).toBeGreaterThan(0);
      await page.evaluate(
        (lon) => window.advisorWorld.navigation.setFocus(lon, 0),
        first,
      );
      await page.waitForFunction(() => window.advisorWorld.state.settled);
      const revisit = await expectBounded(page);
      expect(revisit.streaming.evictions).toBeGreaterThanOrEqual(beforeRevisit);
    }
  });
}
