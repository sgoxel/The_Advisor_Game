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

test('authoritative boundary captures only current simulation-owned R02 truth', async ({ page }) => {
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
      protagonistMatches:
        snapshot.world.protagonist.row === runtime.world.player.row &&
        snapshot.world.protagonist.col === runtime.world.player.col,
      rootKeys: Object.keys(snapshot).sort(),
      worldKeys: Object.keys(snapshot.world).sort(),
      protagonistKeys: Object.keys(snapshot.world.protagonist).sort(),
      firstTileKeys: Object.keys(snapshot.world.terrain[0][0]).sort(),
      frozen:
        Object.isFrozen(snapshot) &&
        Object.isFrozen(snapshot.world) &&
        Object.isFrozen(snapshot.world.protagonist) &&
        Object.isFrozen(snapshot.world.terrain) &&
        Object.isFrozen(snapshot.world.terrain[0]) &&
        Object.isFrozen(snapshot.world.terrain[0][0]) &&
        Object.isFrozen(snapshot.world.terrain[0][0].tags),
      hasMutationApi: ['set', 'apply', 'commit', 'replace', 'update'].some((name) => typeof api[name] === 'function')
    };
  });

  expect(evidence.schemaVersion).toBe(1);
  expect(evidence.authority).toBe('simulation');
  expect(evidence.seedMatches).toBe(true);
  expect(evidence.rowsMatch).toBe(true);
  expect(evidence.colsMatch).toBe(true);
  expect(evidence.protagonistMatches).toBe(true);
  expect(evidence.rootKeys).toEqual(['authority', 'schemaVersion', 'world']);
  expect(evidence.worldKeys).toEqual(['cols', 'protagonist', 'rows', 'seed', 'terrain']);
  expect(evidence.protagonistKeys).toEqual(['col', 'row']);
  expect(evidence.firstTileKeys).toEqual(['blocked', 'elevation', 'obstacle', 'tags', 'type']);
  expect(evidence.frozen).toBe(true);
  expect(evidence.hasMutationApi).toBe(false);
});

test('presentation and derived R01 fields cannot become authoritative state', async ({ page }) => {
  await waitForAuthorityBoundary(page);

  const comparison = await page.evaluate(() => {
    const api = window.Game.AuthoritativeState;
    const state = window.Game.State;
    const baseline = api.canonicalStringify(state);
    const candidate = {
      world: {
        ...state.world,
        tileWidth: state.world.tileWidth + 1000,
        tileHeight: state.world.tileHeight + 1000,
        params: { injected: 'derived-only' },
        selected: { row: 1, col: 1 },
        hover: { row: 2, col: 2 },
        previewPath: [{ row: 3, col: 3 }],
        player: {
          ...state.world.player,
          moving: true,
          direction: 'n',
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
      worldKeys: Object.keys(normalized.world),
      protagonistKeys: Object.keys(normalized.world.protagonist),
      cameraPresent: Object.prototype.hasOwnProperty.call(normalized, 'camera'),
      renderPresent: Object.prototype.hasOwnProperty.call(normalized, 'render')
    };
  });

  expect(comparison.equal).toBe(true);
  for (const derived of ['tileWidth', 'tileHeight', 'params', 'selected', 'hover', 'previewPath', 'player']) {
    expect(comparison.worldKeys).not.toContain(derived);
  }
  for (const transient of ['moving', 'direction', 'pathQueue', 'progress']) {
    expect(comparison.protagonistKeys).not.toContain(transient);
  }
  expect(comparison.cameraPresent).toBe(false);
  expect(comparison.renderPresent).toBe(false);
});

test('terrain semantics and equivalent inputs canonicalize deterministically', async ({ page }) => {
  await waitForAuthorityBoundary(page);

  const result = await page.evaluate(() => {
    const api = window.Game.AuthoritativeState;
    const a = {
      seed: 42,
      rows: '2',
      cols: 2,
      tileWidth: 48,
      params: { ignored: true },
      terrain: [
        [{ type: 'grass', elevation: '1', tags: new Set(['road', 'safe', 'road']) }, { type: 'forest', elevation: 2, tags: ['blocked', 'forest'] }],
        [{ type: 'road', elevation: 1, obstacle: true }, { type: 'lake', elevation: '0', blocked: true }]
      ],
      player: { row: '9', col: -4, direction: 'e' }
    };
    const b = {
      protagonist: { col: 0, row: 1 },
      terrain: [
        [{ elevation: 1, type: 'grass', tags: ['safe', 'road'], decoration: 'ignored' }, { tags: ['forest', 'blocked'], elevation: 2, type: 'forest' }],
        [{ obstacle: true, elevation: 1, type: 'road' }, { blocked: true, elevation: 0, type: 'lake' }]
      ],
      cols: '2',
      rows: 2,
      seed: '42',
      selected: { row: 9, col: 9 }
    };
    return {
      canonicalA: api.canonicalStringify(a),
      canonicalB: api.canonicalStringify(b),
      normalizedA: api.normalize(a),
      normalizedEmpty: api.normalize({})
    };
  });

  expect(result.canonicalA).toBe(result.canonicalB);
  expect(result.normalizedA.world.protagonist).toEqual({ row: 1, col: 0 });
  expect(result.normalizedA.world.terrain[0][0]).toEqual({
    type: 'grass', elevation: 1, tags: ['road', 'safe'], blocked: false, obstacle: false
  });
  expect(result.normalizedA.world.terrain[1][0].obstacle).toBe(true);
  expect(result.normalizedA.world.terrain[1][1].blocked).toBe(true);
  expect(result.normalizedEmpty).toEqual({
    schemaVersion: 1,
    authority: 'simulation',
    world: {
      seed: '',
      rows: 0,
      cols: 0,
      terrain: [],
      protagonist: { row: 0, col: 0 }
    }
  });
});
