import { test, expect } from '@playwright/test';

async function waitForPersistence(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.terrain?.length &&
    window.Game?.AuthoritativeState?.capture &&
    window.Game?.CampaignPersistence?.validateSave &&
    window.Game?.CampaignPersistence?.loadSave
  ));
}

test('valid compatible save restores canonical authoritative state and seed identity', async ({ page }) => {
  await waitForPersistence(page);
  const result = await page.evaluate(() => {
    const p = window.Game.CampaignPersistence;
    const a = window.Game.AuthoritativeState;
    const saved = p.serializeSave();
    const expected = a.canonicalStringify(a.capture(window.Game.State));
    window.Game.State.world.seed = 'mutated-after-save';
    window.Game.State.world.player.row = 0;
    const loaded = p.loadSave(saved);
    return { ok: loaded.ok, expected, actual: a.canonicalStringify(a.capture(window.Game.State)) };
  });
  expect(result.ok).toBe(true);
  expect(result.actual).toBe(result.expected);
});

test('malformed, unsupported and structurally incompatible saves fail without mutation', async ({ page }) => {
  await waitForPersistence(page);
  const evidence = await page.evaluate(() => {
    const p = window.Game.CampaignPersistence;
    const a = window.Game.AuthoritativeState;
    const baseline = a.canonicalStringify(a.capture(window.Game.State));
    const valid = JSON.parse(p.serializeSave());
    const cases = [
      '{bad json',
      { ...valid, version: 999 },
      { ...valid, format: 'foreign/save' },
      { ...valid, seedIdentity: 'injected-seed' },
      { ...valid, authoritativeState: { ...valid.authoritativeState, world: { ...valid.authoritativeState.world, terrain: [] } } },
      { ...valid, authoritativeState: { ...valid.authoritativeState, world: { ...valid.authoritativeState.world, protagonist: { row: -1, col: 0 } } } }
    ];
    return cases.map((candidate) => {
      const result = p.loadSave(candidate);
      return { ok: result.ok, code: result.code, unchanged: a.canonicalStringify(a.capture(window.Game.State)) === baseline };
    });
  });
  for (const result of evidence) {
    expect(result.ok).toBe(false);
    expect(result.code).toBeTruthy();
    expect(result.unchanged).toBe(true);
  }
});

test('presentation-only injected truth is ignored and cannot enter authoritative runtime', async ({ page }) => {
  await waitForPersistence(page);
  const result = await page.evaluate(() => {
    const p = window.Game.CampaignPersistence;
    const a = window.Game.AuthoritativeState;
    const envelope = JSON.parse(p.serializeSave());
    envelope.camera = { x: 999999, injected: 'ROOT_PRESENTATION_INJECTION' };
    envelope.authoritativeState.world.selected = { row: 0, col: 0, injected: 'SELECTED_INJECTION' };
    envelope.authoritativeState.world.protagonist.directControl = true;
    const loaded = p.loadSave(envelope);
    const canonical = a.canonicalStringify(a.capture(window.Game.State));
    return { ok: loaded.ok, canonical, cameraX: window.Game.State.camera.x, selected: window.Game.State.world.selected };
  });
  expect(result.ok).toBe(true);
  expect(result.canonical).not.toContain('INJECTION');
  expect(result.canonical).not.toContain('directControl');
  expect(result.cameraX).not.toBe(999999);
  expect(result.selected).toBeNull();
});
