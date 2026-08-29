import { test, expect } from '@playwright/test';

const registryEntries = [
  { family: 'rock', type: 'cluster_small', size: 256, source: 'tests/fixtures/world-objects/rock_cluster_small.png' },
  { family: 'well', type: 'stone_round', size: 256, source: 'tests/fixtures/world-objects/well_stone_round.png' },
  { family: 'flagpole', type: 'village_standard', size: 256, source: 'tests/fixtures/world-objects/flagpole_village_standard.png' },
  { family: 'fence', type: 'straight_ns', size: 256, source: 'tests/fixtures/world-objects/fence_straight_ns.png' },
  { family: 'wagon', type: 'parked_side', size: 256, source: 'tests/fixtures/world-objects/wagon_parked_side.png' },
];

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.WorldObjectPresentationDescriptor?.describe &&
    window.Game?.WorldObjectRenderer?.configureRegistry &&
    window.Game?.NPCWorld?.capture &&
    window.Game?.Renderer?.gridToScreen
  ), null, { timeout: 20_000 });
  await page.waitForFunction(() => {
    const npcs = window.Game?.NPCWorld?.capture?.() || [];
    return npcs.some((npc) => Number.isFinite(Number(npc?.row)) && Number.isFinite(Number(npc?.col)));
  }, null, { timeout: 20_000 });
}

async function configureRepresentativeScene(page, includeMissing = false) {
  return page.evaluate(async ({ entries, includeMissing }) => {
    const Game = window.Game;
    const descriptorApi = Game.WorldObjectPresentationDescriptor;
    const renderer = Game.WorldObjectRenderer;
    const projection = Game.Renderer;
    const existingNpcs = Game.NPCWorld.capture().filter((npc) =>
      Number.isFinite(Number(npc?.row)) && Number.isFinite(Number(npc?.col))
    );
    const selectedNpc = existingNpcs[0];
    if (!selectedNpc) throw new Error('A live Simulation-owned NPC is required for composition verification.');

    const row = Math.max(10, Math.min(86, Math.round(Number(selectedNpc.row))));
    const col = Math.max(10, Math.min(86, Math.round(Number(selectedNpc.col))));
    const npcPoint = projection.gridToScreen(Number(selectedNpc.row), Number(selectedNpc.col), 0, 0);

    function depthPosition(wantFront) {
      const candidates = [];
      for (let dr = -6; dr <= 6; dr += 1) {
        for (let dc = -6; dc <= 6; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          const candidateRow = Math.max(2, Math.min(97, row + dr));
          const candidateCol = Math.max(2, Math.min(97, col + dc));
          const point = projection.gridToScreen(candidateRow, candidateCol, 0, 0);
          const delta = Number(point.y) - Number(npcPoint.y);
          if ((wantFront && delta > 24) || (!wantFront && delta < -24)) {
            candidates.push({ row: candidateRow, col: candidateCol, delta });
          }
        }
      }
      if (!candidates.length) throw new Error(`Unable to find ${wantFront ? 'front' : 'behind'} depth fixture position.`);
      candidates.sort((a, b) => wantFront ? b.delta - a.delta : a.delta - b.delta);
      return candidates[0];
    }

    const behindPosition = depthPosition(false);
    const frontPosition = depthPosition(true);

    const describe = (input) => descriptorApi.describe({
      position: { regionX: 0, regionY: 0, row, col },
      footprint: { width: 1, height: 1 },
      blocking: false,
      walkable: true,
      interaction: null,
      ...input
    });

    const descriptors = [
      describe({
        objectId: 'prop:rock',
        semanticType: 'rock',
        position: { regionX: 0, regionY: 0, row: row - 2, col },
        blocking: true,
        walkable: false,
        visual: {
          semanticKey: 'rock.cluster_small', assetAvailable: true,
          bounds: { width: 256, height: 192 }, anchor: { x: 0.5, y: 1 }, overhangAllowed: true
        }
      }),
      describe({
        objectId: 'prop:well',
        semanticType: 'well',
        position: { regionX: 0, regionY: 0, row: row - 1, col: col + 1 },
        interaction: { enabled: true, kind: 'draw-water' },
        visual: {
          semanticKey: 'well.stone_round', assetAvailable: true,
          bounds: { width: 256, height: 224 }, anchor: { x: 0.5, y: 1 }, overhangAllowed: true
        }
      }),
      describe({
        objectId: 'prop:flag-behind',
        semanticType: 'flagpole',
        position: { regionX: 0, regionY: 0, row: behindPosition.row, col: behindPosition.col },
        visual: {
          semanticKey: 'flagpole.village_standard', assetAvailable: true,
          bounds: { width: 160, height: 512 }, anchor: { x: 0.5, y: 1 }, overhangAllowed: true
        }
      }),
      describe({
        objectId: 'prop:flag-front',
        semanticType: 'flagpole',
        position: { regionX: 0, regionY: 0, row: frontPosition.row, col: frontPosition.col },
        visual: {
          semanticKey: 'flagpole.village_standard', assetAvailable: true,
          bounds: { width: 160, height: 512 }, anchor: { x: 0.5, y: 1 }, overhangAllowed: true
        }
      }),
      describe({
        objectId: 'prop:fence',
        semanticType: 'fence',
        position: { regionX: 0, regionY: 0, row: row + 1, col: col + 2 },
        footprint: {
          occupiedCells: [
            { row: row + 1, col: col + 2 },
            { row: row + 2, col: col + 2 },
            { row: row + 3, col: col + 2 }
          ]
        },
        blocking: true,
        walkable: false,
        visual: {
          semanticKey: 'fence.straight_ns', assetAvailable: true,
          bounds: { width: 256, height: 320 }, anchor: { x: 0.5, y: 1 }, overhangAllowed: true
        }
      }),
      describe({
        objectId: 'prop:wagon-parked',
        semanticType: 'wagon',
        position: { regionX: 0, regionY: 0, row: row + 2, col: col - 3 },
        footprint: { width: 3, height: 2 },
        blocking: true,
        walkable: false,
        interaction: { enabled: true, kind: 'inspect' },
        visual: {
          semanticKey: 'wagon.parked_side', assetAvailable: true,
          bounds: { width: 512, height: 256 }, anchor: { x: 0.5, y: 1 }, overhangAllowed: true
        }
      }),
      describe({
        objectId: 'entity:wagon-moving',
        semanticType: 'wagon',
        position: { regionX: 0, regionY: 0, row: row + 3, col: col - 1 },
        footprint: {
          occupiedCells: [
            { row: row + 3, col: col - 1 },
            { row: row + 3, col }
          ]
        },
        blocking: true,
        walkable: false,
        interaction: { enabled: true, kind: 'inspect' },
        entity: { entityId: 'wagon:moving:01', moving: true, state: 'travelling' },
        visual: {
          semanticKey: 'wagon.parked_side', assetAvailable: true,
          bounds: { width: 512, height: 256 }, anchor: { x: 0.5, y: 1 }, overhangAllowed: true
        }
      })
    ];

    if (includeMissing) {
      descriptors.push(describe({
        objectId: 'prop:missing-art',
        semanticType: 'rock',
        position: { regionX: 0, regionY: 0, row: row + 4, col: col + 1 },
        blocking: true,
        walkable: false,
        interaction: { enabled: true, kind: 'inspect' },
        visual: {
          semanticKey: 'rock.missing_art', assetAvailable: true,
          bounds: { width: 1024, height: 768 }, anchor: { x: 0.5, y: 1 }, overhangAllowed: true
        }
      }));
    }

    const authoritativeSnapshot = (descriptor) => JSON.stringify({
      objectId: descriptor.objectId,
      position: descriptor.position,
      footprint: descriptor.footprint,
      blocking: descriptor.blocking,
      walkable: descriptor.walkable,
      interaction: descriptor.interaction,
      entity: descriptor.entity
    });
    const fingerprintsBefore = descriptors.map((descriptor) => descriptorApi.fingerprint(descriptor));
    const authorityBefore = descriptors.map(authoritativeSnapshot);

    await renderer.configureRegistry(entries);
    renderer.setDescriptors(descriptors, { source: 'r04-294-browser-fixture' });
    const assetDiagnostics = await renderer.ensureAssets();
    renderer.drawPresentation();

    const fingerprintsAfter = descriptors.map((descriptor) => descriptorApi.fingerprint(descriptor));
    const authorityAfter = descriptors.map(authoritativeSnapshot);
    const overlay = document.getElementById('worldObjectCompositionOverlay');
    const npcOverlay = document.getElementById('npcWorldOverlay');

    return {
      row,
      col,
      selectedNpcId: selectedNpc.id,
      descriptors: descriptors.map((descriptor) => JSON.parse(JSON.stringify(descriptor))),
      fingerprintsBefore,
      fingerprintsAfter,
      authorityBefore,
      authorityAfter,
      assets: assetDiagnostics,
      composition: renderer.snapshotComposition(),
      overlay: {
        authority: overlay?.dataset.presentationAuthority,
        descriptorAuthority: overlay?.dataset.descriptorAuthority,
        source: overlay?.dataset.descriptorSource,
        objectCount: Number(overlay?.dataset.objectCount || 0),
        readyObjectCount: Number(overlay?.dataset.readyObjectCount || 0),
        missingObjectCount: Number(overlay?.dataset.missingObjectCount || 0),
        worldEntityCount: Number(overlay?.dataset.worldEntityCount || 0),
        composedNpcCount: Number(overlay?.dataset.composedNpcCount || 0),
        depthOrder: overlay?.dataset.depthOrder,
        registryEntryCount: Number(overlay?.dataset.registryEntryCount || 0),
        pointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : null,
        width: overlay?.clientWidth || 0,
        height: overlay?.clientHeight || 0
      },
      npcOverlayVisibility: npcOverlay ? getComputedStyle(npcOverlay).visibility : null
    };
  }, { entries: registryEntries, includeMissing });
}

test.describe('R04 #294 generalized transparent world-object composition', () => {
  test('semantic transparent PNGs compose without mutating Simulation-owned object truth', async ({ page }) => {
    await ready(page);
    const evidence = await configureRepresentativeScene(page);

    expect(evidence.authorityAfter).toEqual(evidence.authorityBefore);
    expect(evidence.fingerprintsAfter).toEqual(evidence.fingerprintsBefore);
    expect(evidence.overlay).toMatchObject({
      authority: 'presentation-only',
      descriptorAuthority: 'simulation',
      source: 'r04-294-browser-fixture',
      objectCount: 7,
      readyObjectCount: 7,
      missingObjectCount: 0,
      worldEntityCount: 1,
      registryEntryCount: 5,
      pointerEvents: 'none',
      depthOrder: 'authoritative-ground-baseline'
    });
    expect(evidence.overlay.composedNpcCount).toBeGreaterThan(0);
    expect(evidence.assets).toHaveLength(5);
    expect(evidence.assets.every((asset) => asset.status === 'ready')).toBe(true);
    expect(evidence.assets.every((asset) => asset.hasTransparency === true)).toBe(true);
    expect(evidence.npcOverlayVisibility).toBe('hidden');
  });

  test('multi-tile, overhang and moving entity classes stay descriptor-owned', async ({ page }) => {
    await ready(page);
    const evidence = await configureRepresentativeScene(page);

    const wagon = evidence.descriptors.find((entry) => entry.objectId === 'prop:wagon-parked');
    const moving = evidence.descriptors.find((entry) => entry.objectId === 'entity:wagon-moving');
    const flag = evidence.descriptors.find((entry) => entry.objectId === 'prop:flag-front');
    expect(wagon.presentationClass).toBe('multi-tile-prop');
    expect(wagon.footprint.occupiedCells).toHaveLength(6);
    expect(wagon.visual.bounds).toEqual({ width: 512, height: 256 });
    expect(moving.presentationClass).toBe('world-entity');
    expect(moving.entity).toEqual({ entityId: 'wagon:moving:01', moving: true, state: 'travelling' });
    expect(flag.footprint.occupiedCells).toHaveLength(1);
    expect(flag.visual.bounds.height).toBeGreaterThan(flag.visual.bounds.width);

    const wagonDraw = evidence.composition.find((entry) => entry.id === 'prop:wagon-parked');
    const flagDraw = evidence.composition.find((entry) => entry.id === 'prop:flag-front');
    expect(wagonDraw.displayWidth).toBeGreaterThan(18);
    expect(flagDraw.displayHeight).toBeGreaterThan(flagDraw.displayWidth);
  });

  test('ground-baseline sorting places a live world-space character between behind/front tall props', async ({ page }) => {
    await ready(page);
    const evidence = await configureRepresentativeScene(page);
    const order = evidence.composition.map((entry) => `${entry.kind}:${entry.id}`);
    const behind = order.indexOf('object:prop:flag-behind');
    const npc = order.indexOf(`npc:${evidence.selectedNpcId}`);
    const front = order.indexOf('object:prop:flag-front');
    expect(behind).toBeGreaterThanOrEqual(0);
    expect(npc).toBeGreaterThan(behind);
    expect(front).toBeGreaterThan(npc);
  });

  test('missing semantic art is visible fallback and cannot erase authoritative blocking/interaction truth', async ({ page }) => {
    await ready(page);
    const evidence = await configureRepresentativeScene(page, true);
    const missing = evidence.descriptors.find((entry) => entry.objectId === 'prop:missing-art');
    const missingDraw = evidence.composition.find((entry) => entry.id === 'prop:missing-art');
    expect(missing.blocking).toBe(true);
    expect(missing.walkable).toBe(false);
    expect(missing.interaction).toEqual({ enabled: true, kind: 'inspect' });
    expect(missingDraw.assetStatus).toBe('failed');
    expect(evidence.overlay.missingObjectCount).toBeGreaterThanOrEqual(1);
    expect(evidence.authorityAfter).toEqual(evidence.authorityBefore);
    expect(evidence.fingerprintsAfter).toEqual(evidence.fingerprintsBefore);
  });

  for (const viewport of [
    { name: 'phone', width: 390, height: 844 },
    { name: 'tablet', width: 820, height: 1180 },
    { name: 'desktop', width: 1440, height: 900 }
  ]) {
    test(`composition remains bounded and passive on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await ready(page);
      const evidence = await configureRepresentativeScene(page);
      expect(evidence.overlay.objectCount).toBe(7);
      expect(evidence.overlay.readyObjectCount).toBe(7);
      expect(evidence.overlay.pointerEvents).toBe('none');
      for (const entry of evidence.composition.filter((item) => item.kind === 'object')) {
        expect(entry.displayWidth).toBeGreaterThanOrEqual(18);
        expect(entry.displayHeight).toBeGreaterThanOrEqual(18);
        expect(entry.displayWidth).toBeLessThanOrEqual(Math.max(48, evidence.overlay.width * 0.28) + 0.5);
        expect(entry.displayHeight).toBeLessThanOrEqual(Math.max(72, evidence.overlay.height * 0.42) + 0.5);
      }
    });
  }
});
