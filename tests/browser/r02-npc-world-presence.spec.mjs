import { test, expect } from '@playwright/test';

async function waitForNpcWorld(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCWorld?.capture &&
    window.Game?.OriginVillage?.generate &&
    Array.isArray(window.Game?.State?.world?.npcs) &&
    window.Game.State.world.npcs.length >= 12 &&
    document.getElementById('npcWorldOverlay')
  ));
}

test('generated villagers become stable simulation-owned NPC state with role anchors', async ({ page }) => {
  await waitForNpcWorld(page);
  const evidence = await page.evaluate(() => {
    const world = window.Game.State.world;
    const populationIds = world.originVillage.population.map((person) => person.id);
    return {
      npc: window.Game.NPCWorld.capture(),
      populationIds,
      runtime: { ...world.npcRuntime }
    };
  });

  expect(evidence.npc.length).toBeGreaterThanOrEqual(12);
  expect(evidence.npc.length).toBe(evidence.populationIds.length);
  expect(new Set(evidence.npc.map((npc) => npc.id)).size).toBe(evidence.npc.length);
  expect(evidence.npc.every((npc) => evidence.populationIds.includes(npc.id))).toBe(true);
  expect(evidence.npc.every((npc) => npc.authority === 'simulation')).toBe(true);
  expect(evidence.npc.every((npc) => npc.controlledBy === 'simulation' && npc.playerControllable === false)).toBe(true);
  expect(evidence.npc.every((npc) =>
    npc.anchors?.home?.buildingId &&
    npc.anchors?.work?.buildingId &&
    Number.isFinite(Number(npc.anchors?.social?.row)) &&
    Number.isFinite(Number(npc.anchors?.social?.col))
  )).toBe(true);
  expect(evidence.runtime.authority).toBe('simulation');
});

test('local routines remain deterministic under authoritative GameTime rather than legacy elapsed milliseconds', async ({ page }) => {
  await waitForNpcWorld(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.NPCWorld;
    const gameMinutes = window.Game.GameTime.capture().totalGameMinutes;
    api.updateAt(0);
    const first = api.capture();
    api.updateAt(7000);
    const second = api.capture();
    api.updateAt(7000);
    const repeated = api.capture();
    const roleByBuildingId = Object.fromEntries(
      window.Game.State.world.originVillage.buildings.map((building) => [building.id, building.role])
    );
    return {
      first,
      second,
      repeated,
      gameMinutes,
      gameMinutesAfter: window.Game.GameTime.capture().totalGameMinutes,
      routineClockAuthority: window.Game.State.world.npcRuntime?.routineClockAuthority,
      roleByBuildingId
    };
  });

  expect(evidence.routineClockAuthority).toBe('Game.GameTime');
  expect(evidence.gameMinutesAfter).toBe(evidence.gameMinutes);
  expect(evidence.second).toEqual(evidence.repeated);
  expect(evidence.second.map((npc) => ({ id: npc.id, row: npc.row, col: npc.col, activity: npc.activity })))
    .toEqual(evidence.first.map((npc) => ({ id: npc.id, row: npc.row, col: npc.col, activity: npc.activity })));

  const roleEvidence = new Map(evidence.second.map((npc) => [npc.occupation, npc]));
  expect(evidence.roleByBuildingId[roleEvidence.get('innkeeper')?.anchors.work.buildingId]).toBe('lodging');
  expect(evidence.roleByBuildingId[roleEvidence.get('baker')?.anchors.work.buildingId]).toBe('food');
  expect(evidence.roleByBuildingId[roleEvidence.get('trader')?.anchors.work.buildingId]).toBe('trade');
  expect(evidence.roleByBuildingId[roleEvidence.get('blacksmith')?.anchors.work.buildingId]).toBe('production');
  expect(evidence.roleByBuildingId[roleEvidence.get('guard')?.anchors.work.buildingId]).toBe('guard');
});

test('presentation recreation does not fabricate identities or reset authoritative NPC state', async ({ page }) => {
  await waitForNpcWorld(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.NPCWorld;
    api.updateAt(9100);
    const before = api.capture();
    const runtimeBefore = { ...window.Game.State.world.npcRuntime };
    api.detachPresentation();
    const overlayAfterDetach = document.getElementById('npcWorldOverlay');
    api.ensureOverlay();
    api.drawPresentation();
    const after = api.capture();
    const runtimeAfter = { ...window.Game.State.world.npcRuntime };
    const overlay = document.getElementById('npcWorldOverlay');
    return {
      before,
      after,
      runtimeBefore,
      runtimeAfter,
      detached: overlayAfterDetach === null,
      overlay: {
        exists: Boolean(overlay),
        pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : null,
        ariaHidden: overlay?.getAttribute('aria-hidden'),
        npcCount: overlay?.dataset.npcCount
      }
    };
  });

  expect(evidence.detached).toBe(true);
  expect(evidence.after).toEqual(evidence.before);
  expect(evidence.runtimeAfter.seed).toBe(evidence.runtimeBefore.seed);
  expect(evidence.runtimeAfter.lastElapsedMs).toBe(evidence.runtimeBefore.lastElapsedMs);
  expect(evidence.overlay.exists).toBe(true);
  expect(evidence.overlay.pointerEvents).toBe('none');
  expect(evidence.overlay.ariaHidden).toBe('true');
  expect(Number(evidence.overlay.npcCount)).toBe(evidence.before.length);
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 }
]) {
  test(`NPC strategic-world presentation remains bounded and visible on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await waitForNpcWorld(page);
    await page.evaluate(() => {
      window.Game.NPCWorld.updateAt(5000);
      window.Game.NPCWorld.drawPresentation();
    });
    const evidence = await page.locator('#npcWorldOverlay').evaluate((overlay) => ({
      rect: overlay.getBoundingClientRect().toJSON(),
      npcCount: Number(overlay.dataset.npcCount || 0),
      visibleNpcCount: Number(overlay.dataset.visibleNpcCount || 0),
      canvasWidth: overlay.width,
      canvasHeight: overlay.height
    }));

    expect(evidence.rect.width).toBeGreaterThan(100);
    expect(evidence.rect.height).toBeGreaterThan(100);
    expect(evidence.canvasWidth).toBeGreaterThan(0);
    expect(evidence.canvasHeight).toBeGreaterThan(0);
    expect(evidence.npcCount).toBeGreaterThanOrEqual(12);
    expect(evidence.visibleNpcCount).toBeGreaterThanOrEqual(4);
    expect(evidence.visibleNpcCount).toBeLessThanOrEqual(16);
  });
}
