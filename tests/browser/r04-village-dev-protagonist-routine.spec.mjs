import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.StarterVillageDevOverlay?.drawDevelopmentLabels &&
    window.Game?.ProtagonistRoutine?.scheduleState &&
    window.Game?.NPCLife?.scheduleState &&
    window.Game?.GameTime?.capture &&
    Array.isArray(window.Game?.State?.world?.originVillage?.buildings) &&
    window.Game.State.world.originVillage.buildings.length >= 20
  ), null, { timeout: 20_000 });
}

test('development building labels align to game canvas and reject pathological footprints', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    window.Game.StarterVillageDevOverlay.redrawExistingExteriorSafely();
    window.Game.StarterVillageDevOverlay.drawDevelopmentLabels();

    const gameCanvas = window.Game.State.dom.canvas;
    const exterior = document.getElementById('starterVillageExteriorOverlay');
    const labels = document.getElementById('starterVillageDevelopmentLabels');
    const gameRect = gameCanvas.getBoundingClientRect();
    const exteriorRect = exterior?.getBoundingClientRect();
    const labelsRect = labels?.getBoundingClientRect();

    return {
      labels: {
        smithy: window.Game.StarterVillageDevOverlay.buildingLabel({ type: 'smithy' }),
        market: window.Game.StarterVillageDevOverlay.buildingLabel({ type: 'market' }),
        home: window.Game.StarterVillageDevOverlay.buildingLabel({ type: 'home' }),
        inn: window.Game.StarterVillageDevOverlay.buildingLabel({ type: 'inn' })
      },
      normalSafe: window.Game.StarterVillageDevOverlay.safeFootprint([
        { x: 100, y: 100 }, { x: 180, y: 100 }, { x: 180, y: 160 }, { x: 100, y: 160 }
      ], 1200, 800),
      pathologicalSafe: window.Game.StarterVillageDevOverlay.safeFootprint([
        { x: -8000, y: -6000 }, { x: 9000, y: -6000 }, { x: 9000, y: 7000 }, { x: -8000, y: 7000 }
      ], 1200, 800),
      gameRect: { x: gameRect.x, y: gameRect.y, width: gameRect.width, height: gameRect.height },
      exteriorRect: exteriorRect ? { x: exteriorRect.x, y: exteriorRect.y, width: exteriorRect.width, height: exteriorRect.height } : null,
      labelsRect: labelsRect ? { x: labelsRect.x, y: labelsRect.y, width: labelsRect.width, height: labelsRect.height } : null,
      labelCount: Number(labels?.dataset.labelCount || 0),
      labelsPointerEvents: labels ? getComputedStyle(labels).pointerEvents : null,
      exteriorProjectionGuard: exterior?.dataset.projectionGuard,
      labelProjectionGuard: labels?.dataset.projectionGuard
    };
  });

  expect(evidence.labels).toEqual({ smithy: 'Blacksmith', market: 'Market', home: 'House', inn: 'Inn' });
  expect(evidence.normalSafe).toBe(true);
  expect(evidence.pathologicalSafe).toBe(false);
  expect(evidence.exteriorRect).not.toBeNull();
  expect(evidence.labelsRect).not.toBeNull();
  for (const rect of [evidence.exteriorRect, evidence.labelsRect]) {
    expect(Math.abs(rect.x - evidence.gameRect.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(rect.y - evidence.gameRect.y)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(rect.width - evidence.gameRect.width)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(rect.height - evidence.gameRect.height)).toBeLessThanOrEqual(1.5);
  }
  expect(evidence.labelCount).toBeGreaterThan(0);
  expect(evidence.labelsPointerEvents).toBe('none');
  expect(evidence.exteriorProjectionGuard).toBe('enabled');
  expect(evidence.labelProjectionGuard).toBe('enabled');
});

test('protagonist gets a profession-aware resident routine without direct movement authority', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const player = window.Game.State.world.player;
    const before = { row: player.row, col: player.col };
    const blacksmith = window.Game.ProtagonistRoutine.scheduleState(480, {
      characterId: 'protagonist',
      rank: 'Peasant',
      baseProfession: 'Peasant',
      currentProfession: 'Blacksmith'
    });
    const peasant = window.Game.ProtagonistRoutine.scheduleState(480, {
      characterId: 'protagonist',
      rank: 'Peasant',
      baseProfession: 'Peasant',
      currentProfession: 'Peasant'
    });
    const refreshed = window.Game.ProtagonistRoutine.refresh(480);
    const after = { row: player.row, col: player.col };
    return {
      before,
      after,
      blacksmith,
      peasant,
      refreshed,
      storedRoutine: window.Game.State.protagonistRoutine,
      playerRoutine: player.dailyRoutine
    };
  });

  expect(evidence.before).toEqual(evidence.after);
  expect(evidence.blacksmith.routineRole).toBe('blacksmith');
  expect(evidence.blacksmith.activity).toBe('work');
  expect(evidence.blacksmith.anchor).toBe('work');
  expect(['smithy', 'blacksmith', 'workshop']).toContain(evidence.blacksmith.targetBuildingType);
  expect(evidence.blacksmith.directMovementAuthority).toBe(false);
  expect(evidence.blacksmith.canYieldToAdvisor).toBe(true);
  expect(evidence.blacksmith.canYieldToCareerIntent).toBe(true);

  expect(evidence.peasant.routineRole).toBe('farmer');
  expect(evidence.peasant.activity).toBe('work');
  expect(evidence.peasant.anchor).toBe('work');
  expect(['farmstead', 'farm', 'mill']).toContain(evidence.peasant.targetBuildingType);

  expect(evidence.refreshed).not.toBeNull();
  expect(evidence.storedRoutine.version).toBe('r04-protagonist-routine-v1');
  expect(evidence.playerRoutine.version).toBe('r04-protagonist-routine-v1');
});