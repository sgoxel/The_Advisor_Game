import { test, expect } from '@playwright/test';

async function ready(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error?.message || error)));
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCIndoorWorkAnchors?.conversationValidity &&
    window.Game?.NPCIndoorWorkAnchors?.reconcileConversations &&
    window.Game?.NPCContextualActivity?.semanticActivity
  ));
  return errors;
}

function pair(rowB = 10, colB = 11) {
  return [
    { id: 'a', name: 'A', row: 10, col: 10, regionX: 0, regionY: 0, activity: 'talking', dialogueWith: 'b', dialogueLine: 'Hello' },
    { id: 'b', name: 'B', row: rowB, col: colB, regionX: 0, regionY: 0, activity: 'talking', dialogueWith: 'a', dialogueLine: 'Hello' }
  ];
}

test('direct conversation is reciprocal, partner-backed and Manhattan-adjacent', async ({ page }) => {
  const errors = await ready(page);
  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const world = Game.State.world;
    const beforeNpcs = world.npcs;
    const beforeDialogues = world.npcDialogues;
    const run = (npcs, dialogues = []) => {
      world.npcs = npcs;
      world.npcDialogues = dialogues;
      Game.NPCIndoorWorkAnchors.reconcileConversations();
      return {
        npcs: world.npcs.map((npc) => ({ id: npc.id, activity: npc.activity, dialogueWith: npc.dialogueWith, intendedDialogueWith: npc.intendedDialogueWith, conversationState: npc.conversationState, label: Game.NPCContextualActivity.semanticActivity(npc) })),
        dialogues: JSON.parse(JSON.stringify(world.npcDialogues || []))
      };
    };
    try {
      const adjacent = run([
        { id: 'a', name: 'A', row: 10, col: 10, regionX: 0, regionY: 0, activity: 'talking', dialogueWith: 'b', dialogueLine: 'Hello' },
        { id: 'b', name: 'B', row: 10, col: 11, regionX: 0, regionY: 0, activity: 'talking', dialogueWith: 'a', dialogueLine: 'Hello' }
      ], [{ speakerId: 'a', listenerId: 'b', line: 'Hello', adjacent: true }]);
      const nonAdjacent = run([
        { id: 'a', name: 'A', row: 10, col: 10, regionX: 0, regionY: 0, activity: 'talking', dialogueWith: 'b' },
        { id: 'b', name: 'B', row: 14, col: 14, regionX: 0, regionY: 0, activity: 'talking', dialogueWith: 'a' }
      ], [{ speakerId: 'a', listenerId: 'b', line: 'stale', adjacent: false }]);
      const sameTile = run([
        { id: 'a', row: 7, col: 7, regionX: 0, regionY: 0, activity: 'chatting', dialogueWith: 'b' },
        { id: 'b', row: 7, col: 7, regionX: 0, regionY: 0, activity: 'chatting', dialogueWith: 'a' }
      ]);
      const missing = run([{ id: 'a', row: 4, col: 4, regionX: 0, regionY: 0, activity: 'talking', dialogueWith: 'missing' }]);
      const isolatedSocial = run([{ id: 'solo', row: 2, col: 2, regionX: 0, regionY: 0, activity: 'social', dialogueWith: null }]);
      return { adjacent, nonAdjacent, sameTile, missing, isolatedSocial };
    } finally {
      world.npcs = beforeNpcs;
      world.npcDialogues = beforeDialogues;
    }
  });

  expect(evidence.adjacent.npcs.every((npc) => npc.conversationState.valid && npc.label === 'Chatting')).toBe(true);
  expect(evidence.adjacent.dialogues).toHaveLength(1);
  expect(evidence.adjacent.dialogues[0].adjacent).toBe(true);

  for (const sample of [evidence.nonAdjacent, evidence.sameTile]) {
    expect(sample.npcs.every((npc) => npc.dialogueWith === null)).toBe(true);
    expect(sample.npcs.every((npc) => npc.label !== 'Chatting')).toBe(true);
    expect(sample.dialogues).toEqual([]);
  }
  expect(evidence.nonAdjacent.npcs.some((npc) => npc.intendedDialogueWith)).toBe(true);
  expect(evidence.missing.npcs[0].dialogueWith).toBeNull();
  expect(evidence.missing.npcs[0].label).not.toBe('Chatting');
  expect(evidence.missing.dialogues).toEqual([]);
  expect(evidence.isolatedSocial.npcs[0].label).toBe('Socializing');
  expect(errors).toEqual([]);
});

test('moving an established partner away terminates shared direct-conversation state', async ({ page }) => {
  const errors = await ready(page);
  const result = await page.evaluate(() => {
    const Game = window.Game;
    const world = Game.State.world;
    const beforeNpcs = world.npcs;
    const beforeDialogues = world.npcDialogues;
    try {
      const a = { id: 'a', row: 20, col: 20, regionX: 0, regionY: 0, activity: 'talking', dialogueWith: 'b' };
      const b = { id: 'b', row: 20, col: 21, regionX: 0, regionY: 0, activity: 'talking', dialogueWith: 'a' };
      world.npcs = [a, b];
      world.npcDialogues = [{ speakerId: 'a', listenerId: 'b', line: 'Active', adjacent: true }];
      Game.NPCIndoorWorkAnchors.reconcileConversations();
      const beforeMove = { count: world.npcDialogues.length, a: a.dialogueWith, b: b.dialogueWith };
      b.row = 25; b.col = 25;
      Game.NPCIndoorWorkAnchors.reconcileConversations();
      return { beforeMove, afterMove: { count: world.npcDialogues.length, a: a.dialogueWith, b: b.dialogueWith, aLabel: Game.NPCContextualActivity.semanticActivity(a), bLabel: Game.NPCContextualActivity.semanticActivity(b) } };
    } finally {
      world.npcs = beforeNpcs;
      world.npcDialogues = beforeDialogues;
    }
  });
  expect(result.beforeMove).toEqual({ count: 1, a: 'b', b: 'a' });
  expect(result.afterMove.count).toBe(0);
  expect(result.afterMove.a).toBeNull();
  expect(result.afterMove.b).toBeNull();
  expect(result.afterMove.aLabel).not.toBe('Chatting');
  expect(result.afterMove.bLabel).not.toBe('Chatting');
  expect(errors).toEqual([]);
});