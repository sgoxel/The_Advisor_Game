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

  test("continuity survives 60s navigation churn and ten unload/revisit cycles", async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 1280, height: 720 });
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

    const setup = await page.evaluate(() => {
      const world = window.advisorWorld,
        roads = world.geography.roads,
        farIndex = Math.max(0, roads.length - 1),
        localRoad = roads[0],
        farRoad = roads[farIndex],
        before = world.state.performance,
        initial = world.continuity.road(farIndex, "INITIAL"),
        persisted = world.continuity.road(farIndex, "0126-01-01 12:00:00/ROAD-STATE-CHANGED"),
        after = world.state.performance;
      return {
        farIndex,
        home: localRoad.fromPosition,
        remote: farRoad.toPosition,
        foundationDigest: persisted.recipe.foundationDigest,
        initialStateDigest: initial.recipe.stateDigest,
        persistedStateDigest: persisted.recipe.stateDigest,
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
        metrics: world.continuity.metrics(),
      };
    });

    expect(setup.initialStateDigest).not.toBe(setup.persistedStateDigest);
    expect(setup.metrics.presentationBytes).toBe(0);
    expect(setup.metrics.materializedPresentationResources).toBe(0);
    expect(setup.after).toEqual(setup.before);

    const settleAt = async (position) => {
      await page.evaluate(
        ({ lon, lat }) => window.advisorWorld.navigation.setFocus(lon, lat),
        position,
      );
      await page.waitForFunction(() => window.advisorWorld.state.settled, null, { timeout: 30000 });
      return page.evaluate(() => {
        const performanceState = window.advisorWorld.state.performance;
        return {
          active: performanceState.activePatches,
          cached: performanceState.cachedPatches,
          generationReady: performanceState.generationReady,
          cpuBytes: performanceState.cpuResourceBytesEstimated,
          gpuBytes: performanceState.gpuResourceBytesEstimated,
          withinBudget: performanceState.withinBudget,
        };
      });
    };

    // Warm both destinations before measuring retained-resource stability.
    await settleAt(setup.remote);
    const warm = await settleAt(setup.home);
    expect(warm.withinBudget).toBe(true);

    const startedAt = Date.now(),
      samples = [];
    let cycles = 0;
    while (cycles < 10 || Date.now() - startedAt < 60000) {
      const away = await settleAt(setup.remote);
      const home = await settleAt(setup.home);
      expect(away.withinBudget).toBe(true);
      expect(home.withinBudget).toBe(true);
      samples.push(home);
      cycles++;
    }
    const churnMs = Date.now() - startedAt,
      final = samples.at(-1);
    expect(churnMs).toBeGreaterThanOrEqual(60000);
    expect(cycles).toBeGreaterThanOrEqual(10);

    const drift = (value, baseline) => Math.abs(value - baseline) / Math.max(1, baseline);
    expect(drift(final.cpuBytes, warm.cpuBytes)).toBeLessThanOrEqual(0.05);
    expect(drift(final.gpuBytes, warm.gpuBytes)).toBeLessThanOrEqual(0.05);

    const revisit = await page.evaluate(({ farIndex, foundationDigest }) => {
      const world = window.advisorWorld;
      world.continuity.clearCache();
      const reconstructed = world.continuity.road(
        farIndex,
        "0126-01-01 12:00:00/ROAD-STATE-CHANGED",
      );
      return {
        foundationDigest,
        rebuiltFoundationDigest: reconstructed.recipe.foundationDigest,
        stateDigest: reconstructed.recipe.stateDigest,
        metrics: world.continuity.metrics(),
        performance: world.state.performance,
      };
    }, { farIndex: setup.farIndex, foundationDigest: setup.foundationDigest });

    expect(revisit.rebuiltFoundationDigest).toBe(revisit.foundationDigest);
    expect(revisit.stateDigest).toBe(setup.persistedStateDigest);
    expect(revisit.metrics.presentationBytes).toBe(0);
    expect(revisit.metrics.materializedPresentationResources).toBe(0);
    expect(revisit.metrics.cacheEntries).toBeLessThanOrEqual(128);
    expect(revisit.performance.withinBudget).toBe(true);

    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      `test-results/continuity-churn-${backend}.json`,
      JSON.stringify(
        {
          environment: `${backend} software CI`,
          churnMs,
          unloadRevisitCycles: cycles,
          warm,
          final,
          cpuDrift: drift(final.cpuBytes, warm.cpuBytes),
          gpuDrift: drift(final.gpuBytes, warm.gpuBytes),
          remoteQueryBefore: setup.before,
          remoteQueryAfter: setup.after,
          foundationDigest: setup.foundationDigest,
          persistedStateDigest: setup.persistedStateDigest,
          continuity: revisit.metrics,
        },
        null,
        2,
      ),
    );
  });
}
