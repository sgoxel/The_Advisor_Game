import { test, expect } from '@playwright/test';

function collectRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror:${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console:${message.text()}`);
  });
  return failures;
}

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCRelevanceRuntime?.snapshot &&
    window.Game?.FrameBudgetScheduler?.metrics &&
    window.Game?.NPCRuntimeBridge?.scheduleReconcile &&
    window.Game?.NPCRuntimeBridge?.validSpatialPopulation?.() &&
    window.Game?.State?.world?.npcs?.length
  ), null, { timeout: 30_000 });
  await page.evaluate(async () => {
    if (window.Game?.Config) window.Game.Config.DEFAULT_SHOW_NPC_ACTIVITY_BUBBLES = false;
    // Let any presentation frame that was already in flight finish before focused
    // tests deliberately manipulate authoritative NPC fixtures.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForFunction(
    () => window.Game?.NPCRuntimeBridge?.validSpatialPopulation?.() === true,
    null,
    { timeout: 30_000 }
  );
}

test('stable NPC identity produces deterministic distributed authoritative-time buckets', async ({ page }) => {
  await ready(page);
  const failures = collectRuntimeFailures(page);

  const distribution = await page.evaluate(() => {
    const runtime = window.Game.NPCRelevanceRuntime;
    const ids = Array.from({ length: 160 }, (_, index) => ({ id: `representative-${index}` }));
    const first = ids.map((npc) => runtime.stableBucket(npc, runtime.tiers.DISTANT));
    const second = ids.map((npc) => runtime.stableBucket(npc, runtime.tiers.DISTANT));
    const counts = first.reduce((map, bucket) => {
      map[bucket] = (map[bucket] || 0) + 1;
      return map;
    }, {});
    return { first, second, counts, cadence: runtime.cadenceMinutes.distant };
  });

  expect(distribution.second).toEqual(distribution.first);
  expect(new Set(distribution.first).size).toBeGreaterThanOrEqual(Math.min(10, distribution.cadence - 1));
  expect(Math.max(...Object.values(distribution.counts))).toBeLessThan(distribution.first.length / 3);
  expect(failures).toEqual([]);
});

test('relevance tiers distinguish interaction-critical work from distant compact work without renderer truth', async ({ page }) => {
  await ready(page);
  const failures = collectRuntimeFailures(page);

  const evidence = await page.evaluate(() => {
    const runtime = window.Game.NPCRelevanceRuntime;
    const player = window.Game.State.world.player;
    const playerRow = Number.isFinite(Number(player?.row)) ? Number(player.row) : 0;
    const playerCol = Number.isFinite(Number(player?.col)) ? Number(player.col) : 0;
    const critical = runtime.classify({ id: 'critical-probe', row: playerRow + 90, col: playerCol + 90, interactionCritical: true });
    const distant = runtime.classify({ id: 'far-probe', row: playerRow + 90, col: playerCol + 90 });
    runtime.scheduleFrame();
    const snapshot = runtime.snapshot();
    return {
      critical,
      distant,
      authority: snapshot.authority,
      compactStatePersisted: snapshot.compactStatePersisted,
      counts: snapshot.counts,
      entries: snapshot.entries.length,
      population: window.Game.State.world.npcs.length
    };
  });

  expect(evidence.critical).toBe('critical');
  expect(evidence.distant).toBe('distant');
  expect(evidence.authority).toBe('scheduling-only');
  expect(evidence.compactStatePersisted).toBe(false);
  expect(evidence.entries).toBe(evidence.population);
  expect(Object.values(evidence.counts).reduce((sum, value) => sum + value, 0)).toBe(evidence.population);
  expect(failures).toEqual([]);
});

test('camera interaction defers NPC detail/reconcile work and idle frame slack drains owned work', async ({ page }) => {
  test.setTimeout(90_000);
  await ready(page);
  const failures = collectRuntimeFailures(page);

  const during = await page.evaluate(() => {
    const scheduler = window.Game.FrameBudgetScheduler;
    scheduler.noteInteraction('npc-performance-test', 260);
    window.Game.NPCRelevanceRuntime.scheduleFrame();
    window.Game.NPCRuntimeBridge.scheduleReconcile();
    window.Game.Renderer.renderWorld(true);
    return {
      scheduler: scheduler.metrics(),
      relevance: window.Game.NPCRelevanceRuntime.snapshot(),
      bridge: window.Game.NPCRuntimeBridge.metrics()
    };
  });

  expect(during.scheduler.interactionActive).toBe(true);
  expect(during.scheduler.queuedKeys.some((key) => key === 'npc-runtime-reconcile')).toBe(true);
  expect(during.bridge.reconcileRequests).toBeGreaterThan(0);
  expect(during.relevance.deferredJobs).toBeGreaterThanOrEqual(0);

  await page.waitForTimeout(310);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const reconcileQueued = await page.evaluate(() => {
      const scheduler = window.Game.FrameBudgetScheduler;
      scheduler.runBackgroundSlice(performance.now());
      return scheduler.metrics().queuedKeys.includes('npc-runtime-reconcile');
    });
    if (!reconcileQueued) break;
    await page.waitForTimeout(4);
  }

  const after = await page.evaluate(() => ({
    scheduler: window.Game.FrameBudgetScheduler.metrics(),
    relevance: window.Game.NPCRelevanceRuntime.snapshot(),
    bridge: window.Game.NPCRuntimeBridge.metrics(),
    uniquePositions: new Set(window.Game.State.world.npcs.map((npc) => `${npc.row},${npc.col}`)).size,
    population: window.Game.State.world.npcs.length
  }));

  expect(after.scheduler.interactionActive).toBe(false);
  // renderWorld continuously schedules the next authoritative reconcile, so instantaneous
  // queue emptiness is racy. Prove idle slack actually consumed owned work instead.
  expect(after.scheduler.completedJobs).toBeGreaterThan(during.scheduler.completedJobs);
  expect(after.bridge.reconcileRuns).toBeGreaterThan(during.bridge.reconcileRuns);
  expect(after.relevance.completedJobs).toBeGreaterThanOrEqual(during.relevance.completedJobs);
  expect(after.relevance.npcJobWorstMs).toBeLessThan(50);
  expect(after.uniquePositions).toBe(after.population);
  expect(failures).toEqual([]);
});

test('same authoritative minute deduplicates repeated relevance scheduling without rematerializing spatial state', async ({ page }) => {
  await ready(page);
  const failures = collectRuntimeFailures(page);

  const evidence = await page.evaluate(async () => {
    const Game = window.Game;
    const capturedTime = Game.GameTime.capture();
    Game.GameTime.stop();
    Game.GameTime.setForTest(Math.floor(capturedTime.totalGameMinutes));
    try {
      const scheduler = Game.FrameBudgetScheduler;
      scheduler.cancel('npc-runtime-reconcile');
      const before = Game.NPCRelevanceRuntime.snapshot();
      const startPositions = Game.State.world.npcs.map((npc) => `${npc.id}:${npc.row},${npc.col}`);
      for (let index = 0; index < 30; index += 1) Game.NPCRelevanceRuntime.scheduleFrame();
      const queuedNpcDetailKeys = scheduler.metrics().queuedKeys.filter((key) => key.startsWith('npc-detail:'));
      for (let attempt = 0; attempt < 40 && scheduler.metrics().queuedKeys.some((key) => key.startsWith('npc-detail:')); attempt += 1) {
        // The focused contract measures relevance jobs only. A renderer frame may queue the
        // normal authoritative reconcile between async slices; remove that unrelated job
        // before each synchronous slice so it cannot repair/move the fixture under test.
        scheduler.cancel('npc-runtime-reconcile');
        scheduler.runBackgroundSlice(performance.now());
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      scheduler.cancel('npc-runtime-reconcile');
      const after = Game.NPCRelevanceRuntime.snapshot();
      return {
        startPositions,
        endPositions: Game.State.world.npcs.map((npc) => `${npc.id}:${npc.row},${npc.col}`),
        population: Game.State.world.npcs.length,
        queuedNpcDetailKeys,
        beforeJobs: before.completedJobs,
        afterJobs: after.completedJobs,
        remainingNpcDetailKeys: scheduler.metrics().queuedKeys.filter((key) => key.startsWith('npc-detail:'))
      };
    } finally {
      Game.GameTime.restore(capturedTime);
      Game.GameTime.start();
      Game.NPCRuntimeBridge.scheduleReconcile();
    }
  });

  expect(new Set(evidence.queuedNpcDetailKeys).size).toBe(evidence.queuedNpcDetailKeys.length);
  expect(evidence.queuedNpcDetailKeys.length).toBeLessThanOrEqual(evidence.population);
  expect(evidence.endPositions).toEqual(evidence.startPositions);
  expect(evidence.afterJobs - evidence.beforeJobs).toBeLessThanOrEqual(evidence.population);
  expect(evidence.remainingNpcDetailKeys).toEqual([]);
  expect(failures).toEqual([]);
});

test('distant demotion unloads detail and interaction-critical promotion reconciles before authoritative work resumes', async ({ page }) => {
  test.setTimeout(90_000);
  await ready(page);
  const failures = collectRuntimeFailures(page);

  const evidence = await page.evaluate(async () => {
    const Game = window.Game;
    const runtime = Game.NPCRelevanceRuntime;
    const scheduler = Game.FrameBudgetScheduler;
    const player = Game.State.world.player;
    const npc = Game.State.world.npcs.find((entry) => entry?.id && entry !== player) || Game.State.world.npcs[0];
    const original = { row: npc.row, col: npc.col, interactionCritical: npc.interactionCritical, selectedForInteraction: npc.selectedForInteraction, dialogueWith: npc.dialogueWith };
    const capturedTime = Game.GameTime.capture();
    const playerRow = Number.isFinite(Number(player?.row)) ? Number(player.row) : 0;
    const playerCol = Number.isFinite(Number(player?.col)) ? Number(player.col) : 0;
    const barrierKey = 'test:npc-relevance-promotion-isolation';

    Game.GameTime.stop();
    Game.GameTime.setForTest(Math.floor(capturedTime.totalGameMinutes));

    try {
      if (Game.State.camera) {
        Game.State.camera.dragActive = false;
        Game.State.camera.inertiaVelocityX = 0;
        Game.State.camera.inertiaVelocityY = 0;
      }
      Game.State.input?.keys?.clear?.();
      for (let attempt = 0; attempt < 60 && scheduler.interactionActive(); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      scheduler.cancel('npc-runtime-reconcile');

      npc.interactionCritical = false;
      npc.selectedForInteraction = false;
      npc.dialogueWith = null;
      npc.row = playerRow + 90;
      npc.col = playerCol + 90;
      runtime.scheduleFrame();
      scheduler.cancel('npc-runtime-reconcile');
      const demoted = runtime.snapshot().entries.find((entry) => entry.id === String(npc.id));

      const promotedBefore = runtime.snapshot().promotedReconciliations;
      npc.interactionCritical = true;
      const promotedStart = { row: npc.row, col: npc.col };
      runtime.scheduleFrame();
      const pendingEntry = runtime.snapshot().entries.find((entry) => entry.id === String(npc.id));
      const detailKey = `npc-detail:${npc.id}`;
      const detailQueuedBefore = scheduler.metrics().queuedKeys.includes(detailKey);

      // The critical detail job has priority 30. Put a test-only priority-29 barrier directly
      // behind it; the barrier marks interaction pressure so runBackgroundSlice stops before
      // the normal priority-25 authoritative reconcile can execute. This exercises the real
      // queued detail closure while isolating the exact no-teleport measurement window.
      scheduler.enqueue(barrierKey, () => {
        scheduler.noteInteraction('npc-relevance-focused-isolation', 80);
        return true;
      }, { priority: 29, label: 'NPC relevance focused isolation barrier' });
      scheduler.cancel('npc-runtime-reconcile');
      scheduler.runBackgroundSlice(performance.now());
      scheduler.cancel('npc-runtime-reconcile');

      const afterDetail = runtime.snapshot();
      const promotedEntry = afterDetail.entries.find((entry) => entry.id === String(npc.id));
      const promotedEnd = { row: npc.row, col: npc.col };

      // Only after the focused detail/no-teleport observation is complete do we acknowledge
      // the separate authoritative update. That transition owns clearing promotion-pending.
      runtime.markAuthoritativeUpdated(npc);
      const afterAuthoritative = runtime.snapshot().entries.find((entry) => entry.id === String(npc.id));

      return {
        demotedTier: demoted?.tier,
        demotedDetailLoaded: demoted?.detailLoaded,
        promotedTier: promotedEntry?.tier,
        detailQueuedBefore,
        promotedPendingBeforeDetail: pendingEntry?.authoritativePromotionPending,
        promotedPendingAfterDetail: promotedEntry?.authoritativePromotionPending,
        promotedPendingAfterAuthoritative: afterAuthoritative?.authoritativePromotionPending,
        promotedReconciliationsDelta: afterDetail.promotedReconciliations - promotedBefore,
        promotedStart,
        promotedEnd
      };
    } finally {
      scheduler.cancel(barrierKey);
      scheduler.cancel('npc-runtime-reconcile');
      npc.row = original.row;
      npc.col = original.col;
      npc.interactionCritical = original.interactionCritical;
      npc.selectedForInteraction = original.selectedForInteraction;
      npc.dialogueWith = original.dialogueWith;
      runtime.markAuthoritativeUpdated(npc);
      Game.GameTime.restore(capturedTime);
      Game.GameTime.start();
      // Ordinary authoritative reconciliation is intentionally resumed only after the
      // focused relevance-detail measurement and fixture restoration are complete.
      Game.NPCRuntimeBridge.scheduleReconcile();
    }
  });

  expect(evidence.demotedTier).toBe('distant');
  expect(evidence.demotedDetailLoaded).toBe(false);
  expect(evidence.promotedTier).toBe('critical');
  expect(evidence.detailQueuedBefore).toBe(true);
  expect(evidence.promotedPendingBeforeDetail).toBe(true);
  expect(evidence.promotedReconciliationsDelta).toBeGreaterThanOrEqual(1);
  expect(evidence.promotedPendingAfterDetail).toBe(true);
  expect(evidence.promotedPendingAfterAuthoritative).toBe(false);
  expect(Math.abs(evidence.promotedEnd.row - evidence.promotedStart.row) + Math.abs(evidence.promotedEnd.col - evidence.promotedStart.col)).toBe(0);
  expect(failures).toEqual([]);
});

test('relevance scheduler metadata stays outside authoritative persisted world state', async ({ page }) => {
  await ready(page);
  const failures = collectRuntimeFailures(page);

  const evidence = await page.evaluate(() => {
    const runtime = window.Game.NPCRelevanceRuntime;
    runtime.scheduleFrame();
    const snapshot = runtime.snapshot();
    const worldJson = JSON.stringify(window.Game.State.world);
    const authoritativeNpcState = window.Game.State.world.npcs.map((npc) => ({ id: npc.id, row: npc.row, col: npc.col, activity: npc.activity }));
    const authoritativeNpcStateJson = JSON.stringify(authoritativeNpcState);
    return {
      compactStatePersisted: snapshot.compactStatePersisted,
      worldContainsPromotionPending: worldJson.includes('authoritativePromotionPending'),
      worldContainsRelevanceVersion: worldJson.includes(String(runtime.version)),
      authoritativeNpcStateJson,
      authoritativeNpcStateRoundTripJson: JSON.stringify(JSON.parse(authoritativeNpcStateJson))
    };
  });

  expect(evidence.compactStatePersisted).toBe(false);
  expect(evidence.worldContainsPromotionPending).toBe(false);
  expect(evidence.worldContainsRelevanceVersion).toBe(false);
  expect(evidence.authoritativeNpcStateRoundTripJson).toBe(evidence.authoritativeNpcStateJson);
  expect(failures).toEqual([]);
});
