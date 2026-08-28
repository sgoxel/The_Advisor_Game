import { test, expect } from '@playwright/test';

async function waitForApp(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.terrain?.length &&
    window.Game?.AuthoritativeState?.capture &&
    window.Game?.AuthoritativeState?.getLastGeneratedInitialization &&
    window.Game?.State?.dom?.applySettingsBtn
  ));
}

async function generateFromSettings(page, seed) {
  await page.evaluate((nextSeed) => {
    const state = window.Game.State;
    state.dom.seedInput.value = nextSeed;
    state.dom.mapWidthInput.value = String(state.world.cols);
    state.dom.mapHeightInput.value = String(state.world.rows);
    state.dom.applySettingsBtn.click();
  }, seed);
  await page.waitForFunction((canonicalSeed) => (
    window.Game?.AuthoritativeState?.getLastGeneratedInitialization?.()?.world?.seed === canonicalSeed &&
    window.Game?.State?.world?.seed === canonicalSeed
  ), String(seed).trim().normalize('NFC'));
}

test('generated strategic map synchronizes from deterministic authoritative initialization', async ({ page }) => {
  await waitForApp(page);
  const seed = 'R02-T04-authoritative-init';
  await generateFromSettings(page, seed);

  const evidence = await page.evaluate(() => {
    const api = window.Game.AuthoritativeState;
    const initialization = api.getLastGeneratedInitialization();
    const runtime = api.capture(window.Game.State);
    return {
      initializationCanonical: api.canonicalStringify(initialization),
      runtimeCanonical: api.canonicalStringify(runtime),
      frozen: Object.isFrozen(initialization) && Object.isFrozen(initialization.world),
      runtimeTagsAreSets: window.Game.State.world.terrain.every((row) => row.every((tile) => tile.tags instanceof Set)),
      seed: window.Game.State.world.seed,
      protagonist: runtime.world.protagonist,
      runtimePlayer: {
        row: window.Game.State.world.player.row,
        col: window.Game.State.world.player.col
      }
    };
  });

  expect(evidence.initializationCanonical).toBe(evidence.runtimeCanonical);
  expect(evidence.frozen).toBe(true);
  expect(evidence.runtimeTagsAreSets).toBe(true);
  expect(evidence.seed).toBe(seed);
  expect(evidence.protagonist).toEqual(evidence.runtimePlayer);
});

test('equivalent canonical seed inputs reproduce byte-equivalent authoritative state', async ({ page }) => {
  await waitForApp(page);

  await generateFromSettings(page, '  R02-T04-repeatable  ');
  const first = await page.evaluate(() => window.Game.AuthoritativeState.canonicalStringify(
    window.Game.AuthoritativeState.getLastGeneratedInitialization()
  ));

  await generateFromSettings(page, 'R02-T04-repeatable');
  const second = await page.evaluate(() => window.Game.AuthoritativeState.canonicalStringify(
    window.Game.AuthoritativeState.getLastGeneratedInitialization()
  ));

  await generateFromSettings(page, 'R02-T04-distinct');
  const distinct = await page.evaluate(() => window.Game.AuthoritativeState.canonicalStringify(
    window.Game.AuthoritativeState.getLastGeneratedInitialization()
  ));

  expect(second).toBe(first);
  expect(distinct).not.toBe(first);
});

test('presentation mutations do not change initialized authoritative truth', async ({ page }) => {
  await waitForApp(page);
  await generateFromSettings(page, 'R02-T04-presentation-boundary');

  const result = await page.evaluate(() => {
    const api = window.Game.AuthoritativeState;
    const before = api.canonicalStringify(api.getLastGeneratedInitialization());
    window.Game.State.camera.x += 9999;
    window.Game.State.camera.zoom = 0.25;
    window.Game.State.world.selected = { row: 0, col: 0 };
    window.Game.State.world.hover = { row: 1, col: 1 };
    window.Game.State.world.previewPath = [{ row: 2, col: 2 }];
    window.Game.State.render.needsWorldRedraw = !window.Game.State.render.needsWorldRedraw;
    const afterInitialization = api.canonicalStringify(api.getLastGeneratedInitialization());
    const runtime = api.canonicalStringify(api.capture(window.Game.State));
    return { before, afterInitialization, runtime };
  });

  expect(result.afterInitialization).toBe(result.before);
  expect(result.runtime).toBe(result.before);
});
