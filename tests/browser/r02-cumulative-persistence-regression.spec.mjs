import { test, expect } from '@playwright/test';

const EXPECTED_OPTIONAL_MAP_404S = [
  '/map/ISOMETRIC_MAP_30032026.js',
  '/map/ISOMETRIC_MAP_30032026/ISOMETRIC_MAP_30032026.js',
  '/map/map.js'
];

function collectRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const locationUrl = message.location().url || '';
    let expected = false;
    if (text.includes('Failed to load resource') && text.includes('404')) {
      try { expected = EXPECTED_OPTIONAL_MAP_404S.includes(new URL(locationUrl).pathname); } catch { expected = false; }
    }
    if (!expected) failures.push(`console.error: ${text}${locationUrl ? ` @ ${locationUrl}` : ''}`);
  });
  return failures;
}

async function waitForPersistence(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.terrain?.length &&
    window.Game?.State?.world?.player &&
    window.Game?.PersistenceUI &&
    window.Game?.CampaignPersistence?.serializeSave &&
    window.Game?.CampaignPersistence?.loadSave
  ));
}

test('cumulative persistence surface remains responsive accessible and map-primary', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await waitForPersistence(page);

  const canvas = page.locator('#gameCanvas');
  const tools = page.getByLabel('Campaign persistence controls');
  await expect(canvas).toBeVisible();
  await expect(tools).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy world seed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export save' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import / Load' })).toBeVisible();
  await expect(page.locator('#persistenceStatusText')).toHaveText(/Ready|Campaign loaded|Save exported|Seed copied/);

  const geometry = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    canvas: document.querySelector('#gameCanvas')?.getBoundingClientRect().toJSON(),
    buttons: [...document.querySelectorAll('.persistence-action')].map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, disabled: node.disabled };
    })
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 2);
  expect(geometry.canvas?.width || 0).toBeGreaterThan(100);
  expect(geometry.canvas?.height || 0).toBeGreaterThan(100);
  for (const button of geometry.buttons) {
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole('button', { name: 'Import / Load' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import or load campaign' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load campaign' })).toBeDisabled();
  await expect(page.locator('#persistenceDialogStatus')).toContainText('No file selected');

  const before = await page.evaluate(() => window.Game.State.world.seed);
  await page.locator('#campaignSaveFile').setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ invalid json')
  });
  await expect(page.locator('#persistenceDialogStatus')).toContainText('Invalid save file');
  await expect(page.getByRole('button', { name: 'Load campaign' })).toBeDisabled();
  expect(await page.evaluate(() => window.Game.State.world.seed)).toBe(before);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Import / Load' })).toBeFocused();
  expect(failures).toEqual([]);
});

test('valid cumulative load restores authoritative seed without presentation injection', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await waitForPersistence(page);
  const save = await page.evaluate(() => window.Game.CampaignPersistence.serializeSave());
  const expected = await page.evaluate(() => ({
    seed: window.Game.State.world.seed,
    canonical: window.Game.AuthoritativeState.canonicalStringify(window.Game.AuthoritativeState.capture(window.Game.State))
  }));

  await page.getByRole('button', { name: 'Import / Load' }).click();
  await page.locator('#campaignSaveFile').setInputFiles({
    name: 'campaign.json',
    mimeType: 'application/json',
    buffer: Buffer.from(save)
  });
  await expect(page.locator('#persistenceDialogStatus')).toContainText('Ready to load');
  await expect(page.getByRole('button', { name: 'Load campaign' })).toBeEnabled();

  await page.evaluate(() => { window.Game.State.world.seed = 'UI-MUST-NOT-BECOME-AUTHORITY'; });
  await page.getByRole('button', { name: 'Load campaign' }).click();
  await expect(page.locator('#persistenceStatusText')).toContainText('Campaign loaded');
  expect(await page.evaluate(() => window.Game.State.world.seed)).toBe(expected.seed);
  expect(await page.evaluate(() => window.Game.AuthoritativeState.canonicalStringify(window.Game.AuthoritativeState.capture(window.Game.State)))).toBe(expected.canonical);
  expect(failures).toEqual([]);
});
