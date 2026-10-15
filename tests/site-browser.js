import { test, expect } from "@playwright/test";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900, limit: 14 },
  { name: "phone", width: 390, height: 844, limit: 8 },
]) {
  for (const kind of ["ruin", "critical-place"]) {
    test(`${kind} semantic icon, detail and inspection stay canonical on ${viewport.name}`, async ({ page }) => {
      test.setTimeout(300000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      await page.waitForFunction(() => window.advisorWorld?.state.ready && window.advisorSites?.sites?.length > 0);
      const target = await page.evaluate((siteKind) => {
        const site = window.advisorSites.sites.find((item) => item.kind === siteKind && item.visibility === "public");
        window.advisorWorld.navigation.setFocus(site.canonicalPosition.lon, site.canonicalPosition.lat);
        return { code: site.code, name: site.name, lon: site.canonicalPosition.lon, lat: site.canonicalPosition.lat };
      }, kind);
      const selector = `.critical-site-marker[data-code="${target.code}"]`;

      await page.selectOption("#map-scale", "1000");
      await page.waitForFunction((code) => {
        const marker = document.querySelector(`.critical-site-marker[data-code="${CSS.escape(code)}"]`);
        return window.advisorWorld?.state.scaleLabel === "1/1000" && window.advisorWorld.state.presentation === "flat" && marker && !marker.hidden && marker.dataset.mode === "semantic";
      }, target.code, { timeout: 90000 });
      const marker = page.locator(selector);
      await expect(marker).toBeVisible();
      await expect(marker).toHaveAttribute("data-mode", "semantic");
      const far = await page.evaluate((code) => ({ visible: window.advisorSites.state.visibleCodes.includes(code), visibleCount: window.advisorSites.state.visibleCount, cachedDetails: window.advisorSites.state.cachedDetails }), target.code);
      expect(far.visible).toBe(true);
      expect(far.visibleCount).toBeLessThanOrEqual(viewport.limit);
      expect(far.cachedDetails).toBe(0);

      await page.selectOption("#map-scale", "100");
      await page.waitForFunction((code) => {
        const marker = document.querySelector(`.critical-site-marker[data-code="${CSS.escape(code)}"]`);
        return window.advisorWorld?.state.scaleLabel === "1/100" && marker && !marker.hidden && marker.dataset.mode === "detailed";
      }, target.code, { timeout: 90000 });
      await expect(marker).toHaveAttribute("data-code", target.code);
      await expect(marker).toHaveAttribute("data-mode", "detailed");
      await marker.click();
      const panel = page.locator("#critical-site-panel");
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(target.name);
      await expect(panel.locator("#critical-site-code")).toHaveText(target.code);
      await expect(panel).toContainText("legal road junction");

      const detailed = await page.evaluate((code) => {
        const site = window.advisorSites.inspect(code);
        return { code: site.code, lon: site.canonicalPosition.lon, lat: site.canonicalPosition.lat, signature: site.detail.signature, state: { ...window.advisorSites.state }, totalSites: window.advisorSites.sites.length };
      }, target.code);
      expect(detailed.code).toBe(target.code);
      expect(detailed.lon).toBe(target.lon);
      expect(detailed.lat).toBe(target.lat);
      expect(detailed.state.visibleCount).toBeLessThanOrEqual(viewport.limit);
      expect(detailed.state.cachedDetails).toBeLessThan(detailed.totalSites);

      await page.evaluate(() => window.advisorWorld.navigation.setFocus(0, 0));
      await page.waitForTimeout(150);
      await page.evaluate(({ lon, lat }) => window.advisorWorld.navigation.setFocus(lon, lat), target);
      await page.selectOption("#map-scale", "100");
      await page.waitForFunction((code) => window.advisorSites?.state.visibleCodes.includes(code), target.code, { timeout: 90000 });
      const revisit = await page.evaluate((code) => window.advisorSites.inspect(code).detail.signature, target.code);
      expect(revisit).toBe(detailed.signature);
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(errors).toEqual([]);
    });
  }
}
