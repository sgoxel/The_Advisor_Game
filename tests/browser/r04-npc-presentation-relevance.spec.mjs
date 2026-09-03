import { test, expect } from '@playwright/test';

async function ready(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCBubbleLayout?.installed &&
    window.Game?.NPCWorld?.drawPresentation &&
    window.Game?.Renderer?.gridToScreen &&
    Array.isArray(window.Game?.State?.world?.npcs) &&
    window.Game.State.world.npcs.length >= 12
  ), null, { timeout: 20_000 });
  return { pageErrors, consoleErrors };
}

test('offscreen NPC labels are culled instead of clamped to viewport edges while visible identity stays stable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await ready(page);

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const world = Game.State.world;
    const npc = world.npcs[0];
    const visibleNpc = world.npcs[1];
    const originalGridToScreen = Game.Renderer.gridToScreen;
    const authoritativeBefore = world.npcs.map((entry) => ({ id: entry.id, row: entry.row, col: entry.col, activity: entry.activity }));
    const overlay = document.getElementById('npcWorldOverlay');
    const rect = overlay.getBoundingClientRect();

    Game.Renderer.gridToScreen = function relevanceFixture(row, col, ...rest) {
      if (Math.trunc(Number(row)) === Math.trunc(Number(npc.row)) && Math.trunc(Number(col)) === Math.trunc(Number(npc.col))) {
        return { x: rect.width + 360, y: rect.height / 2 };
      }
      if (Math.trunc(Number(row)) === Math.trunc(Number(visibleNpc.row)) && Math.trunc(Number(col)) === Math.trunc(Number(visibleNpc.col))) {
        return { x: rect.width / 2, y: rect.height / 2 };
      }
      return originalGridToScreen.call(Game.Renderer, row, col, ...rest);
    };

    const snapshots = [];
    try {
      for (let i = 0; i < 30; i += 1) {
        Game.NPCBubbleLayout.draw();
        snapshots.push(Game.NPCBubbleLayout.snapshot());
      }
    } finally {
      Game.Renderer.gridToScreen = originalGridToScreen;
    }

    const authoritativeAfter = world.npcs.map((entry) => ({ id: entry.id, row: entry.row, col: entry.col, activity: entry.activity }));
    return {
      npcId: npc.id,
      visibleNpcId: visibleNpc.id,
      width: rect.width,
      snapshots,
      authoritativeBefore,
      authoritativeAfter,
      datasetCulled: Number(overlay.dataset.activityBubbleCulledCount || 0)
    };
  });

  expect(evidence.snapshots).toHaveLength(30);
  for (const snapshot of evidence.snapshots) {
    expect(snapshot.version).toBe('r04-npc-activity-bubble-layout-v2-relevance-cull');
    expect(snapshot.culledIds).toContain(evidence.npcId);
    expect(snapshot.cullReasons[evidence.npcId]).toBe('outside-viewport-relevance-envelope');
    expect(snapshot.boxes.some((box) => box.id === evidence.npcId)).toBe(false);
    expect(snapshot.boxes.some((box) => box.id === evidence.visibleNpcId)).toBe(true);
    for (const box of snapshot.boxes) {
      expect(box.rect.left).toBeGreaterThanOrEqual(0);
      expect(box.rect.right).toBeLessThanOrEqual(evidence.width);
    }
  }
  expect(evidence.datasetCulled).toBeGreaterThanOrEqual(1);
  expect(evidence.authoritativeAfter).toEqual(evidence.authoritativeBefore);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});
