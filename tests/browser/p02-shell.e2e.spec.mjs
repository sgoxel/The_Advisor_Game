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
  await expect(page.locator('#check-title')).toHaveText('Tohumlu kontrol');
  await expect(page.locator('#export-save')).toHaveText('JSON dışa aktar');

  expect(await page.locator('#campaign-seed').textContent()).toBe(before.seed);
  expect(await page.locator('#campaign-turn').textContent()).toBe(before.turn);
  expect(await page.locator('#character-gold').textContent()).toBe(before.gold);

  await page.locator('#language-select').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#campaign-title')).toHaveText('Current campaign');
});

test('public seeded check visibly reproduces unchanged deterministic context', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#check-seed')).toHaveText(await page.locator('#campaign-seed').textContent());
  await page.locator('#run-seeded-check').click();
  const firstRoll = await page.locator('#check-result').textContent();
  const firstPercentile = await page.locator('#check-percentile').textContent();
  expect(firstRoll).not.toBe('—');
  expect(firstPercentile).not.toBe('—');
  await expect(page.locator('#check-status')).toHaveText(/Resolved by simulation/);

  await page.locator('#run-seeded-check').click();
  expect(await page.locator('#check-result').textContent()).toBe(firstRoll);
  expect(await page.locator('#check-percentile').textContent()).toBe(firstPercentile);

  await page.locator('#check-identity').selectOption('p02-public-check-b');
  await expect(page.locator('#check-result')).toHaveText('—');
  await page.locator('#run-seeded-check').click();
  expect(await page.locator('#check-result').textContent()).not.toBe(firstRoll);
});

test('seeded-check UI exposes no desired-result control', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#check-panel')).toBeVisible();
  await expect(page.locator('#run-seeded-check')).toBeVisible();
  await expect(page.locator('input[name="desiredResult"], select[name="desiredResult"], [data-result-choice]')).toHaveCount(0);
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
