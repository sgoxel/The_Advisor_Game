import { test, expect } from '@playwright/test';

async function waitForStrategicMap(page) {
  await page.goto('./');
  await page.waitForFunction(() => {
    const game = window.Game;
    return Boolean(
      game?.State?.world?.terrain?.length &&
      game?.State?.world?.player &&
      game?.State?.dom?.canvas &&
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

function collectRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console.error: ${message.text()}`);
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
  await expect(page.locator('#minimap')).toBeVisible();
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
