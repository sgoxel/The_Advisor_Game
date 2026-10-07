import { test, expect } from "@playwright/test";
test("missing WebGPU shows a reason and allows explicit compatibility", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await expect(page.locator("#error")).toContainText("does not expose WebGPU");
  expect(await page.evaluate(() => window.advisorRenderer.backend)).toBe("");
  await page.screenshot({ path: "test-results/webgpu-unavailable.png" });
  await page.locator("#use-webgl2").click();
  await page.waitForFunction(() => window.advisorWorld?.state.ready);
  await expect(page.locator("#backend")).toContainText("WebGL2");
  expect(await page.evaluate(() => window.advisorRenderer.requested)).toBe(
    "webgl2",
  );
});
