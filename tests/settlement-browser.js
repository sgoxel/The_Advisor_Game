import { settlementPlan } from "../src/settlements.ts";
import { villages } from "../src/geography.ts";

function evidenceVillage() {
  const plans = villages.map((village) => ({ village, plan: settlementPlan(village.id) }));
  const preferred = plans.find(({ plan }) => plan.archetype === "green") ?? plans[0];
  return preferred;
}

export function settlementBrowserTests(test, expect, webgl2) {
  test("settlement inspector and protagonist interiors are deterministic and demand-loaded", async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 1280, height: 800 });
    if (webgl2)
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }),
      );
    const { village, plan } = evidenceVillage(),
      inn = plan.buildings.find((building) => building.use === "inn"),
      smith = plan.buildings.find((building) => building.use === "blacksmith"),
      home = plan.buildings.find((building) => building.use === "home");
    expect(inn).toBeTruthy();
    expect(smith).toBeTruthy();
    expect(home).toBeTruthy();

    await page.goto("/");
    await page.waitForFunction(() => window.advisorWorld?.state.ready && window.advisorSettlements);
    expect(await page.evaluate(() => window.advisorRenderer.backend)).toBe(webgl2 ? "webgl2" : "webgpu");
    await page.evaluate(
      ({ lon, lat }) => {
        window.advisorWorld.navigation.setFocus(lon, lat);
        window.advisorWorld.setHalfHeight(97);
      },
      village.canonicalPosition,
    );
    await page.waitForFunction(() => window.advisorWorld.state.settled, null, { timeout: 180000 });
    await expect(page.locator("#settlement-inspector")).toBeVisible();
    await expect(page.locator("#settlement-inspector-name")).toHaveText(village.name);
    await expect(page.locator("#settlement-inspector-summary")).toContainText("canonical buildings");
    expect(await page.evaluate(() => window.advisorSettlements.state.interior.realized)).toBe(0);

    await page.evaluate((code) => window.advisorSettlements.select(code), inn.code);
    await page.waitForTimeout(450);
    await expect(page.locator("#settlement-selection strong")).toHaveText("Inn");
    await page.locator(".enter-building").click();
    await expect(page.locator("#interior-experience")).toBeVisible();
    await expect(page.locator("#interior-title")).toHaveText("Inn");
    await expect(page.locator(".interior-room")).toHaveCount(inn.rooms.length);
    let interiorState = await page.evaluate(() => window.advisorSettlements.state);
    expect(interiorState.interior.realized).toBe(1);
    expect(interiorState.activeInterior).toBe(inn.code);

    await page.locator(".interior-room").first().click();
    await page.locator("#interior-use").click();
    await expect(page.locator("#interior-status")).toContainText("Used");
    await page.locator("#interior-exit").click();
    await expect(page.locator("#interior-experience")).toBeHidden();
    interiorState = await page.evaluate(() => window.advisorSettlements.state);
    expect(interiorState.interior.realized).toBe(0);
    expect(interiorState.interior.evictions).toBeGreaterThanOrEqual(1);

    await page.evaluate((code) => window.advisorSettlements.enter(code), inn.code);
    await expect(page.locator("#interior-title")).toHaveText("Inn");
    interiorState = await page.evaluate(() => window.advisorSettlements.state);
    expect(interiorState.stableReentries).toBeGreaterThanOrEqual(1);
    expect(interiorState.unstableReentries).toBe(0);
    await page.evaluate(() => window.advisorSettlements.exit());

    await page.evaluate((code) => window.advisorSettlements.enter(code), smith.code);
    await expect(page.locator("#interior-title")).toHaveText("Blacksmith");
    await expect(page.locator("#interior-experience")).toContainText("forge");
    await page.evaluate(() => window.advisorSettlements.exit());

    await page.evaluate((code) => window.advisorSettlements.enter(code), home.code);
    await expect(page.locator("#interior-title")).toHaveText("Home");
    for (const expected of ["living/common", "bedroom", "latrine"])
      await expect(page.locator("#interior-experience")).toContainText(expected);
    await page.evaluate(() => window.advisorSettlements.exit());

    const finalState = await page.evaluate(() => ({
      settlement: window.advisorSettlements.state,
      performance: window.advisorWorld.state.performance,
    }));
    expect(finalState.settlement.interior.realized).toBe(0);
    expect(finalState.settlement.unstableReentries).toBe(0);
    expect(finalState.performance.withinBudget).toBeTruthy();
  });

  test("phone settlement controls keep usable touch targets and interior viewport", async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 390, height: 844 });
    if (webgl2)
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true }),
      );
    const { village, plan } = evidenceVillage(),
      market = plan.buildings.find((building) => building.use === "market");
    await page.goto("/");
    await page.waitForFunction(() => window.advisorWorld?.state.ready && window.advisorSettlements);
    await page.evaluate(
      ({ lon, lat }) => {
        window.advisorWorld.navigation.setFocus(lon, lat);
        window.advisorWorld.setHalfHeight(97);
      },
      village.canonicalPosition,
    );
    await page.waitForFunction(() => window.advisorWorld.state.settled, null, { timeout: 180000 });
    await expect(page.locator("#settlement-inspector")).toBeVisible();
    await page.evaluate((code) => window.advisorSettlements.select(code), market.code);
    await page.waitForTimeout(450);
    for (const locator of [page.locator(".focus-building"), page.locator(".enter-building")]) {
      const box = await locator.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await page.locator(".enter-building").click();
    await expect(page.locator("#interior-experience")).toBeVisible();
    const viewport = page.viewportSize(),
      experience = await page.locator("#interior-experience").boundingBox(),
      use = await page.locator("#interior-use").boundingBox(),
      exit = await page.locator("#interior-exit").boundingBox();
    expect(experience?.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(experience?.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(use?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(exit?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.locator("#interior-exit").click();
    expect(await page.evaluate(() => window.advisorSettlements.state.interior.realized)).toBe(0);
  });
}
