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

async function waitForVisibleNpcPngSnapshot(page) {
  const handle = await page.waitForFunction(() => {
    const overlay = document.getElementById('npcWorldOverlay');
    if (!overlay) return false;
    const visible = Number(overlay.dataset.visibleNpcCount || 0);
    const png = Number(overlay.dataset.pngNpcCount || 0);
    const fallback = Number(overlay.dataset.fallbackNpcCount || 0);
    if (!(visible > 0 && png > 0 && png + fallback === visible)) return false;
    return {
      authority: overlay.dataset.presentationAuthority,
      total: Number(overlay.dataset.npcCount || 0),
      visible,
      png,
      fallback,
      pointerEvents: getComputedStyle(overlay).pointerEvents,
      ariaHidden: overlay.getAttribute('aria-hidden')
    };
  });
  return handle.jsonValue();
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

  const evidence = await waitForVisibleNpcPngSnapshot(page);

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
  test(`character PNG overlay keeps stable screen-space size while zoom changes world projection on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await waitForNpcWorld(page);
    const initialEvidence = await waitForVisibleNpcPngSnapshot(page);

    const evidence = await page.evaluate((initial) => {
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
      const player = Game.State.world.player;
      const npc = Game.State.world.npcs[0];

      const samples = [2, 3.5, 5].map((zoom) => {
        Game.State.camera.zoom = zoom;
        Game.NPCWorld.drawPresentation();
        const playerPoint = Game.Renderer.gridToScreen(Number(player.row), Number(player.col), 0, 0);
        const npcPoint = Game.Renderer.gridToScreen(Number(npc.row), Number(npc.col), 0, 0);
        const resolved = Game.NPCWorld.resolveWorldSpaceScale(overlay.clientWidth);
        return {
          zoom,
          iconSize: Number(overlay.dataset.iconSizePx || 0),
          spriteWidth: Number(overlay.dataset.spriteWidthPx || 0),
          spriteHeight: Number(overlay.dataset.spriteHeightPx || 0),
          resolvedWidth: Number(resolved.width || 0),
          resolvedHeight: Number(resolved.height || 0),
          playerPoint,
          npcPoint,
          protagonistRenderKind: overlay.dataset.protagonistRenderKind
        };
      });

      const after = snapshot();
      const presentationAuthority = overlay.dataset.presentationAuthority;
      const pointerEvents = getComputedStyle(overlay).pointerEvents;
      const ariaHidden = overlay.getAttribute('aria-hidden');
      const rect = overlay.getBoundingClientRect().toJSON();

      Game.State.camera.zoom = originalZoom;
      Game.NPCWorld.drawPresentation();

      return {
        before,
        after,
        samples,
        presentationAuthority,
        pointerEvents,
        ariaHidden,
        rect,
        initialVisible: initial.visible,
        initialPng: initial.png
      };
    }, initialEvidence);

    expect(evidence.rect.width).toBeGreaterThan(100);
    expect(evidence.rect.height).toBeGreaterThan(100);
    expect(evidence.initialVisible).toBeGreaterThan(0);
    expect(evidence.initialPng).toBeGreaterThan(0);

    const iconSizes = evidence.samples.map((sample) => sample.iconSize);
    const spriteWidths = evidence.samples.map((sample) => sample.spriteWidth);
    const spriteHeights = evidence.samples.map((sample) => sample.spriteHeight);
    const resolvedWidths = evidence.samples.map((sample) => sample.resolvedWidth);
    const resolvedHeights = evidence.samples.map((sample) => sample.resolvedHeight);

    for (const sample of evidence.samples) {
      expect(sample.iconSize).toBeGreaterThanOrEqual(34);
      expect(sample.iconSize).toBeLessThanOrEqual(64);
      expect(sample.spriteWidth).toBeGreaterThan(0);
      expect(sample.spriteHeight).toBeGreaterThan(sample.spriteWidth);
      expect(sample.protagonistRenderKind).toBe('world-space-png');
      expect(Number.isFinite(sample.playerPoint.x) && Number.isFinite(sample.playerPoint.y)).toBe(true);
      expect(Number.isFinite(sample.npcPoint.x) && Number.isFinite(sample.npcPoint.y)).toBe(true);
    }

    const spread = (values) => Math.max(...values) - Math.min(...values);
    expect(spread(iconSizes)).toBeLessThanOrEqual(0.1);
    expect(spread(spriteWidths)).toBeLessThanOrEqual(0.1);
    expect(spread(spriteHeights)).toBeLessThanOrEqual(0.1);
    expect(spread(resolvedWidths)).toBeLessThanOrEqual(0.1);
    expect(spread(resolvedHeights)).toBeLessThanOrEqual(0.1);

    const first = evidence.samples[0];
    const last = evidence.samples[evidence.samples.length - 1];
    const projectionDelta =
      Math.abs(first.playerPoint.x - last.playerPoint.x) +
      Math.abs(first.playerPoint.y - last.playerPoint.y) +
      Math.abs(first.npcPoint.x - last.npcPoint.x) +
      Math.abs(first.npcPoint.y - last.npcPoint.y);
    expect(projectionDelta).toBeGreaterThan(0.5);

    expect(evidence.presentationAuthority).toBe('presentation-only');
    expect(evidence.pointerEvents).toBe('none');
    expect(evidence.ariaHidden).toBe('true');
    expect(evidence.after).toEqual(evidence.before);
    expect(evidence.after.every((npc) => npc.authority === 'simulation')).toBe(true);
  });
}
