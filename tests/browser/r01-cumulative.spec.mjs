import { test, expect } from '@playwright/test';

const EXPECTED_OPTIONAL_MAP_404S = [
  '/map/ISOMETRIC_MAP_30032026.js',
  '/map/ISOMETRIC_MAP_30032026/ISOMETRIC_MAP_30032026.js',
  '/map/map.js'
];

function isExpectedOptionalMap404(message) {
  if (message.type() !== 'error') return false;
  const text = message.text();
  const locationUrl = message.location().url || '';
  if (!text.includes('Failed to load resource') || !text.includes('404')) return false;
  try {
    return EXPECTED_OPTIONAL_MAP_404S.includes(new URL(locationUrl).pathname);
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

async function waitForStrategicMap(page, navigate = true) {
  if (navigate) await page.goto('./');
  await page.waitForFunction(() => {
    const game = window.Game;
    const canvas = game?.State?.dom?.canvas;
    return Boolean(
      game?.State?.world?.terrain?.length &&
      game?.State?.world?.player &&
      game?.State?.world?.seed &&
      canvas?.isConnected &&
      canvas.clientWidth > 0 &&
      canvas.clientHeight > 0 &&
      game?.Renderer?.pickTile &&
      game?.I18n?.loadLanguage
    );
  });
  await expect(page.locator('#gameCanvas')).toBeVisible();
}

async function baseWorldSnapshot(page) {
  return page.evaluate(() => {
    const world = window.Game.State.world;
    let hash = 2166136261 >>> 0;
    const feed = (value) => {
      const text = String(value);
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      hash ^= 124;
      hash = Math.imul(hash, 16777619) >>> 0;
    };

    feed(world.seed);
    feed(world.rows);
    feed(world.cols);
    for (let row = 0; row < world.rows; row += 1) {
      for (let col = 0; col < world.cols; col += 1) {
        const tile = world.terrain[row]?.[col] || {};
        feed(row);
        feed(col);
        feed(tile.type || '');
        feed(Number.isFinite(Number(tile.elevation)) ? Number(tile.elevation).toFixed(4) : '');
      }
    }

    return {
      seed: String(world.seed),
      rows: world.rows,
      cols: world.cols,
      hash: hash >>> 0,
      player: {
        row: world.player.row,
        col: world.player.col
      }
    };
  });
}

test('same configured seed reloads the same base-world structure', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await waitForStrategicMap(page);
  const first = await baseWorldSnapshot(page);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForStrategicMap(page, false);
  const second = await baseWorldSnapshot(page);

  expect(second).toEqual(first);
  expect(failures).toEqual([]);
});

test('main menu, settings and localization remain usable without runtime failures', async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page);
  await waitForStrategicMap(page);

  const mainMenu = page.locator('#mainMenuBtn');
  await expect(mainMenu).toHaveAccessibleName(/main menu/i);
  await mainMenu.click();
  await expect(mainMenu).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#mainMenuDropdown')).toBeVisible();
  await mainMenu.click();
  await expect(mainMenu).toHaveAttribute('aria-expanded', 'false');

  await page.locator('#settingsBtn').click();
  await expect(page.locator('#settingsModal')).toBeVisible();
  await expect(page.locator('#seedInput')).toHaveValue(/.+/);
  await page.locator('#cancelSettingsBtn').click();
  await expect(page.locator('#settingsModal')).toBeHidden();

  const languageSelect = page.locator('#languageSelect');
  await languageSelect.selectOption('tr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect.poll(() => page.evaluate(() => window.Game.State.i18n.current)).toBe('tr');
  const turkishMainMenu = await page.evaluate(() => window.Game.I18n.t('header.mainMenu'));
  await expect(mainMenu).toHaveText(turkishMainMenu);

  await languageSelect.selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect.poll(() => page.evaluate(() => window.Game.State.i18n.current)).toBe('en');
  await expect(mainMenu).toHaveAccessibleName(/main menu/i);

  const playerState = await page.evaluate(() => {
    const player = window.Game.State.world.player;
    return { row: player.row, col: player.col, moving: player.moving, queueLength: player.pathQueue?.length || 0 };
  });
  expect(playerState.moving).toBe(false);
  expect(playerState.queueLength).toBe(0);

  await page.screenshot({ path: testInfo.outputPath('cumulative-menu-localization.png'), fullPage: true });
  expect(failures).toEqual([]);
});
