import { test, expect } from '@playwright/test';

async function waitForAuthorityBoundary(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.terrain?.length &&
    window.Game?.State?.world?.player &&
    window.Game?.AuthoritativeState?.capture &&
    window.Game?.AuthoritativeState?.canonicalStringify
  ));
}

test('authoritative boundary captures only the current simulation-owned R02 envelope', async ({ page }) => {
  await waitForAuthorityBoundary(page);

  const evidence = await page.evaluate(() => {
    const api = window.Game.AuthoritativeState;
    const runtime = window.Game.State;
    const snapshot = api.capture(runtime);
    return {
      schemaVersion: snapshot.schemaVersion,
      authority: snapshot.authority,
      seedMatches: snapshot.world.seed === String(runtime.world.seed),
      rowsMatch: snapshot.world.rows === runtime.world.rows,
      colsMatch: snapshot.world.cols === runtime.world.cols,
      playerMatches: snapshot.world.player.row === runtime.world.player.row && snapshot.world.player.col === runtime.world.player.col,
      rootKeys: Object.keys(snapshot).sort(),
      worldKeys: Object.keys(snapshot.world).sort(),
      playerKeys: Object.keys(snapshot.world.player).sort(),
      frozen: Object.isFrozen(snapshot) && Object.isFrozen(snapshot.world) && Object.isFrozen(snapshot.world.player) && Object.isFrozen(snapshot.world.terrain),
      hasMutationApi: ['set', 'apply', 'commit', 'replace', 'update'].some((name) => typeof api[name] === 'function')
    };
  });

  expect(evidence.schemaVersion).toBe(1);
  expect(evidence.authority).toBe('simulation');
  expect(evidence.seedMatches).toBe(true);
  expect(evidence.rowsMatch).toBe(true);
  expect(evidence.colsMatch).toBe(true);
  expect(evidence.playerMatches).toBe(true);
  expect(evidence.rootKeys).toEqual(['authority', 'schemaVersion', 'world']);
  expect(evidence.worldKeys).toEqual(['cols', 'params', 'player', 'rows', 'seed', 'terrain', 'tileHeight', 'tileWidth']);
  expect(evidence.playerKeys).toEqual(['col', 'direction', 'row']);
  expect(evidence.frozen).toBe(true);
  expect(evidence.hasMutationApi).toBe(false);
});

test('presentation, cache and transient input fields cannot enter authoritative state', async ({ page }) => {
  await waitForAuthorityBoundary(page);

  const comparison = await page.evaluate(() => {
    const api = window.Game.AuthoritativeState;
    const state = window.Game.State;
    const baseline = api.canonicalStringify(state);
    const candidate = {
      world: {
        ...state.world,
        selected: { row: 1, col: 1 },
        hover: { row: 2, col: 2 },
        previewPath: [{ row: 3, col: 3 }],
        player: {
          ...state.world.player,
          moving: true,
          pathQueue: [{ row: 4, col: 4 }],
          progress: 0.25
        }
      },
      camera: { zoom: 99, x: 9999, y: -9999 },
      render: { needsWorldRedraw: false, injectedTruth: true },
      dom: { selectedTruth: true },
      input: { keys: ['W'] },
      i18n: { current: 'tr' }
    };
    const normalized = api.normalize(candidate);
    return {
      equal: api.canonicalStringify(candidate) === baseline,
      selectedPresent: Object.prototype.hasOwnProperty.call(normalized.world, 'selected'),
      hoverPresent: Object.prototype.hasOwnProperty.call(normalized.world, 'hover'),
      previewPresent: Object.prototype.hasOwnProperty.call(normalized.world, 'previewPath'),
      movingPresent: Object.prototype.hasOwnProperty.call(normalized.world.player, 'moving'),
      queuePresent: Object.prototype.hasOwnProperty.call(normalized.world.player, 'pathQueue'),
      cameraPresent: Object.prototype.hasOwnProperty.call(normalized, 'camera'),
      renderPresent: Object.prototype.hasOwnProperty.call(normalized, 'render')
    };
  });

  expect(comparison.equal).toBe(true);
  expect(comparison.selectedPresent).toBe(false);
  expect(comparison.hoverPresent).toBe(false);
  expect(comparison.previewPresent).toBe(false);
  expect(comparison.movingPresent).toBe(false);
  expect(comparison.queuePresent).toBe(false);
  expect(comparison.cameraPresent).toBe(false);
  expect(comparison.renderPresent).toBe(false);
});

test('equivalent inputs normalize and canonicalize deterministically', async ({ page }) => {
  await waitForAuthorityBoundary(page);

  const result = await page.evaluate(() => {
    const api = window.Game.AuthoritativeState;
    const a = {
      seed: 42,
      rows: '2',
      cols: 2,
      tileWidth: '48',
      tileHeight: 24,
      params: { zeta: 2, alpha: { y: 2, x: 1 } },
      terrain: [
        [{ type: 'grass', elevation: '1' }, { type: 'forest', elevation: 2 }],
        [{ type: 'road', elevation: 1 }, { type: 'lake', elevation: '0' }]
      ],
      player: { row: '1', col: 0, direction: 'e' }
    };
    const b = {
      player: { direction: 'e', col: 0, row: 1, moving: true },
      terrain: [
        [{ elevation: 1, type: 'grass', decoration: 'ignored' }, { elevation: 2, type: 'forest' }],
        [{ elevation: 1, type: 'road' }, { elevation: 0, type: 'lake' }]
      ],
      params: { alpha: { x: 1, y: 2 }, zeta: 2 },
      tileHeight: 24,
      tileWidth: 48,
      cols: '2',
      rows: 2,
      seed: '42',
      selected: { row: 9, col: 9 }
    };
    return {
      canonicalA: api.canonicalStringify(a),
      canonicalB: api.canonicalStringify(b),
      normalizedEmpty: api.normalize({})
    };
  });

  expect(result.canonicalA).toBe(result.canonicalB);
  expect(result.normalizedEmpty).toEqual({
    schemaVersion: 1,
    authority: 'simulation',
    world: {
      seed: '',
      rows: 0,
      cols: 0,
      tileWidth: 0,
      tileHeight: 0,
      params: null,
      terrain: [],
      player: { row: 0, col: 0, direction: 's' }
    }
  });
});
