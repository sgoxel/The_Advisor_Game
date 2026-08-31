import { test, expect } from '@playwright/test';

async function ready(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCMotionPresentation?.presentationPosition &&
    window.Game?.NPCSpatial?.updateAt &&
    window.Game?.CharacterAge?.deriveFromSeed &&
    window.Game?.State?.world?.npcs?.length
  ), null, { timeout: 20_000 });
  return { pageErrors, consoleErrors };
}

function clean(errors) {
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors.filter((line) => !/favicon/i.test(line))).toEqual([]);
}

test('age-aware tile duration is deterministic and bounded from 0.5s to 4.0s', async ({ page }) => {
  const errors = await ready(page);
  const result = await page.evaluate(() => {
    const api = window.Game.NPCMotionPresentation;
    const samples = [
      { age: 15, stage: 'adolescent', id: '' },
      { age: 22, stage: 'young-adult', id: 'young-a' },
      { age: 38, stage: 'adult', id: 'adult-a' },
      { age: 58, stage: 'mature-adult', id: 'mature-a' },
      { age: 78, stage: 'older-adult', id: 'older-a' },
      { age: 100, stage: 'older-adult', id: '' }
    ];
    return {
      min: api.minTileMs,
      max: api.maxTileMs,
      values: samples.map((sample) => api.tileDurationMsForAge(sample.age, sample.stage, sample.id)),
      repeat: api.tileDurationMsForAge(58, 'mature-adult', 'mature-a')
    };
  });
  expect(result.min).toBe(500);
  expect(result.max).toBe(4000);
  expect(result.values[0]).toBe(500);
  expect(result.values.at(-1)).toBe(4000);
  expect(result.values.every((value) => value >= 500 && value <= 4000)).toBe(true);
  expect(result.repeat).toBe(result.values[3]);
  expect(result.values[4]).toBeGreaterThan(result.values[2]);
  clean(errors);
});

test('presentation interpolation never fractionalizes authoritative occupancy', async ({ page }) => {
  const errors = await ready(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.NPCMotionPresentation;
    const npc = window.Game.State.world.npcs[0];
    const original = { row: npc.row, col: npc.col, decision: npc.movementDecision };
    api.observe(1000);
    const candidates = [
      { row: original.row, col: original.col + 1 },
      { row: original.row + 1, col: original.col },
      { row: original.row, col: original.col - 1 },
      { row: original.row - 1, col: original.col }
    ].filter((p) => p.row >= 0 && p.row < 100 && p.col >= 0 && p.col < 100);
    const next = candidates[0];
    npc.row = next.row;
    npc.col = next.col;
    npc.movementDecision = 'move';
    api.observe(1100);
    const duration = api.durationForNpc(npc);
    const midpoint = api.presentationPosition(npc, 1100 + duration / 2);
    const authoritative = { row: npc.row, col: npc.col };
    npc.row = original.row;
    npc.col = original.col;
    npc.movementDecision = original.decision;
    api.observe(7000);
    return { original, next, midpoint, authoritative, duration };
  });
  expect(Number.isInteger(evidence.authoritative.row)).toBe(true);
  expect(Number.isInteger(evidence.authoritative.col)).toBe(true);
  expect(evidence.midpoint.row).toBeCloseTo((evidence.original.row + evidence.next.row) / 2, 5);
  expect(evidence.midpoint.col).toBeCloseTo((evidence.original.col + evidence.next.col) / 2, 5);
  expect(evidence.duration).toBeGreaterThanOrEqual(500);
  expect(evidence.duration).toBeLessThanOrEqual(4000);
  clean(errors);
});

test('hold/yield and large gaps snap presentation to the authoritative tile', async ({ page }) => {
  const errors = await ready(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.NPCMotionPresentation;
    const npc = window.Game.State.world.npcs[1];
    const original = { row: npc.row, col: npc.col, decision: npc.movementDecision };
    api.observe(100);
    npc.col = Math.min(99, original.col + 1);
    if (npc.col === original.col) npc.col = Math.max(0, original.col - 1);
    npc.movementDecision = 'yield-wait';
    api.observe(200);
    const yieldPosition = api.presentationPosition(npc, 300);
    npc.movementDecision = 'move';
    api.observe(5000);
    const gapPosition = api.presentationPosition(npc, 5000);
    const authoritative = { row: npc.row, col: npc.col };
    npc.row = original.row;
    npc.col = original.col;
    npc.movementDecision = original.decision;
    return { yieldPosition, gapPosition, authoritative };
  });
  expect(evidence.yieldPosition).toEqual(evidence.authoritative);
  expect(evidence.gapPosition).toEqual(evidence.authoritative);
  clean(errors);
});
