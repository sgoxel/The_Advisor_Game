/* R02-T22 / #124: Simulation-owned active/off-screen hierarchical world progression. */
(function installRegionTimeProgression() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r02-region-time-progression-v2';
  const COARSE_STEP_MINUTES = 60;

  function requireDependencies() {
    if (!Game.GameTime?.capture) throw new Error('GameTime is required before region time progression.');
    if (!Game.CampaignCalendar?.capture) throw new Error('CampaignCalendar is required before region time progression.');
    if (!Game.WorldHierarchy?.refinementInput || !Game.WorldHierarchy?.materializeLocal) throw new Error('WorldHierarchy is required before region time progression.');
    if (!Game.WorldDeltaPersistence?.capture || !Game.WorldDeltaPersistence?.setRegionFlag || !Game.WorldDeltaPersistence?.reconstructRegion) {
      throw new Error('WorldDeltaPersistence is required before region time progression.');
    }
  }

  function coordinates(regionXInput, regionYInput) {
    const regionX = Number(regionXInput);
    const regionY = Number(regionYInput);
    if (!Number.isSafeInteger(regionX) || !Number.isSafeInteger(regionY)) throw new TypeError('Region coordinates must be safe integers.');
    return { regionX, regionY };
  }

  function campaignSnapshot() {
    requireDependencies();
    const snapshot = Game.CampaignCalendar.capture();
    if (!snapshot || snapshot.authority !== 'simulation' || !Number.isFinite(snapshot.totalGameMinutes)) {
      throw new Error('Authoritative campaign time is unavailable.');
    }
    return snapshot;
  }

  function currentGameMinute() { return Number(campaignSnapshot().totalGameMinutes); }
  function seed() { return String(Game.State?.world?.seed ?? ''); }

  function persistedRegion(regionX, regionY) {
    const captured = Game.WorldDeltaPersistence.capture(seed());
    return captured.regions.find((region) => Number(region.regionX) === regionX && Number(region.regionY) === regionY) || null;
  }

  function progressionFrom(regionX, regionY) {
    const region = persistedRegion(regionX, regionY);
    const flags = region?.flags || {};
    const totalElapsed = Number(flags.regionTimeElapsedMinutes || 0);
    const lastMinute = Number(flags.regionTimeLastMinute);
    return Object.freeze({
      version: VERSION,
      authority: 'simulation',
      mode: flags.regionTimeMode || null,
      lastSimulatedGameMinute: Number.isFinite(lastMinute) ? lastMinute : null,
      totalElapsedGameMinutes: Number.isFinite(totalElapsed) && totalElapsed >= 0 ? totalElapsed : 0,
      coarseTicks: Number(flags.regionTimeCoarseTicks || 0) || 0,
      hierarchy: flags.regionTimeHierarchy || null
    });
  }

  function hierarchyFor(regionX, regionY, campaignMinutes, persistentHistory = {}) {
    const refinement = Game.WorldHierarchy.refinementInput(seed(), regionX, regionY, campaignMinutes, persistentHistory);
    return Object.freeze({
      refinement,
      compact: Object.freeze({
        refinementKey: refinement.refinementKey,
        world: Object.freeze({ id: refinement.world.id, aggregate: refinement.world.aggregate }),
        realm: Object.freeze({ id: refinement.realm.id, aggregate: refinement.realm.aggregate }),
        region: Object.freeze({ id: refinement.region.id, aggregate: refinement.region.aggregate }),
        settlement: refinement.settlement ? Object.freeze({ id: refinement.settlement.id, aggregate: refinement.settlement.aggregate }) : null
      })
    });
  }

  function writeProgression(regionX, regionY, next) {
    const deltas = Game.WorldDeltaPersistence;
    deltas.setRegionFlag(regionX, regionY, 'regionTimeVersion', VERSION);
    deltas.setRegionFlag(regionX, regionY, 'regionTimeAuthority', 'simulation');
    deltas.setRegionFlag(regionX, regionY, 'regionTimeMode', next.mode);
    deltas.setRegionFlag(regionX, regionY, 'regionTimeLastMinute', Number(next.lastSimulatedGameMinute.toFixed(6)));
    deltas.setRegionFlag(regionX, regionY, 'regionTimeElapsedMinutes', Number(next.totalElapsedGameMinutes.toFixed(6)));
    deltas.setRegionFlag(regionX, regionY, 'regionTimeCoarseTicks', next.coarseTicks);
    if (next.hierarchy) deltas.setRegionFlag(regionX, regionY, 'regionTimeHierarchy', next.hierarchy);
    return progressionFrom(regionX, regionY);
  }

  function markActive(regionXInput, regionYInput) {
    requireDependencies();
    const { regionX, regionY } = coordinates(regionXInput, regionYInput);
    const prior = progressionFrom(regionX, regionY);
    const now = currentGameMinute();
    const last = prior.lastSimulatedGameMinute;
    const elapsed = last === null ? 0 : Math.max(0, now - last);
    const hierarchical = hierarchyFor(regionX, regionY, now, persistedRegion(regionX, regionY)?.flags || {});
    const progression = writeProgression(regionX, regionY, {
      mode: 'active-high-detail', lastSimulatedGameMinute: now,
      totalElapsedGameMinutes: prior.totalElapsedGameMinutes + elapsed,
      coarseTicks: prior.coarseTicks, hierarchy: hierarchical.compact
    });
    return Object.freeze({ ...progression, advancedGameMinutes: elapsed });
  }

  function progressInactive(regionXInput, regionYInput, targetGameMinuteInput = null) {
    requireDependencies();
    const { regionX, regionY } = coordinates(regionXInput, regionYInput);
    const target = targetGameMinuteInput === null ? currentGameMinute() : Number(targetGameMinuteInput);
    if (!Number.isFinite(target) || target < 0) throw new TypeError('Target game minute must be non-negative and finite.');
    const prior = progressionFrom(regionX, regionY);
    const baseline = prior.lastSimulatedGameMinute === null ? target : prior.lastSimulatedGameMinute;
    if (target < baseline) throw new RangeError('Region time cannot move backwards.');
    const elapsed = target - baseline;
    const coarseTicks = prior.coarseTicks + Math.floor(elapsed / COARSE_STEP_MINUTES);
    const hierarchical = hierarchyFor(regionX, regionY, target, persistedRegion(regionX, regionY)?.flags || {});
    const progression = writeProgression(regionX, regionY, {
      mode: 'inactive-aggregate', lastSimulatedGameMinute: target,
      totalElapsedGameMinutes: prior.totalElapsedGameMinutes + elapsed,
      coarseTicks, hierarchy: hierarchical.compact
    });
    return Object.freeze({
      ...progression,
      advancedGameMinutes: elapsed,
      lazyCatchUp: true,
      fullDetailReplayTicks: 0,
      materializedLocalEntities: 0,
      hierarchy: hierarchical.compact
    });
  }

  function catchUpInactive(regionXInput, regionYInput) {
    const snapshot = campaignSnapshot();
    const progressed = progressInactive(regionXInput, regionYInput, snapshot.totalGameMinutes);
    return Object.freeze({ ...progressed, campaignCalendar: snapshot.calendar });
  }

  function leaveActiveRegion(regionXInput, regionYInput) { return markActive(regionXInput, regionYInput); }

  function materializeRelevantRegion(regionXInput, regionYInput, options = {}) {
    const { regionX, regionY } = coordinates(regionXInput, regionYInput);
    const progressed = catchUpInactive(regionX, regionY);
    const reconstructed = Game.WorldDeltaPersistence.reconstructRegion(seed(), regionX, regionY);
    const refinement = hierarchyFor(regionX, regionY, progressed.lastSimulatedGameMinute, reconstructed.persistentDeltas?.flags || {}).refinement;
    const local = Game.WorldHierarchy.materializeLocal(refinement, { importantEntityIds: options.importantEntityIds || [] });
    const active = markActive(regionX, regionY);
    return Object.freeze({
      authority: 'simulation', regionX, regionY,
      elapsedGameMinutes: progressed.advancedGameMinutes,
      lazyCatchUp: true,
      fullDetailReplayTicks: 0,
      materializedOffscreenRegions: 0,
      progression: active,
      hierarchy: Object.freeze({ world: refinement.world, realm: refinement.realm, region: refinement.region, settlement: refinement.settlement }),
      local,
      region: reconstructed
    });
  }

  function returnToRegion(regionXInput, regionYInput, options = {}) { return materializeRelevantRegion(regionXInput, regionYInput, options); }
  function capture(regionXInput, regionYInput) { const { regionX, regionY } = coordinates(regionXInput, regionYInput); return progressionFrom(regionX, regionY); }

  Game.RegionTimeProgression = Object.freeze({
    version: VERSION, authority: 'simulation', coarseStepMinutes: COARSE_STEP_MINUTES,
    markActive, progressInactive, catchUpInactive, leaveActiveRegion, materializeRelevantRegion, returnToRegion, capture
  });
})();
