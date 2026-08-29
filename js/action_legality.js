/*
  R03-T01 / #156
  Deterministic Simulation-owned action-intent and legality contract.

  This module validates candidate action intents without mutating authoritative
  world state. Presentation/UI data may request inspection but cannot inject an
  allowed result: legality is derived only from normalized intent plus the
  Simulation-owned authoritative context supplied to validate().
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
    MALFORMED_INTENT: 'MALFORMED_INTENT',
    DIRECT_CONTROL_FORBIDDEN: 'DIRECT_CONTROL_FORBIDDEN',
    ACTOR_CONTEXT_MISMATCH: 'ACTOR_CONTEXT_MISMATCH',
    STALE_CAMPAIGN_REFERENCE: 'STALE_CAMPAIGN_REFERENCE',
    STALE_LOCATION_REFERENCE: 'STALE_LOCATION_REFERENCE',
    ACTION_NOT_SUPPORTED: 'ACTION_NOT_SUPPORTED',
    ACTION_CURRENTLY_IMPOSSIBLE: 'ACTION_CURRENTLY_IMPOSSIBLE',
    TARGET_REQUIRED: 'TARGET_REQUIRED',
    TARGET_NOT_FOUND: 'TARGET_NOT_FOUND',
    TARGET_CATEGORY_NOT_APPLICABLE: 'TARGET_CATEGORY_NOT_APPLICABLE'
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

  function normalizeIntent(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const targetRef = source.targetRef === null || source.targetRef === undefined
      ? null
      : cleanString(source.targetRef) || null;

    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      decisionSource: cleanString(source.decisionSource).toLowerCase(),
      actorId: cleanString(source.actorId),
      actionType: cleanString(source.actionType).toLowerCase(),
      campaignRef: cleanString(source.campaignRef),
      locationRef: cleanString(source.locationRef),
      targetRef
    });
  }

  function normalizeTarget(target) {
    const source = target && typeof target === 'object' ? target : {};
    return {
      ref: cleanString(source.ref),
      category: cleanString(source.category).toLowerCase()
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
        requiresTarget: definition.requiresTarget === true,
        allowedTargetCategories: Array.isArray(definition.allowedTargetCategories)
          ? Array.from(new Set(definition.allowedTargetCategories
            .map((category) => cleanString(category).toLowerCase())
            .filter(Boolean)))
            .sort()
          : []
      };
    });

    const normalizedTargets = (Array.isArray(source.targets) ? source.targets : [])
      .map(normalizeTarget)
      .filter((target) => target.ref)
      .sort((a, b) => a.ref.localeCompare(b.ref) || a.category.localeCompare(b.category));

    return {
      actorId: cleanString(source.actorId),
      campaignRef: cleanString(source.campaignRef),
      locationRef: cleanString(source.locationRef),
      actions: normalizedActions,
      targets: normalizedTargets
    };
  }

  function result(status, reasonCode, intent) {
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      authority: 'simulation',
      status,
      reasonCode,
      canResolve: status === STATUS.ALLOWED,
      intent
    });
  }

  function validate(candidateIntent, authoritativeContext) {
    const intent = normalizeIntent(candidateIntent);
    const context = normalizeContext(authoritativeContext);

    if (!intent.actorId || !intent.actionType || !intent.campaignRef || !intent.locationRef) {
      return result(STATUS.REJECTED, REASON.MALFORMED_INTENT, intent);
    }

    if (intent.decisionSource !== 'character') {
      return result(STATUS.REJECTED, REASON.DIRECT_CONTROL_FORBIDDEN, intent);
    }

    if (!context.actorId || intent.actorId !== context.actorId) {
      return result(STATUS.REJECTED, REASON.ACTOR_CONTEXT_MISMATCH, intent);
    }

    if (!context.campaignRef || intent.campaignRef !== context.campaignRef) {
      return result(STATUS.REJECTED, REASON.STALE_CAMPAIGN_REFERENCE, intent);
    }

    if (!context.locationRef || intent.locationRef !== context.locationRef) {
      return result(STATUS.REJECTED, REASON.STALE_LOCATION_REFERENCE, intent);
    }

    const action = context.actions[intent.actionType];
    if (!action) {
      return result(STATUS.NOT_APPLICABLE, REASON.ACTION_NOT_SUPPORTED, intent);
    }

    if (!action.enabled) {
      return result(STATUS.IMPOSSIBLE, REASON.ACTION_CURRENTLY_IMPOSSIBLE, intent);
    }

    if (action.requiresTarget && !intent.targetRef) {
      return result(STATUS.REJECTED, REASON.TARGET_REQUIRED, intent);
    }

    if (intent.targetRef) {
      const target = context.targets.find((item) => item.ref === intent.targetRef);
      if (!target) {
        return result(STATUS.REJECTED, REASON.TARGET_NOT_FOUND, intent);
      }
      if (action.allowedTargetCategories.length > 0 && !action.allowedTargetCategories.includes(target.category)) {
        return result(STATUS.NOT_APPLICABLE, REASON.TARGET_CATEGORY_NOT_APPLICABLE, intent);
      }
    }

    return result(STATUS.ALLOWED, REASON.OK, intent);
  }

  function canonicalStringify(candidateIntent) {
    return JSON.stringify(normalizeIntent(candidateIntent));
  }

  window.Game.ActionLegality = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: 'simulation',
    statuses: STATUS,
    reasonCodes: REASON,
    normalizeIntent,
    canonicalStringify,
    validate
  });
})();
