/*
  R04-T02 / #171 + R04-T17 / #181
  Deterministic Local BOT goal and candidate-action selection.

  This module ranks Simulation-derived opportunities and emits one candidate for
  ProtagonistDriverIntent. Optional Advisor influence may change bounded candidate
  evaluation only. It never validates, executes, resolves, or mutates authoritative
  world state, and Advisor wording never becomes direct action authority.
*/

window.Game = window.Game || {};

(function () {
  const SCHEMA_VERSION = 1;
  const PRIORITY_STEP = 1000000;
  const ADVISOR_STATUS = Object.freeze({ READY: 'ready', IGNORED: 'ignored' });
  const ADVISOR_REASON = Object.freeze({
    OK: 'OK',
    INVALID_ADVISOR_RECORD: 'INVALID_ADVISOR_RECORD',
    CONTEXT_MISMATCH: 'CONTEXT_MISMATCH',
    STALE_ADVISOR_RECORD: 'STALE_ADVISOR_RECORD',
    REJECTED_BY_CHARACTER: 'REJECTED_BY_CHARACTER',
    DELAY_PENDING: 'DELAY_PENDING',
    NO_OPPORTUNITY_MATCH: 'NO_OPPORTUNITY_MATCH'
  });
  const ADVISOR_DISPOSITIONS = new Set(['accepted', 'rejected', 'delayed', 'reinterpreted']);
  const STOP_WORDS = new Set([
    'a', 'an', 'and', 'at', 'be', 'can', 'consider', 'could', 'do', 'for', 'go', 'i', 'in', 'is',
    'it', 'might', 'move', 'of', 'on', 'or', 'please', 'recommend', 'should', 'suggest', 'that', 'the',
    'to', 'want', 'would', 'you', 'your'
  ]);

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

  function tokens(value) {
    return Array.from(new Set(String(value || '')
      .toLowerCase()
      .match(/[a-z0-9]+/g) || []))
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
      .sort();
  }

  function ignoredAdvisor(reasonCode, disposition = null, effect = null, message = '') {
    return freeze({
      status: ADVISOR_STATUS.IGNORED,
      reasonCode,
      disposition,
      effect,
      message,
      messageTokens: freeze([]),
      maxBoost: 0,
      applyNow: false,
      directActionAuthority: false,
      directMovementAuthority: false,
      directLegalityAuthority: false,
      directResolutionAuthority: false
    });
  }

  function normalizeAdvisorInfluence(input, contextInput) {
    const context = contextInput && typeof contextInput === 'object' && contextInput.authority !== undefined
      ? contextInput
      : normalizeContext(contextInput);
    const source = input && typeof input === 'object' ? input : null;
    if (!source) return ignoredAdvisor(ADVISOR_REASON.INVALID_ADVISOR_RECORD);

    const record = source.record && typeof source.record === 'object' ? source.record : null;
    const advisoryContext = source.context && typeof source.context === 'object' ? source.context : null;
    const influence = record?.influence && typeof record.influence === 'object' ? record.influence : null;
    const disposition = text(source.disposition).toLowerCase();
    const effect = text(influence?.effect).toLowerCase() || null;
    const message = text(source.advisorMessage || record?.advisor?.message);

    const noAuthority = source.canValidateAction === false
      && source.canExecuteAction === false
      && source.canResolveAction === false
      && source.canMutateWorld === false
      && influence?.directActionAuthority === false
      && influence?.directMovementAuthority === false
      && influence?.directLegalityAuthority === false
      && influence?.directResolutionAuthority === false;

    if (text(source.authority).toLowerCase() !== 'character-advice'
      || text(source.status).toLowerCase() !== 'ready'
      || !record
      || !advisoryContext
      || !influence
      || text(influence.type).toLowerCase() !== 'non-binding-advisory-context'
      || !ADVISOR_DISPOSITIONS.has(disposition)
      || !message
      || !noAuthority) {
      return ignoredAdvisor(ADVISOR_REASON.INVALID_ADVISOR_RECORD, disposition || null, effect, message);
    }

    const sameIdentity = text(advisoryContext.actorId) === context.actorId
      && text(record.actorId) === context.actorId
      && text(advisoryContext.campaignRef) === context.campaignRef
      && text(record.campaignRef) === context.campaignRef
      && text(advisoryContext.locationRef) === context.locationRef
      && text(record.locationRef) === context.locationRef
      && text(advisoryContext.worldRef) === context.worldRef
      && text(advisoryContext.regionRef) === context.regionRef;
    if (!sameIdentity) return ignoredAdvisor(ADVISOR_REASON.CONTEXT_MISMATCH, disposition, effect, message);

    const adviceRevision = integer(advisoryContext.contextRevision, -1);
    const recordRevision = integer(record.contextRevision, -1);
    const adviceMinute = integer(advisoryContext.campaignMinute, -1);
    const recordMinute = integer(record.campaignMinute, -1);
    if (adviceRevision !== context.contextRevision
      || recordRevision !== context.contextRevision
      || adviceMinute < 0
      || recordMinute !== adviceMinute
      || adviceMinute > context.campaignMinute) {
      return ignoredAdvisor(ADVISOR_REASON.STALE_ADVISOR_RECORD, disposition, effect, message);
    }

    if (disposition === 'rejected') {
      return ignoredAdvisor(ADVISOR_REASON.REJECTED_BY_CHARACTER, disposition, effect, message);
    }

    if (disposition === 'delayed' && context.campaignMinute <= adviceMinute) {
      return ignoredAdvisor(ADVISOR_REASON.DELAY_PENDING, disposition, effect, message);
    }

    const maxBoost = disposition === 'accepted'
      ? 450000
      : disposition === 'reinterpreted'
        ? 250000
        : 150000;

    return freeze({
      status: ADVISOR_STATUS.READY,
      reasonCode: ADVISOR_REASON.OK,
      disposition,
      effect,
      message,
      messageTokens: freeze(tokens(message)),
      maxBoost: Math.min(maxBoost, PRIORITY_STEP - 1),
      applyNow: true,
      directActionAuthority: false,
      directMovementAuthority: false,
      directLegalityAuthority: false,
      directResolutionAuthority: false
    });
  }

  function opportunityTokens(opportunity) {
    return tokens([
      opportunity.id,
      opportunity.goalType,
      opportunity.actionType,
      opportunity.targetRef || '',
      opportunity.locationRef || ''
    ].join(' '));
  }

  function advisorMatchCount(opportunity, advisory) {
    if (advisory?.status !== ADVISOR_STATUS.READY || advisory.applyNow !== true || !advisory.messageTokens.length) return 0;
    const available = new Set(opportunityTokens(opportunity));
    return advisory.messageTokens.reduce((count, token) => count + (available.has(token) ? 1 : 0), 0);
  }

  function advisorBoost(opportunity, advisory) {
    const matches = advisorMatchCount(opportunity, advisory);
    if (!matches) return 0;
    const unit = advisory.disposition === 'accepted' ? 150000 : advisory.disposition === 'reinterpreted' ? 100000 : 75000;
    return Math.min(advisory.maxBoost, matches * unit);
  }

  function score(opportunity, context, advisory = null) {
    const need = opportunity.needKey ? (context.needs[opportunity.needKey] || 0) : 0;
    const sameLocation = opportunity.locationRef && opportunity.locationRef === context.locationRef ? 25 : 0;
    return opportunity.priority * PRIORITY_STEP
      + opportunity.urgency * 10000
      + need * 100
      + sameLocation * 10
      - Math.min(opportunity.distance, 1000000)
      + advisorBoost(opportunity, advisory);
  }

  function compare(a, b, context, advisory = null) {
    const delta = score(b, context, advisory) - score(a, context, advisory);
    if (delta !== 0) return delta;
    return [a.goalType, a.actionType, a.targetRef || '', a.id].join('|')
      .localeCompare([b.goalType, b.actionType, b.targetRef || '', b.id].join('|'));
  }

  function advisorSummary(advisory, opportunities) {
    const matchedOpportunityIds = advisory?.status === ADVISOR_STATUS.READY
      ? opportunities.filter((item) => advisorBoost(item, advisory) > 0).map((item) => item.id).sort()
      : [];
    const applied = matchedOpportunityIds.length > 0;
    let reasonCode = advisory?.reasonCode || ADVISOR_REASON.INVALID_ADVISOR_RECORD;
    if (advisory?.status === ADVISOR_STATUS.READY && !applied) reasonCode = ADVISOR_REASON.NO_OPPORTUNITY_MATCH;
    return freeze({
      status: advisory?.status || ADVISOR_STATUS.IGNORED,
      reasonCode,
      disposition: advisory?.disposition || null,
      effect: advisory?.effect || null,
      applied,
      matchedOpportunityIds: freeze(matchedOpportunityIds),
      directActionAuthority: false,
      directMovementAuthority: false,
      directLegalityAuthority: false,
      directResolutionAuthority: false
    });
  }

  function withAdvisor(base, advisorSupplied, advisory, opportunities = []) {
    if (!advisorSupplied) return freeze(base);
    return freeze({ ...base, advisory: advisorSummary(advisory, opportunities) });
  }

  function select(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput) {
    const context = normalizeContext(authoritativeContextInput);
    const advisorSupplied = advisorInfluenceInput !== undefined && advisorInfluenceInput !== null;
    const advisory = advisorSupplied ? normalizeAdvisorInfluence(advisorInfluenceInput, context) : null;
    if (context.authority !== 'simulation' || !context.actorId || !context.campaignRef || !context.locationRef || !context.worldRef || !context.regionRef) {
      return withAdvisor({ schemaVersion: SCHEMA_VERSION, authority: 'local-bot', status: 'rejected', reasonCode: 'INVALID_SIMULATION_CONTEXT', context, selected: null, candidate: null }, advisorSupplied, ignoredAdvisor(ADVISOR_REASON.CONTEXT_MISMATCH), []);
    }

    const opportunities = (Array.isArray(opportunitiesInput) ? opportunitiesInput : [])
      .map(normalizeOpportunity)
      .filter((item) => isEligible(item, context))
      .sort((a, b) => compare(a, b, context, advisory));

    if (!opportunities.length) {
      return withAdvisor({ schemaVersion: SCHEMA_VERSION, authority: 'local-bot', status: 'idle', reasonCode: 'NO_ELIGIBLE_OPPORTUNITY', context, selected: null, candidate: null }, advisorSupplied, advisory, opportunities);
    }

    const selected = opportunities[0];
    const candidate = freeze({
      actorId: context.actorId,
      goalType: selected.goalType,
      actionType: selected.actionType,
      targetRef: selected.targetRef,
      expectedContextRevision: context.contextRevision
    });

    return withAdvisor({
      schemaVersion: SCHEMA_VERSION,
      authority: 'local-bot',
      status: 'selected',
      reasonCode: 'OK',
      context,
      selected,
      candidate
    }, advisorSupplied, advisory, opportunities);
  }

  function buildIntent(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput) {
    const selection = select(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput);
    if (selection.status !== 'selected') return freeze({ selection, intent: null });
    const driver = window.Game?.ProtagonistDriverIntent;
    const intent = driver?.build ? driver.build(selection.candidate, selection.context) : null;
    return freeze({ selection, intent });
  }

  function canonicalStringify(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput) {
    return JSON.stringify(select(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput));
  }

  window.Game.LocalBotDriver = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: 'local-bot',
    advisorStatuses: ADVISOR_STATUS,
    advisorReasonCodes: ADVISOR_REASON,
    normalizeContext,
    normalizeOpportunity,
    normalizeAdvisorInfluence,
    select,
    buildIntent,
    canonicalStringify
  });
})();
