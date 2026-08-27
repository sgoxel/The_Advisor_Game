import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const seriousOrCritical = (violations) => violations.filter((violation) => (
  ['serious', 'critical'].includes(violation.impact) && violation.id !== 'color-contrast'
));

test('Phase 1 save workflow works without corrupting state', async ({ page }, testInfo) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');
  await expect(page.locator('#app-status')).toHaveText('Ready');

  const initialTurn = await page.locator('#campaign-turn').textContent();
  const initialGold = await page.locator('#character-gold').textContent();

  await page.locator('#export-save').click();
  const exported = await page.locator('#save-json').inputValue();
  const campaign = JSON.parse(exported);
  expect(campaign.schemaVersion).toBe(1);

  campaign.world.turn = 42;
  campaign.character.resources = campaign.character.resources.map((resource) => (
    resource.id === 'Gold' ? { ...resource, amount: 123 } : resource
  ));

  await page.locator('#save-json').fill(JSON.stringify(campaign));
  await page.locator('#import-save').click();
  await expect(page.locator('#campaign-turn')).toHaveText('42');
  await expect(page.locator('#character-gold')).toHaveText('123');
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'success');

  await page.locator('#reset-campaign').click();
  await expect(page.locator('#campaign-turn')).toHaveText(initialTurn ?? '1');
  await expect(page.locator('#character-gold')).toHaveText(initialGold ?? '0');

  const beforeMalformedTurn = await page.locator('#campaign-turn').textContent();
  const beforeMalformedGold = await page.locator('#character-gold').textContent();
  await page.locator('#save-json').fill('{ malformed json');
  await page.locator('#import-save').click();
  await expect(page.locator('#save-status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#campaign-turn')).toHaveText(beforeMalformedTurn ?? '1');
  await expect(page.locator('#character-gold')).toHaveText(beforeMalformedGold ?? '0');

  await page.screenshot({ path: testInfo.outputPath('phase1-full-page.png'), fullPage: true });
  expect(pageErrors).toEqual([]);
});

test('Phase 1 layout remains usable and has no serious accessibility violations', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');

  for (const selector of ['#export-save', '#import-save', '#reset-campaign', '#save-json']) {
    await expect(page.locator(selector)).toBeVisible();
  }

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(horizontalOverflow).toBe(false);

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(seriousOrCritical(results.violations)).toEqual([]);
});
