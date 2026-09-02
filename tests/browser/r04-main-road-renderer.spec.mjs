import { test, expect } from '@playwright/test';

async function loadRuntime(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`page:${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console:${message.text()}`); });
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
    const authoritativeVillage = Game.State.world.originVillage;
    const authoritativeRoads = authoritativeVillage.roadTiles;
    const beforeWorld = JSON.stringify(authoritativeVillage);
    const originalWorld = Game.State.world;
    const syntheticRoads = [];
    for (let col = 10; col <= 16; col += 1) syntheticRoads.push({ row: 10, col }, { row: 11, col });
    const fixtureVillage = { ...authoritativeVillage, roadTiles: syntheticRoads };
    const fixtureWorld = { ...originalWorld, originVillage: fixtureVillage };
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    document.body.appendChild(canvas);
    let evidence = null;
    try {
      Game.State.world = fixtureWorld;
      await Game.MainRoadRenderer.ensureAssets();
      const classification = Game.MainRoadRenderer.classify();
      const beforeRoads = JSON.stringify(fixtureVillage.roadTiles);
      const project = (row, col) => ({ x: (col - 8) * 24, y: (row - 8) * 24 });
      const drawn = Game.MainRoadRenderer.drawPresentation({ canvas, classification, project });
      const afterRoads = JSON.stringify(fixtureVillage.roadTiles);
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let alphaPixels = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) alphaPixels += 1;
      evidence = {
        drawn,
        segmentCount: classification.segments.length,
        classifiedCells: Object.keys(classification.cells).length,
        dataset: {
          mainRoadDrawnCount: canvas.dataset.mainRoadDrawnCount,
          mainRoadTransitionCount: canvas.dataset.mainRoadTransitionCount,
          mainRoadAuthority: canvas.dataset.mainRoadAuthority,
          mainRoadClassificationSource: canvas.dataset.mainRoadClassificationSource,
          mainRoadRegistry: canvas.dataset.mainRoadRegistry,
          mainRoadAssetCount: canvas.dataset.mainRoadAssetCount
        },
        alphaPixels,
        fixtureRoadsUnchanged: beforeRoads === afterRoads
      };
    } finally {
      Game.State.world = originalWorld;
      canvas.remove();
    }
    evidence.authoritativeVillageRestored = Game.State.world.originVillage === authoritativeVillage && JSON.stringify(authoritativeVillage) === beforeWorld;
    evidence.authoritativeRoadArrayIdentityRestored = Game.State.world.originVillage.roadTiles === authoritativeRoads;
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
  expect(result.fixtureRoadsUnchanged).toBe(true);
  expect(result.authoritativeVillageRestored).toBe(true);
  expect(result.authoritativeRoadArrayIdentityRestored).toBe(true);
  expect(failures).toEqual([]);
});

test('final road runtime bridge redraws broad main roads after ordinary-road overlay clear', async ({ page }) => {
  const failures = await loadRuntime(page);
  await page.waitForFunction(() => Boolean(window.Game?.RoadRuntimeBridge?.installed));
  const result = await page.evaluate(async () => {
    const Game = window.Game;
    const originalWorld = Game.State.world;
    const authoritativeVillage = originalWorld.originVillage;
    const authoritativeRoads = authoritativeVillage.roadTiles;
    const beforeVillage = JSON.stringify(authoritativeVillage);
    const syntheticRoads = [];
    for (let col = 10; col <= 16; col += 1) syntheticRoads.push({ row: 10, col }, { row: 11, col });
    const fixtureVillage = { ...authoritativeVillage, roadTiles: syntheticRoads };
    const fixtureWorld = { ...originalWorld, originVillage: fixtureVillage };
    let evidence = null;
    try {
      Game.State.world = fixtureWorld;
      await Game.StarterVillageRoads.ensureSemanticAssets();
      await Game.MainRoadRenderer.ensureAssets();
      const overlay = Game.StarterVillageRoads.ensureOverlay();
      // Remove stale #339 metadata so this assertion proves that the *final*
      // RoadRuntimeBridge composition calls MainRoadRenderer after the ordinary
      // road renderer clears/repaints their shared overlay.
      overlay.dataset.mainRoadRenderedTypes = '';
      overlay.dataset.mainRoadDrawnCount = '';
      overlay.dataset.mainRoadRendererVersion = '';
      const composed = Game.RoadRuntimeBridge.drawRoads();
      evidence = {
        composed,
        ordinaryMode: overlay.dataset.presentationMode,
        ordinaryDrawn: Number(overlay.dataset.semanticDrawnCount || 0),
        mainDrawn: Number(overlay.dataset.mainRoadDrawnCount || 0),
        mainTypes: overlay.dataset.mainRoadRenderedTypes || '',
        mainVersion: overlay.dataset.mainRoadRendererVersion || '',
        fixtureRoadsUnchanged: JSON.stringify(fixtureVillage.roadTiles) === JSON.stringify(syntheticRoads)
      };
    } finally {
      Game.State.world = originalWorld;
    }
    evidence.authoritativeVillageRestored = Game.State.world.originVillage === authoritativeVillage && JSON.stringify(authoritativeVillage) === beforeVillage;
    evidence.authoritativeRoadArrayIdentityRestored = Game.State.world.originVillage.roadTiles === authoritativeRoads;
    return evidence;
  });
  expect(result.composed).toBe(true);
  expect(result.ordinaryMode).toBe('authoritative-semantic-transparent-png');
  expect(result.ordinaryDrawn).toBeGreaterThan(0);
  expect(result.mainDrawn).toBeGreaterThanOrEqual(10);
  expect(result.mainTypes).toContain('main_straight_horizontal_');
  expect(result.mainVersion).toBe('r04-main-road-renderer-v2-final-bridge-composition');
  expect(result.fixtureRoadsUnchanged).toBe(true);
  expect(result.authoritativeVillageRestored).toBe(true);
  expect(result.authoritativeRoadArrayIdentityRestored).toBe(true);
  expect(failures).toEqual([]);
});
