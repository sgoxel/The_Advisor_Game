import { test, expect } from "@playwright/test";

async function clickCanvasCenter(page) {
  const box = await page.locator("#world").boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.56);
  await expect(page.locator("#cell-panel")).toBeVisible();
}

test("WebGPU local ENU frame rebases without changing canonical selection or cache identity", async ({ page }) => {
  test.setTimeout(300000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.settled);
  await page.waitForFunction(() => window.advisorWorld?.planet?.authority);
  expect(await page.evaluate(() => window.advisorWorld.renderer.backend)).toBe("webgpu");
  await page.evaluate(() => {
    const focus = window.advisorWorld.state.navigation.focus;
    window.advisorWorld.navigation.setFocus(focus.lon + 0.001, focus.lat);
    window.advisorWorld.setHalfHeight(70);
  });
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  await clickCanvasCenter(page);
  const before = await page.evaluate(() => ({
    selected: window.advisorWorld.state.navigation.selectedCanonicalId,
    cached: window.advisorWorld.state.cached,
    active: window.advisorWorld.state.active,
    rebase: { ...window.advisorWorld.state.renderFrame },
    simulation: { ...window.advisorWorld.state.simulation },
  }));
  expect(before.selected).toContain("/PLANET/");
  expect(before.rebase.focusDistanceM).toBeGreaterThan(1);
  expect(before.rebase.focusDistanceM).toBeLessThan(before.rebase.rebaseThresholdM);
  await page.screenshot({ path: "test-results/webgpu-enu-before-rebase.png" });

  await page.evaluate(() => window.advisorWorld.navigation.forceRebase());
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  const after = await page.evaluate(() => ({
    selected: window.advisorWorld.state.navigation.selectedCanonicalId,
    cached: window.advisorWorld.state.cached,
    active: window.advisorWorld.state.active,
    rebase: { ...window.advisorWorld.state.renderFrame },
    simulation: { ...window.advisorWorld.state.simulation },
  }));
  expect(after.selected).toBe(before.selected);
  expect(after.cached).toBe(before.cached);
  expect(after.active).toBe(before.active);
  expect(after.rebase.rebases).toBeGreaterThan(before.rebase.rebases);
  expect(after.rebase.focusDistanceM).toBeLessThan(0.001);
  expect(after.rebase.resourceRebuildsOnRebase).toBe(0);
  expect(after.rebase.detailedMaxHorizontalM).toBeLessThan(after.rebase.gpuLocalLimitM);
  expect(after.rebase.maxFloat32ErrorM).toBeLessThan(0.01);
  expect(after.simulation.residents).toBe(before.simulation.residents);
  await page.screenshot({ path: "test-results/webgpu-enu-after-rebase.png" });

  await page.locator("#close-cell").click();
  await page.evaluate(() => {
    const village = window.advisorWorld.geography.villages.at(-1);
    window.advisorWorld.navigation.setFocus(
      village.canonicalPosition.lon,
      village.canonicalPosition.lat,
    );
    window.advisorWorld.setHalfHeight(70);
  });
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  const far = await page.evaluate(() => ({ ...window.advisorWorld.state.renderFrame }));
  expect(far.rebases).toBeGreaterThan(after.rebase.rebases);
  expect(far.focusDistanceM).toBeLessThanOrEqual(far.rebaseThresholdM);
  expect(far.detailedMaxHorizontalM).toBeLessThan(far.gpuLocalLimitM);
  expect(far.maxFloat32ErrorM).toBeLessThan(0.01);
  await clickCanvasCenter(page);
  expect(
    await page.evaluate(() => window.advisorWorld.state.navigation.selectedCanonicalId),
  ).toContain("/PLANET/");
  await page.screenshot({ path: "test-results/webgpu-enu-far-settlement.png" });
  expect(errors).toEqual([]);
});
