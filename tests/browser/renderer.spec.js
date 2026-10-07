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
    await page.locator("#zoom-in").click();
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    expect(
      await page.evaluate(() => window.advisorWorld.state.view.halfHeight),
    ).toBeLessThan(97);
    await page.locator("#world").click({ position: { x: 275, y: 485 } });
    await expect(page.locator("#cell-panel")).toBeVisible();
    expect(await page.evaluate(() => window.advisorWorld.cellAt(1, 1))).toEqual(
      cell,
    );
    expect(errors).toEqual([]);
  });
}
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
