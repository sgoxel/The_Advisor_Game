import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCContextualActivity?.semanticActivity &&
    window.Game?.NPCContextualActivity?.snapshot &&
    window.Game?.NPCBubbleLayout?.draw &&
    window.Game?.Renderer?.renderWorld &&
    Array.isArray(window.Game?.State?.world?.npcs) &&
    window.Game.State.world.npcs.length > 0
  ), null, { timeout: 20_000 });
}

test('generic routine states resolve to deterministic profession/context activities', async ({ page }) => {
  await ready(page);
  const labels = await page.evaluate(() => {
    const semantic = window.Game.NPCContextualActivity.semanticActivity;
    return {
      baker: semantic({ occupation: 'baker', activity: 'working', movementDecision: 'hold' }),
      blacksmith: semantic({ occupation: 'blacksmith', activity: 'working', movementDecision: 'hold' }),
      miller: semantic({ occupation: 'miller', activity: 'working', movementDecision: 'hold' }),
      farmer: semantic({ occupation: 'farmer', activity: 'working', movementDecision: 'hold' }),
      woodcutter: semantic({ occupation: 'woodcutter', activity: 'working', movementDecision: 'hold' }),
      hunter: semantic({ occupation: 'hunter', activity: 'working', movementDecision: 'hold' }),
      moving: semantic({ occupation: 'baker', activity: 'working', movementDecision: 'move' }),
      talking: semantic({ occupation: 'trader', activity: 'talking', dialogueWith: 'npc-2', movementDecision: 'hold' }),
      sleeping: semantic({ occupation: 'villager', activity: 'home', dailySchedule: { activity: 'sleeping' }, movementDecision: 'hold' }),
      social: semantic({ occupation: 'villager', activity: 'social', movementDecision: 'hold' }),
      errand: semantic({ occupation: 'villager', activity: 'local-errand', movementDecision: 'hold' })
    };
  });
  expect(labels).toEqual({ baker: 'Baking', blacksmith: 'Forging', miller: 'Milling', farmer: 'Checking Crops', woodcutter: 'Cutting Woods', hunter: 'Hunting', moving: 'Walking', talking: 'Waiting', sleeping: 'Sleeping', social: 'Socializing', errand: 'Running Errands' });
});

test('contextual bubble pass preserves authoritative NPC objects and replaces generic working presentation', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await ready(page);

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const npcs = Game.State.world.npcs;
    // #351 limits expensive activity detail to relevant NPCs. This presentation fixture
    // deliberately changes projection, so establish one explicit interaction-critical NPC
    // through the public relevance metadata contract before the draw assertions run.
    const activityCritical = npcs.find((npc) => !npc.dialogueWith) || npcs[0];
    activityCritical.interactionCritical = true;
    Game.NPCRelevanceRuntime?.markAuthoritativeUpdated?.(
      activityCritical,
      Game.GameTime?.capture?.()?.totalGameMinutes ?? 0
    );
    Game.Renderer.renderWorld(true);
    const references = npcs.slice();
    const before = JSON.stringify(npcs.map((npc) => ({ id: npc.id, row: npc.row, col: npc.col, activity: npc.activity, occupation: npc.occupation, movementDecision: npc.movementDecision, dialogueWith: npc.dialogueWith })));

    const renderer = Game.Renderer;
    const originalGridToScreen = renderer.gridToScreen;
    const overlay = document.getElementById('npcWorldOverlay');
    const rect = overlay?.getBoundingClientRect?.() || { width: innerWidth, height: innerHeight };
    const width = Math.max(1, Number(rect.width || innerWidth));
    const height = Math.max(1, Number(rect.height || innerHeight));
    renderer.gridToScreen = function contextualFixtureProjection(row, col, ...rest) {
      const base = originalGridToScreen.call(this, row, col, ...rest);
      const r = Math.trunc(Number(row) || 0);
      const c = Math.trunc(Number(col) || 0);
      const hash = Math.abs((r * 73856093) ^ (c * 19349663));
      const columns = width <= 480 ? 3 : 6;
      const rows = 4;
      const laneX = hash % columns;
      const laneY = Math.floor(hash / columns) % rows;
      const spanX = Math.min(width * 0.70, columns * 105);
      const spanY = Math.min(height * 0.42, rows * 82);
      return {
        ...base,
        x: width * 0.5 - spanX * 0.5 + laneX * spanX / Math.max(1, columns - 1),
        y: height * 0.58 - spanY * 0.5 + laneY * spanY / Math.max(1, rows - 1)
      };
    };
    try {
      Game.NPCContextualActivity.draw();
    } finally {
      renderer.gridToScreen = originalGridToScreen;
    }

    const afterNpcs = Game.State.world.npcs;
    const after = JSON.stringify(afterNpcs.map((npc) => ({ id: npc.id, row: npc.row, col: npc.col, activity: npc.activity, occupation: npc.occupation, movementDecision: npc.movementDecision, dialogueWith: npc.dialogueWith })));
    const snapshot = Game.NPCContextualActivity.snapshot();
    const expected = new Map(afterNpcs.map((npc) => [npc.id, Game.NPCContextualActivity.semanticActivity(npc)]));
    return {
      before, after,
      sameReferences: references.length === afterNpcs.length && references.every((npc, index) => npc === afterNpcs[index]),
      snapshot,
      expected: Object.fromEntries(expected),
      overlay: { layoutVersion: overlay?.dataset.bubbleLayoutVersion || null, activityCount: Number(overlay?.dataset.activityBubbleCount || 0), dialogueCount: Number(overlay?.dataset.dialoguePairCount || 0) }
    };
  });

  expect(pageErrors).toEqual([]);
  expect(evidence.after).toBe(evidence.before);
  expect(evidence.sameReferences).toBe(true);
  expect(evidence.snapshot?.authority).toBe('presentation-only');
  expect(evidence.snapshot?.labels?.length).toBeGreaterThan(0);
  expect(evidence.overlay.layoutVersion).toBe('r04-npc-activity-bubble-layout-v1');
  expect(evidence.overlay.activityCount + evidence.overlay.dialogueCount).toBeGreaterThan(0);
  for (const label of evidence.snapshot.labels) {
    expect(label.activity).toBe(evidence.expected[label.id]);
    expect(label.activity.toLowerCase()).not.toBe('working');
  }
});
