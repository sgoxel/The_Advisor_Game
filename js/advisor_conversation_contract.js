/*
  R04-T16 / #180
  Deterministic Advisor conversation and non-binding influence contract.

  This module normalizes a free-text Advisor message against an authoritative
  Simulation context and produces immutable character-owned advisory context.
  It never validates, executes, resolves, or mutates authoritative world state.
  The deterministic Local BOT can consume this record without any external LLM.
*/

window.Game = window.Game || {};

(function () {
  const SCHEMA_VERSION = 1;
  const MAX_MESSAGE_LENGTH = 2000;

  const STATUS = Object.freeze({
    READY: 'ready',
    REJECTED: 'rejected'
  });

  const REASON = Object.freeze({
    OK: 'OK',
    INVALID_SIMULATION_CONTEXT: 'INVALID_SIMULATION_CONTEXT',
    EMPTY_ADVISOR_MESSAGE: 'EMPTY_ADVISOR_MESSAGE'
  });

  const MESSAGE_KIND = Object.freeze({
    QUESTION: 'question',
    WARNING: 'warning',
    RECOMMENDATION: 'recommendation',
    REQUEST: 'request',
    EXPLANATION: 'explanation'
  });

  const DISPOSITION = Object.freeze({
    ACCEPTED: 'accepted',
    REJECTED: 'rejected',
    DELAYED: 'delayed',
    REINTERPRETED: 'reinterpreted'
  });

  const BIAS = Object.freeze({
    NEUTRAL: 'neutral',
    RECEPTIVE: 'receptive',
    SKEPTICAL: 'skeptical',
    CAUTIOUS: 'cautious',
    INDEPENDENT: 'independent'
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function cleanString(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  }

  function cleanMessage(value) {
    return cleanString(value).slice(0, MAX_MESSAGE_LENGTH);
  }

  function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
  }

  function normalizeStringArray(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
      .map((item) => cleanString(item))
      .filter(Boolean)))
      .sort();
  }

  function normalizeBias(value) {
    const normalized = cleanString(value).toLowerCase();
    return Object.values(BIAS).includes(normalized) ? normalized : BIAS.NEUTRAL;
  }

  function normalizeContext(input) {
    const source = input && typeof input === 'object' ? input : {};
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      authority: cleanString(source.authority).toLowerCase(),
      actorId: cleanString(source.actorId),
      campaignRef: cleanString(source.campaignRef),
      locationRef: cleanString(source.locationRef),
      worldRef: cleanString(source.worldRef),
      regionRef: cleanString(source.regionRef),
      contextRevision: nonNegativeInteger(source.contextRevision),
      campaignMinute: nonNegativeInteger(source.campaignMinute),
      actorStateRef: cleanString(source.actorStateRef) || null,
      adviceDispositionBias: normalizeBias(source.adviceDispositionBias),
      knownFactRefs: normalizeStringArray(source.knownFactRefs)
    });
  }

  function classifyMessage(messageInput) {
    const message = cleanMessage(messageInput);
    const lower = message.toLowerCase();

    if (/\?$/.test(message) || /^(who|what|where|when|why|how|is|are|can|could|would|should)\b/.test(lower)) {
      return MESSAGE_KIND.QUESTION;
    }
    if (/\b(beware|warning|warn|danger|dangerous|careful|caution|avoid|unsafe|risk|risky)\b/.test(lower)) {
      return MESSAGE_KIND.WARNING;
    }
    if (/\b(recommend|suggest|consider|should|could|might want|advise)\b/.test(lower)) {
      return MESSAGE_KIND.RECOMMENDATION;
    }
    if (/^(please\b|can you\b|could you\b|would you\b)/.test(lower)) {
      return MESSAGE_KIND.REQUEST;
    }
    return MESSAGE_KIND.EXPLANATION;
  }

  function hasDirectControlLanguage(messageInput) {
    const lower = cleanMessage(messageInput).toLowerCase();
    return /\b(must|obey|do exactly|you have to)\b/.test(lower)
      || /^(go|move|travel|visit|attack|arrest|buy|sell|build|join|leave|talk|speak)\b/.test(lower);
  }

  function requestsDelay(messageInput) {
    const lower = cleanMessage(messageInput).toLowerCase();
    return /\b(later|eventually|when safe|when possible|not now|wait|afterwards|tomorrow)\b/.test(lower);
  }

  function stableHash(textInput) {
    const value = String(textInput || '');
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function chooseDisposition(message, kind, context) {
    if (hasDirectControlLanguage(message) || context.adviceDispositionBias === BIAS.INDEPENDENT) {
      return DISPOSITION.REINTERPRETED;
    }
    if (requestsDelay(message)) return DISPOSITION.DELAYED;
    if (context.adviceDispositionBias === BIAS.SKEPTICAL) return DISPOSITION.REJECTED;
    if (context.adviceDispositionBias === BIAS.RECEPTIVE) return DISPOSITION.ACCEPTED;
    if (context.adviceDispositionBias === BIAS.CAUTIOUS) {
      return kind === MESSAGE_KIND.WARNING ? DISPOSITION.ACCEPTED : DISPOSITION.DELAYED;
    }
    if (kind === MESSAGE_KIND.WARNING) return DISPOSITION.ACCEPTED;

    const options = [
      DISPOSITION.ACCEPTED,
      DISPOSITION.REJECTED,
      DISPOSITION.DELAYED,
      DISPOSITION.REINTERPRETED
    ];
    const key = [context.actorId, context.contextRevision, context.campaignMinute, kind, message].join('|');
    return options[stableHash(key) % options.length];
  }

  function interpretationFor(kind) {
    if (kind === MESSAGE_KIND.QUESTION) return 'The Advisor is asking for the protagonist’s judgment or knowledge.';
    if (kind === MESSAGE_KIND.WARNING) return 'The Advisor is warning the protagonist about a possible risk.';
    if (kind === MESSAGE_KIND.RECOMMENDATION) return 'The Advisor is recommending a possible course of action.';
    if (kind === MESSAGE_KIND.REQUEST) return 'The Advisor is requesting that the protagonist consider something.';
    return 'The Advisor is providing information or an explanation for the protagonist to consider.';
  }

  function responseFor(disposition) {
    if (disposition === DISPOSITION.ACCEPTED) return 'I understand. I will consider that now when I decide what to do.';
    if (disposition === DISPOSITION.REJECTED) return 'I understand your advice, but I do not intend to follow it right now.';
    if (disposition === DISPOSITION.DELAYED) return 'I understand. I will keep it in mind and reconsider when the circumstances fit.';
    return 'I understand the suggestion. I will treat it as advice and decide for myself what is appropriate.';
  }

  function influenceFor(disposition) {
    const effect = disposition === DISPOSITION.ACCEPTED
      ? 'consider-now'
      : disposition === DISPOSITION.DELAYED
        ? 'consider-later'
        : disposition === DISPOSITION.REINTERPRETED
          ? 'consider-reinterpreted'
          : 'no-positive-weight';

    return deepFreeze({
      type: 'non-binding-advisory-context',
      effect,
      canAffectCandidateEvaluation: disposition !== DISPOSITION.REJECTED,
      directActionAuthority: false,
      directMovementAuthority: false,
      directLegalityAuthority: false,
      directResolutionAuthority: false
    });
  }

  function result(status, reasonCode, message, kind, context, disposition, record) {
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      authority: 'character-advice',
      driver: 'local-bot-compatible',
      externalLlmRequired: false,
      status,
      reasonCode,
      canInfluenceDecision: status === STATUS.READY && disposition !== DISPOSITION.REJECTED,
      canValidateAction: false,
      canExecuteAction: false,
      canResolveAction: false,
      canMutateWorld: false,
      advisorMessage: message,
      messageKind: kind,
      context,
      disposition,
      record
    });
  }

  function normalize(messageInput, authoritativeContextInput) {
    const message = cleanMessage(messageInput);
    const context = normalizeContext(authoritativeContextInput);

    if (context.authority !== 'simulation'
      || !context.actorId
      || !context.campaignRef
      || !context.locationRef
      || !context.worldRef
      || !context.regionRef) {
      return result(STATUS.REJECTED, REASON.INVALID_SIMULATION_CONTEXT, message, null, context, null, null);
    }

    if (!message) {
      return result(STATUS.REJECTED, REASON.EMPTY_ADVISOR_MESSAGE, '', null, context, null, null);
    }

    const kind = classifyMessage(message);
    const disposition = chooseDisposition(message, kind, context);
    const messageHash = stableHash(message).toString(16).padStart(8, '0');
    const record = deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      recordId: `advisor:${encodeURIComponent(context.actorId)}:${context.contextRevision}:${messageHash}`,
      actorId: context.actorId,
      campaignRef: context.campaignRef,
      locationRef: context.locationRef,
      contextRevision: context.contextRevision,
      campaignMinute: context.campaignMinute,
      source: 'advisor',
      advisor: {
        message,
        kind,
        directControlLanguageReinterpreted: hasDirectControlLanguage(message)
      },
      character: {
        actorId: context.actorId,
        interpretation: interpretationFor(kind),
        response: responseFor(disposition),
        disposition
      },
      influence: influenceFor(disposition),
      knownFactRefs: context.knownFactRefs
    });

    return result(STATUS.READY, REASON.OK, message, kind, context, disposition, record);
  }

  function canonicalStringify(messageInput, authoritativeContextInput) {
    return JSON.stringify(normalize(messageInput, authoritativeContextInput));
  }

  window.Game.AdvisorConversationContract = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    authority: 'character-advice',
    statuses: STATUS,
    reasonCodes: REASON,
    messageKinds: MESSAGE_KIND,
    dispositions: DISPOSITION,
    biases: BIAS,
    normalizeContext,
    classifyMessage,
    normalize,
    canonicalStringify
  });
})();
