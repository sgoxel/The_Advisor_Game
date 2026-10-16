import { test, expect } from "@playwright/test";

const representativeViewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

const requiredViewports = [
  { name: "phone-360", width: 360, height: 800 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "desktop-1280", width: 1280, height: 720 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

for (const viewport of representativeViewports) {
  test(`critical sites are discoverable and inspectable on ${viewport.name}`, async ({ page }) => {
    test.setTimeout(300000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await page.waitForFunction(() => window.advisorWorld?.state.ready && window.advisorSites?.sites?.length > 0);
    const target = await page.evaluate(() => {
      const site = window.advisorSites.sites.find((item) => item.kind === "ruin");
      window.advisorWorld.navigation.setFocus(site.canonicalPosition.lon, site.canonicalPosition.lat);
      return { code: site.code, name: site.name };
    });

    await page.selectOption("#map-scale", "1000");
    await page.waitForFunction(
      (code) => {
        const marker = document.querySelector(`.critical-site-marker[data-code="${CSS.escape(code)}"]`), state = window.advisorWorld?.state;
        return state?.scaleLabel === "1/1000" && state.presentation === "flat" && marker && !marker.hidden && getComputedStyle(marker).display !== "none";
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

    await page.selectOption("#map-scale", "100");
    await page.waitForFunction(
      (code) => window.advisorWorld?.state.scaleLabel === "1/100" && window.advisorSites?.state.visibleCodes.includes(code),
      target.code,
      { timeout: 90000 },
    );
    await marker.click();
    const panel = page.locator("#critical-site-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(target.name);
    await expect(panel).toContainText("legal road junction");
    await expect(panel).toContainText("natural relief");
    await expect(panel.locator("#critical-site-code")).toContainText("/SITE/KEEP");
    const before = await page.evaluate((code) => window.advisorSites.inspect(code).detail.signature, target.code);
    const churn = await page.evaluate(() => {
      for (const site of window.advisorSites.sites) window.advisorSites.inspect(site.code);
      return { ...window.advisorSites.state, totalSites: window.advisorSites.sites.length };
    });
    expect(churn.cachedDetails).toBeLessThanOrEqual(churn.detailCacheLimit);
    expect(churn.detailCacheLimit).toBeLessThan(churn.totalSites);

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
    expect(state.cachedDetails).toBeLessThanOrEqual(state.detailCacheLimit);
    expect(state.detailCacheLimit).toBeLessThan(state.totalSites);
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(errors).toEqual([]);
  });
}

test("critical-site controls remain touch-safe and in-bounds on all required viewports", async ({ page }) => {
  test.setTimeout(300000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.ready && window.advisorSites?.sites?.length > 0);
  const target = await page.evaluate(() => {
    const site = window.advisorSites.sites.find((item) => item.kind === "critical-place");
    window.advisorWorld.navigation.setFocus(site.canonicalPosition.lon, site.canonicalPosition.lat);
    return { code: site.code, name: site.name };
  });
  await page.selectOption("#map-scale", "100");
  await page.waitForFunction((code) => window.advisorSites?.state.visibleCodes.includes(code), target.code, { timeout: 90000 });
  await page.locator(`.critical-site-marker[data-code="${target.code}"]`).click();
  const panel = page.locator("#critical-site-panel");
  await expect(panel).toBeVisible();

  for (const viewport of requiredViewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(120);
    const geometry = await page.evaluate((code) => {
      const marker = document.querySelector(`.critical-site-marker[data-code="${CSS.escape(code)}"]`),
        panel = document.getElementById("critical-site-panel"),
        close = document.getElementById("close-critical-site"),
        markerBox = marker?.getBoundingClientRect(),
        panelBox = panel?.getBoundingClientRect(),
        closeBox = close?.getBoundingClientRect();
      return {
        marker: markerBox && { x: markerBox.x, y: markerBox.y, width: markerBox.width, height: markerBox.height },
        panel: panelBox && { x: panelBox.x, y: panelBox.y, width: panelBox.width, height: panelBox.height },
        close: closeBox && { width: closeBox.width, height: closeBox.height },
        hidden: marker?.hidden ?? true,
      };
    }, target.code);
    expect(geometry.hidden, viewport.name).toBe(false);
    expect(geometry.marker, viewport.name).not.toBeNull();
    expect(geometry.marker.width, viewport.name).toBeGreaterThanOrEqual(44);
    expect(geometry.marker.height, viewport.name).toBeGreaterThanOrEqual(44);
    expect(geometry.close.width, viewport.name).toBeGreaterThanOrEqual(44);
    expect(geometry.close.height, viewport.name).toBeGreaterThanOrEqual(44);
    expect(geometry.panel.x, viewport.name).toBeGreaterThanOrEqual(0);
    expect(geometry.panel.y, viewport.name).toBeGreaterThanOrEqual(0);
    expect(geometry.panel.x + geometry.panel.width, viewport.name).toBeLessThanOrEqual(viewport.width + 1);
    expect(geometry.panel.y + geometry.panel.height, viewport.name).toBeLessThanOrEqual(viewport.height + 1);
  }
  await expect(panel).toContainText(target.name);
  expect(errors).toEqual([]);
});
