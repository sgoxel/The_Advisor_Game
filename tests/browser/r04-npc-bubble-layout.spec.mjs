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
      // authoritative. Build one legal pair, then exercise dense presentation.
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
      world.npcDialogues = [{ authority: 'presentation-context', authoritativeFact: false, speakerId: speaker.id, listenerId: listener.id, line, adjacent: true }];

      // #351 limits activity-detail drawing to currently relevant NPCs. This fixture
      // overrides projection only after relevance state may already be cached, so establish
      // one explicit non-dialogue interaction-critical NPC through the scheduling contract.
      // The existing >0 activity assertion stays meaningful without bypassing relevance.
      const activityCritical = npcs[2];
      activityCritical.interactionCritical = true;
      Game.NPCRelevanceRuntime?.markAuthoritativeUpdated?.(
        activityCritical,
        Game.GameTime.capture?.()?.totalGameMinutes ?? 0
      );

      const before = JSON.stringify({
        npcs: Game.State.world.npcs.map((npc) => ({ id: npc.id, row: npc.row, col: npc.col, activity: npc.activity, movementDecision: npc.movementDecision, dialogueWith: npc.dialogueWith, dialogueLine: npc.dialogueLine })),
        dialogues: Game.State.world.npcDialogues
      });

      const originalGridToScreen = Game.Renderer.gridToScreen;
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      Game.Renderer.gridToScreen = function denseProjection(row, col, ...rest) {
        const base = originalGridToScreen.call(this, row, col, ...rest);
        const r = Math.trunc(Number(row) || 0);
        const c = Math.trunc(Number(col) || 0);
        const isSpeaker = r === pairTiles[0].row && c === pairTiles[0].col;
        const isListener = r === pairTiles[1].row && c === pairTiles[1].col;
        if (isSpeaker || isListener) {
          return {
            ...base,
            x: width * 0.5 + (isSpeaker ? -28 : 28),
            y: height * 0.78
          };
        }

        // Keep the population deliberately dense in one lower-screen band while
        // preserving real vertical slack above protected character rectangles.
        // This exercises deterministic bubble suppression/placement instead of an
        // impossible fixture where protected icons occupy every candidate height.
        const hash = Math.abs((r * 73856093) ^ (c * 19349663));
        const columns = width <= 480 ? 3 : (width <= 900 ? 5 : 8);
        const laneX = hash % columns;
        const spanX = Math.min(width * 0.78, columns * 104);
        return {
          ...base,
          x: width * 0.5 - spanX * 0.5 + (columns === 1 ? 0 : laneX * spanX / (columns - 1)),
          y: height * 0.8 + ((Math.floor(hash / columns) % 3) - 1) * 7
        };
      };

      try {
        Game.NPCBubbleLayout.draw();
      } finally {
        Game.Renderer.gridToScreen = originalGridToScreen;
      }

      const after = JSON.stringify({
        npcs: Game.State.world.npcs.map((npc) => ({ id: npc.id, row: npc.row, col: npc.col, activity: npc.activity, movementDecision: npc.movementDecision, dialogueWith: npc.dialogueWith, dialogueLine: npc.dialogueLine })),
        dialogues: Game.State.world.npcDialogues
      });
      const layout = Game.NPCBubbleLayout.snapshot();
      return {
        before, after, layout,
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

    const diagnostic = JSON.stringify({
      viewport,
      populationCount: evidence.populationCount,
      dialogueCount: evidence.dialogueCount,
      dataset: evidence.dataset,
      pointerEvents: evidence.pointerEvents,
      layout: evidence.layout ? {
        authority: evidence.layout.authority,
        overlapCount: evidence.layout.overlapCount,
        maximumActivityBubbles: evidence.layout.maximumActivityBubbles,
        suppressedIds: evidence.layout.suppressedIds,
        boxCount: evidence.layout.boxes?.length,
        viewport: evidence.layout.viewport
      } : null,
      pageErrors: errors.pageErrors,
      consoleErrors: errors.consoleErrors
    });

    expect(evidence.before, diagnostic).toBe(evidence.after);
    expect(evidence.layout, diagnostic).not.toBeNull();
    expect(evidence.layout.authority, diagnostic).toBe('presentation-only');
    expect(evidence.layout.overlapCount, diagnostic).toBe(0);
    expect(evidence.dataset.overlapCount, diagnostic).toBe(0);
    expect(evidence.dataset.version, diagnostic).toBe('r04-npc-activity-bubble-layout-v1');
    expect(evidence.dataset.authority, diagnostic).toBe('presentation-only');
    expect(evidence.pointerEvents, diagnostic).toBe('none');
    expect(evidence.populationCount, diagnostic).toBeGreaterThanOrEqual(20);
    expect(evidence.dataset.npcCount, diagnostic).toBeGreaterThanOrEqual(20);
    expect(evidence.dialogueCount, diagnostic).toBe(1);
    expect(evidence.dataset.dialoguePairCount, diagnostic).toBe(1);
    expect(evidence.dataset.activityBubbleCount, diagnostic).toBeGreaterThan(0);
    expect(evidence.dataset.activityBubbleCount, diagnostic).toBeLessThanOrEqual(evidence.layout.maximumActivityBubbles);
    expect(evidence.dataset.suppressedCount, diagnostic).toBeGreaterThan(0);
    expect(evidence.dataset.suppressedCount, diagnostic).toBe(evidence.layout.suppressedIds.length);

    for (const box of evidence.layout.boxes) {
      expect(box.rect.left, diagnostic).toBeGreaterThanOrEqual(0);
      expect(box.rect.top, diagnostic).toBeGreaterThanOrEqual(0);
      expect(box.rect.right, diagnostic).toBeLessThanOrEqual(evidence.layout.viewport.width);
      expect(box.rect.bottom, diagnostic).toBeLessThanOrEqual(evidence.layout.viewport.height);
    }
    for (let i = 0; i < evidence.layout.boxes.length; i += 1) {
      for (let j = i + 1; j < evidence.layout.boxes.length; j += 1) {
        expect(intersects(evidence.layout.boxes[i].rect, evidence.layout.boxes[j].rect), `${evidence.layout.boxes[i].id} overlaps ${evidence.layout.boxes[j].id}; ${diagnostic}`).toBe(false);
      }
    }

    expect(errors.pageErrors, `page errors: ${errors.pageErrors.join('\n')}; ${diagnostic}`).toEqual([]);
    expect(errors.consoleErrors.filter((line) => !/favicon/i.test(line)), `console errors: ${errors.consoleErrors.join('\n')}; ${diagnostic}`).toEqual([]);
  });
}
