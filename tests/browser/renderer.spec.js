import { test, expect } from "@playwright/test";
for (const scenario of [
  "missing",
  "blocked",
  "device-failure",
  "late-failure",
]) {
  test(`${scenario} WebGPU automatically renders through WebGL2`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((scenario) => {
      const gpu =
        scenario === "missing"
          ? undefined
          : {
              async requestAdapter() {
                if (scenario === "blocked") return null;
                if (scenario === "device-failure")
                  return {
                    features: new Set(),
                    async requestDevice() {
                      throw Error("Device denied");
                    },
                  };
                // Simulate failure after WebGPU has already bound the canvas.
                document.getElementById("world").getContext("webgpu");
                throw Error("Canvas initialization failed");
              },
            };
      Object.defineProperty(navigator, "gpu", {
        value: gpu,
        configurable: true,
      });
    }, scenario);
    await page.goto("/");
    await page.waitForFunction(() => window.advisorWorld?.state.settled);
    expect(await page.evaluate(() => window.advisorRenderer)).toMatchObject({
      requested: "webgpu",
      backend: "webgl2",
      phase: "ready",
      error: "",
    });
    expect(
      await page.evaluate(() => window.advisorRenderer.fallbackReason),
    ).toBeTruthy();
    await expect(page.locator("#error")).toBeHidden();
    await expect(page.locator("#backend")).toContainText("WebGL2");
    const cell = await page.evaluate(() => window.advisorWorld.cellAt(1, 1));
    await page.screenshot({
      path: `test-results/fallback-${scenario}-phone.png`,
    });
    if (scenario === "blocked") {
      // Verify full refinement once: the other cases use this same renderer.
      await page.locator("#zoom-in").click();
      await page.waitForFunction(() => window.advisorWorld.state.settled);
      expect(
        await page.evaluate(() => window.advisorWorld.state.view.halfHeight),
      ).toBeLessThan(97);
      await page.screenshot({
        path: "test-results/fallback-blocked-detail.png",
      });
    }
    await page.locator("#world").click({ position: { x: 275, y: 485 } });
    await expect(page.locator("#cell-panel")).toBeVisible();
    expect(await page.evaluate(() => window.advisorWorld.cellAt(1, 1))).toEqual(
      cell,
    );
    expect(errors).toEqual([]);
  });
}
test("the Realm globe renders through WebGL2 and returns to the flat village", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.ready);
  await page.locator("#overview").click();
  await page.waitForFunction(
    () =>
      window.advisorWorld.state.presentation === "globe" &&
      window.advisorWorld.state.globe.complete &&
      window.advisorWorld.state.settled,
  );
  expect(await page.evaluate(() => window.advisorRenderer.backend)).toBe(
    "webgl2",
  );
  await expect(page.locator("#detail-name")).toHaveText("Realm");
  await expect(page.locator("#error")).toBeHidden();
  // The compact phone panel leaves the globe uncovered.
  const panel = await page.locator(".region-panel").boundingBox();
  expect(panel.y + panel.height).toBeLessThanOrEqual(200);
  await page.screenshot({ path: "test-results/fallback-globe-phone.png" });
  await page.locator("#home").click();
  await page.waitForFunction(
    () =>
      window.advisorWorld.state.presentation === "flat" &&
      window.advisorWorld.state.view.halfHeight === 97,
  );
  expect(errors).toEqual([]);
});
test("both unavailable backends show an actionable failure", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    });
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === "webgl2" ? null : original.call(this, type, ...args);
    };
  });
  await page.goto("/");
  await expect(page.locator("#error")).toContainText("WebGL2 unavailable");
  await expect(
    page.getByRole("button", { name: "Retry rendering" }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.advisorRenderer.phase)).toBe(
    "failed",
  );
});


test("WebGL2 fallback keeps the same focus through the handoff and pinch", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }));
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.ready);
  const anchors = await page.evaluate(() => window.advisorWorld.handoff);
  await page.evaluate((h) => window.advisorWorld.setHalfHeight(h), anchors.localHalfHeight * 1.15);
  await page.waitForFunction(() => window.advisorWorld.state.handoff.projectionTransition > 0.01);
  const focus = await page.evaluate(() => ({ ...window.advisorWorld.state.view }));
  await page.locator("#zoom-out").click();
  await page.locator("#world").hover();
  await page.mouse.wheel(0, 100);
  await page.evaluate(() => {
    const c = document.getElementById("world"), r = c.getBoundingClientRect();
    const fire = (type, id, x) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: id, pointerType: "touch", clientX: x,
      clientY: r.top + r.height * 0.55, buttons: type === "pointerup" ? 0 : 1,
    }));
    const cx = r.left + r.width / 2;
    fire("pointerdown", 41, cx - 35); fire("pointerdown", 42, cx + 35);
    fire("pointermove", 41, cx - 55); fire("pointermove", 42, cx + 55);
    fire("pointerup", 41, cx - 55); fire("pointerup", 42, cx + 55);
  });
  await page.waitForTimeout(100);
  const state = await page.evaluate(() => window.advisorWorld.state);
  expect(state.view.x).toBe(focus.x);
  expect(state.view.z).toBe(focus.z);
  expect(state.view.yaw).toBe(focus.yaw);
  expect(await page.evaluate(() => window.advisorRenderer.backend)).toBe("webgl2");
  expect(errors).toEqual([]);
});
