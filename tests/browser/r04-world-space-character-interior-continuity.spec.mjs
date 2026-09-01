import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.NPCWorld?.drawPresentation &&
    window.Game?.WorldSpaceCharacterContinuity?.installed &&
    window.Game?.StarterVillageInteriors?.snapshot &&
    window.Game?.StarterVillageInteriors?.materialize &&
    Array.isArray(window.Game?.State?.world?.originVillage?.buildings) &&
    Array.isArray(window.Game?.State?.world?.npcs) &&
    document.getElementById('npcWorldOverlay') &&
    document.getElementById('starterVillageInteriorOverlay')
  ), null, { timeout: 20_000 });

  // #254 verifies composition with the already-authoritative #253 interior model. The
  // interior cache is lazily materialized, so make the representative state explicit
  // instead of treating cache timing as a product requirement.
  await page.evaluate(() => {
    const G = window.Game;
    if (!G.State.world.buildingInteriors?.interiors?.length) {
      G.StarterVillageInteriors.materialize(G.State.world);
    }
    G.NPCWorld.drawPresentation();
    G.WorldSpaceCharacterContinuity.synchronize();
  });
  await page.waitForFunction(() => Boolean(window.Game?.State?.world?.buildingInteriors?.interiors?.length));
}

test('same authoritative protagonist and NPC sprite identity follows exterior -> interior -> exit', async ({ page }) => {
  await ready(page);

  const evidence = await page.evaluate(() => {
    const G = window.Game;
    const world = G.State.world;
    const interior = G.StarterVillageInteriors.snapshot().interiors.find((entry) => entry.floors.length >= 3);
    if (!interior) throw new Error('Representative interior evidence unavailable');
    const floors = interior.floors.filter((point) => point.row !== interior.door.row || point.col !== interior.door.col);
    const npc = world.npcs.find((entry) => Boolean(G.NPCWorld.worldSpaceAssetFor(entry)));
    if (floors.length < 2 || !npc) throw new Error('Representative interior/NPC evidence unavailable');

    const locationState = (character) => ({
      row: character.row,
      col: character.col,
      targetRow: character.targetRow,
      targetCol: character.targetCol,
      moving: character.moving
    });
    const player = world.player;
    const playerBefore = locationState(player);
    const npcBefore = { ...locationState(npc), id: npc.id, authority: npc.authority, occupation: npc.occupation };
    const playerAssetBefore = G.NPCWorld.protagonistWorldSpaceAssetFor(player);
    const npcAssetBefore = G.NPCWorld.worldSpaceAssetFor(npc);

    const moveExact = (character, point) => {
      character.row = point.row;
      character.col = point.col;
      if ('targetRow' in character) character.targetRow = point.row;
      if ('targetCol' in character) character.targetCol = point.col;
      if ('moving' in character) character.moving = false;
    };

    try {
      moveExact(player, floors[0]);
      moveExact(npc, floors[1]);
      G.NPCWorld.drawPresentation();
      G.WorldSpaceCharacterContinuity.synchronize();

      const inside = G.WorldSpaceCharacterContinuity.snapshot();
      const insideNpc = inside.npcs.find((entry) => entry.id === npc.id);
      const overlay = document.getElementById('npcWorldOverlay');
      const interiorOverlay = document.getElementById('starterVillageInteriorOverlay');
      const interiorLayer = Number.parseInt(getComputedStyle(interiorOverlay).zIndex || '0', 10) || 0;
      const characterLayer = Number.parseInt(getComputedStyle(overlay).zIndex || '0', 10) || 0;

      moveExact(player, interior.entrance);
      moveExact(npc, interior.entrance);
      G.NPCWorld.drawPresentation();
      G.WorldSpaceCharacterContinuity.synchronize();
      const outside = G.WorldSpaceCharacterContinuity.snapshot();
      const outsideNpc = outside.npcs.find((entry) => entry.id === npc.id);

      return {
        authority: inside.authority,
        version: inside.version,
        buildingId: interior.buildingId,
        playerAssetBefore,
        npcAssetBefore,
        insidePlayer: inside.protagonist,
        insideNpc,
        outsidePlayer: outside.protagonist,
        outsideNpc,
        characterLayer,
        interiorLayer,
        spriteAnchor: overlay.dataset.spriteAnchor,
        continuityVersion: overlay.dataset.interiorContinuityVersion,
        playerBefore,
        npcBefore,
        npcAuthorityAfterDraw: npc.authority,
        npcOccupationAfterDraw: npc.occupation
      };
    } finally {
      Object.assign(player, playerBefore);
      Object.assign(npc, npcBefore);
      G.NPCWorld.drawPresentation();
      G.WorldSpaceCharacterContinuity.synchronize();
    }
  });

  expect(evidence.authority).toBe('presentation-only');
  expect(evidence.version).toBe('r04-world-space-character-interior-continuity-v1');
  expect(evidence.continuityVersion).toBe(evidence.version);
  expect(evidence.insidePlayer.buildingId).toBe(evidence.buildingId);
  expect(evidence.insideNpc.buildingId).toBe(evidence.buildingId);
  expect(evidence.insidePlayer.locationLayer).toBe('interior');
  expect(evidence.insideNpc.locationLayer).toBe('interior');
  expect(evidence.outsidePlayer.locationLayer).toBe('exterior');
  expect(evidence.outsideNpc.locationLayer).toBe('exterior');
  expect(evidence.insidePlayer.asset).toBe(evidence.playerAssetBefore);
  expect(evidence.outsidePlayer.asset).toBe(evidence.playerAssetBefore);
  expect(evidence.insideNpc.asset).toBe(evidence.npcAssetBefore);
  expect(evidence.outsideNpc.asset).toBe(evidence.npcAssetBefore);
  expect(evidence.insidePlayer.spriteAnchor).toBe('bottom-center-feet');
  expect(evidence.insideNpc.spriteAnchor).toBe('bottom-center-feet');
  expect(evidence.spriteAnchor).toBe('bottom-center-feet');
  expect(evidence.characterLayer).toBeGreaterThan(evidence.interiorLayer);
  expect(evidence.npcAuthorityAfterDraw).toBe(evidence.npcBefore.authority);
  expect(evidence.npcOccupationAfterDraw).toBe(evidence.npcBefore.occupation);
});

test('interior continuity bridge is presentation-only and does not serialize duplicate character state', async ({ page }) => {
  await ready(page);

  const evidence = await page.evaluate(() => {
    const G = window.Game;
    const before = JSON.stringify({
      player: G.State.world.player,
      npcs: G.State.world.npcs,
      originVillage: G.State.world.originVillage
    });
    const first = G.WorldSpaceCharacterContinuity.snapshot();
    G.WorldSpaceCharacterContinuity.synchronize();
    G.NPCWorld.drawPresentation();
    G.WorldSpaceCharacterContinuity.synchronize();
    const second = G.WorldSpaceCharacterContinuity.snapshot();
    const after = JSON.stringify({
      player: G.State.world.player,
      npcs: G.State.world.npcs,
      originVillage: G.State.world.originVillage
    });
    return {
      before,
      after,
      firstAuthority: first.authority,
      secondAuthority: second.authority,
      stablePlayerAsset: first.protagonist?.asset === second.protagonist?.asset,
      stableNpcAssets: first.npcs.map((entry) => [entry.id, entry.asset]),
      secondNpcAssets: second.npcs.map((entry) => [entry.id, entry.asset])
    };
  });

  expect(evidence.after).toBe(evidence.before);
  expect(evidence.firstAuthority).toBe('presentation-only');
  expect(evidence.secondAuthority).toBe('presentation-only');
  expect(evidence.stablePlayerAsset).toBe(true);
  expect(evidence.secondNpcAssets).toEqual(evidence.stableNpcAssets);
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 }
]) {
  test(`world-space character layer remains bounded above interior presentation on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await ready(page);
    const evidence = await page.evaluate(() => {
      const G = window.Game;
      G.WorldSpaceCharacterContinuity.synchronize();
      G.NPCWorld.drawPresentation();
      const overlay = document.getElementById('npcWorldOverlay');
      const interior = document.getElementById('starterVillageInteriorOverlay');
      const rect = overlay.getBoundingClientRect();
      return {
        characterLayer: Number.parseInt(getComputedStyle(overlay).zIndex || '0', 10) || 0,
        interiorLayer: Number.parseInt(getComputedStyle(interior).zIndex || '0', 10) || 0,
        width: rect.width,
        height: rect.height,
        pointerEvents: getComputedStyle(overlay).pointerEvents,
        ariaHidden: overlay.getAttribute('aria-hidden')
      };
    });
    expect(evidence.characterLayer).toBeGreaterThan(evidence.interiorLayer);
    expect(evidence.width).toBeGreaterThan(100);
    expect(evidence.height).toBeGreaterThan(100);
    expect(evidence.pointerEvents).toBe('none');
    expect(evidence.ariaHidden).toBe('true');
  });
}
