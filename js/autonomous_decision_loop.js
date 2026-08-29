/*
  R04-T04 / #173
  Bounded, deterministic, time-aware autonomous protagonist decision loop.

  Campaign time and relevant local context are Simulation-owned inputs. Decision
  checkpoints are sparse world deltas so save/load resumes without replaying the
  same decision. Prepared work is revision/time/serial-bound; stale completion
  cannot overwrite newer protagonist/world state.
*/
window.Game = window.Game || {};

(function () {
  const Game = window.Game;
  const SCHEMA_VERSION = 1;
  const CHECKPOINT_ID = 'r04:protagonist-decision-loop';
  const DEFAULT_INTERVAL_MINUTES = 5;
  const REJECT_RETRY_MINUTES = 1;
  const MAX_OPPORTUNITIES = 24;
  const RELEVANT = new Set(['active', 'nearby']);

  const STATUS = Object.freeze({ READY: 'ready', WAIT: 'wait', IDLE: 'idle', STALE: 'stale', RESOLVED: 'resolved', REJECTED: 'rejected' });
  const REASON = Object.freeze({
    OK: 'OK',
    NON_SIMULATION_CONTEXT: 'NON_SIMULATION_CONTEXT',
    INVALID_CAMPAIGN_MINUTE: 'INVALID_CAMPAIGN_MINUTE',
    INVALID_CONTEXT_REVISION: 'INVALID_CONTEXT_REVISION',
    IRRELEVANT_CONTEXT: 'IRRELEVANT_CONTEXT',
    WAIT_INTERVAL: 'WAIT_INTERVAL',
    NO_RELEVANT_OPPORTUNITY: 'NO_RELEVANT_OPPORTUNITY',
    STALE_PREPARED_WORK: 'STALE_PREPARED_WORK',
    EXECUTION_API_UNAVAILABLE: 'EXECUTION_API_UNAVAILABLE'
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function text(value) { return typeof value === 'string' ? value.trim() : ''; }
  function integer(value, fallback = null) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : fallback;
  }
  function minute(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Number(number.toFixed(6)) : null;
  }

  function normalizeContext(input) {
    const source = input && typeof input === 'object' ? input : {};
    return deepFreeze({
      authority: text(source.authority).toLowerCase(),
      campaignMinute: minute(source.campaignMinute),
      contextRevision: integer(source.contextRevision),
      worldRef: text(source.worldRef),
      regionRef: text(source.regionRef),
      locationRef: text(source.locationRef),
      relevance: text(source.relevance).toLowerCase() || 'active',
      regionX: integer(source.regionX, 0),
      regionY: integer(source.regionY, 0),
      intervalMinutes: Math.max(1, integer(source.intervalMinutes, DEFAULT_INTERVAL_MINUTES) || DEFAULT_INTERVAL_MINUTES)
    });
  }

  function checkpointFromDelta(context) {
    const api = Game.WorldDeltaPersistence;
    if (!api?.capture || !Game.State?.world?.seed) return null;
    const captured = api.capture(Game.State.world.seed);
    const region = captured.regions.find((entry) => entry.regionX === context.regionX && entry.regionY === context.regionY);
    const change = region?.entityChanges?.find((entry) => entry.id === CHECKPOINT_ID && entry.removed !== true);
    const state = change?.state;
    if (!state || typeof state !== 'object') return null;
    return deepFreeze({
      serial: Math.max(0, integer(state.serial, 0) || 0),
      campaignMinute: minute(state.campaignMinute) ?? 0,
      contextRevision: Math.max(0, integer(state.contextRevision, 0) || 0),
      worldRef: text(state.worldRef),
      regionRef: text(state.regionRef),
      locationRef: text(state.locationRef),
      lastStatus: text(state.lastStatus),
      lastReasonCode: text(state.lastReasonCode),
      selectedOpportunityId: text(state.selectedOpportunityId) || null
    });
  }

  function writeCheckpoint(context, status, reasonCode, selectedOpportunityId) {
    const api = Game.WorldDeltaPersistence;
    if (!api?.recordEntityDelta) return null;
    const previous = checkpointFromDelta(context);
    const state = {
      serial: (previous?.serial || 0) + 1,
      campaignMinute: context.campaignMinute,
      contextRevision: context.contextRevision,
      worldRef: context.worldRef,
      regionRef: context.regionRef,
      locationRef: context.locationRef,
      lastStatus: status,
      lastReasonCode: reasonCode,
      selectedOpportunityId: selectedOpportunityId || null
    };
    api.recordEntityDelta(context.regionX, context.regionY, CHECKPOINT_ID, state, false);
    return checkpointFromDelta(context);
  }

  function withinSchedule(opportunity, campaignMinute) {
    if (opportunity?.scheduleOpen === false) return false;
    const windows = Array.isArray(opportunity?.timeWindows) ? opportunity.timeWindows : [];
    if (!windows.length) return true;
    const minuteOfDay = Math.floor(campaignMinute) % 1440;
    return windows.some((window) => {
      const start = integer(window?.startMinute);
      const end = integer(window?.endMinute);
      if (start === null || end === null || start < 0 || start > 1439 || end < 0 || end > 1439) return false;
      return start <= end ? minuteOfDay >= start && minuteOfDay <= end : minuteOfDay >= start || minuteOfDay <= end;
    });
  }

  function relevantOpportunities(context, input) {
    const list = Array.isArray(input) ? input : [];
    return list
      .filter((item) => item && typeof item === 'object')
      .filter((item) => !item.locationRef || item.locationRef === context.locationRef)
      .filter((item) => item.relevance === undefined || RELEVANT.has(text(item.relevance).toLowerCase()))
      .filter((item) => withinSchedule(item, context.campaignMinute))
      .slice(0, MAX_OPPORTUNITIES);
  }

  function frozenResult(status, reasonCode, context, checkpoint, extra = {}) {
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      authority: 'simulation',
      status,
      reasonCode,
      campaignMinute: context?.campaignMinute ?? null,
      contextRevision: context?.contextRevision ?? null,
      checkpointSerial: checkpoint?.serial || 0,
      ...extra
    });
  }

  function prepare(contextInput, opportunitiesInput) {
    const context = normalizeContext(contextInput);
    if (context.authority !== 'simulation') return frozenResult(STATUS.REJECTED, REASON.NON_SIMULATION_CONTEXT, context, null);
    if (context.campaignMinute === null) return frozenResult(STATUS.REJECTED, REASON.INVALID_CAMPAIGN_MINUTE, context, null);
    if (context.contextRevision === null || context.contextRevision < 0) return frozenResult(STATUS.REJECTED, REASON.INVALID_CONTEXT_REVISION, context, null);
    if (!RELEVANT.has(context.relevance)) return frozenResult(STATUS.IDLE, REASON.IRRELEVANT_CONTEXT, context, checkpointFromDelta(context));

    const checkpoint = checkpointFromDelta(context);
    if (checkpoint && checkpoint.worldRef === context.worldRef && checkpoint.regionRef === context.regionRef) {
      const retryDelay = checkpoint.lastStatus === STATUS.REJECTED ? REJECT_RETRY_MINUTES : context.intervalMinutes;
      if (context.campaignMinute < checkpoint.campaignMinute + retryDelay) {
        return frozenResult(STATUS.WAIT, REASON.WAIT_INTERVAL, context, checkpoint, {
          nextDecisionMinute: checkpoint.campaignMinute + retryDelay
        });
      }
    }

    const opportunities = relevantOpportunities(context, opportunitiesInput);
    if (!opportunities.length) {
      const saved = writeCheckpoint(context, STATUS.IDLE, REASON.NO_RELEVANT_OPPORTUNITY, null);
      return frozenResult(STATUS.IDLE, REASON.NO_RELEVANT_OPPORTUNITY, context, saved, {
        nextDecisionMinute: context.campaignMinute + context.intervalMinutes
      });
    }

    return frozenResult(STATUS.READY, REASON.OK, context, checkpoint, {
      prepared: deepFreeze({
        authority: 'simulation',
        campaignMinute: context.campaignMinute,
        contextRevision: context.contextRevision,
        worldRef: context.worldRef,
        regionRef: context.regionRef,
        locationRef: context.locationRef,
        regionX: context.regionX,
        regionY: context.regionY,
        checkpointSerial: checkpoint?.serial || 0,
        opportunities
      })
    });
  }

  function resolvePrepared(preparedInput, authoritativeContextInput, executionContextInput) {
    const prepared = preparedInput && typeof preparedInput === 'object' ? preparedInput : null;
    const context = normalizeContext(authoritativeContextInput);
    if (!prepared || prepared.authority !== 'simulation' || context.authority !== 'simulation') {
      return frozenResult(STATUS.REJECTED, REASON.NON_SIMULATION_CONTEXT, context, checkpointFromDelta(context));
    }
    const currentCheckpoint = checkpointFromDelta(context);
    const stale = prepared.campaignMinute !== context.campaignMinute ||
      prepared.contextRevision !== context.contextRevision ||
      prepared.worldRef !== context.worldRef ||
      prepared.regionRef !== context.regionRef ||
      prepared.locationRef !== context.locationRef ||
      prepared.checkpointSerial !== (currentCheckpoint?.serial || 0);
    if (stale) return frozenResult(STATUS.STALE, REASON.STALE_PREPARED_WORK, context, currentCheckpoint);

    const executionApi = Game.AutonomousActionExecution;
    if (!executionApi?.execute) return frozenResult(STATUS.REJECTED, REASON.EXECUTION_API_UNAVAILABLE, context, currentCheckpoint);

    const result = executionApi.execute(authoritativeContextInput, prepared.opportunities, executionContextInput);
    const status = result.status === 'resolved' ? STATUS.RESOLVED : result.status === 'idle' ? STATUS.IDLE : STATUS.REJECTED;
    const saved = writeCheckpoint(context, status, result.reasonCode || REASON.OK, result.selectedOpportunityId || null);
    return frozenResult(status, result.reasonCode || REASON.OK, context, saved, {
      execution: result,
      nextDecisionMinute: context.campaignMinute + (status === STATUS.REJECTED ? REJECT_RETRY_MINUTES : context.intervalMinutes)
    });
  }

  Game.AutonomousDecisionLoop = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: 'simulation',
    checkpointId: CHECKPOINT_ID,
    maxOpportunities: MAX_OPPORTUNITIES,
    statuses: STATUS,
    reasonCodes: REASON,
    normalizeContext,
    readCheckpoint: checkpointFromDelta,
    prepare,
    resolvePrepared
  });
})();
