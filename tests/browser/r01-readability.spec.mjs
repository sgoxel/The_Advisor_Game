import { test, expect } from '@playwright/test';

async function waitForStrategicMap(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.terrain?.length &&
    window.Game?.State?.world?.player &&
    window.Game?.State?.dom?.canvas &&
    window.Game?.Renderer?.pickTile &&
    document.getElementById('r01-current-location')
  ));
}

async function findInspectableCanvasPoint(page) {
  return page.evaluate(() => {
    const canvas = window.Game.State.dom.canvas;
    const rect = canvas.getBoundingClientRect();
    const stepX = Math.max(28, rect.width / 12);
    const stepY = Math.max(28, rect.height / 10);
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

test('Designer current-location cue is integrated into the live map and remains non-interactive', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await waitForStrategicMap(page);

  const cue = page.locator('#r01-current-location');
  await expect(cue).toBeVisible();
  await expect(cue).toHaveAttribute('aria-label', 'Current protagonist location');
  await expect(cue.locator('use')).toHaveAttribute('href', /strategic-map-symbols\.svg#current-location$/);

  const pointerEvents = await cue.evaluate((element) => getComputedStyle(element.closest('#r01-map-cues')).pointerEvents);
  expect(pointerEvents).toBe('none');

  const cueBox = await cue.boundingBox();
  const canvasBox = await page.locator('#gameCanvas').boundingBox();
  expect(cueBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(cueBox.x + cueBox.width).toBeGreaterThan(canvasBox.x);
  expect(cueBox.x).toBeLessThan(canvasBox.x + canvasBox.width);
  expect(cueBox.y + cueBox.height).toBeGreaterThan(canvasBox.y);
  expect(cueBox.y).toBeLessThan(canvasBox.y + canvasBox.height);
  expect(failures).toEqual([]);
});

test('tile inspection uses persistent Designer brackets and route preview cannot move the protagonist', async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page);
  await waitForStrategicMap(page);
  const point = await findInspectableCanvasPoint(page);
  expect(point).not.toBeNull();

  const before = await page.evaluate(() => {
    const player = window.Game.State.world.player;
    return { row: player.row, col: player.col, moving: player.moving, queueLength: player.pathQueue?.length || 0 };
  });

  if (testInfo.project.name.startsWith('phone-')) {
    await page.touchscreen.tap(point.clientX, point.clientY);
  } else {
    await page.mouse.click(point.clientX, point.clientY);
  }

  await page.waitForFunction(({ row, col }) => {
    const selected = window.Game?.State?.world?.selected;
    return selected?.row === row && selected?.col === col;
  }, { row: point.row, col: point.col });

  const inspection = page.locator('#r01-inspection');
  await expect(inspection).toBeVisible();
  await expect(inspection).toHaveAttribute('aria-label', 'Inspected map location');
  await expect(inspection.locator('use')).toHaveAttribute('href', /strategic-map-symbols\.svg#inspection$/);

  const after = await page.evaluate(() => {
    const { world } = window.Game.State;
    const player = world.player;
    return {
      row: player.row,
      col: player.col,
      moving: player.moving,
      queueLength: player.pathQueue?.length || 0,
      previewLength: world.previewPath?.length || 0
    };
  });

  expect(after.row).toBe(before.row);
  expect(after.col).toBe(before.col);
  expect(after.moving).toBe(false);
  expect(after.queueLength).toBe(before.queueLength);

  if (after.previewLength > 1) {
    const preview = page.locator('#r01-route-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText(/non-binding|bağlayıcı değil/i);
  }

  expect(failures).toEqual([]);
});
