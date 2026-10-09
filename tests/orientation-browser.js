export function orientationTests(test, expect, webgl2) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`geographic orientation survives local/globe handoff ${viewport.width}`, async ({ page }) => {
      test.setTimeout(600000);
      if (webgl2) await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }));
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.waitForFunction(() => window.advisorWorld?.state.settled);
      expect(await page.evaluate(() => window.advisorRenderer.backend)).toBe(webgl2 ? "webgl2" : "webgpu");
      // Prepare the shared globe texture before exercising rapid local pans.
      await page.locator("#overview").click();
      await page.waitForFunction(() => window.advisorWorld.state.globe.complete, null, { timeout: 180000 });
      await page.evaluate(() => window.advisorWorld.navigation.setFocus(-1.05, -0.2));
      for (const blend of [0, 0.49, 0.51, 1]) {
        await page.evaluate((blend) => {
          const w = window.advisorWorld, a = w.handoff.localHalfHeight, b = w.handoff.globeHalfHeight;
          const t = 1 - Math.pow(1 - blend, 0.1);
          w.setHalfHeight(blend === 0 ? a * 0.9 : blend === 1 ? b * 1.1 : Math.exp(Math.log(a) + t * Math.log(b / a)));
        }, blend);
        await page.waitForFunction(() => {
          const h = window.advisorWorld.state.handoff;
          return h.destinationReady && Math.abs(h.projectionTransition - h.desiredTransition) <= 0.001;
        }, null, { timeout: 180000 }).catch(async (error) => {
          console.log("orientation readiness", blend, await page.evaluate(() => ({ handoff: window.advisorWorld.state.handoff, performance: window.advisorWorld.state.performance, error: window.advisorWorld.state.error })));
          throw error;
        });
        const points = await page.evaluate(() => {
          const w = window.advisorWorld, x = innerWidth / 2, y = innerHeight / 2;
          return { focus: w.state.navigation.focus, north: w.navigation.surfaceAtScreen(x, y - 45), east: w.navigation.surfaceAtScreen(x + 45, y), yaw: w.state.view.yaw };
        });
        expect(points.north.lat).toBeGreaterThan(points.focus.lat);
        expect(Math.atan2(Math.sin(points.east.lon - points.focus.lon), Math.cos(points.east.lon - points.focus.lon))).toBeGreaterThan(0);
        await page.screenshot({ path: `test-results/orientation-${webgl2 ? "webgl2" : "webgpu"}-${viewport.width}-${blend}.png` });
        const before = points.focus;
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await page.mouse.down();
        await page.mouse.move(viewport.width / 2 + 35, viewport.height / 2 + 20, { steps: 5 });
        await page.mouse.up();
        const after = await page.evaluate(() => ({ focus: window.advisorWorld.state.navigation.focus, yaw: window.advisorWorld.state.view.yaw }));
        expect(after.focus.lon).toBeLessThan(before.lon);
        expect(after.focus.lat).toBeGreaterThan(before.lat);
        expect(after.yaw).toBe(points.yaw);
        await page.evaluate(() => window.advisorWorld.navigation.setFocus(-1.05, -0.2));
      }
    });
  }
}
