import { test, expect } from "@playwright/test";

test("organic settlements and protagonist-demand interiors reconstruct after eviction", async ({ page }) => {
  test.setTimeout(600000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.ready && window.advisorInteriors);

  const initial = await page.evaluate(() => window.advisorInteriors.state);
  expect(initial.cache).toMatchObject({ active: 0, cached: 0, bytes: 0, materializations: 0, evictions: 0 });

  await page.setViewportSize({ width: 1440, height: 900 });
  for (const index of [0, 1, 2]) {
    expect(await page.evaluate((i) => window.advisorInteriors.selectByRole("home", i, false), index)).toBe(true);
    await page.evaluate(() => window.advisorWorld.setHalfHeight(105));
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    await page.screenshot({ path: `test-results/wp-s002-004-009/village-layout-${index + 1}.png` });
    const selected = await page.evaluate(() => window.advisorInteriors.state);
    expect(selected.active).toBeNull();
    expect(selected.cache.cached).toBe(0);
  }

  expect(await page.evaluate(() => window.advisorInteriors.selectByRole("home", 0, false))).toBe(true);
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  await page.screenshot({ path: "test-results/wp-s002-004-009/home-exterior.png" });
  await page.locator("#building-enter").click();
  await expect(page.locator("#interior-shell")).toBeVisible();
  const enteredHome = await page.evaluate(() => window.advisorInteriors.state);
  expect(enteredHome.active.role).toBe("home");
  expect(enteredHome.cache).toMatchObject({ active: 1, cached: 1, materializations: 1 });
  const homeSignature = enteredHome.active.signature;
  await page.screenshot({ path: "test-results/wp-s002-004-009/home-interior-enter.png" });
  expect(await page.evaluate(() => window.advisorInteriors.useAnchor())).toBe(true);
  expect((await page.evaluate(() => window.advisorInteriors.state)).lastAction).toMatch(/^Used /);
  await page.screenshot({ path: "test-results/wp-s002-004-009/home-interior-use.png" });
  await page.locator("#interior-exit").click();
  const exitedHome = await page.evaluate(() => window.advisorInteriors.state);
  expect(exitedHome.active).toBeNull();
  expect(exitedHome.cache.cached).toBe(0);
  expect(exitedHome.cache.evictions).toBe(1);
  await page.locator("#building-enter").click();
  const reenteredHome = await page.evaluate(() => window.advisorInteriors.state);
  expect(reenteredHome.active.signature).toBe(homeSignature);
  expect(reenteredHome.reconstructed).toBe(true);
  await page.screenshot({ path: "test-results/wp-s002-004-009/home-interior-reenter.png" });
  await page.locator("#interior-exit").click();

  expect(await page.evaluate(() => window.advisorInteriors.selectByRole("blacksmith", 0, false))).toBe(true);
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  await page.screenshot({ path: "test-results/wp-s002-004-009/blacksmith-exterior.png" });
  await page.locator("#building-enter").click();
  const smith = await page.evaluate(() => window.advisorInteriors.state);
  expect(smith.active.role).toBe("blacksmith");
  expect(smith.active.signature).not.toBe(homeSignature);
  await page.screenshot({ path: "test-results/wp-s002-004-009/blacksmith-interior.png" });
  expect(await page.evaluate(() => window.advisorInteriors.useAnchor())).toBe(true);
  await page.locator("#interior-exit").click();
  expect((await page.evaluate(() => window.advisorInteriors.state)).cache.cached).toBe(0);

  expect(await page.evaluate(() => window.advisorInteriors.selectByRole("market", 0, true))).toBe(true);
  await page.evaluate(() => window.advisorWorld.setHalfHeight(170));
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  await page.screenshot({ path: "test-results/wp-s002-004-009/city-organic-layout.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => window.advisorInteriors.selectByRole("inn", 0, false))).toBe(true);
  await page.locator("#building-enter").click();
  await expect(page.locator("#interior-shell")).toBeVisible();
  let box = await page.locator("#interior-shell").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(391);
  expect(box.y + box.height).toBeLessThanOrEqual(845);
  await page.screenshot({ path: "test-results/wp-s002-004-009/phone-portrait-interior.png" });
  await page.locator("#interior-exit").click();

  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator("#building-enter").click();
  box = await page.locator("#interior-shell").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(845);
  expect(box.y + box.height).toBeLessThanOrEqual(391);
  await page.screenshot({ path: "test-results/wp-s002-004-009/phone-landscape-interior.png" });
  await page.locator("#interior-exit").click();

  expect(errors).toEqual([]);
});
