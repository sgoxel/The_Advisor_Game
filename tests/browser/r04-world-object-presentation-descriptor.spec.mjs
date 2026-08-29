import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.WorldObjectPresentationDescriptor), null, { timeout: 20_000 });
}

function base(overrides = {}) {
  return {
    objectId: 'starter:rock:01',
    semanticType: 'rock',
    position: { regionX: 0, regionY: 0, row: 12, col: 18 },
    footprint: { width: 1, height: 1 },
    blocking: true,
    walkable: false,
    interaction: null,
    visual: {
      semanticKey: 'rock.small',
      assetAvailable: true,
      assetPath: 'assets/world/rock.png',
      bounds: { width: 256, height: 256 },
      anchor: { x: 0.5, y: 1 },
      overhangAllowed: true
    },
    ...overrides
  };
}

test.describe('R04 #293 Simulation-backed world-object descriptor', () => {
  test.beforeEach(async ({ page }) => ready(page));

  test('one-tile static prop keeps gameplay truth separate from visual metadata', async ({ page }) => {
    const result = await page.evaluate((input) => {
      const api = window.Game.WorldObjectPresentationDescriptor;
      const before = window.Game.State ? JSON.stringify(window.Game.State) : null;
      const descriptor = api.describe(input);
      const after = window.Game.State ? JSON.stringify(window.Game.State) : null;
      return {
        descriptor,
        frozen: Object.isFrozen(descriptor) && Object.isFrozen(descriptor.position) && Object.isFrozen(descriptor.footprint),
        before,
        after
      };
    }, base());

    expect(result.descriptor.authority).toBe('simulation');
    expect(result.descriptor.presentationClass).toBe('static-prop');
    expect(result.descriptor.footprint.occupiedCells).toEqual([{ row: 12, col: 18 }]);
    expect(result.descriptor.blocking).toBe(true);
    expect(result.descriptor.walkable).toBe(false);
    expect(result.descriptor.visual.authority).toBe('presentation');
    expect(result.descriptor.visual.nonAuthoritative).toBe(true);
    expect(result.frozen).toBe(true);
    expect(result.after).toBe(result.before);
  });

  test('multi-tile footprint is explicit and never inferred from 256px visual cells', async ({ page }) => {
    const descriptor = await page.evaluate((input) => window.Game.WorldObjectPresentationDescriptor.describe(input), base({
      objectId: 'starter:wagon:01',
      semanticType: 'wagon',
      position: { regionX: 0, regionY: 0, row: 30, col: 40 },
      footprint: { width: 3, height: 2 },
      blocking: true,
      walkable: false,
      visual: {
        semanticKey: 'wagon.parked',
        assetAvailable: true,
        assetPath: 'assets/world/wagon_256.png',
        bounds: { width: 256, height: 256 },
        overhangAllowed: true
      }
    }));

    expect(descriptor.presentationClass).toBe('multi-tile-prop');
    expect(descriptor.footprint.width).toBe(3);
    expect(descriptor.footprint.height).toBe(2);
    expect(descriptor.footprint.occupiedCells).toHaveLength(6);
    expect(descriptor.visual.bounds).toEqual({ width: 256, height: 256 });
  });

  test('visual overhang, path and missing asset cannot change authoritative identity or footprint', async ({ page }) => {
    const result = await page.evaluate((input) => {
      const api = window.Game.WorldObjectPresentationDescriptor;
      const first = api.describe(input);
      const second = api.describe({
        ...input,
        visual: {
          semanticKey: 'rock.alternate',
          assetAvailable: false,
          assetPath: 'missing/not-authoritative.png',
          bounds: { width: 1024, height: 768 },
          anchor: { x: 0.1, y: 0.9 },
          overhangAllowed: true
        }
      });
      return {
        first,
        second,
        firstFingerprint: api.fingerprint(first),
        secondFingerprint: api.fingerprint(second)
      };
    }, base());

    expect(result.second.visual.assetAvailable).toBe(false);
    expect(result.second.visual.bounds).toEqual({ width: 1024, height: 768 });
    expect(result.second.objectId).toBe(result.first.objectId);
    expect(result.second.position).toEqual(result.first.position);
    expect(result.second.footprint).toEqual(result.first.footprint);
    expect(result.second.blocking).toBe(result.first.blocking);
    expect(result.second.interaction).toEqual(result.first.interaction);
    expect(result.secondFingerprint).toBe(result.firstFingerprint);
  });

  test('interactable well remains authoritative when its visual asset is unavailable', async ({ page }) => {
    const descriptor = await page.evaluate((input) => window.Game.WorldObjectPresentationDescriptor.describe(input), base({
      objectId: 'starter:well:01',
      semanticType: 'well',
      blocking: false,
      walkable: true,
      interaction: { enabled: true, kind: 'draw-water' },
      visual: { semanticKey: 'well.stone', assetAvailable: false, assetPath: null }
    }));

    expect(descriptor.interaction).toEqual({ enabled: true, kind: 'draw-water' });
    expect(descriptor.visual.assetAvailable).toBe(false);
    expect(descriptor.authority).toBe('simulation');
  });

  test('moving cart keeps stable entity identity and authoritative position', async ({ page }) => {
    const result = await page.evaluate((input) => {
      const api = window.Game.WorldObjectPresentationDescriptor;
      const first = api.describe(input);
      const repeated = api.describe(input);
      return { first, repeated, same: api.fingerprint(first) === api.fingerprint(repeated) };
    }, base({
      objectId: 'entity:cart:07',
      semanticType: 'cart',
      position: { regionX: -2, regionY: 5, row: 44, col: 9 },
      footprint: {
        occupiedCells: [
          { row: 44, col: 9 },
          { row: 44, col: 10 }
        ]
      },
      blocking: true,
      walkable: false,
      interaction: { enabled: true, kind: 'inspect' },
      entity: { entityId: 'cart:07', moving: true, state: 'travelling' },
      visual: { semanticKey: 'cart.wagon', assetAvailable: true, bounds: { width: 512, height: 256 }, overhangAllowed: true }
    }));

    expect(result.same).toBe(true);
    expect(result.first.presentationClass).toBe('world-entity');
    expect(result.first.entity).toEqual({ entityId: 'cart:07', moving: true, state: 'travelling' });
    expect(result.first.position).toEqual({ regionX: -2, regionY: 5, row: 44, col: 9 });
    expect(result.first.footprint.occupiedCells).toEqual([{ row: 44, col: 9 }, { row: 44, col: 10 }]);
  });

  test('fence/gate semantics remain explicit while footprint comes only from Simulation input', async ({ page }) => {
    const result = await page.evaluate(() => {
      const api = window.Game.WorldObjectPresentationDescriptor;
      const fence = api.describe({
        objectId: 'starter:fence:west:01', semanticType: 'fence',
        position: { regionX: 0, regionY: 0, row: 60, col: 21 },
        footprint: { occupiedCells: [{ row: 60, col: 21 }, { row: 61, col: 21 }, { row: 62, col: 21 }] },
        blocking: true, walkable: false, interaction: null,
        visual: { semanticKey: 'fence.wood.vertical', assetAvailable: true }
      });
      const gate = api.describe({
        objectId: 'starter:gate:west:01', semanticType: 'gate',
        position: { regionX: 0, regionY: 0, row: 63, col: 21 },
        footprint: { width: 1, height: 1 },
        blocking: false, walkable: true,
        interaction: { enabled: true, kind: 'open-close' },
        visual: { semanticKey: 'gate.wood', assetAvailable: true }
      });
      return { fence, gate };
    });

    expect(result.fence.semanticType).toBe('fence');
    expect(result.fence.footprint.occupiedCells).toHaveLength(3);
    expect(result.gate.semanticType).toBe('gate');
    expect(result.gate.interaction.kind).toBe('open-close');
    expect(result.gate.footprint.occupiedCells).toHaveLength(1);
  });

  test('logical footprint is mandatory even when visual source dimensions exist', async ({ page }) => {
    const error = await page.evaluate(() => {
      try {
        window.Game.WorldObjectPresentationDescriptor.describe({
          objectId: 'bad:flag',
          semanticType: 'flagpole',
          position: { regionX: 0, regionY: 0, row: 5, col: 5 },
          blocking: false,
          walkable: true,
          visual: { semanticKey: 'flagpole', bounds: { width: 256, height: 256 } }
        });
        return null;
      } catch (caught) {
        return String(caught?.message || caught);
      }
    });

    expect(error).toContain('footprint is required');
  });
});
