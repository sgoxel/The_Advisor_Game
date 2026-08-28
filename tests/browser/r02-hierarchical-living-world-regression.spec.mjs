import { test, expect } from '@playwright/test';

const EXPECTED_OPTIONAL_MAP_404S = [
  '/map/ISOMETRIC_MAP_30032026.js',
  '/map/ISOMETRIC_MAP_30032026/ISOMETRIC_MAP_30032026.js',
  '/map/map.js'
];

function collectRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const locationUrl = message.location().url || '';
    let expected = false;
    if (text.includes('Failed to load resource') && text.includes('404')) {
      try { expected = EXPECTED_OPTIONAL_MAP_404S.includes(new URL(locationUrl).pathname); } catch { expected = false; }
    }
    if (!expected) failures.push(`console.error: ${text}${locationUrl ? ` @ ${locationUrl}` : ''}`);
  });
  return failures;
}

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.seed &&
    window.Game?.GameTime?.setForTest &&
    window.Game?.CampaignCalendar?.initializeOrigin &&
    window.Game?.CampaignCalendar?.reconcileResume &&
    window.Game?.RegionTimeProgression?.materializeRelevantRegion &&
    window.Game?.RelevanceBoundedCompute?.prepare &&
    window.Game?.WorldHierarchy?.refinementInput &&
    window.Game?.PoliticalGeography?.baseRegion &&
    window.Game?.SettlementEvolution?.advance &&
    window.Game?.NPCWorld?.capture &&
    window.Game?.NPCLife?.scheduleState &&
    window.Game?.Ecology?.composeRegion &&
    window.Game?.WorldDeltaPersistence?.clearAll
  ));
}

test('real-world-origin chronology drives bounded relevance-scaled lazy materialization', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const time = Game.GameTime;
    const calendar = Game.CampaignCalendar;
    const progression = Game.RegionTimeProgression;
    const compute = Game.RelevanceBoundedCompute;
    const deltas = Game.WorldDeltaPersistence;

    time.stop();
    deltas.clearAll();
    delete Game.State.world.campaignCalendar;
    time.setForTest(0);

    const origin = Date.UTC(2026, 7, 28, 14, 30);
    const initialized = calendar.initializeOrigin(origin, 0);
    const before = calendar.capture();
    const active = progression.markActive(2, -2);
    const resumed = calendar.reconcileResume(origin + 10 * 24 * 60 * 60 * 1000, 0);
    const after = calendar.capture();

    const smallJob = progression.prepareInactiveReconciliation(2, -2, after.totalGameMinutes, { irrelevantRegionCount: 0 });
    const hugeJob = progression.prepareInactiveReconciliation(2, -2, after.totalGameMinutes, { irrelevantRegionCount: 1_000_000 });
    const small = compute.compute(smallJob);
    const huge = compute.compute(hugeJob);
    const materialized = progression.materializeRelevantRegion(2, -2);

    return { initialized, before, active, resumed, after, small, huge, materialized };
  });

  expect(evidence.initialized.ok).toBe(true);
  expect(evidence.before.authority).toBe('simulation');
  expect(evidence.before.calendar).toMatchObject({ year: 26, month: 8, dayOfMonth: 28, hour: 14, minute: 30 });
  expect(evidence.resumed.ok).toBe(true);
  expect(evidence.resumed.elapsedGameDays).toBe(240);
  expect(evidence.resumed.operations).toBe(1);
  expect(evidence.resumed.fullDetailReplayTicks).toBe(0);
  expect(evidence.resumed.materializedOffscreenRegions).toBe(0);
  expect(evidence.after.totalGameMinutes - evidence.before.totalGameMinutes).toBe(240 * 1440);

  expect(evidence.active.authority).toBe('simulation');
  expect(evidence.active.mode).toBe('active-high-detail');
  expect(evidence.small.resultFingerprint).toBe(evidence.huge.resultFingerprint);
  expect(evidence.huge.workAccounting.continuousEntityTicks).toBe(0);
  expect(evidence.huge.workAccounting.localMicroActionsReplayed).toBe(0);
  expect(evidence.huge.workAccounting.dayNightCyclesReplayed).toBe(0);
  expect(evidence.huge.workAccounting.continuousWorkUnits).toBe(evidence.small.workAccounting.continuousWorkUnits);
  expect(evidence.huge.workAccounting.scalesWithIrrelevantWorldSize).toBe(false);

  expect(evidence.materialized.authority).toBe('simulation');
  expect(evidence.materialized.presentationAuthority).toBe(false);
  expect(evidence.materialized.fullDetailReplayTicks).toBe(0);
  expect(evidence.materialized.materializedOffscreenRegions).toBe(0);
  expect(evidence.materialized.relevanceBoundedScheduling.boundedCatchUp).toBe(true);
  expect(evidence.materialized.relevanceBoundedScheduling.workAccounting.continuousEntityTicks).toBe(0);
  expect(evidence.materialized.hierarchy.region.id).toBe('region:2:-2');
  expect(evidence.materialized.politicalGeography.authority).toBe('simulation');
  if (evidence.materialized.settlementEvolution) {
    expect(evidence.materialized.settlementEvolution.authority).toBe('simulation');
    expect(evidence.materialized.settlementMaterialization.authority).toBe('simulation');
  }
  expect(failures).toEqual([]);
});

test('async completion, representative device-speed delay and visit order cannot change authoritative results', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);

  const evidence = await page.evaluate(async () => {
    const Game = window.Game;
    const compute = Game.RelevanceBoundedCompute;
    const seed = String(Game.State.world.seed);
    const epoch = 'r02-cumulative-regression';
    const common = {
      authorityEpoch: epoch,
      priorCampaignMinutes: 100,
      meaningfulEvents: [{ id: 'event:market', kind: 'trade' }],
      persistentChanges: { checkpoint: 'cumulative' }
    };

    const olderJob = compute.prepare(seed, 7, -5, { ...common, targetCampaignMinutes: 200, authorityRevision: 2 });
    const newerJob = compute.prepare(seed, 7, -5, { ...common, targetCampaignMinutes: 300, authorityRevision: 3 });
    const [lateOlder, fastNewer] = await Promise.all([
      compute.computeAsync(olderJob, { delayMs: 25 }),
      compute.computeAsync(newerJob, { delayMs: 0 })
    ]);

    const initial = compute.initialCommitState(epoch);
    const acceptNewer = compute.acceptResult(initial, fastNewer);
    const rejectOlder = compute.acceptResult(acceptNewer.state, lateOlder);
    const syncNewer = compute.compute(newerJob);
    const slowDeviceNewer = await compute.computeAsync(newerJob, { delayMs: 35 });

    const aJob = compute.prepare(seed, -9, 4, { ...common, authorityEpoch: 'visit:a', targetCampaignMinutes: 500, authorityRevision: 5 });
    const bJob = compute.prepare(seed, 11, -8, { ...common, authorityEpoch: 'visit:b', targetCampaignMinutes: 500, authorityRevision: 5 });
    const visitAB = [compute.compute(aJob), compute.compute(bJob)];
    const visitBA = [compute.compute(bJob), compute.compute(aJob)];

    return {
      acceptNewer,
      rejectOlder,
      syncNewer,
      slowDeviceNewer,
      visitAB: visitAB.map((entry) => ({ regionX: entry.result.regionX, regionY: entry.result.regionY, fingerprint: entry.resultFingerprint })),
      visitBA: visitBA.map((entry) => ({ regionX: entry.result.regionX, regionY: entry.result.regionY, fingerprint: entry.resultFingerprint }))
    };
  });

  expect(evidence.acceptNewer.accepted).toBe(true);
  expect(evidence.rejectOlder.accepted).toBe(false);
  expect(evidence.rejectOlder.reason).toBe('stale-campaign-time');
  expect(evidence.syncNewer.resultFingerprint).toBe(evidence.slowDeviceNewer.resultFingerprint);
  expect(evidence.syncNewer.inputFingerprint).toBe(evidence.slowDeviceNewer.inputFingerprint);

  const normalize = (entries) => [...entries].sort((a, b) => `${a.regionX},${a.regionY}`.localeCompare(`${b.regionX},${b.regionY}`));
  expect(normalize(evidence.visitAB)).toEqual(normalize(evidence.visitBA));
  expect(failures).toEqual([]);
});

test('living map remains usable and authoritative state remains device-independent across responsive projects', async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    Game.GameTime.stop();
    Game.GameTime.setForTest(300);
    const dawn = Game.GameTime.capture();
    Game.GameTime.setForTest(1320);
    const night = Game.GameTime.capture();

    const viewportWidth = document.documentElement.clientWidth;
    const canvas = document.getElementById('gameCanvas')?.getBoundingClientRect();
    const center = document.getElementById('center-area')?.getBoundingClientRect();
    const controls = document.querySelector('[aria-label="Campaign persistence controls"]');
    const buttons = [...document.querySelectorAll('.persistence-tools button')].map((button) => ({
      name: button.getAttribute('aria-label') || button.textContent?.trim() || '',
      width: button.getBoundingClientRect().width,
      height: button.getBoundingClientRect().height
    }));
    const directControlApi = [Game.RegionTimeProgression, Game.NPCWorld].some((api) =>
      ['movePlayer', 'moveProtagonist', 'commandNpc', 'setPlayerRegion'].some((name) => typeof api?.[name] === 'function')
    );

    return {
      viewportWidth,
      scrollWidth: document.documentElement.scrollWidth,
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      center: center ? { width: center.width, height: center.height } : null,
      persistenceLabel: controls?.getAttribute('aria-label') || null,
      buttons,
      dawn: { authority: dawn.authority, phase: dawn.phase, daylight: dawn.daylight },
      night: { authority: night.authority, phase: night.phase, daylight: night.daylight },
      directControlApi
    };
  });

  expect(['desktop', 'tablet', 'phone-portrait', 'phone-landscape']).toContain(testInfo.project.name);
  expect(evidence.scrollWidth).toBeLessThanOrEqual(evidence.viewportWidth + 2);
  expect(evidence.canvas?.width || 0).toBeGreaterThan(100);
  expect(evidence.canvas?.height || 0).toBeGreaterThan(100);
  expect(evidence.center?.width || 0).toBeGreaterThan(100);
  expect(evidence.center?.height || 0).toBeGreaterThan(100);
  expect(evidence.persistenceLabel).toBe('Campaign persistence controls');
  expect(evidence.buttons.length).toBeGreaterThanOrEqual(3);
  for (const button of evidence.buttons) {
    expect(button.name).toBeTruthy();
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
  }
  expect(evidence.dawn).toEqual({ authority: 'simulation', phase: 'daylight', daylight: true });
  expect(evidence.night).toEqual({ authority: 'simulation', phase: 'night', daylight: false });
  expect(evidence.directControlApi).toBe(false);
  expect(failures).toEqual([]);
});
