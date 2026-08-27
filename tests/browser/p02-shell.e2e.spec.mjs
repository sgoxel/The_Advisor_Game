import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const seriousOrCritical = (violations) => violations.filter((violation) => (
  ['serious', 'critical'].includes(violation.impact) && violation.id !== 'color-contrast'
));

test('P02 shell switches EN/TR without mutating authoritative campaign state', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true');

  const before = {
    seed: await page.locator('#campaign-seed').textContent(),
    turn: await page.locator('#campaign-turn').textContent(),
    gold: await page.locator('#character-gold').textContent(),
  };

  await page.locator('#language-select').selectOption('tr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect(page.locator('[data-i18n="shell.menu"]')).toHaveText('Menü');
  await expect(page.locator('#campaign-title')).toHaveText('Mevcut kampanya');
  await expect(page.locator('#export-save')).toHaveText('JSON dışa aktar');

  expect(await page.locator('#campaign-seed').textContent()).toBe(before.seed);
  expect(await page.locator('#campaign-turn').textContent()).toBe(before.turn);
  expect(await page.locator('#character-gold').textContent()).toBe(before.gold);

  await page.locator('#language-select').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#campaign-title')).toHaveText('Current campaign');
});

test('P02 shell controls remain responsive and accessible', async ({ page }) => {
  await page.goto('./');

  await expect(page.locator('#language-select')).toBeVisible();
  await expect(page.locator('.shell-menu summary')).toBeVisible();
  await page.locator('.shell-menu summary').click();
  await expect(page.locator('.menu-popover')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(seriousOrCritical(results.violations)).toEqual([]);
});
