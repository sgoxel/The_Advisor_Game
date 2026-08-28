import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.GameTime?.capture && window.Game?.State?.world?.gameTime));
  await page.evaluate(() => window.Game.GameTime.stop());
}

test('normal speed maps 60 real minutes to exactly 24 game hours', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.GameTime;
    api.setForTest(0);
    const before = api.capture();
    api.advanceRealMilliseconds(60 * 60 * 1000);
    return { before, after: api.capture(), speed: api.normalSpeed };
  });
  expect(evidence.before.totalGameMinutes).toBe(0);
  expect(evidence.after.totalGameMinutes).toBe(1440);
  expect(evidence.after.day).toBe(2);
  expect(evidence.speed.realMillisecondsPerGameHour).toBe(150000);
});

test('05:00 begins daylight and 22:00 begins night', async ({ page }) => {
  await ready(page);
  const phases = await page.evaluate(() => {
    const api = window.Game.GameTime;
    const at = (minute) => { api.setForTest(minute); return api.capture(); };
    return { preDawn: at(299), dawn: at(300), preNight: at(1319), night: at(1320) };
  });
  expect(phases.preDawn.phase).toBe('night');
  expect(phases.preDawn.daylight).toBe(false);
  expect(phases.dawn.phase).toBe('daylight');
  expect(phases.dawn.daylight).toBe(true);
  expect(phases.preNight.phase).toBe('daylight');
  expect(phases.night.phase).toBe('night');
});

test('deterministic elapsed-time inputs yield identical authoritative state', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.GameTime;
    const run = () => {
      api.setForTest(480);
      for (const elapsed of [250, 1000, 30000, 118750]) api.advanceRealMilliseconds(elapsed);
      return api.capture();
    };
    return { first: run(), second: run() };
  });
  expect(evidence.first).toEqual(evidence.second);
  expect(evidence.first.authority).toBe('simulation');
});

test('clock state validates/restores without rendering authority', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.GameTime;
    api.setForTest(4319.5);
    const saved = api.capture();
    api.setForTest(0);
    const restored = api.restore(saved);
    const invalid = api.restore({ authority: 'renderer', totalGameMinutes: 1 });
    return { saved, restored, invalid, runtime: window.Game.State.world.gameTime };
  });
  expect(evidence.restored.ok).toBe(true);
  expect(evidence.runtime.totalGameMinutes).toBe(evidence.saved.totalGameMinutes);
  expect(evidence.runtime.authority).toBe('simulation');
  expect(evidence.invalid.ok).toBe(false);
});