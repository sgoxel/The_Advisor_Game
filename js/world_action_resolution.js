/*
  R03-T06 / #161
  Simulation-owned resolution for already-candidate spatial actions/interactions.

  Resolution always revalidates against current authoritative context immediately
  before an explicit state transition. Presentation/candidate supplied result data
  is ignored. Spatial protagonist transitions persist through AuthoritativeState /
  CampaignPersistence; target consequences persist through WorldDeltaPersistence.
*/

window.Game = window.Game || {};

(function () {
  const Game = window.Game;
  const SCHEMA_VERSION = 1;
  const STATUS = Object.freeze({ RESOLVED: 'resolved', REJECTED: 'rejected' });
  const REASON = Object.freeze({
    OK: 'OK',
    SPATIAL_VALIDATOR_UNAVAILABLE: 'SPATIAL_VALIDATOR_UNAVAILABLE',
    INTERACTION_VALIDATOR_UNAVAILABLE: 'INTERACTION_VALIDATOR_UNAVAILABLE',
    NON_SIMULATION_RESOLUTION_CONTEXT: 'NON_SIMULATION_RESOLUTION_CONTEXT',
    STALE_RESOLUTION_CONTEXT: 'STALE_RESOLUTION_CONTEXT',
    VALIDATION_REJECTED: 'VALIDATION_REJECTED',
    RESOLUTION_RULE_NOT_FOUND: 'RESOLUTION_RULE_NOT_FOUND',
    DESTINATION_STATE_MISMATCH: 'DESTINATION_STATE_MISMATCH',
    TARGET_STATE_MISMATCH: 'TARGET_STATE_MISMATCH',
    WORLD_DELTA_UNAVAILABLE: 'WORLD_DELTA_UNAVAILABLE',
    INVALID_TRANSITION: 'INVALID_TRANSITION',
    TRANSITION_FAILED: 'TRANSITION_FAILED'
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function integer(value, fallback = 0) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : fallback;
  }

  function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function jsonSafe(value, depth = 0) {
    if (depth > 8) throw new TypeError('Resolution patch is too deeply nested.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('Resolution patch numbers must be finite.');
      return value;
    }
    if (Array.isArray(value)) return value.map((entry) => jsonSafe(entry, depth + 1));
    if (!isPlainObject(value)) throw new TypeError('Resolution patch must be JSON-safe.');
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new TypeError('Resolution patch contains a forbidden key.');
      output[key] = jsonSafe(value[key], depth + 1);
    }
    return output;
  }

  function normalizeSpatialRule(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    return {
      destinationRef: cleanString(source.destinationRef),
      row: integer(source.row, -1),
      col: integer(source.col, -1)
    };
  }

  function normalizeInteractionRule(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    let statePatch = {};
    try { statePatch = jsonSafe(source.statePatch ?? {}); } catch (_error) { statePatch = null; }
    return {
      interactionType: cleanString(source.interactionType).toLowerCase(),
      targetRef: cleanString(source.targetRef),
      expectedTargetStateRef: cleanString(source.expectedTargetStateRef) || null,
      nextTargetStateRef: cleanString(source.nextTargetStateRef) || null,
      regionX: integer(source.regionX, Number.NaN),
      regionY: integer(source.regionY, Number.NaN),
      statePatch
    };
  }

  function normalizeResolutionContext(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    return {
      authority: cleanString(source.authority).toLowerCase(),
      revision: nonNegativeInteger(source.revision),
      spatialRules: (Array.isArray(source.spatialRules) ? source.spatialRules : [])
        .map(normalizeSpatialRule)
        .filter((rule) => rule.destinationRef)
        .sort((a, b) => a.destinationRef.localeCompare(b.destinationRef)),
      interactionRules: (Array.isArray(source.interactionRules) ? source.interactionRules : [])
        .map(normalizeInteractionRule)
        .filter((rule) => rule.interactionType && rule.targetRef)
        .sort((a, b) => `${a.interactionType}:${a.targetRef}`.localeCompare(`${b.interactionType}:${b.targetRef}`))
    };
  }

  function rejected(reasonCode, validation, details = null) {
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      authority: 'simulation',
      status: STATUS.REJECTED,
      reasonCode,
      validationStatus: validation?.status || null,
      validationReasonCode: validation?.reasonCode || null,
      consequence: null,
      details: details ? deepFreeze(details) : null
    });
  }

  function resolved(kind, validation, consequence) {
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      authority: 'simulation',
      status: STATUS.RESOLVED,
      reasonCode: REASON.OK,
      kind,
      validationStatus: validation.status,
      validationReasonCode: validation.reasonCode,
      consequence: deepFreeze(consequence),
      details: null
    });
  }

  function checkResolutionContext(resolutionContext, expectedRevision) {
    const context = normalizeResolutionContext(resolutionContext);
    if (context.authority !== 'simulation') return { ok: false, context, reasonCode: REASON.NON_SIMULATION_RESOLUTION_CONTEXT };
    if (context.revision !== nonNegativeInteger(expectedRevision)) return { ok: false, context, reasonCode: REASON.STALE_RESOLUTION_CONTEXT };
    return { ok: true, context };
  }

  function resolveSpatial(candidateRequest, authoritativeContext, resolutionContext) {
    const validator = Game.SpatialActionLegality;
    if (!validator || typeof validator.validate !== 'function') return rejected(REASON.SPATIAL_VALIDATOR_UNAVAILABLE, null);

    const validation = validator.validate(candidateRequest, authoritativeContext);
    if (validation.status !== validator.statuses.ALLOWED || validation.canResolve !== true) {
      return rejected(REASON.VALIDATION_REJECTED, validation);
    }

    const checked = checkResolutionContext(resolutionContext, authoritativeContext?.revision);
    if (!checked.ok) return rejected(checked.reasonCode, validation);

    const destinationRef = validation.request.destinationRef;
    const rule = checked.context.spatialRules.find((item) => item.destinationRef === destinationRef);
    if (!rule) return rejected(REASON.RESOLUTION_RULE_NOT_FOUND, validation);

    const world = Game.State?.world;
    const player = world?.player;
    if (!world || !player || !Array.isArray(world.terrain) || rule.row < 0 || rule.col < 0 || rule.row >= world.rows || rule.col >= world.cols) {
      return rejected(REASON.INVALID_TRANSITION, validation);
    }
    const tile = world.terrain[rule.row]?.[rule.col];
    if (!tile || tile.blocked === true || tile.obstacle === true) {
      return rejected(REASON.DESTINATION_STATE_MISMATCH, validation);
    }

    const from = { row: integer(player.row), col: integer(player.col) };
    Object.assign(player, {
      row: rule.row,
      col: rule.col,
      moving: false,
      startRow: rule.row,
      startCol: rule.col,
      targetRow: rule.row,
      targetCol: rule.col,
      progress: 1,
      pathQueue: []
    });
    world.selected = null;
    world.previewPath = [];
    if (Game.State?.render) {
      Game.State.render.needsWorldRedraw = true;
      Game.State.render.needsMinimapRedraw = true;
    }

    return resolved('spatial', validation, {
      type: 'protagonist_location',
      destinationRef,
      from,
      to: { row: rule.row, col: rule.col },
      persistence: 'authoritative_state'
    });
  }

  function resolveInteraction(candidateRequest, authoritativeContext, resolutionContext) {
    const validator = Game.InteractionValidation;
    if (!validator || typeof validator.validate !== 'function') return rejected(REASON.INTERACTION_VALIDATOR_UNAVAILABLE, null);

    const validation = validator.validate(candidateRequest, authoritativeContext);
    if (validation.status !== validator.statuses.ALLOWED || validation.canResolve !== true || !validation.target) {
      return rejected(REASON.VALIDATION_REJECTED, validation);
    }

    const checked = checkResolutionContext(resolutionContext, authoritativeContext?.revision);
    if (!checked.ok) return rejected(checked.reasonCode, validation);

    const request = validation.request;
    const target = validation.target;
    const rule = checked.context.interactionRules.find((item) => item.interactionType === request.interactionType && item.targetRef === target.ref);
    if (!rule) return rejected(REASON.RESOLUTION_RULE_NOT_FOUND, validation);
    if (!Number.isSafeInteger(rule.regionX) || !Number.isSafeInteger(rule.regionY) || !rule.statePatch) {
      return rejected(REASON.INVALID_TRANSITION, validation);
    }
    if (rule.expectedTargetStateRef && rule.expectedTargetStateRef !== target.stateRef) {
      return rejected(REASON.TARGET_STATE_MISMATCH, validation);
    }

    const deltaApi = Game.WorldDeltaPersistence;
    if (!deltaApi || typeof deltaApi.recordEntityDelta !== 'function') return rejected(REASON.WORLD_DELTA_UNAVAILABLE, validation);

    const patch = {
      ...rule.statePatch,
      ...(rule.nextTargetStateRef ? { stateRef: rule.nextTargetStateRef } : {}),
      lastInteraction: {
        type: request.interactionType,
        actorId: request.actorId,
        campaignRef: request.campaignRef,
        contextRevision: request.contextRevision
      }
    };

    try {
      deltaApi.recordEntityDelta(rule.regionX, rule.regionY, target.ref, patch, false);
    } catch (_error) {
      return rejected(REASON.TRANSITION_FAILED, validation);
    }

    return resolved('interaction', validation, {
      type: 'world_entity_delta',
      targetRef: target.ref,
      targetCategory: target.category,
      regionX: rule.regionX,
      regionY: rule.regionY,
      statePatch: patch,
      persistence: 'world_delta'
    });
  }

  Game.WorldActionResolution = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: 'simulation',
    statuses: STATUS,
    reasonCodes: REASON,
    resolveSpatial,
    resolveInteraction
  });
})();
