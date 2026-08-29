/*
  R04-T02 / #171
  Deterministic Local BOT goal and candidate-action selection.

  This module ranks Simulation-derived opportunities and emits one candidate for
  ProtagonistDriverIntent. It never validates, executes, resolves, or mutates
  authoritative world state.
*/

window.Game = window.Game || {};

(function () {
  const SCHEMA_VERSION = 1;

  function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => freeze(value[key]));
    return value;
  }

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function integer(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeNeeds(value) {
    const source = value && typeof value === 'object' ? value : {};
    return freeze(Object.fromEntries(Object.entries(source)
      .map(([key, item]) => [text(key).toLowerCase(), clamp(integer(item), 0, 100)])
      .filter(([key]) => Boolean(key))
      .sort(([a], [b]) => a.localeCompare(b))));
  }

  function normalizeContext(input) {
    const source = input && typeof input === 'object' ? input : {};
    return freeze({
      authority: text(source.authority).toLowerCase(),
      actorId: text(source.actorId),
      campaignRef: text(source.campaignRef),
      locationRef: text(source.locationRef),
      worldRef: text(source.worldRef),
      regionRef: text(source.regionRef),
      contextRevision: Math.max(0, integer(source.contextRevision)),
      campaignMinute: Math.max(0, integer(source.campaignMinute)),
      actorStateRef: text(source.actorStateRef) || null,
      needs: normalizeNeeds(source.needs)
    });
  }

  function normalizeOpportunity(input) {
    const source = input && typeof input === 'object' ? input : {};
    return freeze({
      id: text(source.id),
      goalType: text(source.goalType).toLowerCase(),
      actionType: text(source.actionType).toLowerCase(),
      targetRef: text(source.targetRef) || null,
      locationRef: text(source.locationRef) || null,
      priority: clamp(integer(source.priority), -1000, 1000),
      urgency: clamp(integer(source.urgency), 0, 100),
      distance: clamp(integer(source.distance), 0, 1000000),
      needKey: text(source.needKey).toLowerCase() || null,
      availableFromMinute: Math.max(0, integer(source.availableFromMinute, 0)),
      availableUntilMinute: source.availableUntilMinute === null || source.availableUntilMinute === undefined
        ? null
        : Math.max(0, integer(source.availableUntilMinute, 0))
    });
  }

  function isEligible(opportunity, context) {
    if (!opportunity.id || !opportunity.goalType || !opportunity.actionType) return false;
    if (context.campaignMinute < opportunity.availableFromMinute) return false;
    if (opportunity.availableUntilMinute !== null && context.campaignMinute > opportunity.availableUntilMinute) return false;
    return true;
  }

  function score(opportunity, context) {
    const need = opportunity.needKey ? (context.needs[opportunity.needKey] || 0) : 0;
    const sameLocation = opportunity.locationRef && opportunity.locationRef === context.locationRef ? 25 : 0;
    return opportunity.priority * 1000000
      + opportunity.urgency * 10000
      + need * 100
      + sameLocation * 10
      - Math.min(opportunity.distance, 1000000);
  }

  function compare(a, b, context) {
    const delta = score(b, context) - score(a, context);
    if (delta !== 0) return delta;
    return [a.goalType, a.actionType, a.targetRef || '', a.id].join('|')
      .localeCompare([b.goalType, b.actionType, b.targetRef || '', b.id].join('|'));
  }

  function select(authoritativeContextInput, opportunitiesInput) {
    const context = normalizeContext(authoritativeContextInput);
    if (context.authority !== 'simulation' || !context.actorId || !context.campaignRef || !context.locationRef || !context.worldRef || !context.regionRef) {
      return freeze({ schemaVersion: SCHEMA_VERSION, authority: 'local-bot', status: 'rejected', reasonCode: 'INVALID_SIMULATION_CONTEXT', context, selected: null, candidate: null });
    }

    const opportunities = (Array.isArray(opportunitiesInput) ? opportunitiesInput : [])
      .map(normalizeOpportunity)
      .filter((item) => isEligible(item, context))
      .sort((a, b) => compare(a, b, context));

    if (!opportunities.length) {
      return freeze({ schemaVersion: SCHEMA_VERSION, authority: 'local-bot', status: 'idle', reasonCode: 'NO_ELIGIBLE_OPPORTUNITY', context, selected: null, candidate: null });
    }

    const selected = opportunities[0];
    const candidate = freeze({
      actorId: context.actorId,
      goalType: selected.goalType,
      actionType: selected.actionType,
      targetRef: selected.targetRef,
      expectedContextRevision: context.contextRevision
    });

    return freeze({
      schemaVersion: SCHEMA_VERSION,
      authority: 'local-bot',
      status: 'selected',
      reasonCode: 'OK',
      context,
      selected,
      candidate
    });
  }

  function buildIntent(authoritativeContextInput, opportunitiesInput) {
    const selection = select(authoritativeContextInput, opportunitiesInput);
    if (selection.status !== 'selected') return freeze({ selection, intent: null });
    const driver = window.Game?.ProtagonistDriverIntent;
    const intent = driver?.build ? driver.build(selection.candidate, selection.context) : null;
    return freeze({ selection, intent });
  }

  function canonicalStringify(authoritativeContextInput, opportunitiesInput) {
    return JSON.stringify(select(authoritativeContextInput, opportunitiesInput));
  }

  window.Game.LocalBotDriver = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: 'local-bot',
    normalizeContext,
    normalizeOpportunity,
    select,
    buildIntent,
    canonicalStringify
  });
})();
