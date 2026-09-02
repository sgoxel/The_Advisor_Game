import { test, expect } from '@playwright/test';

const EMBEDDED = '/js/embedded_textures.js';
const TOP_LEVEL_TEXTURE = /\/textures\/(?:grass|dirt|forest|lake|river|road|mountain|settlement)_tile_texture\.png(?:\?|$)/;

async function waitForTerrain(page) {
  await page.waitForFunction(() => window.Game?.State?.render?.textureLoadStatus === 'ready');
  return page.evaluate(() => ({
    seed: window.Game.State.world.seed,
    rows: window.Game.State.world.rows,
    cols: window.Game.State.world.cols,
    terrain: window.Game.State.world.terrain.map((row) => row.map((tile) => tile?.type || null)),
    textureKeys: Object.keys(window.Game.State.render.textureImages || {}).sort(),
    fallbackVersion: window.Game.EmbeddedTextureFallback?.version || null,
    payloadRequested: Boolean(window.Game.EmbeddedTextureFallback?.payloadRequested),
    embeddedKeys: Object.keys(window.Game.EmbeddedTextures || {}).sort(),
    navigationMs: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd || 0,
    embeddedResources: performance.getEntriesByType('resource')
      .filter((entry) => entry.name.includes('js/embedded_textures.js'))
      .map((entry) => ({ name: entry.name, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, duration: entry.duration }))
  }));
}

test('normal external texture startup does not load or parse the 3.77 MB embedded fallback', async ({ page }) => {
  let embeddedRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes(EMBEDDED)) embeddedRequests += 1;
  });
  await page.goto('./');
  const result = await waitForTerrain(page);

  expect(result.fallbackVersion).toBe('r04-embedded-texture-fallback-v1');
  expect(result.textureKeys).toEqual(['dirt', 'forest', 'grass', 'lake', 'mountain', 'river', 'road', 'settlement']);
  expect(result.payloadRequested).toBe(false);
  expect(result.embeddedKeys).toEqual([]);
  expect(result.embeddedResources).toEqual([]);
  expect(embeddedRequests).toBe(0);
  expect(result.navigationMs).toBeGreaterThan(0);
});

test('forced external texture failure lazily loads unchanged embedded assets and preserves deterministic world state', async ({ page }) => {
  // Establish the normal-path Simulation fingerprint first.
  await page.goto('./');
  const normal = await waitForTerrain(page);

  // On reload, fail only the eight renderer-owned top-level terrain texture files.
  // Semantic road/building assets remain untouched so this isolates #355 fallback behavior.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (TOP_LEVEL_TEXTURE.test(url.pathname)) {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'forced #355 texture failure' });
      return;
    }
    await route.continue();
  });
  await page.goto('./');
  const fallback = await waitForTerrain(page);

  expect(fallback.fallbackVersion).toBe('r04-embedded-texture-fallback-v1');
  expect(fallback.payloadRequested).toBe(true);
  expect(fallback.embeddedKeys).toEqual(['dirt_tile_texture.png', 'forest_tile_texture.png', 'grass_tile_texture.png', 'lake_tile_texture.png', 'mountain_tile_texture.png', 'river_tile_texture.png', 'road_tile_texture.png', 'settlement_tile_texture.png']);
  expect(fallback.textureKeys).toEqual(normal.textureKeys);
  expect(fallback.embeddedResources.length).toBe(1);
  expect(fallback.seed).toBe(normal.seed);
  expect(fallback.rows).toBe(normal.rows);
  expect(fallback.cols).toBe(normal.cols);
  expect(fallback.terrain).toEqual(normal.terrain);
});
