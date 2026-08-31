import { test, expect } from '@playwright/test';

async function waitForMinimap(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.terrain?.length &&
    window.Game?.State?.dom?.minimap?.isConnected
  ));

  const minimap = page.locator('#minimap');
  if (!(await minimap.isVisible())) {
    const mobileMinimapTab = page.locator('[data-panel-target="minimap-panel"]');
    if (await mobileMinimapTab.isVisible()) await mobileMinimapTab.click();
  }

  await expect(minimap).toBeVisible();
  await page.waitForFunction(() => {
    const minimap = window.Game?.State?.dom?.minimap;
    return Boolean(minimap && minimap.clientWidth > 0 && minimap.clientHeight > 0);
  });
}

async function clickMinimapCenter(minimap) {
  const box = await minimap.boundingBox();
  expect(box).not.toBeNull();
  await minimap.click({
    position: {
      x: box.width / 2,
      y: box.height / 2
    }
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

test('minimap navigation survives unavailable and late logger dependencies', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await waitForMinimap(page);

  const setup = await page.evaluate(() => {
    const game = window.Game;
    const previousUI = game.UI;
    const originalCenter = game.Renderer.centerCameraOnTile;
    let centered = 0;
    game.Renderer.centerCameraOnTile = function (...args) {
      centered += 1;
      return originalCenter.apply(this, args);
    };
    game.__minimap330 = { previousUI, getCentered: () => centered };
    game.UI = undefined;
    return true;
  });
  expect(setup).toBe(true);

  const minimap = page.locator('#minimap');
  await clickMinimapCenter(minimap);
  await page.waitForFunction(() => window.Game.__minimap330.getCentered() > 0);

  const unavailableResult = await page.evaluate(() => window.Game.__minimap330.getCentered());
  expect(unavailableResult).toBeGreaterThan(0);
  expect(failures).toEqual([]);

  const lateLogger = await page.evaluate(() => {
    const game = window.Game;
    let calls = 0;
    game.UI = { addLog: () => { calls += 1; } };
    game.__minimap330.getLogCalls = () => calls;
    return true;
  });
  expect(lateLogger).toBe(true);

  await clickMinimapCenter(minimap);
  await page.waitForFunction(() => (
    window.Game.__minimap330.getCentered() > 1 &&
    window.Game.__minimap330.getLogCalls() > 0
  ));

  const result = await page.evaluate(() => ({
    centered: window.Game.__minimap330.getCentered(),
    logged: window.Game.__minimap330.getLogCalls()
  }));
  expect(result.centered).toBeGreaterThan(1);
  expect(result.logged).toBe(1);
  expect(failures).toEqual([]);
});
