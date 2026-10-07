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

test("WebGL2 fallback keeps the same focus through handoff controls on every target viewport", async ({ page }) => {
  test.setTimeout(300000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.ready);
  expect(await page.evaluate(() => window.advisorRenderer.backend)).toBe("webgl2");
  const anchors = await page.evaluate(() => window.advisorWorld.handoff);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(
      (h) => window.advisorWorld.setHalfHeight(h),
      anchors.localHalfHeight * 0.94,
    );
    await page.waitForFunction(
      () =>
        window.advisorWorld.state.presentation === "flat" &&
        window.advisorWorld.state.settled,
    );
    const focus = await page.evaluate(() => ({ ...window.advisorWorld.state.view }));

    await page.locator("#zoom-out").click();
    await page.waitForFunction(
      () => window.advisorWorld.state.handoff.projectionTransition > 0.01,
    );
    let state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);

    await page.mouse.move(viewport.width * 0.5, viewport.height * 0.55);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(70);
    state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);

    await page.evaluate(() => {
      const c = document.getElementById("world"),
        r = c.getBoundingClientRect(),
        fire = (type, id, x, y) =>
          c.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: id,
              pointerType: "touch",
              clientX: x,
              clientY: y,
              buttons: type === "pointerup" ? 0 : 1,
            }),
          ),
        cy = r.top + r.height * 0.55,
        cx = r.left + r.width * 0.5;
      fire("pointerdown", 41, cx - 45, cy);
      fire("pointerdown", 42, cx + 45, cy);
      fire("pointermove", 41, cx - 70, cy);
      fire("pointermove", 42, cx + 70, cy);
      fire("pointerup", 41, cx - 70, cy);
      fire("pointerup", 42, cx + 70, cy);
    });
    await page.waitForTimeout(80);
    state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);

    await page.mouse.move(viewport.width * 0.5, viewport.height * 0.55);
    await page.mouse.wheel(0, -420);
    await page.waitForFunction(
      () => {
        const h = window.advisorWorld.state.handoff;
        return (
          h.desiredTransition < h.projectionTransition ||
          h.projectionTransition <= 0.01
        );
      },
    );
    state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);

    await page.evaluate(
      (h) => window.advisorWorld.setHalfHeight(h),
      anchors.globeHalfHeight * 1.06,
    );
    await page.waitForFunction(
      () =>
        window.advisorWorld.state.presentation === "globe" &&
        window.advisorWorld.state.settled,
    );
    state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);
    expect(state.handoff.destinationReady).toBeTruthy();

    await page.evaluate(
      (h) => window.advisorWorld.setHalfHeight(h),
      anchors.localHalfHeight * 0.94,
    );
    await page.waitForFunction(
      () =>
        window.advisorWorld.state.presentation === "flat" &&
        window.advisorWorld.state.settled,
    );
  }
  await expect(page.locator("#error")).toBeHidden();
  expect(errors).toEqual([]);
});
