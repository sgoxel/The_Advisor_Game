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


test("pure zoom handoff preserves focus through both directions of every input", async ({ page }) => {
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
    const marker = await page.locator("#centre-marker").boundingBox();
    expect(marker).not.toBeNull();
    const markerCenter = {
      x: marker.x + marker.width / 2,
      y: marker.y + marker.height / 2,
    };
    const assertInvariant = async () => {
      const current = await page.evaluate(() => window.advisorWorld.state);
      expect(current.view.x).toBe(focus.x);
      expect(current.view.z).toBe(focus.z);
      expect(current.view.yaw).toBe(focus.yaw);
      expect(current.navigation.heading).toBe(-focus.yaw || 0);
      const box = await page.locator("#centre-marker").boundingBox();
      expect(box).not.toBeNull();
      expect(box.x + box.width / 2).toBeCloseTo(markerCenter.x, 6);
      expect(box.y + box.height / 2).toBeCloseTo(markerCenter.y, 6);
      return current;
    };

    await page.locator("#zoom-out").click();
    await page.waitForFunction(() => window.advisorWorld.state.handoff.projectionTransition > 0.01);
    let state = await assertInvariant();
    expect(state.globe.complete).toBeTruthy();
    expect(state.handoff.destinationReady).toBeTruthy();
    expect(state.handoff.waitingForDestination).toBeFalsy();
    expect(state.handoff.preparationWaitMs).toBeGreaterThanOrEqual(0);
    expect(state.handoff.blendDurationMs).toBeGreaterThan(0);
    const buttonOutHeight = state.view.halfHeight;
    await page.locator("#zoom-in").click();
    await page.waitForTimeout(50);
    state = await assertInvariant();
    expect(state.view.halfHeight).toBeLessThan(buttonOutHeight);
    await page.locator("#zoom-out").click();
    await page.waitForTimeout(50);
    state = await assertInvariant();
    expect(state.view.halfHeight).toBeGreaterThan(buttonOutHeight / 1.4);

    await page.locator("#world").hover();
    const wheelStart = state.view.halfHeight;
    await page.mouse.wheel(0, 140);
    await page.waitForTimeout(60);
    state = await assertInvariant();
    expect(state.view.halfHeight).toBeGreaterThan(wheelStart);
    const wheelOutHeight = state.view.halfHeight;
    await page.mouse.wheel(0, -140);
    await page.waitForTimeout(60);
    state = await assertInvariant();
    expect(state.view.halfHeight).toBeLessThan(wheelOutHeight);

    const pinch = async (startSpread, endSpread, firstId) => {
      await page.evaluate(
        ({ startSpread, endSpread, firstId }) => {
          const c = document.getElementById("world"),
            r = c.getBoundingClientRect(),
            fire = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, {
              bubbles: true,
              pointerId: id,
              pointerType: "touch",
              clientX: x,
              clientY: y,
              buttons: type === "pointerup" ? 0 : 1,
            })),
            cy = r.top + r.height * 0.55,
            cx = r.left + r.width * 0.5;
          fire("pointerdown", firstId, cx - startSpread, cy);
          fire("pointerdown", firstId + 1, cx + startSpread, cy);
          fire("pointermove", firstId, cx - endSpread, cy);
          fire("pointermove", firstId + 1, cx + endSpread, cy);
          fire("pointerup", firstId, cx - endSpread, cy);
          fire("pointerup", firstId + 1, cx + endSpread, cy);
        },
        { startSpread, endSpread, firstId },
      );
      await page.waitForTimeout(80);
      return assertInvariant();
    };
    const pinchStart = state.view.halfHeight;
    state = await pinch(45, 70, 31);
    expect(state.view.halfHeight).toBeLessThan(pinchStart);
    const pinchInHeight = state.view.halfHeight;
    state = await pinch(70, 45, 41);
    expect(state.view.halfHeight).toBeGreaterThan(pinchInHeight);

    // Explicit reversal while projectionTransition is strictly between 0 and 1.
    await page.mouse.move(viewport.width * 0.5, viewport.height * 0.55);
    const beforeReverse = await page.evaluate(
      () => window.advisorWorld.state.handoff.projectionTransition,
    );
    expect(beforeReverse).toBeGreaterThan(0);
    expect(beforeReverse).toBeLessThan(1);
    await page.mouse.wheel(0, -420);
    await page.waitForFunction(() => {
      const h = window.advisorWorld.state.handoff;
      return h.desiredTransition < h.projectionTransition || h.projectionTransition <= 0.01;
    });
    state = await assertInvariant();

    await page.evaluate((h) => window.advisorWorld.setHalfHeight(h), anchors.globeHalfHeight * 1.06);
    await page.waitForFunction(() => window.advisorWorld.state.presentation === "globe" && window.advisorWorld.state.settled);
    const globeState = await assertInvariant();
    expect(globeState.globe.complete).toBeTruthy();
    expect(globeState.handoff.destinationReady).toBeTruthy();
    expect(globeState.handoff.waitingForDestination).toBeFalsy();
    expect(globeState.handoff.preparationWaitMs).toBeGreaterThanOrEqual(0);
    expect(globeState.handoff.blendDurationMs).toBeGreaterThan(0);
    await page.evaluate((h) => window.advisorWorld.setHalfHeight(h), anchors.localHalfHeight * 0.94);
    await page.waitForFunction(() => window.advisorWorld.state.presentation === "flat" && window.advisorWorld.state.settled);
    const flatState = await assertInvariant();
    expect(flatState.handoff.destinationReady).toBeTruthy();
    expect(flatState.handoff.waitingForDestination).toBeFalsy();
    await expect(page.locator("#error")).toBeHidden();
  }
  expect(errors).toEqual([]);
});
