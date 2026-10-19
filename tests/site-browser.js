import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`critical sites are discoverable and inspectable on ${viewport.name}`, async ({ page }, testInfo) => {
    test.setTimeout(viewport.name === "desktop" ? 1500000 : 300000);
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
          // Every cartographic guide must terminate at a visible real junction.
          offscreenAccessJunctions: [...document.querySelectorAll(
            "#critical-site-access line.ruin-access, #critical-site-access line.critical-access",
          )].filter(line => {
            const x = Number(line.getAttribute("x2")), y = Number(line.getAttribute("y2"));
            return !(x > 0 && x < innerWidth && y > 0 && y < innerHeight);
          }).length,
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
    expect(discovery.offscreenAccessJunctions).toBe(0);
    await page.waitForTimeout(150);
    const idleBefore = await page.evaluate(() => ({
      placement: window.advisorSites.state.placementPassCount,
      measured: window.advisorSites.state.obstacleMeasureCount,
      nearbyQueries: window.advisorSites.state.nearbyQueryCount,
      view: [window.advisorWorld.state.view.x, window.advisorWorld.state.view.z,
        window.advisorWorld.state.view.halfHeight, window.advisorWorld.state.view.aspect],
      revision: window.politicalAtlas.state.labelLayoutRevision,
    }));
    await page.waitForTimeout(160);
    const idleAfter = await page.evaluate(() => ({
      placement: window.advisorSites.state.placementPassCount,
      measured: window.advisorSites.state.obstacleMeasureCount,
      nearbyQueries: window.advisorSites.state.nearbyQueryCount,
      view: [window.advisorWorld.state.view.x, window.advisorWorld.state.view.z,
        window.advisorWorld.state.view.halfHeight, window.advisorWorld.state.view.aspect],
      revision: window.politicalAtlas.state.labelLayoutRevision,
    }));
    if (idleBefore.revision === idleAfter.revision &&
        JSON.stringify(idleBefore.view) === JSON.stringify(idleAfter.view)) {
      expect(idleAfter.placement).toBe(idleBefore.placement);
      expect(idleAfter.measured).toBe(idleBefore.measured);
      expect(idleAfter.nearbyQueries).toBe(idleBefore.nearbyQueries);
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
    if (viewport.name === "desktop") {
      // Verify the same canonical ruin and critical place on all seven layouts
      // without restarting the expensive seeded world for each resize.
      const profiles = [
        { name: "desktop", width: 1440, height: 900 },
        { name: "laptop", width: 1280, height: 720 },
        { name: "tablet", width: 1024, height: 768 },
        { name: "phone", width: 390, height: 844 },
        { name: "phone-landscape", width: 844, height: 390 },
        { name: "phone-small", width: 360, height: 800 },
        { name: "tablet-portrait", width: 768, height: 1024 },
      ];
      await panel.locator("#close-critical-site").click();
      for (const kind of ["ruin", "critical-place"]) {
        const site = await page.evaluate((targetKind) => {
          const item = window.advisorSites.sites.find(s => s.kind === targetKind);
          window.advisorWorld.navigation.setFocus(item.canonicalPosition.lon, item.canonicalPosition.lat);
          return { code: item.code, name: item.name, kind: item.kind };
        }, kind);
        await page.selectOption("#map-scale", "1000");
        await page.waitForFunction((code) =>
          window.advisorWorld.state.scaleLabel === "1/1000" &&
          window.advisorWorld.state.settled &&
          window.advisorSites.state.visibleCodes.includes(code),
          site.code, { timeout: 120000 });

        for (const profile of profiles) {
          await page.setViewportSize({ width: profile.width, height: profile.height });
          await page.waitForFunction((code) =>
            window.advisorWorld.state.settled &&
            window.advisorSites.state.visibleCodes.includes(code),
            site.code, { timeout: 120000 });
          await page.waitForTimeout(180);
          const geometry = await page.evaluate(code => {
            const marker = document.querySelector(`.critical-site-marker[data-code="${CSS.escape(code)}"]`),
              label = marker?.querySelector(".site-label"),
              glyph = marker?.querySelector(".site-glyph"),
              boxes = [label, glyph].filter(Boolean).map(n => n.getBoundingClientRect()),
              occupied = boxes.length ? {
                x: Math.min(...boxes.map(r => r.x)),
                y: Math.min(...boxes.map(r => r.y)),
                right: Math.max(...boxes.map(r => r.right)),
                bottom: Math.max(...boxes.map(r => r.bottom)),
              } : null,
              obstacleSelectors = [
                ".masthead", "#region-panel", "#cell-panel", "#travel-panel",
                "#critical-site-panel:not([hidden])", ".bottom-bar", ".map-controls",
                ".telemetry", "#focus-coordinates", "#centre-marker",
                "#political-labels .political-label",
              ],
              obstacles = obstacleSelectors.flatMap(selector =>
                [...document.querySelectorAll(selector)])
                  .filter(n => {
                    const style = getComputedStyle(n);
                    return style.display !== "none" && style.visibility !== "hidden";
                  })
                  .map(n => ({ node: n, rect: n.getBoundingClientRect() }))
                  .filter(({ rect }) => rect.width > 0 && rect.height > 0)),
              intersects = (r, padding = 4) =>
                occupied.x < r.right + padding && occupied.right + padding > r.x &&
                occupied.y < r.bottom + padding && occupied.bottom + padding > r.y,
              conflicts = occupied ? obstacles.filter(({ rect }) => intersects(rect))
                .map(({ node }) => node.textContent?.trim().slice(0, 48) || node.id || node.className) : ["missing marker"],
              // Independently clip actual leader and cartographic access segments
              // against the same visible HUD/political obstacles.
              leaderCrossings = [...document.querySelectorAll(
                "#critical-site-access line.site-label-leader, #critical-site-access line.ruin-access, #critical-site-access line.critical-access",
              )]
                .flatMap(line => {
                  const x1 = Number(line.getAttribute("x1")), y1 = Number(line.getAttribute("y1")),
                    dx = Number(line.getAttribute("x2")) - x1,
                    dy = Number(line.getAttribute("y2")) - y1;
                  return obstacles.filter(({ rect }) => {
                    const gap = 4, left = rect.x - gap, top = rect.y - gap,
                      right = rect.right + gap, bottom = rect.bottom + gap;
                    let start = 0, end = 1;
                    const clip = (p, q) => {
                      if (p === 0) return q >= 0;
                      const t = q / p;
                      if (p < 0) start = Math.max(start, t);
                      else end = Math.min(end, t);
                      return start <= end;
                    };
                    return clip(-dx, x1 - left) && clip(dx, right - x1) &&
                      clip(-dy, y1 - top) && clip(dy, bottom - y1);
                  }).map(({ node }) => node.textContent?.trim().slice(0, 48) || node.id || node.className);
                });
            const target = window.advisorSites.sites.find(s => s.code === code),
              view = window.advisorWorld.state.view,
              wrap = dx => ((dx + 131072) % 262144 + 262144) % 262144 - 131072,
              dx = wrap(target.x - view.x), dz = target.z - view.z,
              c = Math.cos(view.yaw), sin = Math.sin(view.yaw),
              pointX = innerWidth / 2 + ((dx * c - dz * sin) / (view.halfHeight * view.aspect)) * innerWidth / 2,
              pointY = innerHeight / 2 + ((dx * sin + dz * c) * 0.8660254 / view.halfHeight) * innerHeight / 2,
              markerBox = marker.getBoundingClientRect(),
              displacement = Math.hypot(markerBox.x + 22 - pointX, markerBox.y + 22 - pointY),
              leaderLinked = [...document.querySelectorAll("#critical-site-access line.site-label-leader")]
                .some(line => Math.hypot(Number(line.getAttribute("x2")) - pointX,
                  Number(line.getAttribute("y2")) - pointY) < 1);
            return { conflicts, leaderCrossings, displacement, leaderLinked,
              rendered: !!marker && !marker.hidden, occupied };
          }, site.code);
          expect(geometry.rendered, `${kind}/${profile.name}`).toBe(true);
          expect(geometry.conflicts, `${kind}/${profile.name}: ${JSON.stringify(geometry)}`).toEqual([]);
          expect(geometry.leaderCrossings, `${kind}/${profile.name}: ${JSON.stringify(geometry)}`).toEqual([]);
          if (geometry.displacement > 25)
            expect(geometry.leaderLinked,
              `${kind}/${profile.name}: displaced site lost canonical leader`).toBe(true);
          const targetMarker = page.locator(`.critical-site-marker[data-code="${site.code}"]`);
          await targetMarker.click();
          await expect(panel).toBeVisible();
          await expect(panel).toContainText(site.name);
          const dimensions = await panel.evaluate(node => {
            const b = node.getBoundingClientRect();
            return {
              panel: { x: b.x, y: b.y, right: b.right, bottom: b.bottom },
              controls: [...node.querySelectorAll("#close-critical-site, #focus-critical-site")]
                .map(el => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height }; }),
            };
          });
          expect(dimensions.panel.x, profile.name).toBeGreaterThanOrEqual(0);
          expect(dimensions.panel.y, profile.name).toBeGreaterThanOrEqual(0);
          expect(dimensions.panel.right, profile.name).toBeLessThanOrEqual(profile.width + 1);
          expect(dimensions.panel.bottom, profile.name).toBeLessThanOrEqual(profile.height + 1);
          expect(dimensions.controls).toHaveLength(2);
          for (const control of dimensions.controls) {
            expect(control.width, profile.name).toBeGreaterThanOrEqual(44);
            expect(control.height, profile.name).toBeGreaterThanOrEqual(44);
          }
          // A clipped compact inspector must advertise additional content.
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
          const scrollCue = await panel.evaluate(node => {
            const cue = node.querySelector("#critical-site-scroll-cue"),
              rect = cue.getBoundingClientRect(),
              panelRect = node.getBoundingClientRect(),
              cueHeight = cue.hidden ? 0 : rect.height;
            return {
              overflow: node.scrollHeight - cueHeight - node.clientHeight,
              remaining: node.scrollHeight - node.clientHeight - node.scrollTop,
              rendered: !cue.hidden && getComputedStyle(cue).display !== "none",
              insidePanel: rect.top >= panelRect.top && rect.bottom <= panelRect.bottom + 1,
              height: cueHeight,
            };
          });
          if (scrollCue.overflow > 8 && scrollCue.remaining > scrollCue.height + 8) {
            expect(scrollCue.rendered, `${kind}/${profile.name}: missing scroll affordance`).toBe(true);
            expect(scrollCue.insidePanel, `${kind}/${profile.name}: clipped scroll affordance`).toBe(true);
          }
          // The final inspector action must be reachable even when the panel scrolls.
          await panel.locator("#focus-critical-site").scrollIntoViewIfNeeded();
          await expect(panel.locator("#focus-critical-site")).toBeInViewport();
          const context = await page.evaluate(code => {
            const marker = document.querySelector(`.critical-site-marker[data-code="${CSS.escape(code)}"]`);
            const glyph = marker?.querySelector(".site-glyph"),
              panelRect = document.querySelector("#critical-site-panel").getBoundingClientRect(),
              glyphRect = glyph?.getBoundingClientRect();
            return {
              visible: !!glyphRect && glyphRect.width > 0 && glyphRect.height > 0,
              covered: !!glyphRect && glyphRect.left < panelRect.right &&
                glyphRect.right > panelRect.left &&
                glyphRect.top < panelRect.bottom && glyphRect.bottom > panelRect.top,
            };
          }, site.code);
          expect(context.visible, `${kind}/${profile.name}`).toBe(true);
          expect(context.covered, `${kind}/${profile.name}: selected site under inspector`).toBe(false);
          await panel.locator("#close-critical-site").click();
          await expect(panel).toBeHidden();
        }
      }
    }
    // Returning to Realm zoom clears site presentation once, not every frame.
    await page.selectOption("#map-scale", "10000");
    await page.waitForFunction(() =>
      window.advisorWorld?.state.scaleLabel === "1/10000" &&
      window.advisorWorld.state.presentation !== "flat" &&
      [...document.querySelectorAll(".critical-site-marker")].every(node => node.hidden) &&
      document.querySelector("#critical-site-access")?.childElementCount === 0,
      null, { timeout: 120000 });
    const idleWideWrites = await page.evaluate(async () => {
      const access = document.querySelector("#critical-site-access");
      let mutationCount = 0;
      const observer = new MutationObserver(records => { mutationCount += records.length; });
      observer.observe(access, { childList: true });
      for (const marker of document.querySelectorAll(".critical-site-marker"))
        observer.observe(marker, { attributes: true, attributeFilter: ["hidden"] });
      await new Promise(resolve => {
        let frames = 0;
        const next = () => ++frames >= 8 ? resolve() : requestAnimationFrame(next);
        requestAnimationFrame(next);
      });
      const mutations = mutationCount + observer.takeRecords().length;
      observer.disconnect();
      return mutations;
    });
    expect(idleWideWrites, "wide-view site layer has repeated hidden/SVG mutations").toBe(0);
    expect(errors).toEqual([]);
  });
}

// The two renderer jobs must independently expose identical authoritative site data.
// The resulting artifacts are compared byte-for-byte by the dedicated evidence workflow.
test("WebGPU and WebGL2 expose identical canonical site authority", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  if (!/webgpu/i.test(testInfo.config.configFile ?? ""))
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }),
    );
  await page.goto("/");
  await page.waitForFunction(
    () => window.advisorWorld?.state.ready && window.advisorSites?.sites?.length > 0,
    null,
    { timeout: 150000 },
  );
  const payload = await page.evaluate(() => ({
    summary: window.advisorSites.summary,
    sites: window.advisorSites.sites.map((site) => ({
      code: site.code,
      kind: site.kind,
      countryCode: site.countryCode,
      continent: site.continent,
      canonicalPosition: site.canonicalPosition,
      sourcePosition: [site.x, site.z],
      archetype: site.archetype,
      variant: site.variant,
      radiusM: site.radiusM,
      falloffM: site.falloffM,
      preparedHeightM: site.preparedHeightM,
      access: site.access,
    })).sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
  }));
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/wp-s004-site-parity.json",
    JSON.stringify(payload, null, 2) + "\n");
  expect(payload.sites.length).toBeGreaterThan(0);
  expect(payload.sites.every(site => site.access.branchCode && site.access.roadCode)).toBe(true);
});
