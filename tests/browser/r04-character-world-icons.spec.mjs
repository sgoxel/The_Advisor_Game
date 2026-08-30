import { test, expect } from '@playwright/test';

async function waitForNpcWorld(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCWorld?.worldIconAssetFor &&
    window.Game?.NPCWorld?.capture &&
    Array.isArray(window.Game?.State?.world?.npcs) &&
    window.Game.State.world.npcs.length >= 12 &&
    document.getElementById('npcWorldOverlay')
  ));
}

test('Simulation-backed occupation deterministically selects presentation-only PNG families', async ({ page }) => {
  await waitForNpcWorld(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.NPCWorld;
    const npcs = api.capture();
    return {
      authority: api.authority,
      presentationAuthority: api.presentationAuthority,
      mapped: npcs.map((npc) => ({
        id: npc.id,
        authority: npc.authority,
        occupation: npc.occupation,
        asset: api.worldIconAssetFor(npc)
      })),
      rejectsPresentationFabrication: api.worldIconAssetFor({ authority: 'presentation', occupation: 'guard' })
    };
  });

  expect(evidence.authority).toBe('simulation');
  expect(evidence.presentationAuthority).toBe('presentation-only');
  expect(evidence.rejectsPresentationFabrication).toBe('');
  expect(evidence.mapped.every((entry) => entry.authority === 'simulation')).toBe(true);
  expect(evidence.mapped.some((entry) => entry.occupation === 'guard' && entry.asset.endsWith('/guard.png'))).toBe(true);
  expect(evidence.mapped.some((entry) => entry.occupation === 'innkeeper' && entry.asset.endsWith('/merchant.png'))).toBe(true);
  expect(evidence.mapped.filter((entry) => entry.asset).length).toBeGreaterThanOrEqual(8);
});

test('character world-icon PNG assets are available and render with safe fallback accounting', async ({ page }) => {
  await waitForNpcWorld(page);
  for (const path of [
    'assets/characters/world/villager.png',
    'assets/characters/world/worker.png',
    'assets/characters/world/merchant.png',
    'assets/characters/world/guard.png',
    'assets/characters/world/healer.png'
  ]) {
    const response = await page.request.get(path);
    expect(response.ok(), path).toBe(true);
    expect(response.headers()['content-type'] || '').toContain('image/png');
  }

  await page.waitForFunction(() => Number(document.getElementById('npcWorldOverlay')?.dataset.pngNpcCount || 0) > 0);
  const evidence = await page.locator('#npcWorldOverlay').evaluate((overlay) => ({
    authority: overlay.dataset.presentationAuthority,
    total: Number(overlay.dataset.npcCount || 0),
    visible: Number(overlay.dataset.visibleNpcCount || 0),
    png: Number(overlay.dataset.pngNpcCount || 0),
    fallback: Number(overlay.dataset.fallbackNpcCount || 0),
    pointerEvents: getComputedStyle(overlay).pointerEvents,
    ariaHidden: overlay.getAttribute('aria-hidden')
  }));

  expect(evidence.authority).toBe('presentation-only');
  expect(evidence.total).toBeGreaterThanOrEqual(12);
  expect(evidence.visible).toBeGreaterThan(0);
  expect(evidence.png).toBeGreaterThan(0);
  expect(evidence.png + evidence.fallback).toBe(evidence.visible);
  expect(evidence.pointerEvents).toBe('none');
  expect(evidence.ariaHidden).toBe('true');
});

test('asset loading and presentation redraw do not mutate authoritative NPC identity or control state', async ({ page }) => {
  await waitForNpcWorld(page);
  const before = await page.evaluate(() => window.Game.NPCWorld.capture().map((npc) => ({
    id: npc.id,
    authority: npc.authority,
    controlledBy: npc.controlledBy,
    playerControllable: npc.playerControllable,
    occupation: npc.occupation,
    regionX: npc.regionX,
    regionY: npc.regionY
  })));

  await page.waitForFunction(() => Number(document.getElementById('npcWorldOverlay')?.dataset.pngNpcCount || 0) > 0);
  await page.evaluate(() => window.Game.NPCWorld.drawPresentation());

  const after = await page.evaluate(() => window.Game.NPCWorld.capture().map((npc) => ({
    id: npc.id,
    authority: npc.authority,
    controlledBy: npc.controlledBy,
    playerControllable: npc.playerControllable,
    occupation: npc.occupation,
    regionX: npc.regionX,
    regionY: npc.regionY
  })));

  expect(after).toEqual(before);
  expect(after.every((npc) => npc.controlledBy === 'simulation' && npc.playerControllable === false)).toBe(true);
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 }
]) {
  test(`character PNG overlay scale responds to zoom without mutating NPC state on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await waitForNpcWorld(page);
    await page.waitForFunction(() => Number(document.getElementById('npcWorldOverlay')?.dataset.pngNpcCount || 0) > 0);

    const evidence = await page.evaluate(() => {
      const Game = window.Game;
      const overlay = document.getElementById('npcWorldOverlay');
      const snapshot = () => Game.State.world.npcs.map((npc) => ({
        id: npc.id,
        authority: npc.authority,
        occupation: npc.occupation,
        row: npc.row,
        col: npc.col,
        localRow: npc.localRow,
        localCol: npc.localCol,
        activity: npc.activity,
        movementDecision: npc.movementDecision,
        dialogueWith: npc.dialogueWith,
        asset: Game.NPCWorld.worldIconAssetFor(npc)
      }));
      const before = snapshot();
      const originalZoom = Number(Game.State.camera.zoom);

      Game.State.camera.zoom = 2;
      Game.NPCWorld.drawPresentation();
      const lowZoomSize = Number(overlay.dataset.iconSizePx || 0);

      Game.State.camera.zoom = 5;
      Game.NPCWorld.drawPresentation();
      const highZoomSize = Number(overlay.dataset.iconSizePx || 0);

      const after = snapshot();
      const presentationAuthority = overlay.dataset.presentationAuthority;
      const pointerEvents = getComputedStyle(overlay).pointerEvents;
      const ariaHidden = overlay.getAttribute('aria-hidden');
      const rect = overlay.getBoundingClientRect().toJSON();
      const visible = Number(overlay.dataset.visibleNpcCount || 0);
      const png = Number(overlay.dataset.pngNpcCount || 0);

      Game.State.camera.zoom = originalZoom;
      Game.NPCWorld.drawPresentation();

      return {
        before,
        after,
        lowZoomSize,
        highZoomSize,
        presentationAuthority,
        pointerEvents,
        ariaHidden,
        rect,
        visible,
        png
      };
    });

    expect(evidence.rect.width).toBeGreaterThan(100);
    expect(evidence.rect.height).toBeGreaterThan(100);
    expect(evidence.visible).toBeGreaterThan(0);
    expect(evidence.png).toBeGreaterThan(0);
    expect(evidence.lowZoomSize).toBeGreaterThanOrEqual(34);
    expect(evidence.lowZoomSize).toBeLessThanOrEqual(64);
    expect(evidence.highZoomSize).toBeGreaterThanOrEqual(34);
    expect(evidence.highZoomSize).toBeLessThanOrEqual(64);
    expect(evidence.highZoomSize).toBeGreaterThan(evidence.lowZoomSize);
    expect(evidence.presentationAuthority).toBe('presentation-only');
    expect(evidence.pointerEvents).toBe('none');
    expect(evidence.ariaHidden).toBe('true');
    expect(evidence.after).toEqual(evidence.before);
    expect(evidence.after.every((npc) => npc.authority === 'simulation')).toBe(true);
  });
}
