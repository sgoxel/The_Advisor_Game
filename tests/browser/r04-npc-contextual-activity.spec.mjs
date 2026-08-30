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

  expect(labels).toEqual({
    baker: 'Baking',
    blacksmith: 'Forging',
    miller: 'Milling',
    farmer: 'Checking Crops',
    woodcutter: 'Cutting Woods',
    hunter: 'Hunting',
    moving: 'Walking',
    talking: 'Chatting',
    sleeping: 'Sleeping',
    social: 'Chatting',
    errand: 'Running Errands'
  });
});

test('contextual bubble pass preserves authoritative NPC objects and replaces generic working presentation', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await ready(page);

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    // Settle the normal authoritative GameTime update first, then verify the next
    // same-minute presentation pass cannot rewrite any Simulation-owned NPC record.
    Game.Renderer.renderWorld(true);
    const npcs = Game.State.world.npcs;
    const references = npcs.slice();
    const before = JSON.stringify(npcs.map((npc) => ({
      id: npc.id,
      row: npc.row,
      col: npc.col,
      activity: npc.activity,
      occupation: npc.occupation,
      movementDecision: npc.movementDecision,
      dialogueWith: npc.dialogueWith
    })));

    Game.Renderer.renderWorld(true);

    const afterNpcs = Game.State.world.npcs;
    const after = JSON.stringify(afterNpcs.map((npc) => ({
      id: npc.id,
      row: npc.row,
      col: npc.col,
      activity: npc.activity,
      occupation: npc.occupation,
      movementDecision: npc.movementDecision,
      dialogueWith: npc.dialogueWith
    })));
    const snapshot = Game.NPCContextualActivity.snapshot();
    const expected = new Map(afterNpcs.map((npc) => [npc.id, Game.NPCContextualActivity.semanticActivity(npc)]));
    const overlay = document.getElementById('npcWorldOverlay');

    return {
      before,
      after,
      sameReferences: references.length === afterNpcs.length && references.every((npc, index) => npc === afterNpcs[index]),
      snapshot,
      expected: Object.fromEntries(expected),
      overlay: {
        layoutVersion: overlay?.dataset.bubbleLayoutVersion || null,
        activityCount: Number(overlay?.dataset.activityBubbleCount || 0),
        dialogueCount: Number(overlay?.dataset.dialoguePairCount || 0)
      }
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
