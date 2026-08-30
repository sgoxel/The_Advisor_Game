import { test, expect } from '@playwright/test';

async function waitForExteriorSprites(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCWorld?.worldSpaceAssetFor &&
    window.Game?.NPCWorld?.protagonistWorldSpaceAssetFor &&
    window.Game?.NPCWorld?.resolveWorldSpaceScale &&
    window.Game?.NPCBubbleLayout?.installed &&
    Array.isArray(window.Game?.State?.world?.npcs) &&
    window.Game.State.world.npcs.length >= 12 &&
    document.getElementById('npcWorldOverlay')
  ));
  await page.waitForFunction(() => {
    const overlay = document.getElementById('npcWorldOverlay');
    return overlay?.dataset.presentationVersion === 'r04-exterior-world-space-sprites-v1' &&
      overlay?.dataset.protagonistRenderKind === 'world-space-png';
  });
}

function rectanglesOverlap(a, b) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

test('approved #252 world-space PNG families bind only from authoritative exterior character state', async ({ page }) => {
  await waitForExteriorSprites(page);

  for (const path of [
    'assets/characters/world-space/protagonist.png',
    'assets/characters/world-space/guard.png',
    'assets/characters/world-space/merchant.png'
  ]) {
    const response = await page.request.get(path);
    expect(response.ok(), path).toBe(true);
    expect(response.headers()['content-type'] || '').toContain('image/png');
  }

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const npcs = Game.NPCWorld.capture();
    const player = Game.State.world.player;
    return {
      authority: Game.NPCWorld.authority,
      presentationAuthority: Game.NPCWorld.presentationAuthority,
      presentationVersion: Game.NPCWorld.presentationVersion,
      protagonist: Game.NPCWorld.protagonistWorldSpaceAssetFor(player),
      mapped: npcs.map((npc) => ({
        id: npc.id,
        authority: npc.authority,
        occupation: npc.occupation,
        worldSpace: Game.NPCWorld.worldSpaceAssetFor(npc),
        compatibilityIcon: Game.NPCWorld.worldIconAssetFor(npc)
      })),
      rejectsPresentationNpc: Game.NPCWorld.worldSpaceAssetFor({ authority: 'presentation', occupation: 'guard' }),
      rejectsMissingPlayer: Game.NPCWorld.protagonistWorldSpaceAssetFor({ row: NaN, col: 1 })
    };
  });

  expect(evidence.authority).toBe('simulation');
  expect(evidence.presentationAuthority).toBe('presentation-only');
  expect(evidence.presentationVersion).toBe('r04-exterior-world-space-sprites-v1');
  expect(evidence.protagonist).toBe('assets/characters/world-space/protagonist.png');
  expect(evidence.rejectsPresentationNpc).toBe('');
  expect(evidence.rejectsMissingPlayer).toBe('');
  expect(evidence.mapped.every((npc) => npc.authority === 'simulation')).toBe(true);
  expect(evidence.mapped.some((npc) => npc.occupation === 'guard' && npc.worldSpace.endsWith('/world-space/guard.png'))).toBe(true);
  expect(evidence.mapped.some((npc) => ['innkeeper', 'trader'].includes(npc.occupation) && npc.worldSpace.endsWith('/world-space/merchant.png'))).toBe(true);
  expect(evidence.mapped.some((npc) => !npc.worldSpace && Boolean(npc.compatibilityIcon))).toBe(true);
});

test('feet-anchored sprite redraw and fallback presentation cannot mutate protagonist or NPC authority', async ({ page }) => {
  await waitForExteriorSprites(page);

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    const overlay = document.getElementById('npcWorldOverlay');
    const playerSnapshot = () => {
      const p = Game.State.world.player;
      return {
        row: p.row,
        col: p.col,
        moving: Boolean(p.moving),
        startRow: p.startRow,
        startCol: p.startCol,
        targetRow: p.targetRow,
        targetCol: p.targetCol
      };
    };
    const npcSnapshot = () => Game.NPCWorld.capture().map((npc) => ({
      id: npc.id,
      authority: npc.authority,
      controlledBy: npc.controlledBy,
      playerControllable: npc.playerControllable,
      occupation: npc.occupation,
      row: npc.row,
      col: npc.col,
      localRow: npc.localRow,
      localCol: npc.localCol,
      activity: npc.activity
    }));

    const before = { player: playerSnapshot(), npcs: npcSnapshot() };
    Game.NPCWorld.drawPresentation();
    const after = { player: playerSnapshot(), npcs: npcSnapshot() };

    return {
      before,
      after,
      spriteAnchor: overlay.dataset.spriteAnchor,
      protagonistVisible: overlay.dataset.protagonistVisible,
      protagonistRenderKind: overlay.dataset.protagonistRenderKind,
      spriteWidth: Number(overlay.dataset.spriteWidthPx || 0),
      spriteHeight: Number(overlay.dataset.spriteHeightPx || 0),
      pngNpcCount: Number(overlay.dataset.pngNpcCount || 0),
      fallbackNpcCount: Number(overlay.dataset.fallbackNpcCount || 0),
      pointerEvents: getComputedStyle(overlay).pointerEvents,
      ariaHidden: overlay.getAttribute('aria-hidden')
    };
  });

  expect(evidence.after).toEqual(evidence.before);
  expect(evidence.after.npcs.every((npc) => npc.authority === 'simulation' && npc.controlledBy === 'simulation' && npc.playerControllable === false)).toBe(true);
  expect(evidence.spriteAnchor).toBe('bottom-center-feet');
  expect(evidence.protagonistVisible).toBe('true');
  expect(evidence.protagonistRenderKind).toBe('world-space-png');
  expect(evidence.spriteWidth).toBeGreaterThan(0);
  expect(evidence.spriteHeight).toBeGreaterThan(evidence.spriteWidth);
  expect(evidence.pngNpcCount).toBeGreaterThan(0);
  expect(evidence.fallbackNpcCount).toBeGreaterThan(0);
  expect(evidence.pointerEvents).toBe('none');
  expect(evidence.ariaHidden).toBe('true');
});

test('activity bubbles remain screen-space feedback attached above world-space character bodies', async ({ page }) => {
  await waitForExteriorSprites(page);

  const evidence = await page.evaluate(() => {
    const Game = window.Game;
    Game.NPCWorld.drawPresentation();
    Game.NPCBubbleLayout.draw();
    const overlay = document.getElementById('npcWorldOverlay');
    const layout = Game.NPCBubbleLayout.snapshot();
    const spriteWidth = Number(overlay.dataset.spriteWidthPx || 0);
    const spriteHeight = Number(overlay.dataset.spriteHeightPx || 0);
    const npcById = new Map(Game.State.world.npcs.map((npc) => [npc.id, npc]));
    const activityPairs = (layout?.boxes || [])
      .filter((box) => box.kind === 'activity' && npcById.has(box.id))
      .map((box) => {
        const npc = npcById.get(box.id);
        const point = Game.Renderer.gridToScreen(npc.row, npc.col, 0, 0);
        return {
          box: box.rect,
          sprite: {
            left: point.x - spriteWidth / 2,
            right: point.x + spriteWidth / 2,
            top: point.y - spriteHeight,
            bottom: point.y
          }
        };
      });
    return {
      authority: layout?.authority,
      spriteWidth,
      spriteHeight,
      overlapCount: activityPairs.filter(({ box, sprite }) => !(box.right <= sprite.left || box.left >= sprite.right || box.bottom <= sprite.top || box.top >= sprite.bottom)).length,
      pairCount: activityPairs.length
    };
  });

  expect(evidence.authority).toBe('presentation-only');
  expect(evidence.pairCount).toBeGreaterThan(0);
  expect(evidence.spriteWidth).toBeGreaterThan(0);
  expect(evidence.spriteHeight).toBeGreaterThan(0);
  expect(evidence.overlapCount).toBe(0);
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844, min: 34, max: 52 },
  { name: 'tablet', width: 820, height: 1180, min: 38, max: 58 },
  { name: 'desktop', width: 1440, height: 900, min: 42, max: 64 }
]) {
  test(`exterior sprite sizing remains bounded and feet-anchored on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await waitForExteriorSprites(page);

    const evidence = await page.evaluate(() => {
      const Game = window.Game;
      const overlay = document.getElementById('npcWorldOverlay');
      const originalZoom = Number(Game.State.camera.zoom);
      Game.State.camera.zoom = 5;
      Game.NPCWorld.drawPresentation();
      const player = Game.State.world.player;
      const base = Game.Renderer.gridToScreen(player.row, player.col, 0, 0);
      const result = {
        width: Number(overlay.dataset.spriteWidthPx || 0),
        height: Number(overlay.dataset.spriteHeightPx || 0),
        anchor: overlay.dataset.spriteAnchor,
        protagonistVisible: overlay.dataset.protagonistVisible,
        protagonistRenderKind: overlay.dataset.protagonistRenderKind,
        baseFinite: Number.isFinite(base.x) && Number.isFinite(base.y),
        overlayRect: overlay.getBoundingClientRect().toJSON()
      };
      Game.State.camera.zoom = originalZoom;
      Game.NPCWorld.drawPresentation();
      return result;
    });

    expect(evidence.height).toBeGreaterThanOrEqual(viewport.min);
    expect(evidence.height).toBeLessThanOrEqual(viewport.max);
    expect(evidence.width / evidence.height).toBeCloseTo(0.8, 1);
    expect(evidence.anchor).toBe('bottom-center-feet');
    expect(evidence.protagonistVisible).toBe('true');
    expect(evidence.protagonistRenderKind).toBe('world-space-png');
    expect(evidence.baseFinite).toBe(true);
    expect(evidence.overlayRect.width).toBeGreaterThan(100);
    expect(evidence.overlayRect.height).toBeGreaterThan(100);
  });
}
