import { test, expect } from '@playwright/test';

async function waitForWorldDeltas(page) {
  await page.goto('./');
  await page.waitForFunction(() => Boolean(
    window.Game?.State?.world?.terrain?.length &&
    window.Game?.RegionTerrain?.generateRegion &&
    window.Game?.WorldDeltaPersistence?.reconstructRegion &&
    window.Game?.CampaignPersistence?.loadSave
  ));
}

function stable(value) { return JSON.stringify(value); }

test('unchanged regions regenerate from SEED and coordinates without stored region copies', async ({ page }) => {
  await waitForWorldDeltas(page);

  const evidence = await page.evaluate(() => {
    const deltas = window.Game.WorldDeltaPersistence;
    const terrain = window.Game.RegionTerrain;
    const seed = window.Game.State.world.seed;
    deltas.clearAll();

    const base = terrain.generateRegion(seed, 3, -2);
    const reconstructed = deltas.reconstructRegion(seed, 3, -2);
    const captured = deltas.capture(seed);
    return {
      regionCount: captured.regions.length,
      baseFingerprint: terrain.fingerprint(base),
      reconstructedFingerprint: terrain.fingerprint(reconstructed),
      sameOrigin: base.originWorldX === reconstructed.originWorldX && base.originWorldY === reconstructed.originWorldY,
      deltaBytes: JSON.stringify(captured),
      generatorVersion: captured.terrainGeneratorVersion,
      runtimeGeneratorVersion: terrain.generatorVersion
    };
  });

  expect(evidence.regionCount).toBe(0);
  expect(evidence.reconstructedFingerprint).toBe(evidence.baseFingerprint);
  expect(evidence.sameOrigin).toBe(true);
  expect(evidence.deltaBytes).not.toContain('"tiles"');
  expect(evidence.generatorVersion).toBe(evidence.runtimeGeneratorVersion);
});

test('sparse tile, entity and region changes reconstruct as deterministic base plus deltas', async ({ page }) => {
  await waitForWorldDeltas(page);

  const evidence = await page.evaluate(() => {
    const deltas = window.Game.WorldDeltaPersistence;
    const terrain = window.Game.RegionTerrain;
    const seed = window.Game.State.world.seed;
    deltas.clearAll();

    const base = terrain.generateRegion(seed, 2, -1);
    const original = base.tiles[3][4];
    const replacementType = original.type === 'road' ? 'grass' : 'road';
    deltas.recordTileDelta(2, -1, 3, 4, { type: replacementType, road: replacementType === 'road' });
    deltas.recordEntityDelta(2, -1, 'npc:stable:merchant', { activity: 'market', stamina: 73, inventory: ['bread'] });
    deltas.setRegionFlag(2, -1, 'bridgeRepaired', true);

    const captured = deltas.capture(seed);
    const reconstructed = deltas.reconstructRegion(seed, 2, -1);
    const otherBase = terrain.generateRegion(seed, -4, 5);
    const otherReconstructed = deltas.reconstructRegion(seed, -4, 5);
    const region = captured.regions[0];

    let firstSave;
    let secondSave;
    if (window.Game.CampaignCalendar?.serializeSaveAt && window.Game.GameTime?.setForTest) {
      window.Game.GameTime.stop?.();
      const fixedGameMinutes = 480;
      const fixedRealTimestampMs = 1787947200000;
      window.Game.GameTime.setForTest(fixedGameMinutes);
      firstSave = window.Game.CampaignCalendar.serializeSaveAt(fixedRealTimestampMs);
      window.Game.GameTime.setForTest(fixedGameMinutes);
      secondSave = window.Game.CampaignCalendar.serializeSaveAt(fixedRealTimestampMs);
    } else {
      firstSave = window.Game.CampaignPersistence.serializeSave();
      secondSave = window.Game.CampaignPersistence.serializeSave();
    }

    return {
      captured,
      replacementType,
      reconstructedTile: reconstructed.tiles[3][4],
      persistentDeltas: reconstructed.persistentDeltas,
      otherBaseFingerprint: terrain.fingerprint(otherBase),
      otherReconstructedFingerprint: terrain.fingerprint(otherReconstructed),
      hasFullTilesCopy: Object.prototype.hasOwnProperty.call(region, 'tiles'),
      tileChangeCount: region.tileChanges.length,
      entityChangeCount: region.entityChanges.length,
      flagValue: region.flags.bridgeRepaired,
      firstSave,
      secondSave
    };
  });

  expect(evidence.captured.regions).toHaveLength(1);
  expect(evidence.hasFullTilesCopy).toBe(false);
  expect(evidence.tileChangeCount).toBe(1);
  expect(evidence.entityChangeCount).toBe(1);
  expect(evidence.flagValue).toBe(true);
  expect(evidence.reconstructedTile.type).toBe(evidence.replacementType);
  expect(evidence.reconstructedTile.authority).toBe('simulation');
  expect(evidence.persistentDeltas.entityChanges[0]).toMatchObject({
    id: 'npc:stable:merchant',
    removed: false,
    state: { activity: 'market', inventory: ['bread'], stamina: 73 }
  });
  expect(evidence.otherReconstructedFingerprint).toBe(evidence.otherBaseFingerprint);
  expect(evidence.firstSave).toBe(evidence.secondSave);
});

test('campaign save/load restores sparse deltas and repeated region reconstruction preserves changes', async ({ page }) => {
  await waitForWorldDeltas(page);

  const evidence = await page.evaluate(() => {
    const deltas = window.Game.WorldDeltaPersistence;
    const persistence = window.Game.CampaignPersistence;
    const terrain = window.Game.RegionTerrain;
    const seed = window.Game.State.world.seed;
    deltas.clearAll();

    const base = terrain.generateRegion(seed, -1, 1);
    const original = base.tiles[7][8];
    const replacementType = original.type === 'forest' ? 'dirt' : 'forest';
    deltas.recordTileDelta(-1, 1, 7, 8, { type: replacementType });
    deltas.recordEntityDelta(-1, 1, 'npc:stable:guard', { activity: 'gate', health: 81 });
    const saved = persistence.serializeSave();

    deltas.recordTileDelta(-1, 1, 7, 8, { type: original.type });
    deltas.recordEntityDelta(-1, 1, 'npc:stable:guard', { activity: 'home', health: 1 });
    const loadResult = persistence.loadSave(saved);
    const firstReturn = deltas.reconstructRegion(seed, -1, 1);
    const secondReturn = deltas.reconstructRegion(seed, -1, 1);
    const restored = deltas.capture(seed);

    return {
      ok: loadResult.ok,
      savedEnvelope: JSON.parse(saved),
      restored,
      expectedType: replacementType,
      firstTile: firstReturn.tiles[7][8],
      sameRepeatedReconstruction: JSON.stringify(firstReturn) === JSON.stringify(secondReturn),
      entity: firstReturn.persistentDeltas.entityChanges[0]
    };
  });

  expect(evidence.ok).toBe(true);
  expect(evidence.savedEnvelope.worldDeltaState.regions).toHaveLength(1);
  expect(evidence.restored.regions).toHaveLength(1);
  expect(evidence.firstTile.type).toBe(evidence.expectedType);
  expect(evidence.sameRepeatedReconstruction).toBe(true);
  expect(evidence.entity).toMatchObject({ id: 'npc:stable:guard', state: { activity: 'gate', health: 81 } });
});

test('tampered world delta data fails before mutation and legacy v1 saves without deltas remain compatible', async ({ page }) => {
  await waitForWorldDeltas(page);

  const evidence = await page.evaluate(() => {
    const deltas = window.Game.WorldDeltaPersistence;
    const persistence = window.Game.CampaignPersistence;
    const seed = window.Game.State.world.seed;
    deltas.clearAll();
    deltas.recordTileDelta(0, 0, 1, 1, { blocked: true });
    const before = JSON.stringify(deltas.capture(seed));

    const tampered = JSON.parse(persistence.serializeSave());
    tampered.worldDeltaState.regions[0].tileChanges[0].patch.worldX = 999999;
    const rejected = persistence.loadSave(JSON.stringify(tampered));
    const afterRejected = JSON.stringify(deltas.capture(seed));

    const legacy = JSON.parse(persistence.serializeSave());
    delete legacy.worldDeltaState;
    const legacyChecked = persistence.validateSave(JSON.stringify(legacy));

    return {
      rejectedOk: rejected.ok,
      rejectedCode: rejected.code,
      unchangedAfterReject: before === afterRejected,
      legacyOk: legacyChecked.ok,
      legacyRegions: legacyChecked.ok ? legacyChecked.worldDeltaState.regions.length : null
    };
  });

  expect(evidence.rejectedOk).toBe(false);
  expect(evidence.rejectedCode).toBe('INVALID_WORLD_DELTAS');
  expect(evidence.unchangedAfterReject).toBe(true);
  expect(evidence.legacyOk).toBe(true);
  expect(evidence.legacyRegions).toBe(0);
});
