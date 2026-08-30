import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function mockPublicBuildMetadata(page) {
  await page.route('https://api.github.com/**', async (route) => {
    const url = route.request().url();
    const json = (value, status = 200) => route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(value)
    });

    if (url.includes('/deployments/9001/statuses')) {
      return json([{
        id: 9101,
        state: 'success',
        created_at: '2026-08-30T07:35:00Z',
        updated_at: '2026-08-30T07:36:12Z'
      }]);
    }
    if (url.includes('/deployments?')) {
      return json([{
        id: 9001,
        sha: '1234567890abcdef1234567890abcdef12345678',
        ref: 'main',
        environment: 'github-pages',
        created_at: '2026-08-30T07:34:30Z',
        updated_at: '2026-08-30T07:36:12Z',
        statuses_url: 'https://api.github.com/repos/sgoxel/The_Advisor_Game/deployments/9001/statuses'
      }]);
    }
    if (url.endsWith('/releases/latest')) {
      return json({ tag_name: 'v0.4.12', name: 'R04 public build' });
    }
    if (url.includes('/commits/main')) {
      return json({
        sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        commit: { committer: { date: '2026-08-30T07:33:00Z' } }
      });
    }
    return json({ message: 'Not Found' }, 404);
  });
}

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.DebugLogExport?.resolveMetadata &&
    window.Game?.DebugLogExport?.buildText &&
    window.Game?.ActivityLog?.add &&
    document.getElementById('downloadLogsBtn')
  ), null, { timeout: 20_000 });
}

test('Log window exposes accessible local download action with exact deployment metadata', async ({ page }) => {
  await mockPublicBuildMetadata(page);
  await ready(page);

  const evidence = await page.evaluate(async () => {
    const Game = window.Game;
    const world = Game.State.world;
    const before = JSON.stringify({
      seed: world.seed,
      rows: world.rows,
      cols: world.cols,
      terrain: world.terrain,
      buildings: world.originVillage?.buildings || []
    });

    Game.ActivityLog.add({
      category: 'system',
      severity: 'warning',
      source: 'debug-test',
      title: 'Representative debug warning',
      details: 'Regression marker 316'
    });

    const metadata = await Game.DebugLogExport.resolveMetadata({ refresh: true });
    const text = Game.DebugLogExport.buildText(metadata);
    const button = document.getElementById('downloadLogsBtn');
    return {
      metadata,
      text,
      buttonText: button?.textContent,
      buttonAria: button?.getAttribute('aria-label'),
      buttonType: button?.getAttribute('type'),
      before,
      after: JSON.stringify({
        seed: world.seed,
        rows: world.rows,
        cols: world.cols,
        terrain: world.terrain,
        buildings: world.originVillage?.buildings || []
      })
    };
  });

  expect(evidence.after).toBe(evidence.before);
  expect(evidence.buttonText).toBe('Download Logs');
  expect(evidence.buttonAria).toBe('Download debug logs');
  expect(evidence.buttonType).toBe('button');
  expect(evidence.metadata.gameVersion).toBe('v0.4.12');
  expect(evidence.metadata.buildSha).toBe('1234567890abcdef1234567890abcdef12345678');
  expect(evidence.metadata.lastDeploy).toBe('2026-08-30T07:36:12.000Z');
  expect(evidence.metadata.deployEnvironment).toBe('github-pages');
  expect(evidence.metadata.deployedBranch).toBe('main');
  expect(evidence.metadata.deploymentRecordSource).toBe('github-deployments-success-status');
  expect(evidence.metadata.publicUrl).toBe('https://sgoxel.github.io/The_Advisor_Game/');
  expect(evidence.text).toContain('Game Version: v0.4.12');
  expect(evidence.text).toContain('Build SHA: 1234567890abcdef1234567890abcdef12345678');
  expect(evidence.text).toContain('Last Deploy: 2026-08-30T07:36:12.000Z');
  expect(evidence.text).toContain('Deploy Environment: github-pages');
  expect(evidence.text).toContain('Deployed Branch: main');
  expect(evidence.text).toContain('Seed:');
  expect(evidence.text).toContain('Game Time:');
  expect(evidence.text).toContain('Viewport:');
  expect(evidence.text).toContain('Browser:');
  expect(evidence.text).toContain('Representative debug warning');
  expect(evidence.text).toContain('Regression marker 316');
});

test('Download Logs produces a timestamped TXT file from the same activity buffer', async ({ page }) => {
  await mockPublicBuildMetadata(page);
  await ready(page);

  await page.evaluate(() => {
    window.Game.ActivityLog.add({
      category: 'world',
      severity: 'info',
      source: 'debug-test',
      title: 'Download marker',
      details: 'same-buffer-evidence'
    });
  });

  await page.click('#logBtn');
  const downloadPromise = page.waitForEvent('download');
  await page.click('#downloadLogsBtn');
  const download = await downloadPromise;
  const suggested = download.suggestedFilename();
  expect(suggested).toMatch(/^advisor-game-debug-1234567890ab-.*\.txt$/);

  const path = await download.path();
  expect(path).not.toBeNull();
  const content = await readFile(path, 'utf8');
  expect(content).toContain('THE ADVISOR GAME - DEBUG LOG');
  expect(content).toContain('Game Version: v0.4.12');
  expect(content).toContain('Build SHA: 1234567890abcdef1234567890abcdef12345678');
  expect(content).toContain('Last Deploy: 2026-08-30T07:36:12.000Z');
  expect(content).toContain('Download marker');
  expect(content).toContain('same-buffer-evidence');
});

test('metadata failure is explicit and never substitutes client time for Last Deploy', async ({ page }) => {
  await page.route('https://api.github.com/**', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'Unavailable' })
  }));
  await ready(page);

  const evidence = await page.evaluate(async () => {
    const metadata = await window.Game.DebugLogExport.resolveMetadata({ refresh: true });
    return {
      metadata,
      text: window.Game.DebugLogExport.buildText(metadata)
    };
  });

  expect(evidence.metadata.lastDeploy).toBeNull();
  expect(evidence.metadata.deploymentRecordSource).toBe('unavailable');
  expect(evidence.text).toContain('Last Deploy: unavailable (no successful public deployment record resolved)');
});
