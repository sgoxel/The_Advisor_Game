import { test, expect } from "@playwright/test";
test("desktop exploration, LOD, cell inspection and return navigation", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?renderer=webgl2");
  await page.waitForFunction(() => window.advisorWorld?.state.ready);
  await page.screenshot({ path: "test-results/village-desktop.png" });
  const first = await page.evaluate(() => window.advisorWorld.cellAt(1, 1));
  await page.locator("#world").click({ position: { x: 840, y: 470 } });
  await expect(page.locator("#cell-panel")).toBeVisible();
  await expect(page.locator("#cell-code")).toContainText("/L1/");
  await page.locator("#close-cell").click();
  await page.locator("#overview").click();
  await page.waitForFunction(
    () =>
      window.advisorWorld.state.view.halfHeight === 100000 &&
      window.advisorWorld.state.settled &&
      window.advisorWorld.state.levels.every((l) => l < 6),
  );
  await page.screenshot({ path: "test-results/realm-desktop.png" });
  await page.locator("#grid").check();
  await page.screenshot({ path: "test-results/realm-tiles.png" });
  await page.locator("#grid").uncheck();
  await page.locator("#home").click();
  await page.waitForFunction(
    () =>
      window.advisorWorld.state.view.halfHeight === 97 &&
      window.advisorWorld.state.settled &&
      window.advisorWorld.state.levels.some((l) => l >= 12),
  );
  await page.locator("#zoom-in").click();
  await page.locator("#zoom-in").click();
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  await page.screenshot({ path: "test-results/street-desktop.png" });
  const canvas = page.locator("#world");
  await canvas.hover({ position: { x: 850, y: 400 } });
  await page.mouse.down();
  await page.mouse.move(630, 460, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  const state = await page.evaluate(() => window.advisorWorld.state);
  expect(state.view.x).not.toBe(0);
  expect(state.cached).toBeLessThanOrEqual(200);
  expect(await page.evaluate(() => window.advisorWorld.cellAt(1, 1))).toEqual(
    first,
  );
  await page.locator("#open-travel").click();
  await page.locator("#continent-select").selectOption("1");
  await page.locator("#visit-city").click();
  await page.waitForFunction(
    () =>
      window.advisorWorld.state.settled &&
      window.advisorWorld.state.view.x < -50000,
  );
  await page.screenshot({ path: "test-results/city-westreach.png" });
  expect(
    (await page.evaluate(() => window.advisorWorld.state.simulation))
      .liveCountries,
  ).toBe(1);
  expect(errors).toEqual([]);
  await page.reload();
  await page.waitForFunction(() => window.advisorWorld?.state.ready);
  expect(await page.evaluate(() => window.advisorWorld.cellAt(1, 1))).toEqual(
    first,
  );
});
test("phone portrait shows world and usable controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?renderer=webgl2");
  await page.waitForFunction(() => window.advisorWorld?.state.ready);
  await expect(page.locator("#home")).toBeVisible();
  await expect(page.locator("#zoom-in")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({ path: "test-results/village-phone.png" });
  await page.locator("#world").click({ position: { x: 275, y: 485 } });
  await expect(page.locator("#cell-panel")).toBeVisible();
  await page.screenshot({ path: "test-results/cell-phone.png" });
});
test("layer controls hide structure details without leaving floating decorations", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/?renderer=webgl2");
  await page.waitForFunction(() => window.advisorWorld?.state.ready);
  const initial = await page.evaluate(
    () => window.advisorWorld.state.visibleMeshes,
  );
  expect(initial.structures).toBeGreaterThan(0);
  expect(initial.detail).toBeGreaterThan(0);
  await page.locator("#structures").uncheck();
  const hidden = await page.evaluate(
    () => window.advisorWorld.state.visibleMeshes,
  );
  expect(hidden.structures).toBe(0);
  expect(hidden.detail).toBe(0);
  expect(hidden.nature).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/layers-nature-only.png" });
  await page.locator("#structures").check();
  expect(
    (await page.evaluate(() => window.advisorWorld.state.visibleMeshes)).detail,
  ).toBeGreaterThan(0);
});
