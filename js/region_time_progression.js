/* R02-T22 / #124: Simulation-owned active/off-screen region time progression. */
(function installRegionTimeProgression() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r02-region-time-progression-v1';
  const COARSE_STEP_MINUTES = 60;

  function requireDependencies() {
    if (!Game.GameTime?.capture) throw new Error('GameTime is required before region time progression.');
    if (!Game.WorldDeltaPersistence?.capture || !Game.WorldDeltaPersistence?.setRegionFlag || !Game.WorldDeltaPersistence?.reconstructRegion) {
      throw new Error('WorldDeltaPersistence is required before region time progression.');
    }
  }

  function coordinates(regionXInput, regionYInput) {
    const regionX = Number(regionXInput);
    const regionY = Number(regionYInput);
    if (!Number.isSafeInteger(regionX) || !Number.isSafeInteger(regionY)) {
      throw new TypeError('Region coordinates must be safe integers.');
    }
    return { regionX, regionY };
  }

  function currentGameMinute() {
    requireDependencies();
    const snapshot = Game.GameTime.capture();
    if (!snapshot || snapshot.authority !== 'simulation' || !Number.isFinite(snapshot.totalGameMinutes)) {
      throw new Error('Authoritative game time is unavailable.');
    }
    return Number(snapshot.totalGameMinutes);
  }

  function seed() {
    return String(Game.State?.world?.seed ?? '');
  }

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
      coarseTicks: Number(flags.regionTimeCoarseTicks || 0) || 0
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
    return progressionFrom(regionX, regionY);
  }

  function markActive(regionXInput, regionYInput) {
    requireDependencies();
    const { regionX, regionY } = coordinates(regionXInput, regionYInput);
    const prior = progressionFrom(regionX, regionY);
    const now = currentGameMinute();
    const last = prior.lastSimulatedGameMinute;
    const elapsed = last === null ? 0 : Math.max(0, now - last);
    const progression = writeProgression(regionX, regionY, {
      mode: 'active-high-detail',
      lastSimulatedGameMinute: now,
      totalElapsedGameMinutes: prior.totalElapsedGameMinutes + elapsed,
      coarseTicks: prior.coarseTicks
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
    const progression = writeProgression(regionX, regionY, {
      mode: 'inactive-aggregate',
      lastSimulatedGameMinute: target,
      totalElapsedGameMinutes: prior.totalElapsedGameMinutes + elapsed,
      coarseTicks
    });
    return Object.freeze({ ...progression, advancedGameMinutes: elapsed });
  }

  function leaveActiveRegion(regionXInput, regionYInput) {
    return markActive(regionXInput, regionYInput);
  }

  function returnToRegion(regionXInput, regionYInput) {
    const { regionX, regionY } = coordinates(regionXInput, regionYInput);
    const progressed = progressInactive(regionX, regionY);
    const reconstructed = Game.WorldDeltaPersistence.reconstructRegion(seed(), regionX, regionY);
    const active = markActive(regionX, regionY);
    return Object.freeze({
      authority: 'simulation',
      regionX,
      regionY,
      elapsedGameMinutes: progressed.advancedGameMinutes,
      progression: active,
      region: reconstructed
    });
  }

  function capture(regionXInput, regionYInput) {
    const { regionX, regionY } = coordinates(regionXInput, regionYInput);
    return progressionFrom(regionX, regionY);
  }

  Game.RegionTimeProgression = Object.freeze({
    version: VERSION,
    authority: 'simulation',
    coarseStepMinutes: COARSE_STEP_MINUTES,
    markActive,
    progressInactive,
    leaveActiveRegion,
    returnToRegion,
    capture
  });
})();
