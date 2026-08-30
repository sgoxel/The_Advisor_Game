import { test, expect } from '@playwright/test';

function road() {
  return { type: 'road', tags: ['road'] };
}

function grass() {
  return { type: 'grass', tags: [] };
}

function grid(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => grass()));
}

async function loadClassifier(page) {
  await page.goto('./');
  await page.addScriptTag({ url: './js/main_road_semantics.js' });
  await page.waitForFunction(() => Boolean(window.Game?.MainRoadSemantics));
}

test('classifies sustained horizontal and vertical road pairs without mutating topology', async ({ page }) => {
  await loadClassifier(page);
  const result = await page.evaluate(({ horizontal, vertical }) => {
    const classify = window.Game.MainRoadSemantics.classify;
    const hBefore = JSON.stringify(horizontal);
    const vBefore = JSON.stringify(vertical);
    const h = classify(horizontal);
    const v = classify(vertical);
    return {
      h,
      v,
      hUnchanged: JSON.stringify(horizontal) === hBefore,
      vUnchanged: JSON.stringify(vertical) === vBefore
    };
  }, (() => {
    const horizontal = grid(6, 8);
    for (let col = 1; col <= 5; col += 1) {
      horizontal[2][col] = road();
      horizontal[3][col] = road();
    }
    const vertical = grid(8, 6);
    for (let row = 1; row <= 5; row += 1) {
      vertical[row][2] = road();
      vertical[row][3] = road();
    }
    return { horizontal, vertical };
  })());

  expect(result.hUnchanged).toBe(true);
  expect(result.vUnchanged).toBe(true);
  expect(result.h.segments).toHaveLength(1);
  expect(result.h.segments[0]).toMatchObject({ orientation: 'horizontal', length: 5 });
  expect(result.h.cells['2,1'].memberships[0].longitudinalRole).toBe('start');
  expect(result.h.cells['2,3'].memberships[0].longitudinalRole).toBe('middle');
  expect(result.h.cells['2,5'].memberships[0].longitudinalRole).toBe('end');
  expect(result.v.segments).toHaveLength(1);
  expect(result.v.segments[0]).toMatchObject({ orientation: 'vertical', length: 5 });
});

test('rejects accidental adjacency and ambiguous three-lane runs', async ({ page }) => {
  await loadClassifier(page);
  const result = await page.evaluate(({ shortPair, threeWide }) => ({
    shortPair: window.Game.MainRoadSemantics.classify(shortPair),
    threeWide: window.Game.MainRoadSemantics.classify(threeWide)
  }), (() => {
    const shortPair = grid(5, 5);
    for (let col = 1; col <= 2; col += 1) {
      shortPair[1][col] = road();
      shortPair[2][col] = road();
    }
    const threeWide = grid(6, 7);
    for (let col = 1; col <= 5; col += 1) {
      threeWide[1][col] = road();
      threeWide[2][col] = road();
      threeWide[3][col] = road();
    }
    return { shortPair, threeWide };
  })());

  expect(result.shortPair.segments).toHaveLength(0);
  expect(Object.keys(result.shortPair.cells)).toHaveLength(0);
  expect(result.threeWide.segments).toHaveLength(0);
  expect(Object.keys(result.threeWide.cells)).toHaveLength(0);
});

test('represents supported crossing/intersection semantics deterministically', async ({ page }) => {
  await loadClassifier(page);
  const result = await page.evaluate((terrain) => {
    const first = window.Game.MainRoadSemantics.classify(terrain);
    const second = window.Game.MainRoadSemantics.classify(terrain);
    return { first, second, same: JSON.stringify(first) === JSON.stringify(second) };
  }, (() => {
    const terrain = grid(9, 9);
    for (let col = 1; col <= 7; col += 1) {
      terrain[3][col] = road();
      terrain[4][col] = road();
    }
    for (let row = 1; row <= 7; row += 1) {
      terrain[row][3] = road();
      terrain[row][4] = road();
    }
    return terrain;
  })());

  expect(result.same).toBe(true);
  expect(result.first.cells['3,3']?.kind).toBe('main-road-intersection');
  expect(result.first.cells['3,3']?.orientation).toBe('cross');
  expect(result.first.cells['3,3']?.memberships).toHaveLength(2);
});
