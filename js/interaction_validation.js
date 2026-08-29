/*
  R03-T05 / #160
  Deterministic Simulation-owned NPC/location/animal/creature interaction validation.

  This validator consumes compact authoritative actor/target/context snapshots.
  It is relevance-bounded, does not materialize world detail and never mutates or
  resolves authoritative state.
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
    TARGET_CONTRACT_UNAVAILABLE: 'TARGET_CONTRACT_UNAVAILABLE',
    NON_SIMULATION_CONTEXT: 'NON_SIMULATION_CONTEXT',
    MALFORMED_INTERACTION_REQUEST: 'MALFORMED_INTERACTION_REQUEST',
    STALE_INTERACTION_CONTEXT: 'STALE_INTERACTION_CONTEXT',
    WORLD_CONTEXT_MISMATCH: 'WORLD_CONTEXT_MISMATCH',
    REGION_CONTEXT_MISMATCH: 'REGION_CONTEXT_MISMATCH',
    TARGET_REFERENCE_REJECTED: 'TARGET_REFERENCE_REJECTED',
    TARGET_UNAVAILABLE: 'TARGET_UNAVAILABLE',
    TARGET_IRRELEVANT: 'TARGET_IRRELEVANT',
    TARGET_STATE_MISMATCH: 'TARGET_STATE_MISMATCH',
    INTERACTION_NOT_SUPPORTED: 'INTERACTION_NOT_SUPPORTED',
    INTERACTION_CATEGORY_NOT_APPLICABLE: 'INTERACTION_CATEGORY_NOT_APPLICABLE',
    TIME_WINDOW_CLOSED: 'TIME_WINDOW_CLOSED',
    LOCATION_MISMATCH: 'LOCATION_MISMATCH',
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

  function minuteOfDay(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return ((Math.trunc(number) % 1440) + 1440) % 1440;
  }

  function stringSet(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
      .map((item) => cleanString(item).toLowerCase())
      .filter(Boolean)))
      .sort();
  }

  function normalizeWindow(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    return {
      startMinute: minuteOfDay(source.startMinute),
      endMinute: minuteOfDay(source.endMinute)
    };
  }

  function normalizeRule(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    return {
      enabled: source.enabled !== false,
      allowedTargetCategories: stringSet(source.allowedTargetCategories),
      allowedRelevance: stringSet(source.allowedRelevance),
      requiredActorTags: stringSet(source.requiredActorTags),
      requiredTargetStates: stringSet(source.requiredTargetStates),
      requiresSameSettlement: source.requiresSameSettlement === true,
      requiresSameSite: source.requiresSameSite === true,
      timeWindows: (Array.isArray(source.timeWindows) ? source.timeWindows : []).map(normalizeWindow)
    };
  }

  function normalizeRequest(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const targetSource = source.targetReference && typeof source.targetReference === 'object'
      ? source.targetReference
      : {
          ref: source.targetRef,
          category: source.targetCategory,
          worldRef: source.worldRef,
          regionRef: source.regionRef,
          contextRevision: source.targetContextRevision
        };
    const targetApi = window.Game?.InteractionTarget;
    const normalizedTargetReference = targetApi?.normalizeReference
      ? targetApi.normalizeReference(targetSource)
      : deepFreeze({
          schemaVersion: 1,
          ref: cleanString(targetSource.ref),
          category: cleanString(targetSource.category).toLowerCase(),
          worldRef: cleanString(targetSource.worldRef),
          regionRef: cleanString(targetSource.regionRef),
          contextRevision: nonNegativeInteger(targetSource.contextRevision)
        });

    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      decisionSource: cleanString(source.decisionSource).toLowerCase(),
      actorId: cleanString(source.actorId),
      interactionType: cleanString(source.interactionType).toLowerCase(),
      campaignRef: cleanString(source.campaignRef),
      locationRef: cleanString(source.locationRef),
      worldRef: cleanString(source.worldRef),
      regionRef: cleanString(source.regionRef),
      contextRevision: nonNegativeInteger(source.contextRevision),
      targetReference: normalizedTargetReference,
      expectedTargetStateRef: cleanString(source.expectedTargetStateRef) || null
    });
  }

  function normalizeActorLocation(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    return {
      settlementRef: cleanString(source.settlementRef) || null,
      siteRef: cleanString(source.siteRef) || null
    };
  }

  function normalizeContext(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const interactions = source.interactions && typeof source.interactions === 'object' ? source.interactions : {};
    const normalizedInteractions = {};
    Object.keys(interactions).sort().forEach((key) => {
      const interactionType = cleanString(key).toLowerCase();
      if (interactionType) normalizedInteractions[interactionType] = normalizeRule(interactions[key]);
    });
    return {
      authority: cleanString(source.authority).toLowerCase(),
      actorId: cleanString(source.actorId),
      campaignRef: cleanString(source.campaignRef),
      locationRef: cleanString(source.locationRef),
      worldRef: cleanString(source.worldRef),
      regionRef: cleanString(source.regionRef),
      revision: nonNegativeInteger(source.revision),
      gameMinute: minuteOfDay(source.gameMinute),
      actorTags: stringSet(source.actorTags),
      actorLocation: normalizeActorLocation(source.actorLocation),
      interactions: normalizedInteractions,
      targetContext: source.targetContext && typeof source.targetContext === 'object' ? source.targetContext : {}
    };
  }

  function minuteWithinWindow(minute, window) {
    if (window.startMinute === window.endMinute) return true;
    if (window.startMinute < window.endMinute) return minute >= window.startMinute && minute < window.endMinute;
    return minute >= window.startMinute || minute < window.endMinute;
  }

  function timeAllowed(minute, windows) {
    return windows.length === 0 || windows.some((window) => minuteWithinWindow(minute, window));
  }

  function result(status, reasonCode, request, targetResolution, target, baseResult) {
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      authority: 'simulation',
      status,
      reasonCode,
      canResolve: status === STATUS.ALLOWED,
      request,
      targetReasonCode: targetResolution?.reasonCode || null,
      baseReasonCode: baseResult?.reasonCode || null,
      target: target ? deepFreeze(target) : null
    });
  }

  function validate(candidateRequest, authoritativeContext) {
    const request = normalizeRequest(candidateRequest);
    const context = normalizeContext(authoritativeContext);
    const actionApi = window.Game?.ActionLegality;
    const targetApi = window.Game?.InteractionTarget;

    if (!actionApi || typeof actionApi.validate !== 'function') {
      return result(STATUS.REJECTED, REASON.BASE_CONTRACT_UNAVAILABLE, request, null, null, null);
    }
    if (!targetApi || typeof targetApi.resolve !== 'function') {
      return result(STATUS.REJECTED, REASON.TARGET_CONTRACT_UNAVAILABLE, request, null, null, null);
    }
    if (!request.actorId || !request.interactionType || !request.campaignRef || !request.locationRef ||
        !request.worldRef || !request.regionRef || !request.targetReference?.ref) {
      return result(STATUS.REJECTED, REASON.MALFORMED_INTERACTION_REQUEST, request, null, null, null);
    }
    if (context.authority !== 'simulation') {
      return result(STATUS.REJECTED, REASON.NON_SIMULATION_CONTEXT, request, null, null, null);
    }
    if (request.contextRevision !== context.revision) {
      return result(STATUS.REJECTED, REASON.STALE_INTERACTION_CONTEXT, request, null, null, null);
    }
    if (!context.worldRef || request.worldRef !== context.worldRef) {
      return result(STATUS.REJECTED, REASON.WORLD_CONTEXT_MISMATCH, request, null, null, null);
    }
    if (!context.regionRef || request.regionRef !== context.regionRef) {
      return result(STATUS.REJECTED, REASON.REGION_CONTEXT_MISMATCH, request, null, null, null);
    }

    const rule = context.interactions[request.interactionType];
    const baseResult = actionApi.validate({
      decisionSource: request.decisionSource,
      actorId: request.actorId,
      actionType: request.interactionType,
      campaignRef: request.campaignRef,
      locationRef: request.locationRef,
      targetRef: request.targetReference.ref
    }, {
      actorId: context.actorId,
      campaignRef: context.campaignRef,
      locationRef: context.locationRef,
      actions: rule ? {
        [request.interactionType]: {
          enabled: rule.enabled,
          requiresTarget: true,
          allowedTargetCategories: rule.allowedTargetCategories
        }
      } : {},
      targets: [{ ref: request.targetReference.ref, category: request.targetReference.category }]
    });

    if (!rule) return result(STATUS.NOT_APPLICABLE, REASON.INTERACTION_NOT_SUPPORTED, request, null, null, baseResult);
    if (baseResult.status !== actionApi.statuses.ALLOWED) {
      return result(baseResult.status, baseResult.reasonCode, request, null, null, baseResult);
    }

    const targetResolution = targetApi.resolve(request.targetReference, context.targetContext);
    if (targetResolution.status !== targetApi.statuses.RESOLVED) {
      return result(STATUS.REJECTED, REASON.TARGET_REFERENCE_REJECTED, request, targetResolution, null, baseResult);
    }

    const target = targetResolution.target;
    if (rule.allowedTargetCategories.length > 0 && !rule.allowedTargetCategories.includes(target.category)) {
      return result(STATUS.NOT_APPLICABLE, REASON.INTERACTION_CATEGORY_NOT_APPLICABLE, request, targetResolution, target, baseResult);
    }
    if (!target.available) return result(STATUS.IMPOSSIBLE, REASON.TARGET_UNAVAILABLE, request, targetResolution, target, baseResult);
    if (rule.allowedRelevance.length > 0 && !rule.allowedRelevance.includes(target.relevance)) {
      return result(STATUS.IMPOSSIBLE, REASON.TARGET_IRRELEVANT, request, targetResolution, target, baseResult);
    }
    if (request.expectedTargetStateRef && request.expectedTargetStateRef !== target.stateRef) {
      return result(STATUS.REJECTED, REASON.TARGET_STATE_MISMATCH, request, targetResolution, target, baseResult);
    }
    if (rule.requiredTargetStates.length > 0 && !rule.requiredTargetStates.includes(target.stateRef.toLowerCase())) {
      return result(STATUS.IMPOSSIBLE, REASON.TARGET_STATE_MISMATCH, request, targetResolution, target, baseResult);
    }
    if (!timeAllowed(context.gameMinute, rule.timeWindows)) {
      return result(STATUS.IMPOSSIBLE, REASON.TIME_WINDOW_CLOSED, request, targetResolution, target, baseResult);
    }
    if (rule.requiresSameSettlement && (!context.actorLocation.settlementRef || !target.location.settlementRef ||
        context.actorLocation.settlementRef !== target.location.settlementRef)) {
      return result(STATUS.IMPOSSIBLE, REASON.LOCATION_MISMATCH, request, targetResolution, target, baseResult);
    }
    if (rule.requiresSameSite && (!context.actorLocation.siteRef || !target.location.siteRef ||
        context.actorLocation.siteRef !== target.location.siteRef)) {
      return result(STATUS.IMPOSSIBLE, REASON.LOCATION_MISMATCH, request, targetResolution, target, baseResult);
    }
    if (rule.requiredActorTags.some((tag) => !context.actorTags.includes(tag))) {
      return result(STATUS.IMPOSSIBLE, REASON.PREREQUISITE_NOT_MET, request, targetResolution, target, baseResult);
    }

    return result(STATUS.ALLOWED, REASON.OK, request, targetResolution, target, baseResult);
  }

  function canonicalStringify(candidateRequest) {
    return JSON.stringify(normalizeRequest(candidateRequest));
  }

  window.Game.InteractionValidation = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: 'simulation',
    statuses: STATUS,
    reasonCodes: REASON,
    normalizeRequest,
    canonicalStringify,
    validate
  });
})();
