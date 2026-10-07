import { test, expect } from "@playwright/test";
test("desktop exploration, LOD, cell inspection and return navigation", async ({
  page,
}) => {
  test.setTimeout(420000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
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
      window.advisorWorld.state.presentation === "globe" &&
      window.advisorWorld.state.globe.complete &&
      window.advisorWorld.state.settled,
  );
  // Realm view keeps the focus and shows the whole globe clear of the interface.
  const globe = await page.evaluate(() => window.advisorWorld.state);
  expect(globe.view.x).toBe(0);
  expect(globe.view.z).toBe(14);
  expect(globe.view.halfHeight).toBeGreaterThan(
    await page.evaluate(() => window.advisorWorld.planet.radius),
  );
  await expect(page.locator("#detail-name")).toHaveText("Realm");
  await expect(page.locator("#place-name")).toHaveText("Eldermere");
  await expect(page.locator("#grid")).toBeHidden();
  await expect(
    page.locator(".map-label.continent", { hasText: "Eldermere" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/realm-desktop.png" });
  // Dragging turns the globe east–west past the wrap line without an edge.
  await page.mouse.move(720, 450);
  await page.mouse.down();
  await page.mouse.move(420, 450, { steps: 10 });
  await page.mouse.up();
  const turned = await page.evaluate(() => window.advisorWorld.state.view);
  expect(turned.x).toBeGreaterThan(0);
  expect(turned.halfHeight).toBe(globe.view.halfHeight);
  // Zooming in below the Realm level returns to the flat map at the same focus.
  for (let i = 0; i < 4; i++) {
    if (
      (await page.evaluate(() => window.advisorWorld.state.presentation)) ===
      "flat"
    )
      break;
    await page.locator("#zoom-in").click();
  }
  const flat = await page.evaluate(() => window.advisorWorld.state);
  expect(flat.presentation).toBe("flat");
  expect(flat.view.x).toBeCloseTo(turned.x, 6);
  expect(flat.view.z).toBeCloseTo(turned.z, 6);
  await expect(page.locator("#grid")).toBeVisible();
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
  await page.goto("/");
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
  await page.goto("/");
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


test("pure zoom handoff preserves focus through buttons wheel pinch and reversal", async ({ page }) => {
  test.setTimeout(420000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.waitForFunction(() => window.advisorWorld?.state.ready);
    const anchors = await page.evaluate(() => window.advisorWorld.handoff);
    await page.evaluate((h) => window.advisorWorld.setHalfHeight(h), anchors.localHalfHeight * 0.94);
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    const focus = await page.evaluate(() => ({ ...window.advisorWorld.state.view }));
    await page.locator("#zoom-out").click();
    await page.waitForFunction(() => window.advisorWorld.state.handoff.projectionTransition > 0.01);
    let state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);
    await page.locator("#world").hover();
    await page.mouse.wheel(0, -220);
    await page.waitForTimeout(60);
    state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);
    // Two-pointer pinch: synthetic pointer events exercise the same production handler.
    await page.evaluate(() => {
      const c = document.getElementById("world"), r = c.getBoundingClientRect();
      const fire = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: id, pointerType: "touch", clientX: x, clientY: y,
        buttons: type === "pointerup" ? 0 : 1,
      }));
      const cy = r.top + r.height * 0.55, cx = r.left + r.width * 0.5;
      fire("pointerdown", 31, cx - 45, cy); fire("pointerdown", 32, cx + 45, cy);
      fire("pointermove", 31, cx - 70, cy); fire("pointermove", 32, cx + 70, cy);
      fire("pointerup", 31, cx - 70, cy); fire("pointerup", 32, cx + 70, cy);
    });
    await page.waitForTimeout(80);
    state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);
    // Reverse mid-transition and then traverse both settled endpoints.
    await page.mouse.wheel(0, -350);
    await page.waitForTimeout(50);
    expect((await page.evaluate(() => window.advisorWorld.state.handoff)).direction).not.toBe("to-globe");
    await page.evaluate((h) => window.advisorWorld.setHalfHeight(h), anchors.globeHalfHeight * 1.06);
    await page.waitForFunction(() => window.advisorWorld.state.presentation === "globe" && window.advisorWorld.state.settled);
    const globe = await page.evaluate(() => window.advisorWorld.state);
    expect(globe.view.x).toBe(focus.x);
    expect(globe.view.z).toBe(focus.z);
    expect(globe.view.yaw).toBe(focus.yaw);
    expect(globe.handoff.destinationReady).toBeTruthy();
    await page.evaluate((h) => window.advisorWorld.setHalfHeight(h), anchors.localHalfHeight * 0.94);
    await page.waitForFunction(() => window.advisorWorld.state.presentation === "flat" && window.advisorWorld.state.settled);
    const flat = await page.evaluate(() => window.advisorWorld.state);
    expect(flat.view.x).toBe(focus.x);
    expect(flat.view.z).toBe(focus.z);
    expect(flat.view.yaw).toBe(focus.yaw);
    await expect(page.locator("#error")).toBeHidden();
  }
  expect(errors).toEqual([]);
});
