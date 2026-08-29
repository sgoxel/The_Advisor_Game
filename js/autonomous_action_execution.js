/*
  R04-T03 / #172 + R04-T17 / #181
  Autonomous protagonist execution adapter.

  Local BOT selects; ProtagonistDriverIntent normalizes the character-owned intent;
  existing R03 Simulation validation/resolution remains the only authority that may
  mutate world truth. Optional Advisor influence is only forwarded into Local BOT
  evaluation and cannot bypass the execution, validation, or resolution gates below.
*/

window.Game = window.Game || {};

(function () {
  const Game = window.Game;
  const SCHEMA_VERSION = 1;
  const STATUS = Object.freeze({ RESOLVED: 'resolved', REJECTED: 'rejected', IDLE: 'idle' });
  const REASON = Object.freeze({
    OK: 'OK',
    LOCAL_BOT_UNAVAILABLE: 'LOCAL_BOT_UNAVAILABLE',
    DRIVER_INTENT_REJECTED: 'DRIVER_INTENT_REJECTED',
    RESOLUTION_API_UNAVAILABLE: 'RESOLUTION_API_UNAVAILABLE',
    NON_SIMULATION_EXECUTION_CONTEXT: 'NON_SIMULATION_EXECUTION_CONTEXT',
    STALE_EXECUTION_CONTEXT: 'STALE_EXECUTION_CONTEXT',
    ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
    ROUTE_KIND_UNSUPPORTED: 'ROUTE_KIND_UNSUPPORTED',
    ROUTE_TARGET_MISMATCH: 'ROUTE_TARGET_MISMATCH',
    REGION_NAVIGATION_UNAVAILABLE: 'REGION_NAVIGATION_UNAVAILABLE',
    INVALID_REGION_TRANSITION: 'INVALID_REGION_TRANSITION',
    SIMULATION_REJECTED: 'SIMULATION_REJECTED'
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function integer(value, fallback = 0) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : fallback;
  }

  function clonePlain(value, depth = 0) {
    if (depth > 10) return null;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) return value.map((entry) => clonePlain(entry, depth + 1));
    if (!value || typeof value !== 'object') return null;
    const output = {};
    Object.keys(value).sort().forEach((key) => {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') return;
      output[key] = clonePlain(value[key], depth + 1);
    });
    return output;
  }

  function normalizeRegionTransition(value) {
    if (!value || typeof value !== 'object') return null;
    const regionX = Number(value.regionX);
    const regionY = Number(value.regionY);
    if (!Number.isSafeInteger(regionX) || !Number.isSafeInteger(regionY)) return { invalid: true };
    return { regionX, regionY };
  }

  function normalizeRoute(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    return {
      opportunityId: text(source.opportunityId),
      kind: text(source.kind).toLowerCase(),
      destinationRef: text(source.destinationRef) || null,
      targetRef: text(source.targetRef) || null,
      interactionType: text(source.interactionType).toLowerCase() || null,
      targetReference: clonePlain(source.targetReference),
      expectedTargetStateRef: text(source.expectedTargetStateRef) || null,
      validationContext: clonePlain(source.validationContext),
      resolutionContext: clonePlain(source.resolutionContext),
      regionTransition: normalizeRegionTransition(source.regionTransition)
    };
  }

  function normalizeExecutionContext(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    return deepFreeze({
      authority: text(source.authority).toLowerCase(),
      revision: Math.max(0, integer(source.revision)),
      routes: (Array.isArray(source.routes) ? source.routes : [])
        .map(normalizeRoute)
        .filter((route) => route.opportunityId)
        .sort((a, b) => a.opportunityId.localeCompare(b.opportunityId))
    });
  }

  function result(status, reasonCode, selection, intent, route, simulationResult, navigation = null) {
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      authority: 'simulation',
      driver: 'local-bot',
      status,
      reasonCode,
      selectionStatus: selection?.status || null,
      selectionReasonCode: selection?.reasonCode || null,
      selectedOpportunityId: selection?.selected?.id || null,
      intentStatus: intent?.status || null,
      intentReasonCode: intent?.reasonCode || null,
      routeKind: route?.kind || null,
      simulationStatus: simulationResult?.status || null,
      simulationReasonCode: simulationResult?.reasonCode || null,
      validationReasonCode: simulationResult?.validationReasonCode || null,
      consequence: simulationResult?.consequence || null,
      navigation
    });
  }

  function rejected(reasonCode, selection, intent, route = null, simulationResult = null) {
    return result(STATUS.REJECTED, reasonCode, selection, intent, route, simulationResult, null);
  }

  function execute(authoritativeContextInput, opportunitiesInput, executionContextInput, advisorInfluenceInput) {
    const localBot = Game.LocalBotDriver;
    if (!localBot || typeof localBot.buildIntent !== 'function') {
      return rejected(REASON.LOCAL_BOT_UNAVAILABLE, null, null);
    }

    const built = localBot.buildIntent(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput);
    const selection = built.selection;
    const intent = built.intent;

    if (selection?.status === 'idle') {
      return result(STATUS.IDLE, selection.reasonCode || 'NO_ELIGIBLE_OPPORTUNITY', selection, intent, null, null, null);
    }
    if (!intent || intent.status !== Game.ProtagonistDriverIntent?.statuses?.READY || intent.canValidate !== true) {
      return rejected(REASON.DRIVER_INTENT_REJECTED, selection, intent);
    }

    const execution = normalizeExecutionContext(executionContextInput);
    if (execution.authority !== 'simulation') {
      return rejected(REASON.NON_SIMULATION_EXECUTION_CONTEXT, selection, intent);
    }
    if (execution.revision !== intent.context.contextRevision) {
      return rejected(REASON.STALE_EXECUTION_CONTEXT, selection, intent);
    }

    const route = execution.routes.find((item) => item.opportunityId === selection.selected.id);
    if (!route) return rejected(REASON.ROUTE_NOT_FOUND, selection, intent);

    const resolver = Game.WorldActionResolution;
    if (!resolver || typeof resolver.resolveSpatial !== 'function' || typeof resolver.resolveInteraction !== 'function') {
      return rejected(REASON.RESOLUTION_API_UNAVAILABLE, selection, intent, route);
    }

    if (route.kind === 'spatial') {
      if (!route.destinationRef) return rejected(REASON.ROUTE_NOT_FOUND, selection, intent, route);
      if (route.regionTransition?.invalid) return rejected(REASON.INVALID_REGION_TRANSITION, selection, intent, route);
      if (route.regionTransition && typeof Game.RegionNavigation?.activate !== 'function') {
        return rejected(REASON.REGION_NAVIGATION_UNAVAILABLE, selection, intent, route);
      }

      const request = {
        ...intent.actionIntent,
        worldRef: intent.context.worldRef,
        regionRef: intent.context.regionRef,
        spatialRevision: intent.context.contextRevision,
        destinationRef: route.destinationRef
      };
      const simulationResult = resolver.resolveSpatial(request, route.validationContext, route.resolutionContext);
      if (simulationResult.status !== resolver.statuses.RESOLVED) {
        return rejected(REASON.SIMULATION_REJECTED, selection, intent, route, simulationResult);
      }

      let navigation = null;
      if (route.regionTransition) {
        navigation = clonePlain(Game.RegionNavigation.activate(route.regionTransition.regionX, route.regionTransition.regionY));
      }
      return result(STATUS.RESOLVED, REASON.OK, selection, intent, route, simulationResult, navigation);
    }

    if (route.kind === 'interaction') {
      const selectedTargetRef = intent.candidate.targetRef;
      const routeTargetRef = route.targetRef || route.targetReference?.ref || null;
      if (!selectedTargetRef || !routeTargetRef || selectedTargetRef !== routeTargetRef) {
        return rejected(REASON.ROUTE_TARGET_MISMATCH, selection, intent, route);
      }

      const request = {
        decisionSource: 'character',
        actorId: intent.context.actorId,
        interactionType: route.interactionType || intent.candidate.actionType,
        campaignRef: intent.context.campaignRef,
        locationRef: intent.context.locationRef,
        worldRef: intent.context.worldRef,
        regionRef: intent.context.regionRef,
        contextRevision: intent.context.contextRevision,
        targetReference: route.targetReference || { ref: routeTargetRef },
        expectedTargetStateRef: route.expectedTargetStateRef
      };
      const simulationResult = resolver.resolveInteraction(request, route.validationContext, route.resolutionContext);
      if (simulationResult.status !== resolver.statuses.RESOLVED) {
        return rejected(REASON.SIMULATION_REJECTED, selection, intent, route, simulationResult);
      }
      return result(STATUS.RESOLVED, REASON.OK, selection, intent, route, simulationResult, null);
    }

    return rejected(REASON.ROUTE_KIND_UNSUPPORTED, selection, intent, route);
  }

  Game.AutonomousActionExecution = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: 'simulation',
    statuses: STATUS,
    reasonCodes: REASON,
    normalizeExecutionContext,
    execute
  });
})();
