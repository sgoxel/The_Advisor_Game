import { test, expect } from '@playwright/test';

const EXPECTED_OPTIONAL_MAP_404S = [
  '/map/ISOMETRIC_MAP_30032026.js',
  '/map/ISOMETRIC_MAP_30032026/ISOMETRIC_MAP_30032026.js',
  '/map/map.js'
];

function collectRuntimeFailures(page) {
  const failures = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const locationUrl = message.location().url || '';
    let expected = false;
    if (text.includes('Failed to load resource') && text.includes('404')) {
      try { expected = EXPECTED_OPTIONAL_MAP_404S.includes(new URL(locationUrl).pathname); } catch { expected = false; }
    }
    if (!expected) failures.push(`console.error: ${text}${locationUrl ? ` @ ${locationUrl}` : ''}`);
  });
  return failures;
}

async function ready(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.RegionTerrain?.generateRegion &&
    window.Game?.OriginVillage?.generate &&
    window.Game?.NPCWorld?.capture &&
    window.Game?.RegionNavigation?.activate &&
    window.Game?.WorldDeltaPersistence?.reconstructRegion &&
    window.Game?.CampaignPersistence?.serializeSave &&
    window.Game?.State?.world?.terrain?.length
  ));
}

test('multiple seeds and positive/negative coordinates remain deterministic, diverse and unbounded', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);

  const evidence = await page.evaluate(() => {
    const terrain = window.Game.RegionTerrain;
    const seeds = ['R02-WORLD-ALPHA', 'R02-WORLD-BETA', 'R02-WORLD-GAMMA'];
    const coords = [[0, 0], [1, -1], [-7, 5], [1200, -975]];
    const snapshots = [];

    for (const seed of seeds) {
      const first = coords.map(([x, y]) => terrain.fingerprint(terrain.generateRegion(seed, x, y)));
      [...coords].reverse().forEach(([x, y]) => terrain.generateRegion(seed, x, y));
      const second = coords.map(([x, y]) => terrain.fingerprint(terrain.generateRegion(seed, x, y)));
      snapshots.push({ seed, first, second, unique: new Set(first).size });
    }

    const west = terrain.generateRegion('R02-BOUNDARY', -1, 0);
    const east = terrain.generateRegion('R02-BOUNDARY', 0, 0);
    const size = terrain.regionSize;
    let maxElevationDelta = 0;
    let maxMoistureDelta = 0;
    let consecutive = true;
    for (let row = 0; row < size; row += 1) {
      const a = west.tiles[row][size - 1];
      const b = east.tiles[row][0];
      consecutive = consecutive && b.worldX === a.worldX + 1 && b.worldY === a.worldY;
      maxElevationDelta = Math.max(maxElevationDelta, Math.abs(a.elevation - b.elevation));
      maxMoistureDelta = Math.max(maxMoistureDelta, Math.abs(a.moisture - b.moisture));
    }

    return {
      snapshots,
      consecutive,
      maxElevationDelta,
      maxMoistureDelta,
      finite: terrain.hasGameplayFiniteBoundary
    };
  });

  for (const snapshot of evidence.snapshots) {
    expect(snapshot.second).toEqual(snapshot.first);
    expect(snapshot.unique).toBeGreaterThanOrEqual(3);
  }
  expect(evidence.consecutive).toBe(true);
  expect(evidence.maxElevationDelta).toBeLessThan(0.2);
  expect(evidence.maxMoistureDelta).toBeLessThan(0.2);
  expect(evidence.finite).toBe(false);
  expect(failures).toEqual([]);
});

test('origin remains inhabited and simulation-owned NPC routines remain governed by authoritative GameTime', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);

  const evidence = await page.evaluate(() => {
    const origin = window.Game.OriginVillage.generate('R02-CUMULATIVE-ORIGIN');
    const npc = window.Game.NPCWorld;
    const gameMinutes = window.Game.GameTime.capture().totalGameMinutes;
    npc.updateAt(0);
    const before = npc.capture();
    npc.updateAt(7000);
    const after = npc.capture();
    const overlay = document.getElementById('npcWorldOverlay');
    return {
      origin,
      before,
      after,
      npcCount: after.length,
      gameMinutes,
      gameMinutesAfter: window.Game.GameTime.capture().totalGameMinutes,
      routineClockAuthority: window.Game.State.world.npcRuntime?.routineClockAuthority,
      allSimulationOwned: after.every((entry) => entry.authority === 'simulation' && entry.controlledBy === 'simulation' && entry.playerControllable === false),
      npcApiKeys: Object.keys(npc),
      navigationApiKeys: Object.keys(window.Game.RegionNavigation),
      overlay: overlay ? {
        pointerEvents: getComputedStyle(overlay).pointerEvents,
        ariaHidden: overlay.getAttribute('aria-hidden')
      } : null
    };
  });

  expect(evidence.origin.region).toMatchObject({ x: 0, y: 0 });
  expect(evidence.origin.village.inhabited).toBe(true);
  expect(evidence.origin.village.buildings.length).toBeGreaterThanOrEqual(10);
  expect(evidence.origin.village.population.length).toBeGreaterThanOrEqual(12);
  expect(evidence.npcCount).toBeGreaterThanOrEqual(12);
  expect(evidence.routineClockAuthority).toBe('Game.GameTime');
  expect(evidence.gameMinutesAfter).toBe(evidence.gameMinutes);
  expect(evidence.after.map((entry) => ({ id: entry.id, row: entry.row, col: entry.col, activity: entry.activity })))
    .toEqual(evidence.before.map((entry) => ({ id: entry.id, row: entry.row, col: entry.col, activity: entry.activity })));
  expect(evidence.allSimulationOwned).toBe(true);
  expect(evidence.npcApiKeys).not.toContain('movePlayer');
  expect(evidence.npcApiKeys).not.toContain('moveProtagonist');
  expect(evidence.navigationApiKeys).not.toContain('movePlayer');
  expect(evidence.navigationApiKeys).not.toContain('moveProtagonist');
  expect(evidence.overlay).toMatchObject({ pointerEvents: 'none', ariaHidden: 'true' });
  expect(failures).toEqual([]);
});

test('region leave/return and campaign save/load preserve sparse world changes over regenerated base state', async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);

  const evidence = await page.evaluate(() => {
    const nav = window.Game.RegionNavigation;
    const deltas = window.Game.WorldDeltaPersistence;
    const terrain = window.Game.RegionTerrain;
    const persistence = window.Game.CampaignPersistence;
    const seed = window.Game.State.world.seed;
    deltas.clearAll();

    const regionX = -2;
    const regionY = 3;
    const row = 5;
    const col = 6;
    const base = terrain.generateRegion(seed, regionX, regionY);
    const original = base.tiles[row][col];
    const replacement = original.type === 'road' ? 'forest' : 'road';

    deltas.recordTileDelta(regionX, regionY, row, col, { type: replacement, road: replacement === 'road' });
    deltas.recordEntityDelta(regionX, regionY, 'npc:cumulative:guard', { activity: 'gate', health: 82 });
    deltas.setRegionFlag(regionX, regionY, 'cumulativeCheckpoint', true);

    nav.activate(regionX, regionY);
    const firstReturn = deltas.reconstructRegion(seed, regionX, regionY);
    nav.activate(8, -9);
    nav.activate(regionX, regionY);
    const secondReturn = deltas.reconstructRegion(seed, regionX, regionY);
    const saved = persistence.serializeSave();

    deltas.recordTileDelta(regionX, regionY, row, col, { type: original.type, road: original.type === 'road' });
    deltas.recordEntityDelta(regionX, regionY, 'npc:cumulative:guard', { activity: 'home', health: 1 });
    deltas.setRegionFlag(regionX, regionY, 'cumulativeCheckpoint', false);

    const loadResult = persistence.loadSave(saved);
    const restored = deltas.reconstructRegion(seed, regionX, regionY);
    const captured = deltas.capture(seed);
    const untouchedBase = terrain.generateRegion(seed, 17, -11);
    const untouched = deltas.reconstructRegion(seed, 17, -11);

    return {
      replacement,
      first: firstReturn.tiles[row][col].type,
      second: secondReturn.tiles[row][col].type,
      loadOk: loadResult.ok,
      restoredType: restored.tiles[row][col].type,
      restoredEntity: restored.persistentDeltas.entityChanges.find((entry) => entry.id === 'npc:cumulative:guard'),
      restoredFlag: restored.persistentDeltas.flags.cumulativeCheckpoint,
      storedRegions: captured.regions.length,
      storesFullTiles: captured.regions.some((region) => Object.prototype.hasOwnProperty.call(region, 'tiles')),
      untouchedStable: terrain.fingerprint(untouchedBase) === terrain.fingerprint(untouched),
      repeatedStable: JSON.stringify(firstReturn) === JSON.stringify(secondReturn)
    };
  });

  expect(evidence.first).toBe(evidence.replacement);
  expect(evidence.second).toBe(evidence.replacement);
  expect(evidence.repeatedStable).toBe(true);
  expect(evidence.loadOk).toBe(true);
  expect(evidence.restoredType).toBe(evidence.replacement);
  expect(evidence.restoredEntity).toMatchObject({ id: 'npc:cumulative:guard', state: { activity: 'gate', health: 82 } });
  expect(evidence.restoredFlag).toBe(true);
  expect(evidence.storedRegions).toBe(1);
  expect(evidence.storesFullTiles).toBe(false);
  expect(evidence.untouchedStable).toBe(true);
  expect(failures).toEqual([]);
});

test('living map remains primary, bounded and accessible across configured responsive projects', async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page);
  await ready(page);
  await page.evaluate(() => window.Game.NPCWorld.drawPresentation());

  const evidence = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const canvas = document.getElementById('gameCanvas')?.getBoundingClientRect();
    const center = document.getElementById('center-area')?.getBoundingClientRect();
    const overlay = document.getElementById('npcWorldOverlay')?.getBoundingClientRect();
    const controls = document.querySelector('[aria-label="Campaign persistence controls"]');
    return {
      viewportWidth,
      scrollWidth: document.documentElement.scrollWidth,
      canvas: canvas ? { width: canvas.width, height: canvas.height } : null,
      center: center ? { width: center.width, height: center.height } : null,
      overlay: overlay ? { width: overlay.width, height: overlay.height } : null,
      persistenceLabel: controls?.getAttribute('aria-label') || null,
      buttons: [...document.querySelectorAll('.persistence-tools button')].map((button) => ({
        text: button.textContent?.trim() || '',
        aria: button.getAttribute('aria-label'),
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height
      }))
    };
  });

  expect(['desktop', 'tablet', 'phone-portrait', 'phone-landscape']).toContain(testInfo.project.name);
  expect(evidence.scrollWidth).toBeLessThanOrEqual(evidence.viewportWidth + 2);
  expect(evidence.canvas?.width || 0).toBeGreaterThan(100);
  expect(evidence.canvas?.height || 0).toBeGreaterThan(100);
  expect(evidence.center?.width || 0).toBeGreaterThan(100);
  expect(evidence.center?.height || 0).toBeGreaterThan(100);
  expect(evidence.overlay?.width || 0).toBeGreaterThan(100);
  expect(evidence.overlay?.height || 0).toBeGreaterThan(100);
  expect(evidence.persistenceLabel).toBe('Campaign persistence controls');
  expect(evidence.buttons.length).toBeGreaterThanOrEqual(3);
  for (const button of evidence.buttons) {
    expect(button.text || button.aria).toBeTruthy();
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(44);
  }
  expect(failures).toEqual([]);
});
