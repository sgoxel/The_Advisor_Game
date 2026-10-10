import { test, expect } from "@playwright/test";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`critical sites are discoverable and inspectable on ${viewport.name}`, async ({ page }) => {
    test.setTimeout(300000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await page.waitForFunction(() => window.advisorWorld?.state.ready && window.advisorSites?.sites?.length > 0);
    const target = await page.evaluate(() => {
      const site = window.advisorSites.sites.find((item) => item.kind === "ruin");
      window.advisorWorld.navigation.setFocus(site.canonicalPosition.lon, site.canonicalPosition.lat);
      window.advisorWorld.setHalfHeight(420);
      return { code: site.code, name: site.name };
    });
    await page.waitForFunction(
      (code) => {
        const marker = document.querySelector(`.critical-site-marker[data-code="${CSS.escape(code)}"]`);
        return marker && !marker.hidden && getComputedStyle(marker).display !== "none";
      },
      target.code,
      { timeout: 90000 },
    );
    const marker = page.locator(`.critical-site-marker[data-code="${target.code}"]`);
    await expect(marker).toBeVisible();
    await expect(marker).toContainText(target.name);
    await marker.click();
    const panel = page.locator("#critical-site-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(target.name);
    await expect(panel).toContainText("legal road junction");
    await expect(panel.locator("#critical-site-code")).toContainText("/SITE/");
    const before = await page.evaluate((code) => window.advisorSites.inspect(code).detail.signature, target.code);
    await page.evaluate(() => window.advisorWorld.navigation.setFocus(0, 0));
    await page.waitForTimeout(250);
    await page.evaluate((code) => {
      const site = window.advisorSites.sites.find((item) => item.code === code);
      window.advisorWorld.navigation.setFocus(site.canonicalPosition.lon, site.canonicalPosition.lat);
      window.advisorWorld.setHalfHeight(420);
    }, target.code);
    await page.waitForFunction((code) => window.advisorSites.state.visibleCodes.includes(code), target.code, { timeout: 90000 });
    const after = await page.evaluate((code) => window.advisorSites.inspect(code).detail.signature, target.code);
    expect(after).toBe(before);
    const state = await page.evaluate(() => window.advisorSites.state);
    expect(state.visibleCount).toBeLessThanOrEqual(viewport.name === "phone" ? 8 : 14);
    expect(state.cachedDetails).toBeLessThanOrEqual(window.advisorSites?.sites?.length ?? 1000);
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(errors).toEqual([]);
  });
}
