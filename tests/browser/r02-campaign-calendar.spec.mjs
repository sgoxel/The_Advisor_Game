import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.GameTime?.setForTest &&
    window.Game?.CampaignCalendar?.reconcileResume &&
    window.Game?.CampaignPersistence?.validateSave &&
    window.Game?.WorldDeltaPersistence?.capture
  ));
}

test('one real hour advances exactly one authoritative game day in one bounded operation', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const time = window.Game.GameTime;
    const calendar = window.Game.CampaignCalendar;
    time.stop();
    time.setForTest(480);
    const anchor = 1_800_000_000_000;
    calendar.checkpointRealTime(anchor);
    const before = calendar.capture();
    const resumed = calendar.reconcileResume(anchor + 3_600_000);
    const after = calendar.capture();
    return { before, resumed, after };
  });
  expect(evidence.resumed.ok).toBe(true);
  expect(evidence.resumed.advancedGameMinutes).toBe(1440);
  expect(evidence.resumed.elapsedGameDays).toBe(1);
  expect(evidence.resumed.operations).toBe(1);
  expect(evidence.resumed.fullDetailReplayTicks).toBe(0);
  expect(evidence.resumed.materializedOffscreenRegions).toBe(0);
  expect(evidence.after.totalGameMinutes - evidence.before.totalGameMinutes).toBe(1440);
  expect(evidence.after.calendar.dayIndex - evidence.before.calendar.dayIndex).toBe(1);
});

test('24 real hours advance exactly 24 game days without per-day replay', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const time = window.Game.GameTime;
    const calendar = window.Game.CampaignCalendar;
    time.stop();
    time.setForTest(1440 * 12 + 75);
    const anchor = 1_810_000_000_000;
    calendar.checkpointRealTime(anchor);
    const resumed = calendar.reconcileResume(anchor + 86_400_000);
    return { resumed, snapshot: calendar.capture() };
  });
  expect(evidence.resumed.advancedGameMinutes).toBe(34560);
  expect(evidence.resumed.elapsedGameDays).toBe(24);
  expect(evidence.resumed.operations).toBe(1);
  expect(evidence.resumed.fullDetailReplayTicks).toBe(0);
  expect(evidence.snapshot.calendar.dayIndex).toBe(36);
});

test('backward and invalid real-world observations never rewind campaign chronology', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const time = window.Game.GameTime;
    const calendar = window.Game.CampaignCalendar;
    time.stop();
    time.setForTest(5000);
    const anchor = 1_820_000_000_000;
    calendar.checkpointRealTime(anchor);
    const before = calendar.capture();
    const backward = calendar.reconcileResume(anchor - 60_000);
    const afterBackward = calendar.capture();
    const invalid = calendar.reconcileResume(-1);
    const afterInvalid = calendar.capture();
    return { before, backward, afterBackward, invalid, afterInvalid };
  });
  expect(evidence.backward.ok).toBe(false);
  expect(evidence.backward.code).toBe('BACKWARD_REAL_CLOCK');
  expect(evidence.backward.advancedGameMinutes).toBe(0);
  expect(evidence.afterBackward.totalGameMinutes).toBe(evidence.before.totalGameMinutes);
  expect(evidence.afterBackward.acceptedRealTimestampMs).toBe(evidence.before.acceptedRealTimestampMs);
  expect(evidence.invalid.ok).toBe(false);
  expect(evidence.invalid.code).toBe('INVALID_REAL_TIMESTAMP');
  expect(evidence.afterInvalid).toEqual(evidence.afterBackward);
});

test('save/load preserves calendar anchor and applies deterministic resume catch-up', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const time = window.Game.GameTime;
    const calendar = window.Game.CampaignCalendar;
    const persistence = window.Game.CampaignPersistence;
    const deltas = window.Game.WorldDeltaPersistence;
    time.stop();
    deltas.clearAll();
    time.setForTest(2880 + 300);
    const anchor = 1_830_000_000_000;
    const serialized = calendar.serializeSaveAt(anchor);
    const parsed = JSON.parse(serialized);
    time.setForTest(99999);
    const loaded = calendar.loadSaveAt(serialized, anchor + 3_600_000);
    return {
      envelope: parsed.campaignCalendarState,
      loadedOk: loaded.ok,
      catchUp: loaded.resumeCatchUp,
      restored: calendar.capture(),
      validated: persistence.validateSave(serialized).ok
    };
  });
  expect(evidence.envelope.authority).toBe('simulation');
  expect(evidence.envelope.acceptedRealTimestampMs).toBe(1_830_000_000_000);
  expect(evidence.loadedOk).toBe(true);
  expect(evidence.catchUp.ok).toBe(true);
  expect(evidence.catchUp.advancedGameMinutes).toBe(1440);
  expect(evidence.restored.totalGameMinutes).toBe(2880 + 300 + 1440);
  expect(evidence.restored.acceptedRealTimestampMs).toBe(1_830_003_600_000);
  expect(evidence.validated).toBe(true);
});

test('malformed calendar data is rejected before current campaign state mutates', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const time = window.Game.GameTime;
    const calendar = window.Game.CampaignCalendar;
    time.stop();
    time.setForTest(7777);
    const anchor = 1_840_000_000_000;
    const parsed = JSON.parse(calendar.serializeSaveAt(anchor));
    time.setForTest(8888);
    calendar.checkpointRealTime(anchor + 5000);
    const before = calendar.capture();
    parsed.campaignCalendarState.acceptedRealTimestampMs = -5;
    const result = calendar.loadSaveAt(JSON.stringify(parsed), anchor + 10_000);
    const after = calendar.capture();
    return { result, before, after };
  });
  expect(evidence.result.ok).toBe(false);
  expect(evidence.result.code).toBe('INVALID_REAL_TIMESTAMP');
  expect(evidence.after).toEqual(evidence.before);
});

test('legacy saves without calendar metadata remain loadable without fabricated elapsed time', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const time = window.Game.GameTime;
    const calendar = window.Game.CampaignCalendar;
    time.stop();
    time.setForTest(900);
    const current = JSON.parse(calendar.serializeSaveAt(1_850_000_000_000));
    delete current.campaignCalendarState;
    time.setForTest(1200);
    const loaded = calendar.loadSaveAt(JSON.stringify(current), 1_860_000_000_000);
    return { loaded, snapshot: calendar.capture() };
  });
  expect(evidence.loaded.ok).toBe(true);
  expect(evidence.loaded.resumeCatchUp.ok).toBe(true);
  expect(evidence.loaded.resumeCatchUp.initialized).toBe(true);
  expect(evidence.loaded.resumeCatchUp.advancedGameMinutes).toBe(0);
  expect(evidence.snapshot.acceptedRealTimestampMs).toBe(1_860_000_000_000);
});
