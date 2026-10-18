import { test, expect } from "@playwright/test";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`critical sites are discoverable and inspectable on ${viewport.name}`, async ({ page }, testInfo) => {
    test.setTimeout(300000);
    const errors = [],
      expectWebgl = !/webgpu/i.test(testInfo.config.configFile ?? "");
    page.on("pageerror", (error) => errors.push(error.message));
    if (expectWebgl)
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }),
      );
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await page.waitForFunction(
      () => window.advisorWorld?.state.ready && window.advisorSites?.sites?.length > 0,
    );
    expect(await page.evaluate(() => window.advisorWorld.renderer.backend)).toBe(
      expectWebgl ? "webgl2" : "webgpu",
    );
    const target = await page.evaluate(() => {
      const site = window.advisorSites.sites.find((item) => item.kind === "ruin");
      window.advisorWorld.navigation.setFocus(
        site.canonicalPosition.lon,
        site.canonicalPosition.lat,
      );
      return { code: site.code, name: site.name };
    });

    await page.selectOption("#map-scale", "1000");
    await page.waitForFunction(
      (code) => {
        const marker = document.querySelector(
            `.critical-site-marker[data-code="${CSS.escape(code)}"]`,
          ),
          state = window.advisorWorld?.state;
        return (
          state?.scaleLabel === "1/1000" &&
          state.presentation === "flat" &&
          marker &&
          !marker.hidden &&
          getComputedStyle(marker).display !== "none"
        );
      },
      target.code,
      { timeout: 90000 },
    );
    const marker = page.locator(`.critical-site-marker[data-code="${target.code}"]`);
    await expect(marker).toBeVisible();
    await expect(marker).toContainText(target.name);
    // Browser backends have different worker/render readiness times. Assert
    // collision against the fully presented world, not the loading overlay.
    await page.waitForFunction(() => window.advisorWorld?.state.settled, null, { timeout: 120000 });
    await page.waitForFunction(() => document.fonts?.status === "loaded", null, { timeout: 30000 });
    await page.waitForTimeout(180);
    const discovery = await page.evaluate(
      (code) => {
        const state = window.advisorSites.state,
          marker = document.querySelector(`.critical-site-marker[data-code="${CSS.escape(code)}"]`),
          label = marker?.querySelector(".site-label"),
          glyph = marker?.querySelector(".site-glyph"),
          rects = [label, glyph].filter(Boolean).map((node) => node.getBoundingClientRect()),
          siteRect = rects.length ? {
            x: Math.min(...rects.map((rect) => rect.x)),
            y: Math.min(...rects.map((rect) => rect.y)),
            right: Math.max(...rects.map((rect) => rect.right)),
            bottom: Math.max(...rects.map((rect) => rect.bottom)),
          } : null,
          overlappingLabels = siteRect ? [...document.querySelectorAll("#political-labels .political-label")].filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 &&
              siteRect.x < rect.right + 4 && siteRect.right + 4 > rect.x &&
              siteRect.y < rect.bottom + 4 && siteRect.bottom + 4 > rect.y;
          }).map(node => {
            const rect = node.getBoundingClientRect();
            return { name: node.textContent, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          }) : [];
        return {
          scale: window.advisorWorld.state.scaleLabel,
          presentation: window.advisorWorld.state.presentation,
          visible: state.visibleCodes.includes(code),
          visibleCount: state.visibleCount,
          declutterSystem: state.declutterSystem,
          detailCacheLimit: state.detailCacheLimit,
          politicalObstacleCount: state.politicalObstacleCount,
          overlapsPoliticalLabel: overlappingLabels.length > 0,
          overlapDetail: { siteRect, overlappingLabels },
          accessLines: document.querySelectorAll("#critical-site-access line.ruin-access").length,
        };
      },
      target.code,
    );
    expect(discovery.scale).toBe("1/1000");
    expect(discovery.presentation).toBe("flat");
    expect(discovery.visible).toBe(true);
    expect(discovery.visibleCount).toBeLessThanOrEqual(viewport.name === "phone" ? 6 : 12);
    expect(discovery.declutterSystem).toBe("critical-sites.nearest-free");
    expect(discovery.detailCacheLimit).toBe(48);
    expect(discovery.overlapsPoliticalLabel, JSON.stringify(discovery.overlapDetail)).toBe(false);
    expect(discovery.accessLines).toBeGreaterThan(0);
    await page.waitForTimeout(150);
    const idleBefore = await page.evaluate(() => ({
      placement: window.advisorSites.state.placementPassCount,
      measured: window.advisorSites.state.obstacleMeasureCount,
      revision: window.politicalAtlas.state.labelLayoutRevision,
    }));
    await page.waitForTimeout(160);
    const idleAfter = await page.evaluate(() => ({
      placement: window.advisorSites.state.placementPassCount,
      measured: window.advisorSites.state.obstacleMeasureCount,
      revision: window.politicalAtlas.state.labelLayoutRevision,
    }));
    if (idleBefore.revision === idleAfter.revision) {
      expect(idleAfter.placement).toBe(idleBefore.placement);
      expect(idleAfter.measured).toBe(idleBefore.measured);
    }

    await page.selectOption("#map-scale", "100");
    await page.waitForFunction(
      (code) =>
        window.advisorWorld?.state.scaleLabel === "1/100" &&
        window.advisorSites?.state.visibleCodes.includes(code),
      target.code,
      { timeout: 90000 },
    );
    const viewSnapshot = () => page.evaluate(() => {
      const view = window.advisorWorld.state.view;
      return {
        x: view.x,
        z: view.z,
        halfHeight: view.halfHeight,
        yaw: view.yaw,
        scale: window.advisorWorld.state.scaleLabel,
      };
    });
    const beforeInspect = await viewSnapshot();
    await marker.click();
    const panel = page.locator("#critical-site-panel");
    await expect(panel).toBeVisible();
    expect(await viewSnapshot()).toEqual(beforeInspect);
    await panel.locator("#close-critical-site").click();
    await expect(panel).toBeHidden();
    expect(await viewSnapshot()).toEqual(beforeInspect);
    await marker.click();
    await expect(panel).toBeVisible();
    expect(await viewSnapshot()).toEqual(beforeInspect);
    await expect(panel).toContainText(target.name);
    await expect(panel).toContainText("legal road junction");
    const touchRects = await panel.locator("#close-critical-site, #focus-critical-site").evaluateAll(nodes =>
      nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }));
    expect(touchRects).toHaveLength(2);
    for (const rect of touchRects) {
      expect(rect.width).toBeGreaterThanOrEqual(44);
      expect(rect.height).toBeGreaterThanOrEqual(44);
    }
    await expect(panel.locator("#critical-site-code")).toContainText("/SITE/");
    const before = await page.evaluate(
      (code) => window.advisorSites.inspect(code).detail.signature,
      target.code,
    );
    await page.evaluate(() => window.advisorWorld.navigation.setFocus(0, 0));
    await page.waitForTimeout(250);
    await page.evaluate((code) => {
      const site = window.advisorSites.sites.find((item) => item.code === code);
      window.advisorWorld.navigation.setFocus(
        site.canonicalPosition.lon,
        site.canonicalPosition.lat,
      );
    }, target.code);
    await page.selectOption("#map-scale", "100");
    await page.waitForFunction(
      (code) => window.advisorSites.state.visibleCodes.includes(code),
      target.code,
      { timeout: 90000 },
    );
    const after = await page.evaluate(
      (code) => window.advisorSites.inspect(code).detail.signature,
      target.code,
    );
    expect(after).toBe(before);
    const state = await page.evaluate(() => ({
      ...window.advisorSites.state,
      totalSites: window.advisorSites.sites.length,
    }));
    expect(state.visibleCount).toBeLessThanOrEqual(viewport.name === "phone" ? 6 : 12);
    expect(state.cachedDetails).toBeLessThanOrEqual(state.detailCacheLimit);
    expect(state.detailCacheLimit).toBeLessThan(state.totalSites);
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    if (viewport.name === "phone") {
      const layout = await panel.evaluate((node) => ({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
      }));
      expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 1);
    }
    expect(errors).toEqual([]);
  });
}
