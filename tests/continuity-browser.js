import { mkdirSync, writeFileSync } from "node:fs";

export function continuityTests(test, expect, forceWebGL2 = false) {
  let referenceDigest;
  for (const viewport of [
    { name: "desktop", width: 1280, height: 720 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    test(`continuity queries stay definition-only ${viewport.name}`, async ({ page }) => {
      test.setTimeout(180000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      if (forceWebGL2)
        await page.addInitScript(() =>
          Object.defineProperty(navigator, "gpu", {
            value: undefined,
            configurable: true,
          }),
        );
      await page.goto("/");
      await page.waitForFunction(() => window.advisorWorld?.state.settled && window.advisorWorld?.continuity);

      const backend = await page.evaluate(() => window.advisorWorld.renderer.backend);
      expect(backend).toBe(forceWebGL2 ? "webgl2" : "webgpu");

      const result = await page.evaluate(() => {
        const world = window.advisorWorld,
          before = world.state.performance,
          coldStart = performance.now(),
          first = world.continuity.road(0),
          coldMs = performance.now() - coldStart,
          warmStart = performance.now(),
          warm = world.continuity.road(0),
          warmMs = performance.now() - warmStart,
          rebuildDigests = [];
        for (let cycle = 0; cycle < 10; cycle++) {
          world.continuity.clearCache();
          rebuildDigests.push(world.continuity.road(0).recipe.foundationDigest);
        }
        const after = world.state.performance,
          metrics = world.continuity.metrics();
        return {
          before: {
            active: before.activePatches,
            wanted: before.wantedCanonicalKeys,
            cached: before.cachedPatches,
            generationReady: before.generationReady,
            pendingGeneration: before.pendingGeneration,
            cpuBytes: before.cpuResourceBytesEstimated,
            gpuBytes: before.gpuResourceBytesEstimated,
          },
          after: {
            active: after.activePatches,
            wanted: after.wantedCanonicalKeys,
            cached: after.cachedPatches,
            generationReady: after.generationReady,
            pendingGeneration: after.pendingGeneration,
            cpuBytes: after.cpuResourceBytesEstimated,
            gpuBytes: after.gpuResourceBytesEstimated,
          },
          firstDigest: first.recipe.foundationDigest,
          warmDigest: warm.recipe.foundationDigest,
          rebuildDigests,
          regions: first.recipe.regions.length,
          ports: first.recipe.ports.length,
          runtimePoints: first.runtimeProfile.length,
          coldMs,
          warmMs,
          metrics,
        };
      });

      expect(result.firstDigest).toBe(result.warmDigest);
      expect(result.rebuildDigests).toHaveLength(10);
      for (const digest of result.rebuildDigests) expect(digest).toBe(result.firstDigest);
      if (referenceDigest) expect(result.firstDigest).toBe(referenceDigest);
      else referenceDigest = result.firstDigest;
      expect(result.regions).toBeLessThanOrEqual(48);
      expect(result.ports).toBeGreaterThan(0);
      expect(result.runtimePoints).toBeGreaterThan(1);
      expect(result.metrics.presentationBytes).toBe(0);
      expect(result.metrics.materializedPresentationResources).toBe(0);
      expect(result.after.active).toBe(result.before.active);
      expect(result.after.wanted).toEqual(result.before.wanted);
      expect(result.after.cached).toBe(result.before.cached);
      expect(result.after.generationReady).toBe(result.before.generationReady);
      expect(result.after.pendingGeneration).toBe(result.before.pendingGeneration);
      expect(result.after.cpuBytes).toBe(result.before.cpuBytes);
      expect(result.after.gpuBytes).toBe(result.before.gpuBytes);

      await page.locator("#map-scale").selectOption("20");
      await page.waitForFunction(() => window.advisorWorld.state.settled);
      const lodDigest = await page.evaluate(() => window.advisorWorld.continuity.road(0).recipe.foundationDigest);
      expect(lodDigest).toBe(result.firstDigest);

      mkdirSync("test-results", { recursive: true });
      writeFileSync(
        `test-results/continuity-metrics-${viewport.name}-${backend}.json`,
        JSON.stringify(
          {
            environment: `${backend} software CI`,
            viewport,
            foundationDigest: result.firstDigest,
            logicalRegions: result.regions,
            sharedPorts: result.ports,
            runtimeProfilePoints: result.runtimePoints,
            coldMs: result.coldMs,
            warmMs: result.warmMs,
            before: result.before,
            after: result.after,
            continuity: result.metrics,
            rebuildCycles: result.rebuildDigests.length,
          },
          null,
          2,
        ),
      );

      await page.locator("#continuity-contracts").check();
      await expect(page.locator("#continuity-workset")).toBeVisible();
      await expect(page.locator("#continuity-workset")).toContainText("Remote presentation resources 0");
      await page.screenshot({
        path: `test-results/continuity-${viewport.name}-${backend}.png`,
        fullPage: true,
      });
    });
  }
}
