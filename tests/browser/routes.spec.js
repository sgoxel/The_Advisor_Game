import { expandInformation } from "../information-panel.js";
import { test, expect } from "@playwright/test";

// WP-S002-004-008: the travel panel lists solved walking routes and draws the selected one.
test("travel panel solves neighbouring routes and draws the selected route", async ({ page }) => {
  test.setTimeout(300000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expandInformation(page);
  await page.waitForFunction(() => window.advisorWorld?.state.ready);
  await page.waitForFunction(() => window.advisorRoutingAcceptance?.summary);

  const acceptance = await page.evaluate(() => window.advisorRoutingAcceptance.summary());
  expect(acceptance.villageCount).toBeGreaterThanOrEqual(270);
  expect(acceptance.totalPairs).toBe((acceptance.villageCount * (acceptance.villageCount - 1)) / 2);
  expect(acceptance.lowerBoundProvenPairs + acceptance.routedPairs).toBe(acceptance.totalPairs);
  expect(acceptance.minimumProvenOrObservedFantasySeconds).toBeGreaterThanOrEqual(3600);
  expect(acceptance.invalidPairs).toBe(0);
  expect(acceptance.unreachablePairs).toBe(0);
  expect(acceptance.cache.size).toBeLessThanOrEqual(acceptance.cache.limit);
  expect(acceptance.searchBounds.maxCells).toBeGreaterThan(0);
  expect(acceptance.searchBounds.maxExpansions).toBeGreaterThan(0);

  await page.locator("#open-travel").click();

  const rows = page.locator("#route-list .route-row");
  await expect(rows.first()).toBeVisible();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#route-list .route-row").length >= 2 &&
      [...document.querySelectorAll("#route-list .route-row")].every((r) => r.dataset.state === "ready"),
    null,
    { timeout: 60000 },
  );
  const data = await rows.evaluateAll((nodes) =>
    nodes.map((n) => ({
      to: n.dataset.to,
      distanceM: Number(n.dataset.distanceM),
      fantasySeconds: Number(n.dataset.fantasySeconds),
      realSeconds: Number(n.dataset.realSeconds),
      text: n.textContent,
    })),
  );
  for (const row of data) {
    expect(row.fantasySeconds).toBeGreaterThanOrEqual(3600);
    expect(row.realSeconds).toBeCloseTo(row.fantasySeconds / 24, 3);
    expect(row.text).toMatch(/km/);
  }
  expect(data[0].distanceM).toBeLessThanOrEqual(data[1].distanceM);

  const overlay = page.locator("#route-overlay");
  await expect(overlay).not.toHaveClass(/visible/);
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#route-detail")).toContainText("60-minute village minimum holds");
  await page.waitForFunction(() => document.getElementById("route-overlay").classList.contains("visible"), null, {
    timeout: 60000,
  });
  await expect(page.locator("#route-tag")).toBeVisible();
  await expect(page.locator("#route-tag")).toContainText("→");
  await expect(page.locator("#route-tag")).toContainText("km");
  const polyline = await page.locator("#route-overlay .route-line").getAttribute("points");
  expect(polyline.split(" ").length).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => window.advisorRoutes.activeId())).toMatch(/^0\/0\/0\/0>/);

  const again = await page.evaluate((to) => window.advisorRoutes.route("0/0/0/0", to), data[0].to);
  expect(again.fantasySeconds).toBe(data[0].fantasySeconds);
  const cache = await page.evaluate(() => window.advisorRoutingAcceptance.cache());
  expect(cache.hits).toBeGreaterThan(0);
  expect(cache.size).toBeLessThanOrEqual(cache.limit);

  await page.locator("#route-clear").click();
  await expect(overlay).not.toHaveClass(/visible/);
  await expect(page.locator("#route-tag")).toBeHidden();
  expect(await page.evaluate(() => window.advisorRoutes.activeId())).toBeNull();
  expect(errors).toEqual([]);
});

test("phone route preview exposes the map and never labels map focus as travel", async ({ page }) => {
  test.setTimeout(300000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expandInformation(page);
  await page.waitForFunction(() => window.advisorWorld?.state.ready);

  await expect(page.locator("#home")).toContainText("Focus home village");
  await expect(page.locator(".travel-hint .flat-only")).toContainText("Drag to pan");
  await page.locator("#open-travel").click();
  await expect(page.locator("#visit-city")).toHaveText("Focus city");
  await expect(page.locator("#visit-village")).toHaveText("Focus village");
  await expect(page.locator("#travel-panel")).toContainText("does not move the protagonist");

  const first = page.locator("#route-list .route-row").first();
  await expect(first).toBeVisible();
  await page.waitForFunction(
    () => document.querySelector("#route-list .route-row")?.dataset.state === "ready",
    null,
    { timeout: 60000 },
  );
  await first.click();

  await expect(page.locator("#travel-panel")).toBeHidden();
  await expect(page.locator("#route-tag")).toBeVisible();
  await page.waitForFunction(() => document.getElementById("route-overlay").classList.contains("visible"), null, {
    timeout: 60000,
  });
  expect(await page.evaluate(() => document.body.classList.contains("travel-panel-open"))).toBe(false);
  expect(await page.evaluate(() => window.advisorRoutes.activeId())).toBeTruthy();
  expect(errors).toEqual([]);
});


test("S005 selected route has a bounded first display opportunity at four canonical scales", async ({ page }) => {
  test.setTimeout(360000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  // Software WebGL2 emulation, not a physical-device FPS or paint-time proof.
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }));
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.ready && window.advisorTransport?.network?.roadEdges?.length);
  const selected = await page.evaluate(() => window.advisorTransport.selectEvidence("junction"));
  expect(selected?.kind).toBe("junction");

  let previousRoute = null;
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
    await page.setViewportSize(viewport);
    for (const scale of ["20", "50", "100", "250"]) {
      await page.locator("#transport-close").click();
      await page.selectOption("#map-scale", scale);
      await page.waitForFunction(value => window.advisorWorld.state.scaleLabel === `1/${value}`, scale);
      await page.evaluate(() => window.advisorTransport.open());
      const focusBefore = await page.evaluate(() => window.advisorWorld.state.navigation.focus);
      await page.locator("#transport-site-route").click();
      await page.waitForFunction(() => {
        const t = window.advisorTransport.telemetry();
        return t.firstSiteRouteFrameMs !== null;
      }, null, { timeout: 90000 });
      const result = await page.evaluate(() => ({
        ...window.advisorTransport.telemetry(),
        focus: window.advisorWorld.state.navigation.focus,
        answer: document.getElementById("transport-site-answer").innerText,
      }));
      console.log("S005_ROUTE_FIRST_ANSWER " + JSON.stringify({
        viewport: viewport.width + "x" + viewport.height, scale,
        graphMs: result.firstSiteRouteMs, displayFrameOpportunityMs: result.firstSiteRouteFrameMs,
        status: result.firstSiteRouteStatus, edges: result.siteRouteEdges,
        context: result.firstSiteRouteContext,
      }));
      expect(result.firstSiteRouteStatus).toBe("canonical walking graph preview ready");
      expect(result.firstSiteRouteContext).toMatchObject({
        scaleLabel: `1/${scale}`,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      });
      expect(result.firstSiteRouteMs).toBeGreaterThanOrEqual(0);
      // A newly selected route has no inherited first-unsafe corridor evidence.
      expect(result.corridorProbeFirstUnsafeCause).toBeNull();
      expect(result.corridorProbeFirstUnsafeIntervalGrade).toBeNull();
      expect(result.firstSiteRouteFrameMs).toBeGreaterThanOrEqual(result.firstSiteRouteMs);
      expect(result.firstSiteRouteFrameMs).toBeLessThan(10000);
      expect(result.answer).toContain("Measured graph distance");
      expect(result.answer).toContain("Estimated good-road time");
      expect(result.answer).toContain("character has not moved");
      expect(result.focus).toEqual(focusBefore);
      if (previousRoute !== null) expect(result.answer).toBe(previousRoute);
      previousRoute = result.answer;
    }
  }
  expect(errors).toEqual([]);
});
