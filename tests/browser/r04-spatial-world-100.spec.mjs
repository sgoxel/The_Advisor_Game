import { test, expect } from '@playwright/test';

async function ready(page) {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.SpatialWorld?.generateOriginVillage &&
    window.Game?.RegionTerrain?.generateRegion &&
    window.Game?.NPCSpatial?.updateAt &&
    window.Game?.NPCWorld?.drawPresentation &&
    window.Game?.State?.world?.originVillage?.spatialModelVersion &&
    window.Game?.State?.world?.rows === 100 &&
    window.Game?.State?.world?.cols === 100
  ), null, { timeout: 20_000 });
  return { pageErrors, consoleErrors };
}

function stable(value) { return JSON.stringify(value); }
function footprintCells(building) {
  const cells = [];
  const f = building.footprint;
  for (let row = f.row; row < f.row + f.height; row += 1) {
    for (let col = f.col; col < f.col + f.width; col += 1) cells.push(`${row},${col}`);
  }
  return cells;
}

async function assertNoUnexpectedErrors(pageErrors, consoleErrors) {
  expect(pageErrors, `page errors: ${pageErrors.join('\n')}`).toEqual([]);
  expect(consoleErrors.filter((line) => !/favicon/i.test(line)), `console errors: ${consoleErrors.join('\n')}`).toEqual([]);
}

test('canonical active and generated region dimensions are exactly 100x100', async ({ page }) => {
  const errors = await ready(page);
  const evidence = await page.evaluate(() => {
    const Config = window.Game.Config;
    const region = window.Game.RegionTerrain.generateRegion('ADMIN-100-SIZE', 3, -2);
    return {
      config: {
        logical: Config.LOGICAL_REGION_TILES,
        defaultRows: Config.DEFAULT_ROWS,
        defaultCols: Config.DEFAULT_COLS,
        minMap: Config.MIN_MAP_SIZE,
        maxMap: Config.MAX_MAP_SIZE
      },
      runtime: {
        rows: window.Game.State.world.rows,
        cols: window.Game.State.world.cols,
        currentRegionSize: window.Game.State.world.currentRegion?.regionSize ?? window.Game.SpatialWorld.regionSize
      },
      regionSize: window.Game.RegionTerrain.regionSize,
      rows: region.tiles.length,
      cols: region.tiles[0]?.length,
      tileCount: region.tiles.reduce((sum, row) => sum + row.length, 0)
    };
  });

  expect(evidence.config).toEqual({ logical: 100, defaultRows: 100, defaultCols: 100, minMap: 100, maxMap: 100 });
  expect(evidence.runtime.rows).toBe(100);
  expect(evidence.runtime.cols).toBe(100);
  expect(evidence.runtime.currentRegionSize).toBe(100);
  expect(evidence.regionSize).toBe(100);
  expect(evidence.rows).toBe(100);
  expect(evidence.cols).toBe(100);
  expect(evidence.tileCount).toBe(10_000);
  await assertNoUnexpectedErrors(errors.pageErrors, errors.consoleErrors);
});

test('SEED and coordinates deterministically produce thematic regions and a coherent 2x2 large city', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.SpatialWorld;
    const seed = 'ADMIN-100-THEMES';
    const sameA = api.describeTheme(seed, 7, -4);
    const sameB = api.describeTheme(seed, 7, -4);
    const seen = new Map();
    let city = null;

    for (let y = -30; y <= 30; y += 1) {
      for (let x = -30; x <= 30; x += 1) {
        const theme = api.describeTheme(seed, x, y);
        if (!seen.has(theme.theme)) seen.set(theme.theme, { x, y, theme });
        if (!city && theme.theme === 'large-city') city = theme;
      }
    }

    let cityDistricts = [];
    if (city) {
      const f = city.regionFootprint;
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          cityDistricts.push(api.describeTheme(seed, f.anchorRegionX + dx, f.anchorRegionY + dy));
        }
      }
    }

    return {
      sameA,
      sameB,
      themes: Array.from(seen.keys()),
      city,
      cityDistricts: cityDistricts.map((entry) => ({
        x: entry.region.x,
        y: entry.region.y,
        theme: entry.theme,
        settlementId: entry.settlementId,
        footprint: entry.regionFootprint,
        district: entry.district
      }))
    };
  });

  expect(stable(evidence.sameA)).toBe(stable(evidence.sameB));
  expect(evidence.themes).toEqual(expect.arrayContaining(['village', 'town', 'forest', 'coast', 'large-city']));
  expect(evidence.city).not.toBeNull();
  expect(evidence.city.regionFootprint).toMatchObject({ regionsWide: 2, regionsHigh: 2, regionCount: 4, totalLogicalTiles: 40_000 });
  expect(evidence.cityDistricts).toHaveLength(4);
  expect(new Set(evidence.cityDistricts.map((entry) => entry.settlementId)).size).toBe(1);
  expect(evidence.cityDistricts.every((entry) => entry.theme === 'large-city')).toBe(true);
  expect(new Set(evidence.cityDistricts.map((entry) => entry.district?.index)).size).toBe(4);
});

test('starter village uses deterministic full-region building, road, home and workplace layout', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    const api = window.Game.SpatialWorld;
    const first = api.generateOriginVillage('ADMIN-100-VILLAGE-A');
    const repeated = api.generateOriginVillage('ADMIN-100-VILLAGE-A');
    const other = api.generateOriginVillage('ADMIN-100-VILLAGE-B');
    return {
      first: first.village,
      repeated: repeated.village,
      other: other.village
    };
  });

  expect(stable(evidence.first)).toBe(stable(evidence.repeated));
  expect(stable(evidence.first)).not.toBe(stable(evidence.other));
  expect(evidence.first.regionSize).toBe(100);
  expect(evidence.first.population.length).toBeGreaterThanOrEqual(20);
  expect(evidence.first.buildings.length).toBeGreaterThanOrEqual(20);
  expect(evidence.first.roadTiles.length).toBeGreaterThan(150);

  const occupied = new Set();
  for (const building of evidence.first.buildings) {
    expect(building.footprint.row).toBeGreaterThanOrEqual(0);
    expect(building.footprint.col).toBeGreaterThanOrEqual(0);
    expect(building.footprint.row + building.footprint.height).toBeLessThanOrEqual(100);
    expect(building.footprint.col + building.footprint.width).toBeLessThanOrEqual(100);
    for (const cell of footprintCells(building)) {
      expect(occupied.has(cell), `overlapping building footprint at ${cell}`).toBe(false);
      occupied.add(cell);
    }
  }

  const homes = evidence.first.buildings.filter((building) => building.type === 'home');
  expect(homes.length).toBeGreaterThanOrEqual(8);
  expect(homes.every((home) => home.footprint.width >= 10 && home.footprint.height >= 10)).toBe(true);
  expect(homes.every((home) => Array.isArray(home.rooms) && home.rooms.length >= 2)).toBe(true);

  const buildingIds = new Set(evidence.first.buildings.map((building) => building.id));
  expect(evidence.first.population.every((npc) => buildingIds.has(npc.homeBuildingId) && buildingIds.has(npc.workBuildingId))).toBe(true);
  expect(evidence.first.population.every((npc) => npc.routes.homeToWork.length > 1 && npc.routes.workToSocial.length > 1 && npc.routes.socialToHome.length > 1)).toBe(true);

  const homeCenters = homes.map((home) => ({
    row: home.footprint.row + home.footprint.height / 2,
    col: home.footprint.col + home.footprint.width / 2
  }));
  expect(Math.min(...homeCenters.map((p) => p.row))).toBeLessThan(40);
  expect(Math.max(...homeCenters.map((p) => p.row))).toBeGreaterThan(60);
  expect(Math.min(...homeCenters.map((p) => p.col))).toBeLessThan(40);
  expect(Math.max(...homeCenters.map((p) => p.col))).toBeGreaterThan(60);
});

test('active NPC movement remains integer-tile and collision-free across representative times', async ({ page }) => {
  await ready(page);
  const samples = await page.evaluate(() => {
    const times = [0, 1250, 3500, 6200, 9500, 12_500, 15_500, 18_500, 22_000, 27_500];
    return times.map((time) => {
      window.Game.NPCSpatial.updateAt(time);
      return {
        time,
        npcs: window.Game.NPCSpatial.capture().map((npc) => ({
          id: npc.id, row: npc.row, col: npc.col, activity: npc.activity, decision: npc.movementDecision
        })),
        runtime: {
          collisions: window.Game.State.world.npcRuntime.collisionCount,
          sideSteps: window.Game.State.world.npcRuntime.sideStepCount,
          waits: window.Game.State.world.npcRuntime.yieldWaitCount
        }
      };
    });
  });

  expect(samples.length).toBeGreaterThan(5);
  for (const sample of samples) {
    const keys = sample.npcs.map((npc) => `${npc.row},${npc.col}`);
    expect(new Set(keys).size, `overlap at ${sample.time}`).toBe(keys.length);
    expect(sample.npcs.every((npc) => Number.isInteger(npc.row) && Number.isInteger(npc.col))).toBe(true);
    expect(sample.npcs.every((npc) => npc.row >= 0 && npc.row < 100 && npc.col >= 0 && npc.col < 100)).toBe(true);
  }
});

test('deterministic conflict resolution yields or side-steps instead of overlapping', async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(() => {
    const village = window.Game.State.world.originVillage;
    const road = village.roadTiles.find((p) => p.row === 50 && p.col === 50) || village.roadTiles[0];
    const roads = new Set(village.roadTiles.map((p) => `${p.row},${p.col}`));
    const npcs = [
      { id: 'conflict-a', row: road.row, col: Math.max(0, road.col - 1), anchors: { home: road, work: road, social: road } },
      { id: 'conflict-b', row: Math.max(0, road.row - 1), col: road.col, anchors: { home: road, work: road, social: road } },
      { id: 'conflict-c', row: road.row, col: Math.min(99, road.col + 1), anchors: { home: road, work: road, social: road } }
    ];
    const desired = new Map(npcs.map((npc) => [npc.id, { point: road }]));
    const outcome = window.Game.NPCSpatial.resolveOccupancy(npcs, desired, {
      village, roads, seed: 'ADMIN-CONFLICT', step: 17
    });
    const resolved = npcs.map((npc) => {
      const entry = outcome.resolved.get(npc.id);
      return { id: npc.id, row: entry.point.row, col: entry.point.col, decision: entry.decision, collided: entry.collided };
    });
    return {
      resolved,
      collisionCount: outcome.collisionCount,
      sideStepCount: outcome.sideStepCount,
      yieldWaitCount: outcome.yieldWaitCount
    };
  });

  const keys = result.resolved.map((entry) => `${entry.row},${entry.col}`);
  expect(new Set(keys).size).toBe(keys.length);
  expect(result.collisionCount).toBeGreaterThanOrEqual(2);
  expect(result.resolved.filter((entry) => entry.decision !== 'move' && entry.decision !== 'hold').length).toBeGreaterThanOrEqual(1);
});

test('NPC dialogue occupies adjacent tiles and renders one shared development bubble', async ({ page }) => {
  await ready(page);
  const evidence = await page.evaluate(() => {
    // Global dialogue window is 65%-80% of the demonstration cycle.
    window.Game.NPCSpatial.updateAt(16_800);
    window.Game.NPCWorld.drawPresentation();
    const dialogue = window.Game.State.world.npcDialogues?.[0] || null;
    const npcs = window.Game.NPCSpatial.capture();
    const a = dialogue ? npcs.find((npc) => npc.id === dialogue.speakerId) : null;
    const b = dialogue ? npcs.find((npc) => npc.id === dialogue.listenerId) : null;
    const overlay = document.getElementById('npcWorldOverlay');
    return {
      dialogue,
      distance: a && b ? Math.abs(a.row - b.row) + Math.abs(a.col - b.col) : null,
      sameTile: a && b ? a.row === b.row && a.col === b.col : null,
      overlay: {
        activityBubbleCount: Number(overlay?.dataset.activityBubbleCount || 0),
        dialoguePairCount: Number(overlay?.dataset.dialoguePairCount || 0),
        authority: overlay?.dataset.debugPresentationAuthority,
        spatialRegionSize: Number(overlay?.dataset.spatialRegionSize || 0)
      }
    };
  });

  expect(evidence.dialogue).not.toBeNull();
  expect(evidence.dialogue.adjacent).toBe(true);
  expect(evidence.distance).toBe(1);
  expect(evidence.sameTile).toBe(false);
  expect(evidence.overlay.dialoguePairCount).toBe(1);
  expect(evidence.overlay.activityBubbleCount).toBeGreaterThan(0);
  expect(evidence.overlay.authority).toBe('presentation-only');
  expect(evidence.overlay.spatialRegionSize).toBe(100);
});

for (const viewport of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 }
]) {
  test(`100x100 NPC world and development bubbles remain bounded on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const errors = await ready(page);
    const overlay = await page.evaluate(() => {
      window.Game.NPCSpatial.updateAt(16_800);
      window.Game.NPCWorld.drawPresentation();
      const element = document.getElementById('npcWorldOverlay');
      return {
        rect: element?.getBoundingClientRect().toJSON(),
        npcCount: Number(element?.dataset.npcCount || 0),
        activityBubbleCount: Number(element?.dataset.activityBubbleCount || 0),
        dialoguePairCount: Number(element?.dataset.dialoguePairCount || 0),
        spatialRegionSize: Number(element?.dataset.spatialRegionSize || 0),
        pointerEvents: element ? getComputedStyle(element).pointerEvents : null
      };
    });
    expect(overlay.rect.width).toBeGreaterThan(100);
    expect(overlay.rect.height).toBeGreaterThan(100);
    expect(overlay.npcCount).toBeGreaterThanOrEqual(20);
    expect(overlay.activityBubbleCount).toBeGreaterThan(0);
    expect(overlay.dialoguePairCount).toBe(1);
    expect(overlay.spatialRegionSize).toBe(100);
    expect(overlay.pointerEvents).toBe('none');
    await assertNoUnexpectedErrors(errors.pageErrors, errors.consoleErrors);
  });
}