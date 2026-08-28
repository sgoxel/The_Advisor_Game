/* R02 / #133: authoritative campaign calendar and real-world resume catch-up. */
(function installCampaignCalendar() {
  window.Game = window.Game || {};
  const Game = window.Game;
  const VERSION = 'r02-campaign-calendar-v1';
  const AUTHORITY = 'simulation';
  const REAL_MS_PER_GAME_MINUTE = 2500;
  const GAME_MINUTES_PER_DAY = 1440;
  const CAMPAIGN_EPOCH_UTC_MS = Date.UTC(1200, 0, 1);
  const MAX_SAFE_REAL_TIMESTAMP_MS = 8.64e15;
  const basePersistence = Game.CampaignPersistence;

  if (!basePersistence) throw new Error('CampaignCalendar requires CampaignPersistence.');

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function validTimestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= MAX_SAFE_REAL_TIMESTAMP_MS ? number : null;
  }

  function currentGameMinutes() {
    const snapshot = Game.GameTime?.capture?.();
    if (!snapshot || snapshot.authority !== AUTHORITY || !Number.isFinite(snapshot.totalGameMinutes)) {
      throw new Error('CampaignCalendar requires authoritative GameTime.');
    }
    return Number(snapshot.totalGameMinutes);
  }

  function dateParts(totalGameMinutes) {
    const total = Number(totalGameMinutes);
    if (!Number.isFinite(total) || total < 0) throw new TypeError('Campaign game minutes must be non-negative and finite.');
    const wholeMinute = Math.floor(total);
    const dayIndex = Math.floor(wholeMinute / GAME_MINUTES_PER_DAY);
    const minuteOfDay = wholeMinute % GAME_MINUTES_PER_DAY;
    const date = new Date(CAMPAIGN_EPOCH_UTC_MS + dayIndex * 86400000);
    return {
      dayIndex,
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      dayOfMonth: date.getUTCDate(),
      hour: Math.floor(minuteOfDay / 60),
      minute: minuteOfDay % 60,
      isoDate: `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
    };
  }

  function ensureState() {
    const world = Game.State?.world;
    if (!world) throw new Error('Campaign world state is unavailable.');
    const total = currentGameMinutes();
    const existing = world.campaignCalendar;
    if (!existing || existing.version !== VERSION || existing.authority !== AUTHORITY) {
      world.campaignCalendar = {
        version: VERSION,
        authority: AUTHORITY,
        acceptedRealTimestampMs: null,
        totalGameMinutes: total,
        catchUpOperations: 0
      };
    } else {
      existing.totalGameMinutes = total;
    }
    return world.campaignCalendar;
  }

  function capture() {
    const state = ensureState();
    const total = currentGameMinutes();
    state.totalGameMinutes = total;
    return deepFreeze({
      version: VERSION,
      authority: AUTHORITY,
      acceptedRealTimestampMs: state.acceptedRealTimestampMs,
      totalGameMinutes: Number(total.toFixed(6)),
      catchUpOperations: Number(state.catchUpOperations || 0),
      calendar: dateParts(total)
    });
  }

  function checkpointRealTime(observedRealTimestampMs = Date.now()) {
    const observed = validTimestamp(observedRealTimestampMs);
    if (observed === null) return deepFreeze({ ok: false, code: 'INVALID_REAL_TIMESTAMP' });
    const state = ensureState();
    state.acceptedRealTimestampMs = observed;
    state.totalGameMinutes = currentGameMinutes();
    return deepFreeze({ ok: true, state: capture() });
  }

  function reconcileResume(observedRealTimestampMs = Date.now()) {
    const observed = validTimestamp(observedRealTimestampMs);
    if (observed === null) return deepFreeze({ ok: false, code: 'INVALID_REAL_TIMESTAMP', advancedGameMinutes: 0 });
    const state = ensureState();
    const accepted = state.acceptedRealTimestampMs;
    if (accepted === null) {
      state.acceptedRealTimestampMs = observed;
      state.totalGameMinutes = currentGameMinutes();
      return deepFreeze({ ok: true, initialized: true, elapsedRealMilliseconds: 0, advancedGameMinutes: 0, operations: 0, state: capture() });
    }
    if (observed < accepted) {
      return deepFreeze({ ok: false, code: 'BACKWARD_REAL_CLOCK', acceptedRealTimestampMs: accepted, observedRealTimestampMs: observed, advancedGameMinutes: 0 });
    }
    const elapsedRealMilliseconds = observed - accepted;
    const advancedGameMinutes = elapsedRealMilliseconds / REAL_MS_PER_GAME_MINUTE;
    if (advancedGameMinutes > 0) Game.GameTime.advanceGameMinutes(advancedGameMinutes);
    state.acceptedRealTimestampMs = observed;
    state.totalGameMinutes = currentGameMinutes();
    state.catchUpOperations = Number(state.catchUpOperations || 0) + (advancedGameMinutes > 0 ? 1 : 0);
    return deepFreeze({
      ok: true,
      initialized: false,
      elapsedRealMilliseconds,
      advancedGameMinutes: Number(advancedGameMinutes.toFixed(6)),
      elapsedGameDays: Number((advancedGameMinutes / GAME_MINUTES_PER_DAY).toFixed(6)),
      operations: advancedGameMinutes > 0 ? 1 : 0,
      fullDetailReplayTicks: 0,
      materializedOffscreenRegions: 0,
      state: capture()
    });
  }

  function validateCalendarState(candidate) {
    if (candidate === undefined || candidate === null) return deepFreeze({ ok: true, legacy: true, state: null });
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return deepFreeze({ ok: false, code: 'INVALID_CAMPAIGN_CALENDAR' });
    if (candidate.version !== VERSION || candidate.authority !== AUTHORITY) return deepFreeze({ ok: false, code: 'INVALID_CAMPAIGN_CALENDAR' });
    const accepted = candidate.acceptedRealTimestampMs === null ? null : validTimestamp(candidate.acceptedRealTimestampMs);
    if (candidate.acceptedRealTimestampMs !== null && accepted === null) return deepFreeze({ ok: false, code: 'INVALID_REAL_TIMESTAMP' });
    const total = Number(candidate.totalGameMinutes);
    if (!Number.isFinite(total) || total < 0) return deepFreeze({ ok: false, code: 'INVALID_CAMPAIGN_TIME' });
    const operations = Number(candidate.catchUpOperations || 0);
    if (!Number.isSafeInteger(operations) || operations < 0) return deepFreeze({ ok: false, code: 'INVALID_CATCHUP_OPERATIONS' });
    return deepFreeze({ ok: true, legacy: false, state: { version: VERSION, authority: AUTHORITY, acceptedRealTimestampMs: accepted, totalGameMinutes: total, catchUpOperations: operations } });
  }

  function installCalendarState(candidate) {
    const checked = validateCalendarState(candidate);
    if (!checked.ok) return checked;
    const state = ensureState();
    if (checked.legacy) {
      state.acceptedRealTimestampMs = null;
      state.totalGameMinutes = currentGameMinutes();
      state.catchUpOperations = 0;
      return deepFreeze({ ok: true, legacy: true, state: capture() });
    }
    const restoredTime = Game.GameTime.restore({ authority: AUTHORITY, totalGameMinutes: checked.state.totalGameMinutes });
    if (!restoredTime.ok) return deepFreeze({ ok: false, code: 'INVALID_CAMPAIGN_TIME' });
    state.acceptedRealTimestampMs = checked.state.acceptedRealTimestampMs;
    state.totalGameMinutes = checked.state.totalGameMinutes;
    state.catchUpOperations = checked.state.catchUpOperations;
    return deepFreeze({ ok: true, legacy: false, state: capture() });
  }

  function withCalendarEnvelope(baseEnvelope) {
    return deepFreeze({ ...baseEnvelope, campaignCalendarState: capture() });
  }

  function validateWrappedSave(input) {
    let envelope = input;
    if (typeof input === 'string') {
      try { envelope = JSON.parse(input); } catch (_error) { return deepFreeze({ ok: false, code: 'INVALID_JSON' }); }
    }
    const baseChecked = basePersistence.validateSave(envelope);
    if (!baseChecked.ok) return baseChecked;
    const calendarChecked = validateCalendarState(envelope?.campaignCalendarState);
    if (!calendarChecked.ok) return calendarChecked;
    return deepFreeze({ ...baseChecked, campaignCalendarState: calendarChecked.state, legacyCalendar: calendarChecked.legacy });
  }

  function createWrappedEnvelope(candidate, deltaCandidate, observedRealTimestampMs = Date.now()) {
    const checkpoint = checkpointRealTime(observedRealTimestampMs);
    if (!checkpoint.ok) throw new TypeError('Cannot save with an invalid real-world timestamp.');
    return withCalendarEnvelope(basePersistence.createSaveEnvelope(candidate, deltaCandidate));
  }

  function serializeSaveAt(observedRealTimestampMs, candidate, deltaCandidate) {
    return JSON.stringify(createWrappedEnvelope(candidate, deltaCandidate, observedRealTimestampMs));
  }

  function loadSaveAt(input, observedRealTimestampMs = Date.now()) {
    const checked = validateWrappedSave(input);
    if (!checked.ok) return checked;
    const loaded = basePersistence.loadSave(input);
    if (!loaded.ok) return loaded;
    const calendarInstalled = installCalendarState(checked.campaignCalendarState);
    if (!calendarInstalled.ok) return calendarInstalled;
    const resumed = reconcileResume(observedRealTimestampMs);
    if (!resumed.ok && resumed.code !== 'BACKWARD_REAL_CLOCK') return resumed;
    return deepFreeze({ ...loaded, campaignCalendarState: capture(), resumeCatchUp: resumed });
  }

  const wrappedPersistence = Object.freeze({
    ...basePersistence,
    createSaveEnvelope(candidate, deltaCandidate) {
      return createWrappedEnvelope(candidate, deltaCandidate, Date.now());
    },
    serializeSave(candidate, deltaCandidate) {
      return JSON.stringify(createWrappedEnvelope(candidate, deltaCandidate, Date.now()));
    },
    validateSave: validateWrappedSave,
    loadSave(input) {
      return loadSaveAt(input, Date.now());
    }
  });

  Game.CampaignPersistence = wrappedPersistence;
  Game.CampaignCalendar = Object.freeze({
    version: VERSION,
    authority: AUTHORITY,
    realMillisecondsPerGameDay: 3600000,
    gameMinutesPerDay: GAME_MINUTES_PER_DAY,
    capture,
    checkpointRealTime,
    reconcileResume,
    validate: validateCalendarState,
    install: installCalendarState,
    serializeSaveAt,
    loadSaveAt
  });
})();
