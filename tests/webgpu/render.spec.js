import { test, expect } from "@playwright/test";
test("the real WebGPU backend renders the seeded world", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /webgpu|gpuvalidation|shader|wgsl|device.*lost/i.test(message.text())) errors.push(message.text());
  });
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/");
  await page.waitForFunction(
    () => window.advisorRenderer?.phase !== "starting",
  );
  expect(await page.evaluate(() => window.advisorRenderer)).toMatchObject({
    requested: "webgpu",
    backend: "webgpu",
    phase: "ready",
    error: "",
  });
  await page.waitForFunction(() => window.advisorWorld?.state.settled);
  await expect(page.locator("#backend")).toContainText("WebGPU");
  await page.screenshot({ path: "test-results/webgpu-village.png" });
  await page.locator("#zoom-in").click();
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  await page.screenshot({ path: "test-results/webgpu-detail.png" });
  expect(errors).toEqual([]);
});
