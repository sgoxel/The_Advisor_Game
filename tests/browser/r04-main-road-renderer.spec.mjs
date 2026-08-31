import { test, expect } from '@playwright/test';

async function loadRuntime(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`page:${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console:${message.text()}`);
  });
  await page.goto('./');
  await page.waitForFunction(() => Boolean(window.Game?.State?.world && window.Game?.Renderer));
  await page.waitForFunction(() => Boolean(window.Game?.MainRoadRenderer && window.Game?.MainRoadSemantics));
  await page.waitForFunction(() => window.Game.MainRoadRenderer.ensureAssets().then(Boolean));
  return failures;
}

test('maps verified #337 pair semantics to canonical #338 main-road pieces', async ({ page }) => {
  const failures = await loadRuntime(page);
  const mapped = await page.evaluate(() => {
    const visual = window.Game.MainRoadRenderer.visualForSemantic;
    return {
      horizontalTop: visual({ kind: 'main-road', orientation: 'horizontal', memberships: [{ lane: 'a', longitudinalRole: 'middle' }] }),
      horizontalBottom: visual({ kind: 'main-road', orientation: 'horizontal', memberships: [{ lane: 'b', longitudinalRole: 'middle' }] }),
      verticalLeft: visual({ kind: 'main-road', orientation: 'vertical', memberships: [{ lane: 'a', longitudinalRole: 'middle' }] }),
      verticalRight: visual({ kind: 'main-road', orientation: 'vertical', memberships: [{ lane: 'b', longitudinalRole: 'middle' }] }),
      horizontalTransition: visual({ kind: 'main-road', orientation: 'horizontal', memberships: [{ lane: 'a', longitudinalRole: 'start' }] }),
      verticalTransition: visual({ kind: 'main-road', orientation: 'vertical', memberships: [{ lane: 'b', longitudinalRole: 'end' }] }),
      intersection: visual({ kind: 'main-road-intersection', orientation: 'cross', memberships: [{ lane: 'a', longitudinalRole: 'middle' }, { lane: 'b', longitudinalRole: 'middle' }] })
    };
  });

  expect(mapped.horizontalTop.type).toBe('main_straight_horizontal_top');
  expect(mapped.horizontalBottom.type).toBe('main_straight_horizontal_bottom');
  expect(mapped.verticalLeft.type).toBe('main_straight_vertical_left');
  expect(mapped.verticalRight.type).toBe('main_straight_vertical_right');
  expect(mapped.horizontalTransition.type).toBe('main_transition_horizontal');
  expect(mapped.verticalTransition.type).toBe('main_transition_vertical');
  expect(mapped.intersection.type).toBe('main_intersection_cross');
  expect(failures).toEqual([]);
});

test('draws a two-tile-wide classified road without mutating authoritative road topology', async ({ page }) => {
  const failures = await loadRuntime(page);
  const result = await page.evaluate(async () => {
    const Game = window.Game;
    const originalRoads = Game.State.world.originVillage.roadTiles;
    const originalEnsure = Game.StarterVillageRoads.ensureOverlay;
    const originalGridToScreen = Game.Renderer.gridToScreen;
    const beforeWorld = JSON.stringify(Game.State.world.originVillage);

    const syntheticRoads = [];
    for (let col = 10; col <= 16; col += 1) {
      syntheticRoads.push({ row: 10, col }, { row: 11, col });
    }
    Game.State.world.originVillage.roadTiles = syntheticRoads;

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    canvas.style.width = '640px';
    canvas.style.height = '480px';
    document.body.appendChild(canvas);
    Game.StarterVillageRoads.ensureOverlay = () => canvas;
    Game.Renderer.gridToScreen = (row, col) => ({ x: (col - 8) * 24, y: (row - 8) * 24 });

    await Game.MainRoadRenderer.ensureAssets();
    const classification = Game.MainRoadRenderer.classify();
    const beforeRoads = JSON.stringify(Game.State.world.originVillage.roadTiles);
    const drawn = Game.MainRoadRenderer.drawPresentation();
    const afterRoads = JSON.stringify(Game.State.world.originVillage.roadTiles);
    const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let alphaPixels = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) alphaPixels += 1;

    const evidence = {
      drawn,
      segmentCount: classification.segments.length,
      classifiedCells: Object.keys(classification.cells).length,
      dataset: { ...canvas.dataset },
      alphaPixels,
      roadsUnchanged: beforeRoads === afterRoads
    };

    Game.State.world.originVillage.roadTiles = originalRoads;
    Game.StarterVillageRoads.ensureOverlay = originalEnsure;
    Game.Renderer.gridToScreen = originalGridToScreen;
    canvas.remove();
    evidence.authoritativeVillageRestored = JSON.stringify(Game.State.world.originVillage) === beforeWorld;
    return evidence;
  });

  expect(result.drawn).toBe(true);
  expect(result.segmentCount).toBe(1);
  expect(result.classifiedCells).toBe(14);
  expect(Number(result.dataset.mainRoadDrawnCount)).toBeGreaterThanOrEqual(10);
  expect(Number(result.dataset.mainRoadTransitionCount)).toBe(4);
  expect(result.dataset.mainRoadAuthority).toBe('presentation-only');
  expect(result.dataset.mainRoadClassificationSource).toBe('Game.MainRoadSemantics');
  expect(result.dataset.mainRoadRegistry).toBe('canonical-main-road-registry');
  expect(Number(result.dataset.mainRoadAssetCount)).toBe(15);
  expect(result.alphaPixels).toBeGreaterThan(0);
  expect(result.roadsUnchanged).toBe(true);
  expect(result.authoritativeVillageRestored).toBe(true);
  expect(failures).toEqual([]);
});
