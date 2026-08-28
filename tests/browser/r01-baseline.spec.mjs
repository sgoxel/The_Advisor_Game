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

test('R02 authoritative-state contract normalizes only allowlisted simulation truth deterministically', async ({ page }) => {
  await waitForStrategicMap(page);

  const result = await page.evaluate(() => {
    const api = window.Game.AuthoritativeState;
    const candidateA = {
      world: {
        seed: 'R02-BOUNDARY',
        rows: 2.9,
        cols: 2.1,
        tileWidth: 100,
        tileHeight: 100,
        params: { zeta: 2, alpha: 1 },
        terrain: [
          [{ type: 'grass', elevation: 1, selected: true }, { type: 'forest', elevation: '2' }],
          [{ type: '', elevation: Number.NaN }, null]
        ],
        player: {
          row: 1.8,
          col: 0.4,
          direction: 'n',
          moving: true,
          pathQueue: [{ row: 0, col: 1 }]
        },
        selected: { row: 1, col: 1 },
        hover: { row: 0, col: 0 },
        previewPath: [{ row: 1, col: 0 }]
      },
      camera: { x: 999 },
      dom: { injected: true },
      render: { injected: true }
    };
    const candidateB = structuredClone(candidateA);
    candidateB.world.params = { alpha: 1, zeta: 2 };
    candidateB.world.selected = { row: 0, col: 0 };
    candidateB.camera = { x: -999 };

    const normalized = api.normalize(candidateA);
    const defaulted = api.normalize({ world: {} });
    return {
      exists: Boolean(api),
      schemaVersion: api?.schemaVersion,
      authority: api?.authority,
      fields: api?.fields ? [...api.fields] : [],
      apiKeys: api ? Object.keys(api) : [],
      normalized,
      defaulted,
      sameCanonical: api.canonicalStringify(candidateA) === api.canonicalStringify(candidateB)
    };
  });

  expect(result.exists).toBe(true);
  expect(result.schemaVersion).toBe(1);
  expect(result.authority).toBe('simulation');
  expect(result.apiKeys).not.toContain('set');
  expect(result.apiKeys).not.toContain('apply');
  expect(result.apiKeys).not.toContain('replace');
  expect(result.fields).not.toContain('camera');
  expect(result.fields).not.toContain('world.selected');
  expect(result.fields).not.toContain('world.hover');
  expect(result.fields).not.toContain('world.previewPath');

  expect(result.normalized.world.rows).toBe(2);
  expect(result.normalized.world.cols).toBe(2);
  expect(result.normalized.world.params).toEqual({ alpha: 1, zeta: 2 });
  expect(result.normalized.world.terrain).toEqual([
    [{ type: 'grass', elevation: 1 }, { type: 'forest', elevation: 2 }],
    [{ type: 'grass', elevation: 0 }, { type: 'grass', elevation: 0 }]
  ]);
  expect(result.normalized.world.player).toEqual({ row: 1, col: 0, direction: 'n' });
  expect(result.normalized.world).not.toHaveProperty('selected');
  expect(result.normalized.world).not.toHaveProperty('hover');
  expect(result.normalized.world).not.toHaveProperty('previewPath');
  expect(result.normalized).not.toHaveProperty('camera');
  expect(result.defaulted).toEqual({
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
  expect(result.sameCanonical).toBe(true);
});

test('R02 authoritative capture is immutable and unaffected by presentation-only runtime changes', async ({ page }) => {
  await waitForStrategicMap(page);

  const result = await page.evaluate(() => {
    const api = window.Game.AuthoritativeState;
    const state = window.Game.State;
    const originalCameraX = state.camera.x;
    const originalSelected = state.world.selected;
    const originalHover = state.world.hover;
    const originalPreviewPath = state.world.previewPath;

    const before = api.capture();
    const beforeCanonical = api.canonicalStringify(before);

    state.camera.x = originalCameraX + 12345;
    state.world.selected = { row: 0, col: 0 };
    state.world.hover = { row: 0, col: 1 };
    state.world.previewPath = [{ row: 1, col: 1 }];

    const after = api.capture();
    const afterCanonical = api.canonicalStringify(after);

    state.camera.x = originalCameraX;
    state.world.selected = originalSelected;
    state.world.hover = originalHover;
    state.world.previewPath = originalPreviewPath;

    return {
      sameCanonical: beforeCanonical === afterCanonical,
      rootFrozen: Object.isFrozen(before),
      worldFrozen: Object.isFrozen(before.world),
      playerFrozen: Object.isFrozen(before.world.player),
      terrainFrozen: Object.isFrozen(before.world.terrain),
      firstRowFrozen: Object.isFrozen(before.world.terrain[0]),
      firstTileFrozen: Object.isFrozen(before.world.terrain[0][0]),
      hasCamera: Object.prototype.hasOwnProperty.call(before, 'camera'),
      hasSelected: Object.prototype.hasOwnProperty.call(before.world, 'selected'),
      hasTransientMovement: Object.prototype.hasOwnProperty.call(before.world.player, 'moving')
    };
  });

  expect(result.sameCanonical).toBe(true);
  expect(result.rootFrozen).toBe(true);
  expect(result.worldFrozen).toBe(true);
  expect(result.playerFrozen).toBe(true);
  expect(result.terrainFrozen).toBe(true);
  expect(result.firstRowFrozen).toBe(true);
  expect(result.firstTileFrozen).toBe(true);
  expect(result.hasCamera).toBe(false);
  expect(result.hasSelected).toBe(false);
  expect(result.hasTransientMovement).toBe(false);
});
