import { test } from "@playwright/test";
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === "webgl2") await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }));
});
export async function expandInformation(page) {
  const toggle = page.locator("#toggle-region-panel");
  // The panel module attaches its listener after hydration; retry briefly so a
  // click that lands during startup cannot leave the panel collapsed.
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await toggle.getAttribute("aria-expanded") === "true") return;
    await toggle.click();
    if (await toggle.getAttribute("aria-expanded") === "true") return;
    await page.waitForTimeout(100);
  }
}
/** Reveal one segmented category of the map-information panel. */
export async function showRegionTab(page, tab) {
  await expandInformation(page);
  await page.locator(`#region-tab-${tab}`).click();
}
