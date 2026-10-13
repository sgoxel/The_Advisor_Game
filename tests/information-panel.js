import { test } from "@playwright/test";
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === "webgl2") await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }));
});
export async function expandInformation(page) {
  const toggle = page.locator("#toggle-region-panel");
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
}
