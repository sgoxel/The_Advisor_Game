import { test, expect } from '@playwright/test';

async function waitForGame(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.terrain?.length &&
    window.Game?.State?.dom?.canvas?.isConnected &&
    window.Game?.CameraFollow &&
    window.Game?.AuthoritativeState
  ));
}

async function cameraDistanceFromProtagonistCenter(page) {
  return page.evaluate(() => {
    const { State, Renderer } = window.Game;
    const beforeX = State.camera.x;
    const beforeY = State.camera.y;
    Renderer.centerCamera();
    const targetX = State.camera.x;
    const targetY = State.camera.y;
    State.camera.x = beforeX;
    State.camera.y = beforeY;
    return Math.hypot(targetX - beforeX, targetY - beforeY);
  });
}

test('smooth follow suspends on manual pan and resumes from accessible Character panel without Simulation mutation', async ({ page }) => {
  test.setTimeout(75_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await waitForGame(page);

  const beforeCanonical = await page.evaluate(() => window.Game.AuthoritativeState.canonicalStringify(window.Game.State));
  const characterPanel = page.locator('.character-panel');
  await expect(characterPanel).toHaveAttribute('role', 'button');
  await expect(characterPanel).toHaveAttribute('tabindex', '0');

  const mobileCharacterTab = page.locator('[data-panel-target="character-panel"]');
  const characterActivation = (await characterPanel.isVisible()) ? characterPanel : mobileCharacterTab;
  await expect(characterActivation).toBeVisible();

  await page.evaluate(() => {
    const { State, CameraFollow } = window.Game;
    State.camera.x += 240;
    State.camera.y -= 160;
    CameraFollow.resume();
  });

  const initialDistance = await cameraDistanceFromProtagonistCenter(page);
  expect(initialDistance).toBeGreaterThan(100);
  await page.evaluate(() => window.Game.CameraFollow.update());
  const firstDistance = await cameraDistanceFromProtagonistCenter(page);
  expect(firstDistance).toBeLessThan(initialDistance);
  expect(firstDistance).toBeGreaterThan(0.5);

  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(16);
    await page.evaluate(() => window.Game.CameraFollow.update());
  }
  const easedDistance = await cameraDistanceFromProtagonistCenter(page);
  expect(easedDistance).toBeLessThan(firstDistance);

  const canvas = page.locator('#gameCanvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.52, { steps: 3 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.Game.CameraFollow.isFollowing())).toBe(false);

  const suspendedPosition = await page.evaluate(() => ({ x: window.Game.State.camera.x, y: window.Game.State.camera.y }));
  await page.waitForTimeout(40);
  const stillSuspended = await page.evaluate(() => ({ x: window.Game.State.camera.x, y: window.Game.State.camera.y }));
  expect(Math.hypot(stillSuspended.x - suspendedPosition.x, stillSuspended.y - suspendedPosition.y)).toBeLessThan(10);

  const beforeResumeDistance = await cameraDistanceFromProtagonistCenter(page);
  await characterActivation.click();
  expect(await page.evaluate(() => window.Game.CameraFollow.isFollowing())).toBe(true);
  const immediatelyAfterResumeDistance = await cameraDistanceFromProtagonistCenter(page);
  expect(immediatelyAfterResumeDistance).toBeGreaterThan(beforeResumeDistance * 0.7);

  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(16);
    await page.evaluate(() => window.Game.CameraFollow.update());
  }
  const resumedDistance = await cameraDistanceFromProtagonistCenter(page);
  expect(resumedDistance).toBeLessThan(immediatelyAfterResumeDistance);

  const zoomBefore = await page.evaluate(() => window.Game.State.camera.zoom);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(50);
  const zoomAfter = await page.evaluate(() => ({ zoom: window.Game.State.camera.zoom, following: window.Game.CameraFollow.isFollowing() }));
  expect(zoomAfter.zoom).not.toBe(zoomBefore);
  expect(zoomAfter.following).toBe(true);

  await characterActivation.focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.Game.CameraFollow.isFollowing())).toBe(true);

  const afterCanonical = await page.evaluate(() => window.Game.AuthoritativeState.canonicalStringify(window.Game.State));
  expect(afterCanonical).toBe(beforeCanonical);
  expect(pageErrors).toEqual([]);
});
