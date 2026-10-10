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
      return { code: site.code, name: site.name };
    });

    // Important-place discoverability begins at the exact canonical 1/1000 anchor.
    // Drive the real player scale control so this assertion covers the same flat-view
    // boundary players use instead of an approximate half-height that can enter handoff.
    await page.selectOption("#map-scale", "1000");
    await page.waitForFunction(
      (code) => {
        const marker = document.querySelector(`.critical-site-marker[data-code="${CSS.escape(code)}"]`),
          state = window.advisorWorld?.state;
        return state?.scaleLabel === "1/1000" && state.presentation === "flat" &&
          marker && !marker.hidden && getComputedStyle(marker).display !== "none";
      },
      target.code,
      { timeout: 90000 },
    );
    const marker = page.locator(`.critical-site-marker[data-code="${target.code}"]`);
    await expect(marker).toBeVisible();
    await expect(marker).toContainText(target.name);
    const discovery = await page.evaluate((code) => ({
      scale: window.advisorWorld.state.scaleLabel,
      presentation: window.advisorWorld.state.presentation,
      visible: window.advisorSites.state.visibleCodes.includes(code),
      visibleCount: window.advisorSites.state.visibleCount,
    }), target.code);
    expect(discovery.scale).toBe("1/1000");
    expect(discovery.presentation).toBe("flat");
    expect(discovery.visible).toBe(true);
    expect(discovery.visibleCount).toBeLessThanOrEqual(viewport.name === "phone" ? 8 : 14);

    // Close inspection uses the same canonical site; detail may materialize only after
    // the view moves inward and must reconstruct identically after a revisit.
    await page.selectOption("#map-scale", "100");
    await page.waitForFunction(
      (code) => window.advisorWorld?.state.scaleLabel === "1/100" &&
        window.advisorSites?.state.visibleCodes.includes(code),
      target.code,
      { timeout: 90000 },
    );
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
    }, target.code);
    await page.selectOption("#map-scale", "100");
    await page.waitForFunction((code) => window.advisorSites.state.visibleCodes.includes(code), target.code, { timeout: 90000 });
    const after = await page.evaluate((code) => window.advisorSites.inspect(code).detail.signature, target.code);
    expect(after).toBe(before);
    const state = await page.evaluate(() => ({ ...window.advisorSites.state, totalSites: window.advisorSites.sites.length }));
    expect(state.visibleCount).toBeLessThanOrEqual(viewport.name === "phone" ? 8 : 14);
    expect(state.cachedDetails).toBeLessThanOrEqual(state.totalSites);
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(errors).toEqual([]);
  });
}
