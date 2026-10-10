import { test, expect } from "@playwright/test";

test("WebGPU preserves organic settlement and protagonist-demand interior lifecycle", async ({ page }) => {
  test.setTimeout(600000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.ready && window.advisorInteriors);
  await expect.poll(() => page.evaluate(() => window.advisorWorld.renderer.backend)).toBe("webgpu");

  expect((await page.evaluate(() => window.advisorInteriors.state)).cache.cached).toBe(0);
  expect(await page.evaluate(() => window.advisorInteriors.selectByRole("home", 0, false))).toBe(true);
  await page.evaluate(() => window.advisorWorld.setHalfHeight(105));
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  let state = await page.evaluate(() => window.advisorInteriors.state);
  expect(state.active).toBeNull();
  expect(state.cache.cached).toBe(0);
  await page.screenshot({ path: "test-results/wp-s002-004-009/webgpu-home-exterior.png" });

  expect(await page.evaluate(() => window.advisorInteriors.enterSelected())).toBe(true);
  state = await page.evaluate(() => window.advisorInteriors.state);
  const signature = state.active.signature;
  expect(state.cache).toMatchObject({ active: 1, cached: 1, materializations: 1 });
  await page.screenshot({ path: "test-results/wp-s002-004-009/webgpu-home-interior.png" });
  expect(await page.evaluate(() => window.advisorInteriors.useAnchor())).toBe(true);
  expect(await page.evaluate(() => window.advisorInteriors.exit())).toBe(true);
  state = await page.evaluate(() => window.advisorInteriors.state);
  expect(state.cache.cached).toBe(0);
  expect(await page.evaluate(() => window.advisorInteriors.enterSelected())).toBe(true);
  state = await page.evaluate(() => window.advisorInteriors.state);
  expect(state.active.signature).toBe(signature);
  expect(state.reconstructed).toBe(true);
  await page.evaluate(() => window.advisorInteriors.exit());

  expect(await page.evaluate(() => window.advisorInteriors.selectByRole("blacksmith", 0, false))).toBe(true);
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  expect(await page.evaluate(() => window.advisorInteriors.enterSelected())).toBe(true);
  state = await page.evaluate(() => window.advisorInteriors.state);
  expect(state.active.role).toBe("blacksmith");
  expect(state.active.signature).not.toBe(signature);
  await page.screenshot({ path: "test-results/wp-s002-004-009/webgpu-blacksmith-interior.png" });
  await page.evaluate(() => window.advisorInteriors.exit());

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => window.advisorInteriors.selectByRole("inn", 0, false))).toBe(true);
  expect(await page.evaluate(() => window.advisorInteriors.enterSelected())).toBe(true);
  const box = await page.locator("#interior-shell").boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(391);
  expect(box.y + box.height).toBeLessThanOrEqual(845);
  await page.screenshot({ path: "test-results/wp-s002-004-009/webgpu-phone-interior.png" });
  await page.evaluate(() => window.advisorInteriors.exit());

  expect(errors).toEqual([]);
});
