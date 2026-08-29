/*
  R03-T04 / #159
  Deterministic Simulation-owned spatial action legality validation.

  This layer composes the approved ActionLegality contract with authoritative
  spatial context. It validates only; it never mutates or resolves world state.
*/

window.Game = window.Game || {};

(function () {
  const SCHEMA_VERSION = 1;
  const STATUS = Object.freeze({
    ALLOWED: 'allowed',
    REJECTED: 'rejected',
    IMPOSSIBLE: 'impossible',
    NOT_APPLICABLE: 'not_applicable'
  });
  const REASON = Object.freeze({
    OK: 'OK',
    BASE_CONTRACT_UNAVAILABLE: 'BASE_CONTRACT_UNAVAILABLE',
    NON_SIMULATION_CONTEXT: 'NON_SIMULATION_CONTEXT',
    MALFORMED_SPATIAL_REQUEST: 'MALFORMED_SPATIAL_REQUEST',
    STALE_SPATIAL_CONTEXT: 'STALE_SPATIAL_CONTEXT',
    WORLD_CONTEXT_MISMATCH: 'WORLD_CONTEXT_MISMATCH',
    REGION_CONTEXT_MISMATCH: 'REGION_CONTEXT_MISMATCH',
    DESTINATION_REQUIRED: 'DESTINATION_REQUIRED',
    DESTINATION_NOT_FOUND: 'DESTINATION_NOT_FOUND',
    DESTINATION_UNAVAILABLE: 'DESTINATION_UNAVAILABLE',
    DESTINATION_BLOCKED: 'DESTINATION_BLOCKED',
    PREREQUISITE_NOT_MET: 'PREREQUISITE_NOT_MET'
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

  function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
  }

  function stringSet(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
      .map((item) => cleanString(item).toLowerCase())
      .filter(Boolean)))
      .sort();
  }

  function normalizeRequest(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      decisionSource: cleanString(source.decisionSource).toLowerCase(),
      actorId: cleanString(source.actorId),
      actionType: cleanString(source.actionType).toLowerCase(),
      campaignRef: cleanString(source.campaignRef),
      locationRef: cleanString(source.locationRef),
      worldRef: cleanString(source.worldRef),
      regionRef: cleanString(source.regionRef),
      spatialRevision: nonNegativeInteger(source.spatialRevision),
      destinationRef: cleanString(source.destinationRef) || null
    });
  }

  function normalizeDestination(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    return {
      ref: cleanString(source.ref),
      worldRef: cleanString(source.worldRef),
      regionRef: cleanString(source.regionRef),
      available: source.available !== false,
      traversable: source.traversable !== false,
      requiredActorTags: stringSet(source.requiredActorTags),
      blockedReason: cleanString(source.blockedReason) || null
    };
  }

  function normalizeContext(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const actions = source.actions && typeof source.actions === 'object' ? source.actions : {};
    const normalizedActions = {};
    Object.keys(actions).sort().forEach((key) => {
      const actionType = cleanString(key).toLowerCase();
      if (!actionType) return;
      const definition = actions[key] && typeof actions[key] === 'object' ? actions[key] : {};
      normalizedActions[actionType] = {
        enabled: definition.enabled !== false,
        requiresDestination: definition.requiresDestination !== false
      };
    });

    const destinations = (Array.isArray(source.destinations) ? source.destinations : [])
      .map(normalizeDestination)
      .filter((item) => item.ref)
      .sort((a, b) => a.ref.localeCompare(b.ref));

    return {
      authority: cleanString(source.authority).toLowerCase(),
      actorId: cleanString(source.actorId),
      campaignRef: cleanString(source.campaignRef),
      locationRef: cleanString(source.locationRef),
      worldRef: cleanString(source.worldRef),
      regionRef: cleanString(source.regionRef),
      revision: nonNegativeInteger(source.revision),
      actorTags: stringSet(source.actorTags),
      actions: normalizedActions,
      destinations
    };
  }

  function result(status, reasonCode, request, baseResult, destination) {
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      authority: 'simulation',
      status,
      reasonCode,
      canResolve: status === STATUS.ALLOWED,
      request,
      baseReasonCode: baseResult?.reasonCode || null,
      destination: destination ? deepFreeze(destination) : null
    });
  }

  function validate(candidateRequest, authoritativeContext) {
    const request = normalizeRequest(candidateRequest);
    const context = normalizeContext(authoritativeContext);
    const baseApi = window.Game?.ActionLegality;

    if (!baseApi || typeof baseApi.validate !== 'function') {
      return result(STATUS.REJECTED, REASON.BASE_CONTRACT_UNAVAILABLE, request, null, null);
    }
    if (!request.actorId || !request.actionType || !request.campaignRef || !request.locationRef ||
        !request.worldRef || !request.regionRef) {
      return result(STATUS.REJECTED, REASON.MALFORMED_SPATIAL_REQUEST, request, null, null);
    }
    if (context.authority !== 'simulation') {
      return result(STATUS.REJECTED, REASON.NON_SIMULATION_CONTEXT, request, null, null);
    }

    const baseActions = {};
    Object.keys(context.actions).forEach((actionType) => {
      baseActions[actionType] = { enabled: context.actions[actionType].enabled };
    });
    const baseResult = baseApi.validate({
      decisionSource: request.decisionSource,
      actorId: request.actorId,
      actionType: request.actionType,
      campaignRef: request.campaignRef,
      locationRef: request.locationRef
    }, {
      actorId: context.actorId,
      campaignRef: context.campaignRef,
      locationRef: context.locationRef,
      actions: baseActions,
      targets: []
    });

    if (baseResult.status !== baseApi.statuses.ALLOWED) {
      return result(baseResult.status, baseResult.reasonCode, request, baseResult, null);
    }
    if (request.spatialRevision !== context.revision) {
      return result(STATUS.REJECTED, REASON.STALE_SPATIAL_CONTEXT, request, baseResult, null);
    }
    if (!context.worldRef || request.worldRef !== context.worldRef) {
      return result(STATUS.REJECTED, REASON.WORLD_CONTEXT_MISMATCH, request, baseResult, null);
    }
    if (!context.regionRef || request.regionRef !== context.regionRef) {
      return result(STATUS.REJECTED, REASON.REGION_CONTEXT_MISMATCH, request, baseResult, null);
    }

    const action = context.actions[request.actionType];
    if (!action) return result(STATUS.NOT_APPLICABLE, baseApi.reasonCodes.ACTION_NOT_SUPPORTED, request, baseResult, null);
    if (action.requiresDestination && !request.destinationRef) {
      return result(STATUS.REJECTED, REASON.DESTINATION_REQUIRED, request, baseResult, null);
    }
    if (!request.destinationRef) return result(STATUS.ALLOWED, REASON.OK, request, baseResult, null);

    const destination = context.destinations.find((item) => item.ref === request.destinationRef);
    if (!destination) return result(STATUS.REJECTED, REASON.DESTINATION_NOT_FOUND, request, baseResult, null);
    if (destination.worldRef && destination.worldRef !== context.worldRef) {
      return result(STATUS.REJECTED, REASON.WORLD_CONTEXT_MISMATCH, request, baseResult, destination);
    }
    if (destination.regionRef && destination.regionRef !== context.regionRef) {
      return result(STATUS.REJECTED, REASON.REGION_CONTEXT_MISMATCH, request, baseResult, destination);
    }
    if (!destination.available) {
      return result(STATUS.IMPOSSIBLE, REASON.DESTINATION_UNAVAILABLE, request, baseResult, destination);
    }
    if (!destination.traversable) {
      return result(STATUS.IMPOSSIBLE, REASON.DESTINATION_BLOCKED, request, baseResult, destination);
    }
    if (destination.requiredActorTags.some((tag) => !context.actorTags.includes(tag))) {
      return result(STATUS.IMPOSSIBLE, REASON.PREREQUISITE_NOT_MET, request, baseResult, destination);
    }

    return result(STATUS.ALLOWED, REASON.OK, request, baseResult, destination);
  }

  function canonicalStringify(candidateRequest) {
    return JSON.stringify(normalizeRequest(candidateRequest));
  }

  window.Game.SpatialActionLegality = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: 'simulation',
    statuses: STATUS,
    reasonCodes: REASON,
    normalizeRequest,
    canonicalStringify,
    validate
  });
})();
