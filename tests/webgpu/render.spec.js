import { test, expect } from "@playwright/test";

async function exercisePureZoomHandoff(page, backend) {
  const anchors = await page.evaluate(() => window.advisorWorld.handoff);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
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
    const focus = await page.evaluate(() => ({ ...window.advisorWorld.state.view }));

    // Zoom button starts the globe-bound transition without moving/turning focus.
    await page.locator("#zoom-out").click();
    await page.waitForFunction(
      () => window.advisorWorld.state.handoff.projectionTransition > 0.01,
    );
    let state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);
    if (backend === "webgpu")
      await page.screenshot({
        path: `test-results/webgpu-handoff-${viewport.width}x${viewport.height}.png`,
      });

    // Wheel changes scale only.
    await page.mouse.move(viewport.width * 0.5, viewport.height * 0.55);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(70);
    state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);

    // Two-pointer pinch exercises the production pointer handler and also changes only scale.
    await page.evaluate(() => {
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
      fire("pointerdown", 31, cx - 45, cy);
      fire("pointerdown", 32, cx + 45, cy);
      fire("pointermove", 31, cx - 70, cy);
      fire("pointermove", 32, cx + 70, cy);
      fire("pointerup", 31, cx - 70, cy);
      fire("pointerup", 32, cx + 70, cy);
    });
    await page.waitForTimeout(80);
    state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);

    // Reverse wheel direction while the blend is active; transition must reverse in place.
    await page.mouse.move(viewport.width * 0.5, viewport.height * 0.55);
    await page.mouse.wheel(0, -420);
    await page.waitForFunction(
      () => {
        const h = window.advisorWorld.state.handoff;
        return (
          h.desiredTransition < h.projectionTransition ||
          h.projectionTransition <= 0.01
        );
      },
    );
    state = await page.evaluate(() => window.advisorWorld.state);
    expect(state.view.x).toBe(focus.x);
    expect(state.view.z).toBe(focus.z);
    expect(state.view.yaw).toBe(focus.yaw);

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
    const globe = await page.evaluate(() => window.advisorWorld.state);
    expect(globe.view.x).toBe(focus.x);
    expect(globe.view.z).toBe(focus.z);
    expect(globe.view.yaw).toBe(focus.yaw);
    expect(globe.handoff.destinationReady).toBeTruthy();

    await page.evaluate(
      (h) => window.advisorWorld.setHalfHeight(h),
      anchors.localHalfHeight * 0.94,
    );
    await page.waitForFunction(
      () =>
        window.advisorWorld.state.presentation === "flat" &&
        window.advisorWorld.state.settled,
    );
    const flat = await page.evaluate(() => window.advisorWorld.state);
    expect(flat.view.x).toBe(focus.x);
    expect(flat.view.z).toBe(focus.z);
    expect(flat.view.yaw).toBe(focus.yaw);
  }
}

test("the real WebGPU backend renders the seeded world", async ({ page }) => {
  test.setTimeout(420000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /webgpu|gpuvalidation|shader|wgsl|device.*lost/i.test(message.text())
    )
      errors.push(message.text());
  });
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
  await page.screenshot({ path: "test-results/webgpu-village.png" });
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

  await exercisePureZoomHandoff(page, "webgpu");
  await expect(page.locator("#error")).toBeHidden();
  expect(errors).toEqual([]);
});
