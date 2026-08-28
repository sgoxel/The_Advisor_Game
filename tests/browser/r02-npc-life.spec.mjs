import { test, expect } from '@playwright/test';

async function waitForNpcLife(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCWorld?.capture &&
    window.Game?.NPCLife?.scheduleState &&
    window.Game?.GameTime?.setForTest &&
    window.Game?.State?.world?.npcs?.length >= 2
  ));
}

test('representative roles follow authoritative time-aware daily schedule states', async ({ page }) => {
  await waitForNpcLife(page);
  const evidence = await page.evaluate(() => {
    const life = window.Game.NPCLife;
    const time = window.Game.GameTime;
    const npcs = window.Game.State.world.npcs;
    time.stop();
    const sample = npcs.slice(0, 6);
    return [300, 480, 780, 1080, 1260, 1380].map((minute) => ({
      minute,
      states: sample.map((npc) => life.scheduleState(npc, minute))
    }));
  });

  for (const point of evidence) {
    expect(point.states.length).toBeGreaterThan(1);
    for (const state of point.states) {
      expect(state.authority).toBe('simulation');
      expect(state.playerControllable).toBe(false);
      expect(['sleep', 'prepare-and-travel', 'work', 'break-or-errand', 'social', 'return-home']).toContain(state.activity);
    }
  }
  const signatures = new Set(evidence.flatMap((point) => point.states.map((state) => `${state.occupation}:${state.activity}`)));
  expect(signatures.size).toBeGreaterThan(4);
});

test('applying schedules changes Simulation-backed NPC routine state without direct player control', async ({ page }) => {
  await waitForNpcLife(page);
  const evidence = await page.evaluate(() => {
    const life = window.Game.NPCLife;
    const before = window.Game.State.world.npcs.map((npc) => ({ id: npc.id, activity: npc.activity }));
    const applied = life.applySchedules(600);
    const after = window.Game.State.world.npcs.map((npc) => ({
      id: npc.id,
      activity: npc.activity,
      authority: npc.authority,
      controlledBy: npc.controlledBy,
      playerControllable: npc.playerControllable,
      scheduleAuthority: npc.dailySchedule?.authority
    }));
    return { before, applied, after };
  });

  expect(evidence.applied.length).toBe(evidence.after.length);
  expect(evidence.after.length).toBeGreaterThan(1);
  for (const npc of evidence.after) {
    expect(npc.authority).toBe('simulation');
    expect(npc.controlledBy).toBe('simulation');
    expect(npc.playerControllable).toBe(false);
    expect(npc.scheduleAuthority).toBe('simulation');
  }
});

test('ambient NPC dialogue is deterministic, varied, contextual and non-authoritative', async ({ page }) => {
  await waitForNpcLife(page);
  const evidence = await page.evaluate(() => {
    const life = window.Game.NPCLife;
    const [a, b] = window.Game.State.world.npcs;
    const context = { totalGameMinutes: 690, location: 'origin-village', environment: 'forest-edge' };
    const first = life.ambientDialogue(a, b, context);
    const second = life.ambientDialogue(a, b, context);
    const later = life.ambientDialogue(a, b, { ...context, totalGameMinutes: 1110 });
    return { first, second, later };
  });

  expect(evidence.first).toEqual(evidence.second);
  expect(evidence.first.externalLlmRequired).toBe(false);
  expect(evidence.first.authoritativeFact).toBe(false);
  expect(evidence.first.location).toBe('origin-village');
  expect(evidence.first.environment).toBe('forest-edge');
  expect(evidence.first.line.length).toBeGreaterThan(12);
  expect(evidence.later.period).not.toBe(evidence.first.period);
});

test('contextual conversation exposes no direct NPC-control or authority injection API', async ({ page }) => {
  await waitForNpcLife(page);
  const evidence = await page.evaluate(() => {
    const life = window.Game.NPCLife;
    const conversation = life.contextualConversation({ totalGameMinutes: 900, location: 'origin-village' });
    return {
      apiAuthority: life.authority,
      conversation,
      hasDirectControl: ['moveNpc', 'commandNpc', 'setNpcPosition', 'controlNpc', 'recordFact'].some((name) => typeof life[name] === 'function')
    };
  });
  expect(evidence.apiAuthority).toBe('simulation');
  expect(evidence.conversation.externalLlmRequired).toBe(false);
  expect(evidence.conversation.authoritativeFact).toBe(false);
  expect(evidence.hasDirectControl).toBe(false);
});
