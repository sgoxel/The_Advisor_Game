import { test, expect } from '@playwright/test';

const EXPECTED_OPTIONAL_MAP_404S = [
  '/map/ISOMETRIC_MAP_30032026.js',
  '/map/ISOMETRIC_MAP_30032026/ISOMETRIC_MAP_30032026.js',
  '/map/map.js'
];

async function waitForStrategicMap(page) {
  await page.goto('./');
  await page.waitForFunction(() => {
    const game = window.Game;
    const canvas = game?.State?.dom?.canvas;
    const minimap = game?.State?.dom?.minimap;
    return Boolean(
      game?.State?.world?.terrain?.length &&
      game?.State?.world?.player &&
      canvas?.isConnected &&
      canvas.clientWidth > 0 &&
      canvas.clientHeight > 0 &&
      minimap?.isConnected &&
      game?.Renderer?.pickTile
    );
  });
  await expect(page.locator('#gameCanvas')).toBeVisible();
}

async function findInspectableCanvasPoint(page) {
  return page.evaluate(() => {
    const canvas = window.Game.State.dom.canvas;
    const rect = canvas.getBoundingClientRect();
    const stepX = Math.max(24, rect.width / 12);
    const stepY = Math.max(24, rect.height / 10);
    for (let y = stepY; y < rect.height - stepY; y += stepY) {
      for (let x = stepX; x < rect.width - stepX; x += stepX) {
        const picked = window.Game.Renderer.pickTile(x, y);
        if (picked) {
          return {
            clientX: rect.left + x,
            clientY: rect.top + y,
            row: picked.row,
            col: picked.col
          };
        }
      }
    }
    return null;
  });
}

function isExpectedOptionalMap404(message) {
  if (message.type() !== 'error') return false;

  const text = message.text();
  const locationUrl = message.location().url || '';
  if (!text.includes('Failed to load resource') || !text.includes('404')) return false;

  try {
    const pathname = new URL(locationUrl).pathname;
    return EXPECTED_OPTIONAL_MAP_404S.includes(pathname);
  } catch {
    return false;
  }
}

function collectRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !isExpectedOptionalMap404(message)) {
      const locationUrl = message.location().url;
      failures.push(`console.error: ${message.text()}${locationUrl ? ` @ ${locationUrl}` : ''}`);
    }
  });
  return failures;
}

test('strategic map starts in representative responsive layouts without runtime failures', async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page);
  await waitForStrategicMap(page);

  const canvasBox = await page.locator('#gameCanvas').boundingBox();
  expect(canvasBox).not.toBeNull();
  expect(canvasBox.width).toBeGreaterThan(100);
  expect(canvasBox.height).toBeGreaterThan(100);

  const minimap = page.locator('#minimap');
  if (testInfo.project.name.startsWith('phone-')) {
    await expect(minimap).toBeHidden();
  } else {
    await expect(minimap).toBeVisible();
    const minimapBox = await minimap.boundingBox();
    expect(minimapBox).not.toBeNull();
    expect(minimapBox.width).toBeGreaterThan(0);
    expect(minimapBox.height).toBeGreaterThan(0);
  }

  await expect(page.locator('#mainMenuBtn')).toHaveAccessibleName(/main menu/i);
  await expect(page.locator('#settingsBtn')).toHaveAccessibleName(/settings/i);

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  expect(horizontalOverflow).toBe(false);

  await page.screenshot({ path: testInfo.outputPath('strategic-map-startup.png'), fullPage: true });
  expect(failures).toEqual([]);
});

test('repeated click or tap inspects a real tile without directly starting protagonist movement', async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page);
  await waitForStrategicMap(page);
  const point = await findInspectableCanvasPoint(page);
  expect(point).not.toBeNull();

  const before = await page.evaluate(() => {
    const player = window.Game.State.world.player;
    return { row: player.row, col: player.col, moving: player.moving, queueLength: player.pathQueue?.length || 0 };
  });

  const useTouch = testInfo.project.name.startsWith('phone-');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (useTouch) await page.touchscreen.tap(point.clientX, point.clientY);
    else await page.mouse.click(point.clientX, point.clientY);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const { world } = window.Game.State;
    const player = world.player;
    return {
      row: player.row,
      col: player.col,
      moving: player.moving,
      queueLength: player.pathQueue?.length || 0,
      selected: world.selected ? { row: world.selected.row, col: world.selected.col } : null,
      previewLength: world.previewPath?.length || 0
    };
  });

  expect(after.selected).toEqual({ row: point.row, col: point.col });
  expect(after.row).toBe(before.row);
  expect(after.col).toBe(before.col);
  expect(after.moving).toBe(false);
  expect(after.queueLength).toBe(before.queueLength);
  expect(after.previewLength).toBeGreaterThanOrEqual(0);
  expect(failures).toEqual([]);
});

test('R02 authority boundary excludes derived/presentation state from the R01 runtime', async ({ page }) => {
  await waitForStrategicMap(page);

  const result = await page.evaluate(() => {
    const api = window.Game.AuthoritativeState;
    const state = window.Game.State;
    const before = api.canonicalStringify(state);
    const candidate = {
      world: {
        ...state.world,
        tileWidth: state.world.tileWidth + 500,
        tileHeight: state.world.tileHeight + 500,
        params: { injected: true },
        selected: { row: 0, col: 0 },
        hover: { row: 0, col: 1 },
        previewPath: [{ row: 1, col: 1 }],
        player: { ...state.world.player, direction: 'n', moving: true, pathQueue: [{ row: 2, col: 2 }] }
      },
      camera: { x: 12345 },
      render: { injected: true }
    };
    const normalized = api.normalize(candidate);
    return {
      unchanged: before === api.canonicalStringify(candidate),
      worldKeys: Object.keys(normalized.world).sort(),
      protagonistKeys: Object.keys(normalized.world.protagonist).sort(),
      apiKeys: Object.keys(api)
    };
  });

  expect(result.unchanged).toBe(true);
  expect(result.worldKeys).toEqual(['cols', 'protagonist', 'rows', 'seed', 'terrain']);
  expect(result.protagonistKeys).toEqual(['col', 'row']);
  for (const mutationName of ['set', 'apply', 'commit', 'replace', 'update']) {
    expect(result.apiKeys).not.toContain(mutationName);
  }
});

test('R02 authority boundary preserves deterministic terrain semantics and frozen capture', async ({ page }) => {
  await waitForStrategicMap(page);

  const result = await page.evaluate(() => {
    const api = window.Game.AuthoritativeState;
    const snapshot = api.capture();
    const tile = snapshot.world.terrain[0][0];
    const equivalent = {
      world: {
        seed: snapshot.world.seed,
        rows: snapshot.world.rows,
        cols: snapshot.world.cols,
        terrain: snapshot.world.terrain.map((row) => row.map((entry) => ({
          obstacle: entry.obstacle,
          tags: [...entry.tags].reverse(),
          type: entry.type,
          blocked: entry.blocked,
          elevation: entry.elevation,
          decoration: 'ignored'
        }))),
        protagonist: { ...snapshot.world.protagonist },
        tileWidth: 999,
        params: { ignored: true }
      }
    };
    return {
      sameCanonical: api.canonicalStringify(snapshot) === api.canonicalStringify(equivalent),
      rootFrozen: Object.isFrozen(snapshot),
      worldFrozen: Object.isFrozen(snapshot.world),
      protagonistFrozen: Object.isFrozen(snapshot.world.protagonist),
      tileFrozen: Object.isFrozen(tile),
      tagsFrozen: Object.isFrozen(tile.tags),
      tileKeys: Object.keys(tile).sort()
    };
  });

  expect(result.sameCanonical).toBe(true);
  expect(result.rootFrozen).toBe(true);
  expect(result.worldFrozen).toBe(true);
  expect(result.protagonistFrozen).toBe(true);
  expect(result.tileFrozen).toBe(true);
  expect(result.tagsFrozen).toBe(true);
  expect(result.tileKeys).toEqual(['blocked', 'elevation', 'obstacle', 'tags', 'type']);
});
