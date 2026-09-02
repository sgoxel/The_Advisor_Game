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
    window.Game?.NPCSpatial?.updateAt &&
    window.Game?.NPCWorld?.drawPresentation &&
    window.Game?.Renderer?.gridToScreen &&
    window.Game?.State?.world?.originVillage?.population?.length >= 20
  ), null, { timeout: 20_000 });
  return { pageErrors, consoleErrors };
}

function intersects(a, b) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 }
]) {
  test(`dense NPC activity bubbles stay bounded, non-overlapping and presentation-only on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const errors = await ready(page);

    const evidence = await page.evaluate(() => {
      const Game = window.Game;
      Game.GameTime.stop();
      Game.GameTime.setForTest(18 * 60);
      Game.NPCSpatial.updateAt();
      Game.Renderer.renderWorld(true);

      const world = Game.State.world;
      const overlay = document.getElementById('npcWorldOverlay');
      const rect = overlay.getBoundingClientRect();

      // #347 requires a real reciprocal adjacent pair before direct Chatting is
      // authoritative. This layout regression must not depend on a particular
      // routine/relevance timing slice to manufacture one. Build a legal pair from
      // two currently active NPCs on two free adjacent road tiles, then snapshot the
      // authoritative fixture before exercising presentation-only layout.
      const npcs = world.npcs;
      const speaker = npcs[0];
      const listener = npcs[1];
      const occupiedByOthers = new Set(npcs.slice(2).map((npc) => `${Math.trunc(Number(npc.row))},${Math.trunc(Number(npc.col))}`));
      const roads = new Set((world.originVillage?.roadTiles || []).map((p) => `${Math.trunc(Number(p.row))},${Math.trunc(Number(p.col))}`));
      let pairTiles = null;
      for (const key of roads) {
        if (occupiedByOthers.has(key)) continue;
        const [rowText, colText] = key.split(',');
        const row = Number(rowText), col = Number(colText);
        for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
          const neighborKey = `${row + dr},${col + dc}`;
          if (!roads.has(neighborKey) || occupiedByOthers.has(neighborKey)) continue;
          pairTiles = [{ row, col }, { row: row + dr, col: col + dc }];
          break;
        }
        if (pairTiles) break;
      }
      if (!pairTiles) throw new Error('Unable to construct adjacent free road pair for bubble-layout fixture.');

      speaker.row = pairTiles[0].row;
      speaker.col = pairTiles[0].col;
      listener.row = pairTiles[1].row;
      listener.col = pairTiles[1].col;
      speaker.activity = 'talking';
      listener.activity = 'talking';
      speaker.movementDecision = 'dialogue-position';
      listener.movementDecision = 'dialogue-position';
      speaker.dialogueWith = listener.id;
      listener.dialogueWith = speaker.id;
      const line = `${speaker.name} and ${listener.name} are talking.`;
      speaker.dialogueLine = line;
      listener.dialogueLine = line;
      world.npcDialogues = [{
        authority: 'presentation-context',
        authoritativeFact: false,
        speakerId: speaker.id,
        listenerId: listener.id,
        line,
        adjacent: true
      }];

      const before = JSON.stringify({
        npcs: Game.State.world.npcs.map((npc) => ({
          id: npc.id,
          row: npc.row,
          col: npc.col,
          activity: npc.activity,
          movementDecision: npc.movementDecision,
          dialogueWith: npc.dialogueWith,
          dialogueLine: npc.dialogueLine
        })),
        dialogues: Game.State.world.npcDialogues
      });

      const originalGridToScreen = Game.Renderer.gridToScreen;
      const centerX = Math.max(100, rect.width * 0.50);
      const centerY = Math.max(100, rect.height * 0.52);
      Game.Renderer.gridToScreen = function denseProjection(row, col, ...rest) {
        const base = originalGridToScreen.call(this, row, col, ...rest);
        const r = Math.trunc(Number(row) || 0);
        const c = Math.trunc(Number(col) || 0);
        return {
          ...base,
          x: centerX + (((r * 17 + c * 11) % 7) - 3) * 3,
          y: centerY + (((r * 13 + c * 19) % 7) - 3) * 3
        };
      };

      try {
        Game.NPCBubbleLayout.draw();
      } finally {
        Game.Renderer.gridToScreen = originalGridToScreen;
      }

      const after = JSON.stringify({
        npcs: Game.State.world.npcs.map((npc) => ({
          id: npc.id,
          row: npc.row,
          col: npc.col,
          activity: npc.activity,
          movementDecision: npc.movementDecision,
          dialogueWith: npc.dialogueWith,
          dialogueLine: npc.dialogueLine
        })),
        dialogues: Game.State.world.npcDialogues
      });
      const layout = Game.NPCBubbleLayout.snapshot();
      return {
        before,
        after,
        layout,
        populationCount: Game.State.world.npcs.length,
        dialogueCount: Game.State.world.npcDialogues?.length || 0,
        dataset: {
          activityBubbleCount: Number(overlay.dataset.activityBubbleCount || 0),
          dialoguePairCount: Number(overlay.dataset.dialoguePairCount || 0),
          suppressedCount: Number(overlay.dataset.activityBubbleSuppressedCount || 0),
          overlapCount: Number(overlay.dataset.bubbleLayoutOverlapCount || -1),
          version: overlay.dataset.bubbleLayoutVersion,
          authority: overlay.dataset.debugPresentationAuthority,
          npcCount: Number(overlay.dataset.npcCount || 0)
        },
        pointerEvents: getComputedStyle(overlay).pointerEvents
      };
    });

    expect(evidence.before).toBe(evidence.after);
    expect(evidence.layout).not.toBeNull();
    expect(evidence.layout.authority).toBe('presentation-only');
    expect(evidence.layout.overlapCount).toBe(0);
    expect(evidence.dataset.overlapCount).toBe(0);
    expect(evidence.dataset.version).toBe('r04-npc-activity-bubble-layout-v1');
    expect(evidence.dataset.authority).toBe('presentation-only');
    expect(evidence.pointerEvents).toBe('none');
    expect(evidence.populationCount).toBeGreaterThanOrEqual(20);
    expect(evidence.dataset.npcCount).toBeGreaterThanOrEqual(20);
    expect(evidence.dialogueCount).toBe(1);
    expect(evidence.dataset.dialoguePairCount).toBe(1);
    expect(evidence.dataset.activityBubbleCount).toBeGreaterThan(0);
    expect(evidence.dataset.activityBubbleCount).toBeLessThanOrEqual(evidence.layout.maximumActivityBubbles);
    expect(evidence.dataset.suppressedCount).toBeGreaterThan(0);
    expect(evidence.dataset.suppressedCount).toBe(evidence.layout.suppressedIds.length);

    for (const box of evidence.layout.boxes) {
      expect(box.rect.left).toBeGreaterThanOrEqual(0);
      expect(box.rect.top).toBeGreaterThanOrEqual(0);
      expect(box.rect.right).toBeLessThanOrEqual(evidence.layout.viewport.width);
      expect(box.rect.bottom).toBeLessThanOrEqual(evidence.layout.viewport.height);
    }
    for (let i = 0; i < evidence.layout.boxes.length; i += 1) {
      for (let j = i + 1; j < evidence.layout.boxes.length; j += 1) {
        expect(intersects(evidence.layout.boxes[i].rect, evidence.layout.boxes[j].rect), `${evidence.layout.boxes[i].id} overlaps ${evidence.layout.boxes[j].id}`).toBe(false);
      }
    }

    expect(errors.pageErrors, `page errors: ${errors.pageErrors.join('\n')}`).toEqual([]);
    expect(errors.consoleErrors.filter((line) => !/favicon/i.test(line)), `console errors: ${errors.consoleErrors.join('\n')}`).toEqual([]);
  });
}
