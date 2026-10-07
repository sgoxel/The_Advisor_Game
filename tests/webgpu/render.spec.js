import { test, expect } from "@playwright/test";

const HANDOFF_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
];

async function exercisePureZoomHandoff(page, backend, viewports = HANDOFF_VIEWPORTS) {
  const anchors = await page.evaluate(() => window.advisorWorld.handoff);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(
      (h) => window.advisorWorld.setHalfHeight(h),
      anchors.localHalfHeight * 0.94,
    );
    await page.waitForFunction(
      () =>
        window.advisorWorld.state.presentation === "flat" &&
        window.advisorWorld.state.settled,
    );
    const focus = await page.evaluate(() => ({
      ...window.advisorWorld.state.view,
    }));
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

    // Zoom buttons work in both directions without moving/turning focus.
    await page.locator("#zoom-out").click();
    await page.waitForFunction(
      () => window.advisorWorld.state.handoff.projectionTransition > 0.01,
    );
    let state = await assertInvariant();
    expect(state.globe.complete).toBeTruthy();
    expect(state.handoff.destinationReady).toBeTruthy();
    expect(state.handoff.waitingForDestination).toBeFalsy();
    expect(state.handoff.preparationWaitMs).toBeGreaterThanOrEqual(0);
    expect(state.handoff.blendDurationMs).toBeGreaterThan(0);
    if (backend === "webgpu")
      await page.screenshot({
        path: `test-results/webgpu-handoff-${viewport.width}x${viewport.height}-button.png`,
      });
    const buttonOutHeight = state.view.halfHeight;
    await page.locator("#zoom-in").click();
    await page.waitForTimeout(50);
    state = await assertInvariant();
    expect(state.view.halfHeight).toBeLessThan(buttonOutHeight);
    await page.locator("#zoom-out").click();
    await page.waitForTimeout(50);
    state = await assertInvariant();
    expect(state.view.halfHeight).toBeGreaterThan(buttonOutHeight / 1.4);

    // Wheel works in both directions and changes only scale.
    await page.mouse.move(viewport.width * 0.5, viewport.height * 0.55);
    const wheelStart = state.view.halfHeight;
    await page.mouse.wheel(0, 140);
    await page.waitForTimeout(60);
    state = await assertInvariant();
    expect(state.view.halfHeight).toBeGreaterThan(wheelStart);
    if (backend === "webgpu")
      await page.screenshot({
        path: `test-results/webgpu-handoff-${viewport.width}x${viewport.height}-wheel.png`,
      });
    const wheelOutHeight = state.view.halfHeight;
    await page.mouse.wheel(0, -140);
    await page.waitForTimeout(60);
    state = await assertInvariant();
    expect(state.view.halfHeight).toBeLessThan(wheelOutHeight);

    // Two-pointer pinch works in both directions through the production handler.
    const pinch = async (startSpread, endSpread, firstId) => {
      await page.evaluate(
        ({ startSpread, endSpread, firstId }) => {
          const c = document.getElementById("world"),
            r = c.getBoundingClientRect(),
            fire = (type, id, x, y) =>
              c.dispatchEvent(
                new PointerEvent(type, {
                  bubbles: true,
                  pointerId: id,
                  pointerType: "touch",
                  clientX: x,
                  clientY: y,
                  buttons: type === "pointerup" ? 0 : 1,
                }),
              ),
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
    if (backend === "webgpu")
      await page.screenshot({
        path: `test-results/webgpu-handoff-${viewport.width}x${viewport.height}-pinch.png`,
      });
    const pinchInHeight = state.view.halfHeight;
    state = await pinch(70, 45, 41);
    expect(state.view.halfHeight).toBeGreaterThan(pinchInHeight);

    // Reverse wheel direction while the blend is active; transition must reverse in place.
    await page.mouse.move(viewport.width * 0.5, viewport.height * 0.55);
    const beforeReverse = await page.evaluate(
      () => window.advisorWorld.state.handoff.projectionTransition,
    );
    expect(beforeReverse).toBeGreaterThan(0);
    expect(beforeReverse).toBeLessThan(1);
    await page.mouse.wheel(0, -420);
    await page.waitForFunction(() => {
      const h = window.advisorWorld.state.handoff;
      return (
        h.desiredTransition < h.projectionTransition ||
        h.projectionTransition <= 0.01
      );
    });
    state = await assertInvariant();
    if (backend === "webgpu")
      await page.screenshot({
        path: `test-results/webgpu-handoff-${viewport.width}x${viewport.height}-reverse.png`,
      });

    // Traverse both settled endpoints at the exact same canonical focus.
    await page.evaluate(
      (h) => window.advisorWorld.setHalfHeight(h),
      anchors.globeHalfHeight * 1.06,
    );
    await page.waitForFunction(
      () =>
        window.advisorWorld.state.presentation === "globe" &&
        window.advisorWorld.state.settled,
    );
    const globe = await assertInvariant();
    expect(globe.globe.complete).toBeTruthy();
    expect(globe.handoff.destinationReady).toBeTruthy();
    expect(globe.handoff.waitingForDestination).toBeFalsy();
    expect(globe.handoff.preparationWaitMs).toBeGreaterThanOrEqual(0);
    expect(globe.handoff.blendDurationMs).toBeGreaterThan(0);
    if (backend === "webgpu")
      await page.screenshot({
        path: `test-results/webgpu-handoff-${viewport.width}x${viewport.height}-globe.png`,
      });

    await page.evaluate(
      (h) => window.advisorWorld.setHalfHeight(h),
      anchors.localHalfHeight * 0.94,
    );
    await page.waitForFunction(
      () =>
        window.advisorWorld.state.presentation === "flat" &&
        window.advisorWorld.state.settled,
    );
    const flat = await assertInvariant();
    expect(flat.handoff.destinationReady).toBeTruthy();
    expect(flat.handoff.waitingForDestination).toBeFalsy();
    if (backend === "webgpu")
      await page.screenshot({
        path: `test-results/webgpu-handoff-${viewport.width}x${viewport.height}-flat-return.png`,
      });
  }
}

function collectWebGpuErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /webgpu|gpuvalidation|shader|wgsl|device.*lost/i.test(message.text())
    )
      errors.push(message.text());
  });
  return errors;
}

async function expectWebGpuReady(page) {
  await page.waitForFunction(
    () => window.advisorRenderer?.phase !== "starting",
  );
  expect(await page.evaluate(() => window.advisorRenderer)).toMatchObject({
    requested: "webgpu",
    backend: "webgpu",
    phase: "ready",
    error: "",
  });
  await page.waitForFunction(() => window.advisorWorld?.state.settled);
  await expect(page.locator("#backend")).toContainText("WebGPU");
}

test("the real WebGPU backend renders the seeded world", async ({ page }) => {
  test.setTimeout(420000);
  const errors = collectWebGpuErrors(page);
  await page.setViewportSize({ width: 960, height: 640 });
  // Verify the test browser can map the staging buffers used by the engine.
  await page.goto("/PLAYCANVAS-LICENSE.txt");
  const mapping = await page.evaluate(async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw Error("WebGPU test adapter unavailable");
    const gpu = await adapter.requestDevice();
    try {
      const buffer = gpu.createBuffer({
        size: 102400,
        usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
        mappedAtCreation: true,
      });
      const bytes = buffer.getMappedRange().byteLength;
      buffer.unmap();
      buffer.destroy();
      return { bytes, adapter: adapter.info.description };
    } finally {
      gpu.destroy();
    }
  });
  console.log("WebGPU staging-buffer probe", mapping);
  expect(mapping.bytes).toBe(102400);
  await page.goto("/");
  await expectWebGpuReady(page);
  await page.screenshot({ path: "test-results/webgpu-village.png" });
  for (const scale of ["10", "10000"]) {
    await page.locator("#map-scale").selectOption(scale);
    await page.waitForFunction(() => window.advisorWorld.state.settled);
    const measured = await page.evaluate(() => {
      const nav = window.advisorWorld.state.navigation,
        r = nav.ruler;
      const a = window.advisorWorld.navigation.surfaceAtScreen(
          innerWidth / 2 - r.pixels / 2,
          innerHeight / 2,
        ),
        b = window.advisorWorld.navigation.surfaceAtScreen(
          innerWidth / 2 + r.pixels / 2,
          innerHeight / 2,
        );
      const u = (p) => [
          Math.cos(p.lat) * Math.sin(p.lon),
          Math.sin(p.lat),
          Math.cos(p.lat) * Math.cos(p.lon),
        ],
        v = u(a),
        w = u(b);
      const metres =
        637100 *
        Math.atan2(
          Math.hypot(
            v[1] * w[2] - v[2] * w[1],
            v[2] * w[0] - v[0] * w[2],
            v[0] * w[1] - v[1] * w[0],
          ),
          v.reduce((s, n, i) => s + n * w[i], 0),
        );
      return {
        ratio: r.distanceM / metres,
        coordinate: document.getElementById("focus-coordinates").textContent,
        labels: nav.labels.length,
      };
    });
    expect(Math.abs(measured.ratio - 1)).toBeLessThan(0.02);
    expect(measured.coordinate).toContain("°");
    await page.screenshot({
      path: `test-results/webgpu-navigation-${scale}.png`,
    });
  }
  await page.locator("#home").click();
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  await page.locator("#zoom-in").click();
  await page.waitForFunction(() => window.advisorWorld.state.settled);
  await page.screenshot({ path: "test-results/webgpu-detail.png" });
  // Realm level: the same world drawn as a globe by the same backend.
  await page.locator("#overview").click();
  await page.waitForFunction(
    () =>
      window.advisorWorld.state.presentation === "globe" &&
      window.advisorWorld.state.globe.complete &&
      window.advisorWorld.state.settled,
  );
  await expect(page.locator("#detail-name")).toHaveText("Realm");
  await expect(page.locator(".map-label.continent").first()).toBeVisible();
  await page.screenshot({ path: "test-results/webgpu-globe.png" });
  await page.locator("#home").click();
  await page.waitForFunction(
    () =>
      window.advisorWorld.state.presentation === "flat" &&
      window.advisorWorld.state.settled,
  );
  await expect(page.locator("#error")).toBeHidden();
  expect(errors).toEqual([]);
});

for (const viewport of HANDOFF_VIEWPORTS) {
  test(`real WebGPU pure-zoom handoff ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(420000);
    const errors = collectWebGpuErrors(page);
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expectWebGpuReady(page);
    await exercisePureZoomHandoff(page, "webgpu", [viewport]);
    await expect(page.locator("#error")).toBeHidden();
    expect(errors).toEqual([]);
  });
}
