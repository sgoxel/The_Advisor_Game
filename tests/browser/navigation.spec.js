import { test, expect } from "@playwright/test";
const sizes = [
  [360, 800],
  [390, 844],
  [844, 390],
  [768, 1024],
  [1024, 768],
  [1280, 720],
  [1440, 900],
];
test("navigation geometry and responsive HUD", async ({ page }) => {
  test.setTimeout(600000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.ready);
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const scale of ["10", "10000"]) {
      await page.locator("#map-scale").selectOption(scale);
      await page.waitForFunction(() => window.advisorWorld.state.settled);
      await page.waitForTimeout(100);
      await page.screenshot({
        path: `test-results/navigation/${width}x${height}-${scale}.png`,
      });
      const rectangles = await page.evaluate(() =>
        [
          "#map-scale",
          "#centre-marker",
          "#focus-coordinates",
          "#scale-line",
          ".bottom-bar",
          ".map-controls",
          ".region-panel",
          ".masthead",
        ].map((s) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return { s, x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
      for (const r of rectangles) {
        expect(r.x, r.s).toBeGreaterThanOrEqual(0);
        expect(r.y, r.s).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, r.s).toBeLessThanOrEqual(width + 1);
        expect(r.y + r.h, r.s).toBeLessThanOrEqual(height + 1);
      }
      const marker = rectangles.find((r) => r.s === "#centre-marker");
      for (const r of rectangles.filter((r) =>
        [".bottom-bar", ".map-controls", ".region-panel", ".masthead"].includes(
          r.s,
        ),
      ))
        expect(
          r.x < marker.x + marker.w &&
            r.x + r.w > marker.x &&
            r.y < marker.y + marker.h &&
            r.y + r.h > marker.y,
          r.s + " obscures focus",
        ).toBe(false);
      const nav = await page.evaluate(
        () => window.advisorWorld.state.navigation,
      );
      const d = (a, b) => {
        const u = [
            Math.cos(a.lat) * Math.sin(a.lon),
            Math.sin(a.lat),
            Math.cos(a.lat) * Math.cos(a.lon),
          ],
          v = [
            Math.cos(b.lat) * Math.sin(b.lon),
            Math.sin(b.lat),
            Math.cos(b.lat) * Math.cos(b.lon),
          ];
        return (
          637100 *
          Math.atan2(
            Math.hypot(
              u[1] * v[2] - u[2] * v[1],
              u[2] * v[0] - u[0] * v[2],
              u[0] * v[1] - u[1] * v[0],
            ),
            u.reduce((s, n, i) => s + n * v[i], 0),
          )
        );
      };
      expect(
        Math.abs(nav.ruler.distanceM - d(nav.ruler.start, nav.ruler.end)) /
          nav.ruler.distanceM,
      ).toBeLessThan(0.02);
      const label = await page.locator("#scale-text").textContent();
      const displayed = parseFloat(label) * (label.includes("km") ? 1000 : 1);
      expect(
        Math.abs(displayed - nav.ruler.distanceM) / nav.ruler.distanceM,
      ).toBeLessThan(0.02);
      const buttons = await page
        .locator(
          ".map-controls button,.region-actions button,#open-travel,#map-scale",
        )
        .evaluateAll((ns) =>
          ns.map((n) => {
            const r = n.getBoundingClientRect();
            return [r.width, r.height];
          }),
        );
      for (const [w, h] of buttons.filter(([w, h]) => w && h)) {
        expect(w).toBeGreaterThanOrEqual(44);
        expect(h).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({
        path: `test-results/navigation/${width}x${height}-${scale}.png`,
      });
    }
  }
  expect(errors).toEqual([]);
});
test("pointer touch keyboard and canonical wrapping", async ({ page }) => {
  test.setTimeout(300000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.settled);
  for (const scale of ["10", "2500", "10000"]) {
    await page.locator("#map-scale").selectOption(scale);
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    const before = await page.evaluate(() => ({
      focus: window.advisorWorld.state.navigation.focus,
      end: window.advisorWorld.navigation.surfaceAtScreen(600, 360),
      start: window.advisorWorld.navigation.surfaceAtScreen(640, 360),
    }));
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.mouse.move(600, 360);
    await page.mouse.up();
    const after = await page.evaluate(
      () => window.advisorWorld.state.navigation.focus,
    );
    const angular = (a, b) =>
      Math.acos(
        Math.min(
          1,
          Math.max(
            -1,
            Math.sin(a.lat) * Math.sin(b.lat) +
              Math.cos(a.lat) * Math.cos(b.lat) * Math.cos(a.lon - b.lon),
          ),
        ),
      );
    expect(
      Math.abs(
        angular(before.focus, after) - angular(before.start, before.end),
      ) / angular(before.start, before.end),
    ).toBeLessThan(0.05);
  }
  await page.locator("#rotate").click();
  await page.evaluate(() => window.advisorWorld.navigation.setFocus(0.3, 1));
  const heading = await page.evaluate(() => window.advisorWorld.state.view.yaw);
  const compass = await page.evaluate(
    () => window.advisorWorld.state.navigation.heading,
  );
  for (const scale of ["20", "5000"]) {
    await page.locator("#map-scale").selectOption(scale);
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    expect(await page.evaluate(() => window.advisorWorld.state.view.yaw)).toBe(
      heading,
    );
    expect(
      await page.evaluate(() => window.advisorWorld.state.navigation.heading),
    ).toBe(compass);
  }
  await page.locator("#compass").click();
  expect(await page.evaluate(() => window.advisorWorld.state.view.yaw)).toBe(0);
  await page.evaluate(() => window.advisorWorld.navigation.setFocus(0.2, 0.4));
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  const touchBefore = await page.evaluate(() => ({
    ...window.advisorWorld.state.view,
  }));
  await page.evaluate(() => {
    const c = document.getElementById("world"),
      fire = (type, id, x) =>
        c.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: "touch",
            clientX: x,
            clientY: 360,
            buttons: type === "pointerup" ? 0 : 1,
            bubbles: true,
          }),
        );
    fire("pointerdown", 31, 600);
    fire("pointerdown", 32, 680);
    fire("pointermove", 31, 580);
    fire("pointermove", 32, 700);
    fire("pointerup", 31, 580);
    fire("pointerup", 32, 700);
  });
  const pinched = await page.evaluate(() => window.advisorWorld.state.view);
  expect(pinched.x).toBe(touchBefore.x);
  expect(pinched.z).toBe(touchBefore.z);
  expect(pinched.yaw).toBe(touchBefore.yaw);
  expect(pinched.halfHeight).toBeLessThan(touchBefore.halfHeight);
  await page.evaluate(() => {
    const c = document.getElementById("world"),
      fire = (type, x) =>
        c.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 41,
            pointerType: "touch",
            clientX: x,
            clientY: 360,
            buttons: type === "pointerup" ? 0 : 1,
            bubbles: true,
          }),
        );
    fire("pointerdown", 640);
    fire("pointermove", 620);
    fire("pointerup", 620);
  });
  expect(
    await page.evaluate(() => window.advisorWorld.state.view.x),
  ).toBeGreaterThan(pinched.x);
  const keyboardBefore = await page.evaluate(
    () => window.advisorWorld.state.view.x,
  );
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(200);
  await page.keyboard.up("ArrowRight");
  expect(
    await page.evaluate(() => window.advisorWorld.state.view.x),
  ).toBeGreaterThan(keyboardBefore);
  const seam = await page.evaluate(() => {
    const a = window.advisorWorld;
    a.navigation.setFocus(0.42 + 2 * Math.PI, 0.3);
    return a.state.navigation.focus;
  });
  expect(seam.lon).toBeCloseTo(0.42, 9);
  expect(seam.lat).toBeCloseTo(0.3, 9);
  const pole = await page.evaluate(() => {
    window.advisorWorld.navigation.setFocus(0, Math.PI);
    return window.advisorWorld.state.navigation.focus;
  });
  expect(pole.lat).toBeCloseTo(Math.PI / 2, 9);
  expect(errors).toEqual([]);
});


test("canonical streaming remains bounded across wrap and poles", async ({ page }) => {
  test.setTimeout(300000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.waitForFunction(() => window.advisorWorld?.state.settled);
  await page.locator("#map-scale").selectOption("100");
  await page.evaluate(() => window.advisorWorld.navigation.setFocus(Math.PI - 0.0002, 0.35));
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  const first = await page.evaluate(() => window.advisorWorld.state.streaming);
  expect(first.deviceClass).toBe("desktop");
  expect(first.activePatches).toBeLessThanOrEqual(first.budget.activePatches);
  expect(first.cachedPatches).toBeLessThanOrEqual(first.budget.cachedPatches);
  expect(first.queuedTotal).toBeLessThanOrEqual(first.budget.generationReadyQueue);
  expect(first.gpuBytesEstimated).toBeLessThanOrEqual(first.budget.gpuBytes);
  expect(new Set(first.activeCanonicalKeys).size).toBe(first.activeCanonicalKeys.length);
  const keys = [...first.activeCanonicalKeys].sort();
  await page.evaluate(() =>
    window.advisorWorld.navigation.setFocus(Math.PI - 0.0002 + Math.PI * 2, 0.35),
  );
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  expect(
    await page.evaluate(() => [...window.advisorWorld.state.streaming.activeCanonicalKeys].sort()),
  ).toEqual(keys);
  await page.evaluate(() => window.advisorWorld.navigation.setFocus(0, Math.PI));
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  const north = await page.evaluate(() => ({
    focus: window.advisorWorld.state.navigation.focus,
    streaming: window.advisorWorld.state.streaming,
  }));
  expect(north.focus.lat).toBeCloseTo(Math.PI / 2, 9);
  expect(north.streaming.poleFeedback).toContain("North pole");
  expect(north.streaming.activePatches).toBeGreaterThan(0);
  expect(new Set(north.streaming.activeCanonicalKeys).size).toBe(
    north.streaming.activeCanonicalKeys.length,
  );
  await page.evaluate(() => window.advisorWorld.navigation.setFocus(Math.PI / 2, -Math.PI));
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  const south = await page.evaluate(() => window.advisorWorld.state.streaming);
  expect(south.poleFeedback).toContain("South pole");
  expect(south.queuedTotal).toBeLessThanOrEqual(south.budget.generationReadyQueue);
  expect(errors).toEqual([]);
});
