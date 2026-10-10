import { test, expect } from "@playwright/test";

// WP-S002-004-008: the travel panel lists solved walking routes and draws the selected one.
test("travel panel solves neighbouring routes and draws the selected route", async ({ page }) => {
  test.setTimeout(300000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.ready);
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
