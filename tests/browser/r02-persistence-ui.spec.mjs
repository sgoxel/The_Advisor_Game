import { test, expect } from '@playwright/test';

async function waitForPersistenceUI(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.PersistenceUI && window.Game?.CampaignPersistence && window.Game?.State?.world?.terrain?.length));
}

test('desktop persistence controls keep the living map primary and expose accessible actions', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await waitForPersistenceUI(page);

  await expect(page.locator('#gameCanvas')).toBeVisible();
  await expect(page.getByLabel('Campaign persistence controls')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export save' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import / Load' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy world seed' })).toBeVisible();
  await expect(page.locator('#persistenceSeedValue')).toContainText('Seed:');

  await page.getByRole('button', { name: 'Import / Load' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import or load campaign' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('#gameCanvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load campaign' })).toBeDisabled();

  await page.locator('#campaignSaveFile').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{bad json') });
  await expect(page.locator('#persistenceDialogStatus')).toContainText('Invalid save file');
  await expect(page.getByRole('button', { name: 'Load campaign' })).toBeDisabled();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Import / Load' })).toBeFocused();
});

test('validated import only loads through authoritative CampaignPersistence and refreshes seed identity', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await waitForPersistenceUI(page);

  const save = await page.evaluate(() => window.Game.CampaignPersistence.serializeSave());
  const expectedSeed = await page.evaluate(() => window.Game.State.world.seed);

  await page.getByRole('button', { name: 'Import / Load' }).click();
  await page.locator('#campaignSaveFile').setInputFiles({ name: 'campaign.json', mimeType: 'application/json', buffer: Buffer.from(save) });
  await expect(page.locator('#persistenceDialogStatus')).toContainText('Ready to load');
  await expect(page.getByRole('button', { name: 'Load campaign' })).toBeEnabled();

  await page.evaluate(() => { window.Game.State.world.seed = 'presentation-must-not-authorize-this'; });
  await page.getByRole('button', { name: 'Load campaign' }).click();
  await expect(page.locator('#persistenceStatusText')).toContainText('Campaign loaded');
  await expect(page.locator('#persistenceSeedValue')).toContainText(expectedSeed);
  await expect.poll(() => page.evaluate(() => window.Game.State.world.seed)).toBe(expectedSeed);
});

test('phone portrait uses full-width persistence sheet without replacing map context', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForPersistenceUI(page);

  await expect(page.locator('#gameCanvas')).toBeVisible();
  await page.getByRole('button', { name: 'Import / Load' }).click();
  const sheet = page.locator('.persistence-sheet');
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(360);
  await expect(page.getByRole('button', { name: 'Choose save file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
});
