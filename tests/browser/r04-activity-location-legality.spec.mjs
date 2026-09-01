import { test, expect } from '@playwright/test';

async function ready(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error?.message || error)));
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCLife?.activityLocationState &&
    window.Game?.NPCLife?.applyActivityLocationGate &&
    window.Game?.ProtagonistRoutine?.scheduleState &&
    window.Game?.NPCContextualActivity?.semanticActivity
  ));
  return errors;
}

test('routine actions remain travel/wait until authoritative location is legal', async ({ page }) => {
  const errors = await ready(page);
  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const life = Game.NPCLife;
    const contextual = Game.NPCContextualActivity;
    const world = {
      npcRuntime: { originBinding: { rowOffset: 0, colOffset: 0 } },
      outdoorWorksites: { assignments: [
        { id: 'wood-1', status: 'assigned', row: 20, col: 21, worksiteId: 'worksite:forest-edge:20:21' }
      ] }
    };

    const smith = {
      id: 'smith-1', occupation: 'blacksmith', row: 3, col: 4,
      anchors: { work: { row: 12, col: 14, buildingId: 'smithy-1' } },
      dailySchedule: { activity: 'work', anchor: 'work' }, movementDecision: 'hold'
    };
    const smithBefore = { row: smith.row, col: smith.col };
    const smithBlocked = life.applyActivityLocationGate(smith, smith.dailySchedule, { world });
    const smithLabelBlocked = contextual.semanticActivity(smith);
    smith.row = 12; smith.col = 14;
    const smithArrived = life.applyActivityLocationGate(smith, smith.dailySchedule, { world });
    const smithLabelArrived = contextual.semanticActivity(smith);

    const wood = {
      id: 'wood-1', occupation: 'woodcutter', row: 8, col: 9,
      anchors: { work: { row: 5, col: 5, buildingId: 'bakery-1' } },
      dailySchedule: { activity: 'work', anchor: 'work' }, movementDecision: 'hold'
    };
    const woodBlocked = life.applyActivityLocationGate(wood, wood.dailySchedule, { world });
    const woodLabelBlocked = contextual.semanticActivity(wood);
    wood.row = 20; wood.col = 21;
    const woodArrived = life.applyActivityLocationGate(wood, wood.dailySchedule, { world });
    const woodLabelArrived = contextual.semanticActivity(wood);

    const sleeper = {
      id: 'sleep-1', occupation: 'villager', row: 30, col: 30,
      anchors: { home: { row: 2, col: 2, buildingId: 'home-1' } },
      dailySchedule: { activity: 'sleep', anchor: 'home' }, movementDecision: 'hold'
    };
    const sleeperBefore = { row: sleeper.row, col: sleeper.col };
    const sleepBlocked = life.applyActivityLocationGate(sleeper, sleeper.dailySchedule, { world });
    const sleepLabelBlocked = contextual.semanticActivity(sleeper);
    sleeper.row = 2; sleeper.col = 2;
    const sleepArrived = life.applyActivityLocationGate(sleeper, sleeper.dailySchedule, { world });
    const sleepLabelArrived = contextual.semanticActivity(sleeper);

    const missing = { id: 'missing', occupation: 'baker', row: 1, col: 1, anchors: {}, dailySchedule: { activity: 'work', anchor: 'work' } };
    const missingState = life.applyActivityLocationGate(missing, missing.dailySchedule, { world: { npcRuntime: { originBinding: {} } } });

    return {
      smithBefore, smithBlocked, smithLabelBlocked, smithArrived, smithLabelArrived,
      woodBlocked, woodLabelBlocked, woodArrived, woodLabelArrived,
      sleeperBefore, sleepBlocked, sleepLabelBlocked, sleepArrived, sleepLabelArrived,
      missingState,
      smithCoordinatesAfterBlocked: smithBefore,
      sleeperCoordinatesAfterBlocked: sleeperBefore
    };
  });

  expect(evidence.smithBlocked.legal).toBe(false);
  expect(evidence.smithBlocked.activeActivity).toBe('commuting-to-work');
  expect(evidence.smithLabelBlocked).toBe('Walking');
  expect(evidence.smithArrived.legal).toBe(true);
  expect(evidence.smithLabelArrived).toBe('Forging');

  expect(evidence.woodBlocked.legal).toBe(false);
  expect(evidence.woodBlocked.target).toMatchObject({ row: 20, col: 21 });
  expect(evidence.woodLabelBlocked).toBe('Walking');
  expect(evidence.woodArrived.legal).toBe(true);
  expect(evidence.woodLabelArrived).toBe('Cutting Woods');

  expect(evidence.sleepBlocked.legal).toBe(false);
  expect(evidence.sleepBlocked.activeActivity).toBe('returning-home');
  expect(evidence.sleepLabelBlocked).toBe('Walking');
  expect(evidence.sleepArrived.legal).toBe(true);
  expect(evidence.sleepLabelArrived).toBe('Sleeping');

  expect(evidence.missingState.legal).toBe(false);
  expect(evidence.missingState.activeActivity).toBe('waiting');
  expect(errors).toEqual([]);
});

test('protagonist sleep intent is travel-first when current location is not home', async ({ page }) => {
  const errors = await ready(page);
  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    Game.GameTime.stop();
    const world = Game.State.world;
    const beforeVillage = world.originVillage;
    const beforePlayer = { ...world.player };
    const beforeProfile = Game.State.characterProfile;
    try {
      world.originVillage = {
        ...(beforeVillage || {}),
        buildings: [
          { id: 'home-test', type: 'home', entrance: { row: 4, col: 5 } },
          { id: 'market-test', type: 'market', entrance: { row: 40, col: 41 } },
          { id: 'farm-test', type: 'farmstead', entrance: { row: 12, col: 13 } },
          { id: 'inn-test', type: 'inn', entrance: { row: 20, col: 21 } }
        ]
      };
      world.player = { ...(world.player || {}), row: 40, col: 41 };
      Game.State.characterProfile = { ...(beforeProfile || {}), characterId: 'protagonist', baseProfession: 'Peasant', currentProfession: 'Peasant', rank: 'Peasant' };
      const away = Game.ProtagonistRoutine.scheduleState(60, Game.State.characterProfile);
      world.player.row = away.target.row;
      world.player.col = away.target.col;
      const home = Game.ProtagonistRoutine.scheduleState(60, Game.State.characterProfile);
      return { away, home, playerAfterAway: { row: 40, col: 41 } };
    } finally {
      world.originVillage = beforeVillage;
      world.player = beforePlayer;
      Game.State.characterProfile = beforeProfile;
    }
  });

  expect(evidence.away.intendedActivity).toBe('sleeping');
  expect(evidence.away.activity).toBe('returning-home');
  expect(evidence.away.activityLocationState.legal).toBe(false);
  expect(evidence.home.activity).toBe('sleeping');
  expect(evidence.home.activityLocationState.legal).toBe(true);
  expect(errors).toEqual([]);
});