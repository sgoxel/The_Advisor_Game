/*
  R03-T05 / #160
  Deterministic Simulation-owned NPC/location/animal/creature interaction validation.

  This layer composes the approved InteractionTarget contract. It validates only;
  it never mutates or resolves authoritative world state.
*/

window.Game = window.Game || {};

(function () {
  const SCHEMA_VERSION = 1;
  const STATUS = Object.freeze({ ALLOWED: 'allowed', REJECTED: 'rejected', IMPOSSIBLE: 'impossible' });
  const REASON = Object.freeze({
    OK: 'OK',
    TARGET_CONTRACT_UNAVAILABLE: 'TARGET_CONTRACT_UNAVAILABLE',
    NON_SIMULATION_CONTEXT: 'NON_SIMULATION_CONTEXT',
    MALFORMED_INTERACTION_REQUEST: 'MALFORMED_INTERACTION_REQUEST',
    STALE_INTERACTION_CONTEXT: 'STALE_INTERACTION_CONTEXT',
    WORLD_CONTEXT_MISMATCH: 'WORLD_CONTEXT_MISMATCH',
    REGION_CONTEXT_MISMATCH: 'REGION_CONTEXT_MISMATCH',
    TARGET_NOT_FOUND: 'TARGET_NOT_FOUND',
    TARGET_CATEGORY_MISMATCH: 'TARGET_CATEGORY_MISMATCH',
    TARGET_UNAVAILABLE: 'TARGET_UNAVAILABLE',
    TARGET_INACTIVE: 'TARGET_INACTIVE',
    ACTOR_LOCATION_MISMATCH: 'ACTOR_LOCATION_MISMATCH',
    TIME_WINDOW_CLOSED: 'TIME_WINDOW_CLOSED',
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
      .filter(Boolean))).sort();
  }

  function normalizeRequest(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      actorId: cleanString(source.actorId),
      actorLocationRef: cleanString(source.actorLocationRef),
      interactionType: cleanString(source.interactionType).toLowerCase(),
      targetRef: cleanString(source.targetRef),
      targetCategory: cleanString(source.targetCategory).toLowerCase(),
      worldRef: cleanString(source.worldRef),
      regionRef: cleanString(source.regionRef),
      contextRevision: nonNegativeInteger(source.contextRevision),
      gameHour: nonNegativeInteger(source.gameHour) % 24
    });
  }

  function normalizeRule(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const startHour = nonNegativeInteger(source.startHour) % 24;
    const endHour = nonNegativeInteger(source.endHour) % 24;
    return {
      targetRef: cleanString(source.targetRef),
      interactionType: cleanString(source.interactionType).toLowerCase(),
      requiredActorTags: stringSet(source.requiredActorTags),
      requiredLocationRef: cleanString(source.requiredLocationRef) || null,
      startHour,
      endHour,
      hasTimeWindow: source.startHour != null || source.endHour != null
    };
  }

  function normalizeContext(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const targets = Array.isArray(source.targets) ? source.targets : [];
    return {
      authority: cleanString(source.authority).toLowerCase(),
      actorId: cleanString(source.actorId),
      actorLocationRef: cleanString(source.actorLocationRef),
      worldRef: cleanString(source.worldRef),
      regionRef: cleanString(source.regionRef),
      revision: nonNegativeInteger(source.revision),
      actorTags: stringSet(source.actorTags),
      targets,
      interactionRules: (Array.isArray(source.interactionRules) ? source.interactionRules : [])
        .map(normalizeRule)
        .filter((rule) => rule.targetRef && rule.interactionType)
        .sort((a, b) => a.targetRef.localeCompare(b.targetRef) || a.interactionType.localeCompare(b.interactionType))
    };
  }

  function withinWindow(hour, rule) {
    if (!rule.hasTimeWindow) return true;
    if (rule.startHour === rule.endHour) return true;
    if (rule.startHour < rule.endHour) return hour >= rule.startHour && hour < rule.endHour;
    return hour >= rule.startHour || hour < rule.endHour;
  }

  function result(status, reasonCode, request, target) {
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      authority: 'simulation',
      status,
      reasonCode,
      canResolve: status === STATUS.ALLOWED,
      request,
      target: target ? deepFreeze(target) : null
    });
  }

  function validate(candidateRequest, authoritativeContext) {
    const request = normalizeRequest(candidateRequest);
    const context = normalizeContext(authoritativeContext);
    const targetApi = window.Game?.InteractionTarget;

    if (!targetApi || typeof targetApi.resolve !== 'function') {
      return result(STATUS.REJECTED, REASON.TARGET_CONTRACT_UNAVAILABLE, request, null);
    }
    if (!request.actorId || !request.actorLocationRef || !request.interactionType || !request.targetRef ||
        !request.targetCategory || !request.worldRef || !request.regionRef) {
      return result(STATUS.REJECTED, REASON.MALFORMED_INTERACTION_REQUEST, request, null);
    }
    if (context.authority !== 'simulation') {
      return result(STATUS.REJECTED, REASON.NON_SIMULATION_CONTEXT, request, null);
    }
    if (request.contextRevision !== context.revision) {
      return result(STATUS.REJECTED, REASON.STALE_INTERACTION_CONTEXT, request, null);
    }
    if (!context.worldRef || request.worldRef !== context.worldRef) {
      return result(STATUS.REJECTED, REASON.WORLD_CONTEXT_MISMATCH, request, null);
    }
    if (!context.regionRef || request.regionRef !== context.regionRef) {
      return result(STATUS.REJECTED, REASON.REGION_CONTEXT_MISMATCH, request, null);
    }
    if (context.actorId && request.actorId !== context.actorId) {
      return result(STATUS.REJECTED, REASON.MALFORMED_INTERACTION_REQUEST, request, null);
    }
    if (context.actorLocationRef && request.actorLocationRef !== context.actorLocationRef) {
      return result(STATUS.IMPOSSIBLE, REASON.ACTOR_LOCATION_MISMATCH, request, null);
    }

    const reference = targetApi.normalizeReference({
      ref: request.targetRef,
      category: request.targetCategory,
      worldRef: request.worldRef,
      regionRef: request.regionRef,
      contextRevision: request.contextRevision
    });
    const resolved = targetApi.resolve(reference, {
      authority: context.authority,
      worldRef: context.worldRef,
      regionRef: context.regionRef,
      revision: context.revision,
      targets: context.targets
    });

    if (resolved.status !== targetApi.statuses.RESOLVED) {
      const mapped = REASON[resolved.reasonCode] || resolved.reasonCode || REASON.TARGET_NOT_FOUND;
      return result(STATUS.REJECTED, mapped, request, null);
    }

    const target = resolved.target;
    if (!target.available) return result(STATUS.IMPOSSIBLE, REASON.TARGET_UNAVAILABLE, request, target);
    if (target.relevance === 'inactive') return result(STATUS.IMPOSSIBLE, REASON.TARGET_INACTIVE, request, target);

    const rule = context.interactionRules.find((item) =>
      item.targetRef === request.targetRef && item.interactionType === request.interactionType);
    if (rule) {
      if (rule.requiredLocationRef && request.actorLocationRef !== rule.requiredLocationRef) {
        return result(STATUS.IMPOSSIBLE, REASON.ACTOR_LOCATION_MISMATCH, request, target);
      }
      if (!withinWindow(request.gameHour, rule)) {
        return result(STATUS.IMPOSSIBLE, REASON.TIME_WINDOW_CLOSED, request, target);
      }
      if (rule.requiredActorTags.some((tag) => !context.actorTags.includes(tag))) {
        return result(STATUS.IMPOSSIBLE, REASON.PREREQUISITE_NOT_MET, request, target);
      }
    }

    return result(STATUS.ALLOWED, REASON.OK, request, target);
  }

  window.Game.WorldInteractionValidation = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: 'simulation',
    statuses: STATUS,
    reasonCodes: REASON,
    normalizeRequest,
    validate
  });
})();
