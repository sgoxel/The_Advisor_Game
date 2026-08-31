import { test, expect } from '@playwright/test';

async function waitForGame(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.terrain?.length &&
    window.Game?.DevelopmentMode &&
    window.Game?.AuthoritativeState
  ));
}

test('Development Mode exposes bounded read-only Simulation and presentation diagnostics', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await waitForGame(page);

  const button = page.locator('#developmentModeBtn');
  const panel = page.locator('#developmentModePanel');
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(panel).toHaveClass(/hidden/);

  const before = await page.evaluate(() => window.Game.AuthoritativeState.canonicalStringify(window.Game.State));
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).not.toHaveClass(/hidden/);
  await expect(panel.getByText('Simulation-backed')).toBeVisible();
  await expect(panel.getByText('Presentation / runtime')).toBeVisible();

  const snapshot = await page.evaluate(() => window.Game.DevelopmentMode.capture());
  expect(snapshot.presentationOnly).toBe(true);
  expect(snapshot.enabled).toBe(true);
  expect(snapshot.simulation.authority).toBe('simulation');
  expect(snapshot.presentation.authority).toBe('presentation');
  expect(snapshot.simulation.world.seed).toBeTruthy();
  expect(snapshot.simulation.world.rows).toBe(100);
  expect(snapshot.simulation.world.cols).toBe(100);
  expect(snapshot.presentation.camera.zoom).toBeGreaterThan(0);
  expect(window.Number?.isFinite?.(snapshot.simulation.gameTime?.totalGameMinutes)).not.toBe(false);

  const firstTimeText = await page.locator('#devGameTime').textContent();
  await page.waitForTimeout(650);
  const secondSnapshot = await page.evaluate(() => window.Game.DevelopmentMode.refresh());
  expect(secondSnapshot.presentationOnly).toBe(true);
  expect(await page.locator('#devGameTime').textContent()).toBeTruthy();
  expect(firstTimeText).toBeTruthy();

  const afterInspection = await page.evaluate(() => window.Game.AuthoritativeState.canonicalStringify(window.Game.State));
  expect(afterInspection).toBe(before);

  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(panel).toHaveClass(/hidden/);
  const afterToggleOff = await page.evaluate(() => window.Game.AuthoritativeState.canonicalStringify(window.Game.State));
  expect(afterToggleOff).toBe(before);

  const refreshInterval = await page.evaluate(() => window.Game.DevelopmentMode.refreshIntervalMs);
  expect(refreshInterval).toBeGreaterThanOrEqual(400);
  expect(refreshInterval).toBeLessThanOrEqual(1000);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
