import { test, expect } from '@playwright/test';

async function waitForStatusBubble(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.player &&
    window.Game?.ProtagonistStatusBubble?.update &&
    window.Game?.Renderer?.gridToScreen
  ));
}

test('projects authoritative protagonist activity into a presentation-only live bubble', async ({ page }) => {
  const failures = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await waitForStatusBubble(page);

  const result = await page.evaluate(() => {
    const Game = window.Game;
    const State = Game.State;
    const player = State.world.player;
    const canonical = Game.AuthoritativeState?.canonicalStringify;
    const beforeCanonical = typeof canonical === 'function' ? canonical(State) : null;
    const beforeRoutine = State.protagonistRoutine;
    const before = {
      moving: player.moving,
      startRow: player.startRow,
      startCol: player.startCol,
      targetRow: player.targetRow,
      targetCol: player.targetCol,
      progress: player.progress,
      currentActivity: player.currentActivity,
      activity: player.activity,
      intent: player.intent,
      inDialogue: player.inDialogue,
      dialogueActive: player.dialogueActive,
      dialogue: State.dialogue
    };

    const read = () => {
      const semantic = Game.ProtagonistStatusBubble.update();
      const bubble = document.getElementById('protagonist-status-bubble');
      const rect = bubble?.getBoundingClientRect();
      return {
        semantic,
        hidden: bubble?.hidden,
        text: bubble?.textContent,
        authority: bubble?.dataset.presentationAuthority,
        source: bubble?.dataset.source,
        activity: bubble?.dataset.activity,
        rect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width } : null
      };
    };

    player.moving = true;
    player.startRow = Number(player.row);
    player.startCol = Number(player.col);
    player.targetRow = Number(player.row) + 1;
    player.targetCol = Number(player.col);
    player.progress = 0.5;
    const walking = read();

    player.moving = false;
    State.protagonistRoutine = Object.freeze({ activity: 'working', anchor: 'work' });
    const working = read();

    State.protagonistRoutine = Object.freeze({ activity: 'social', anchor: 'social' });
    const chatting = read();

    State.protagonistRoutine = Object.freeze({ activity: 'sleeping', anchor: 'home' });
    const sleeping = read();

    State.protagonistRoutine = beforeRoutine;
    Object.assign(player, {
      moving: before.moving,
      startRow: before.startRow,
      startCol: before.startCol,
      targetRow: before.targetRow,
      targetCol: before.targetCol,
      progress: before.progress,
      currentActivity: before.currentActivity,
      activity: before.activity,
      intent: before.intent,
      inDialogue: before.inDialogue,
      dialogueActive: before.dialogueActive
    });
    State.dialogue = before.dialogue;
    Game.ProtagonistStatusBubble.update();
    const afterCanonical = typeof canonical === 'function' ? canonical(State) : null;

    return { walking, working, chatting, sleeping, beforeCanonical, afterCanonical, viewportWidth: innerWidth };
  });

  expect(result.walking).toMatchObject({ hidden: false, text: 'Walking', authority: 'presentation-only', source: 'authoritative-movement', activity: 'walking' });
  expect(result.working).toMatchObject({ hidden: false, text: 'Working', authority: 'presentation-only', source: 'authoritative-routine' });
  expect(result.chatting).toMatchObject({ hidden: false, text: 'Chatting', authority: 'presentation-only', source: 'authoritative-routine' });
  expect(result.sleeping).toMatchObject({ hidden: false, text: 'Sleeping', authority: 'presentation-only', source: 'authoritative-routine' });
  expect(result.walking.rect?.width).toBeGreaterThan(0);
  expect(result.walking.rect?.width).toBeLessThan(result.viewportWidth * 0.55);
  if (result.beforeCanonical !== null) expect(result.afterCanonical).toBe(result.beforeCanonical);
  expect(failures).toEqual([]);
});

test('status bubble remains bounded on a constrained viewport and hides unsupported activity', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForStatusBubble(page);

  const result = await page.evaluate(() => {
    const Game = window.Game;
    const State = Game.State;
    const player = State.world.player;
    const beforeRoutine = State.protagonistRoutine;
    const beforeMoving = player.moving;
    player.moving = false;
    State.protagonistRoutine = Object.freeze({ activity: 'unsupported-non-authoritative-label' });
    const semantic = Game.ProtagonistStatusBubble.update();
    const bubble = document.getElementById('protagonist-status-bubble');
    const hidden = bubble.hidden;
    State.protagonistRoutine = beforeRoutine;
    player.moving = beforeMoving;
    Game.ProtagonistStatusBubble.update();
    return { semantic, hidden, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
  });

  expect(result.semantic).toBeNull();
  expect(result.hidden).toBe(true);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth + 1);
});
