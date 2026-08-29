import { test, expect } from '@playwright/test';

async function waitForNpcTimeRuntime(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.GameTime?.setForTest &&
    window.Game?.NPCSpatial?.updateAt &&
    window.Game?.NPCSpatial?.capture &&
    window.Game?.State?.world?.originVillage?.population?.length
  ), null, { timeout: 20_000 });
}

function compactNpcState(npcs) {
  return npcs.map((npc) => ({
    id: npc.id,
    row: npc.row,
    col: npc.col,
    activity: npc.activity,
    yielded: Boolean(npc.yielded)
  }));
}

test('NPC routines are driven by authoritative Game.GameTime, not a seconds-long demo loop', async ({ page }) => {
  await waitForNpcTimeRuntime(page);

  const evidence = await page.evaluate(async () => {
    const Game = window.Game;
    Game.GameTime.stop();
    const source = await (await fetch('js/npc_spatial_runtime.js')).text();
    const speed = Game.GameTime.normalSpeed;
    const representativeMinutes = [
      8 * 60,
      12 * 60,
      18 * 60,
      23 * 60
    ];
    const snapshots = [];

    for (const minuteOfDay of representativeMinutes) {
      Game.GameTime.setForTest(minuteOfDay);
      // The legacy argument must not become an independent routine clock. Two wildly
      // different values at the same authoritative game time must resolve identically.
      Game.NPCSpatial.updateAt(0);
      const first = Game.NPCSpatial.capture();
      Game.NPCSpatial.updateAt(987654321);
      const second = Game.NPCSpatial.capture();
      snapshots.push({
        minuteOfDay,
        first,
        second,
        sameAuthoritativeTimeStable: JSON.stringify(first) === JSON.stringify(second),
        uniqueTileCount: new Set(first.map((npc) => `${npc.row},${npc.col}`)).size,
        populationCount: first.length
      });
    }

    const compactHashes = snapshots.map(({ first }) => JSON.stringify(first.map((npc) => ({
      id: npc.id,
      row: npc.row,
      col: npc.col,
      activity: npc.activity
    }))));

    return {
      realMillisecondsPerGameHour: Number(speed?.realMillisecondsPerGameHour || 0),
      realMillisecondsPerGameDay: Number(speed?.realMillisecondsPerGameHour || 0) * 24,
      sourceUsesGameTime: source.includes('Game.GameTime') || source.includes('world.gameTime'),
      legacySecondsCycleRemoved: !/CYCLE_MS\s*=\s*24000/.test(source),
      sourceDoesNotModuloRoutineByLegacyCycle: !source.includes('% CYCLE_MS'),
      snapshots: snapshots.map((entry) => ({
        minuteOfDay: entry.minuteOfDay,
        sameAuthoritativeTimeStable: entry.sameAuthoritativeTimeStable,
        uniqueTileCount: entry.uniqueTileCount,
        populationCount: entry.populationCount
      })),
      distinctRepresentativeStates: new Set(compactHashes).size
    };
  });

  expect(evidence.realMillisecondsPerGameHour).toBe(150000);
  expect(evidence.realMillisecondsPerGameDay).toBe(3600000);
  expect(evidence.sourceUsesGameTime).toBe(true);
  expect(evidence.legacySecondsCycleRemoved).toBe(true);
  expect(evidence.sourceDoesNotModuloRoutineByLegacyCycle).toBe(true);
  expect(evidence.distinctRepresentativeStates).toBeGreaterThanOrEqual(3);

  for (const snapshot of evidence.snapshots) {
    expect(snapshot.sameAuthoritativeTimeStable).toBe(true);
    expect(snapshot.populationCount).toBeGreaterThanOrEqual(20);
    expect(snapshot.uniqueTileCount).toBe(snapshot.populationCount);
  }
});

test('equivalent authoritative game time is frame/input elapsed independent', async ({ page }) => {
  await waitForNpcTimeRuntime(page);

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    Game.GameTime.stop();
    const target = 1 * 1440 + 16 * 60 + 30;

    Game.GameTime.setForTest(target);
    Game.NPCSpatial.updateAt(16);
    const atFastFrame = Game.NPCSpatial.capture().map((npc) => ({ id: npc.id, row: npc.row, col: npc.col, activity: npc.activity }));

    Game.GameTime.setForTest(target);
    Game.NPCSpatial.updateAt(5000);
    const atSlowFrame = Game.NPCSpatial.capture().map((npc) => ({ id: npc.id, row: npc.row, col: npc.col, activity: npc.activity }));

    return {
      same: JSON.stringify(atFastFrame) === JSON.stringify(atSlowFrame),
      unique: new Set(atSlowFrame.map((npc) => `${npc.row},${npc.col}`)).size,
      count: atSlowFrame.length
    };
  });

  expect(evidence.same).toBe(true);
  expect(evidence.unique).toBe(evidence.count);
});
