import { test, expect } from "@playwright/test";

test("Realm macro surface is prepared once, reused across navigation and bounded on desktop/phone landscape", async ({ page }) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.planet?.macro && window.advisorWorld.state.ready);
  expect(await page.evaluate(() => window.advisorRenderer.backend)).toBe("webgpu");
  await page.evaluate(() => window.advisorWorld.setHalfHeight(window.advisorWorld.handoff.globeHalfHeight));
  await page.waitForFunction(() => window.advisorWorld.state.globe.complete && window.advisorWorld.state.settled);

  const signature = await page.evaluate(() =>
    window.advisorWorld.planet.macro.continents.map((c) => [c.code, c.canonicalPosition.lon, c.canonicalPosition.lat]),
  );
  const first = await page.evaluate(() => ({ ...window.advisorWorld.state.globe }));
  expect(first.surfaceBuilds).toBe(2);
  expect(first.textureWidth).toBe(1024);
  expect(first.textureHeight).toBe(512);
  expect(first.drawCalls).toBe(2);
  expect(first.triangles).toBeGreaterThan(8000);
  expect(first.surfaceBuildCpuMs).toBeGreaterThan(0);
  expect(first.surfaceUploadCpuMs).toBeGreaterThanOrEqual(0);
  expect(first.cpuResourceBytesEstimated).toBeGreaterThan(0);
  expect(first.gpuResourceBytesEstimated).toBeGreaterThan(0);

  for (let i = 0; i < 3; i++) {
    await page.evaluate((index) => {
      const p = window.advisorWorld.planet.macro.continents[index].canonicalPosition;
      window.advisorWorld.navigation.setFocus(p.lon, p.lat);
    }, i);
    await page.waitForFunction(() => window.advisorWorld.state.settled);
  }
  const desktop = await page.evaluate(() => ({ ...window.advisorWorld.state.globe }));
  expect(desktop.surfaceBuilds).toBe(first.surfaceBuilds);
  expect(desktop.surfaceReuseHits).toBeGreaterThan(first.surfaceReuseHits);
  expect(desktop.orientationUpdates).toBeGreaterThan(first.orientationUpdates);
  expect(await page.evaluate(() =>
    window.advisorWorld.planet.macro.continents.map((c) => [c.code, c.canonicalPosition.lon, c.canonicalPosition.lat]),
  )).toEqual(signature);
  console.log("WP13_REALM_TELEMETRY_DESKTOP", JSON.stringify(desktop));

  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => {
    const p = window.advisorWorld.planet.macro.continents[0].canonicalPosition;
    window.advisorWorld.navigation.setFocus(p.lon, p.lat);
  });
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  const phoneLandscape = await page.evaluate(() => ({ ...window.advisorWorld.state.globe }));
  expect(phoneLandscape.surfaceBuilds).toBe(first.surfaceBuilds);
  expect(phoneLandscape.surfaceReuseHits).toBeGreaterThan(desktop.surfaceReuseHits);
  console.log("WP13_REALM_TELEMETRY_PHONE_LANDSCAPE", JSON.stringify(phoneLandscape));
});
