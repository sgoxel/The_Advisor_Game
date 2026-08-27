import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const seriousOrCritical = (violations) => violations.filter((violation) => (
  ['serious', 'critical'].includes(violation.impact)
));

test('cumulative P02 flow is deterministic, localized, P01-reachable, error-free and accessible', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');

  for (const selector of [
    '#campaign-panel',
    '#check-panel',
    '#save-panel',
    '#run-seeded-check',
    '#export-save',
    '#import-save',
    '#reset-campaign',
  ]) {
    await expect(page.locator(selector)).toBeVisible();
  }

  const initialSeed = await page.locator('#campaign-seed').textContent();
  const initialTurn = await page.locator('#campaign-turn').textContent();
  const initialGold = await page.locator('#character-gold').textContent();

  await page.locator('#run-seeded-check').click();
  const firstRoll = await page.locator('#check-result').textContent();
  const firstPercentile = await page.locator('#check-percentile').textContent();
  expect(firstRoll).not.toBe('—');
  expect(firstPercentile).not.toBe('—');
  await expect(page.locator('#check-status')).toHaveAttribute('data-state', 'success');

  await page.locator('#run-seeded-check').click();
  expect(await page.locator('#check-result').textContent()).toBe(firstRoll);
  expect(await page.locator('#check-percentile').textContent()).toBe(firstPercentile);
  expect(await page.locator('#campaign-seed').textContent()).toBe(initialSeed);
  expect(await page.locator('#campaign-turn').textContent()).toBe(initialTurn);
  expect(await page.locator('#character-gold').textContent()).toBe(initialGold);

  await page.locator('#language-select').selectOption('tr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect(page.locator('#check-title')).toHaveText('Tohumlu kontrol');
  await expect(page.locator('#run-seeded-check')).toHaveText('Deterministik kontrolü çalıştır');
  await page.locator('#run-seeded-check').click();
  expect(await page.locator('#check-result').textContent()).toBe(firstRoll);
  expect(await page.locator('#check-percentile').textContent()).toBe(firstPercentile);

  await page.locator('#export-save').click();
  const exported = await page.locator('#save-json').inputValue();
  const campaign = JSON.parse(exported);
  expect(String(campaign.world.seed)).toBe(initialSeed);

  await page.locator('#reset-campaign').click();
  expect(await page.locator('#campaign-seed').textContent()).toBe(initialSeed);

  const horizontalOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  ));
  expect(horizontalOverflow).toBe(false);

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(seriousOrCritical(axe.violations)).toEqual([]);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
