/*
  WP-002/I04
  Bounded Character-autonomy evaluation for the Advisor innkeeper-work inquiry.

  This module does not create a second autonomy authority. It consumes the existing
  AdvisorConversationContract result and maps that Character-owned disposition into
  a small decision envelope that later Simulation validation may inspect.
*/

window.Game = window.Game || {};

(function () {
  const VERSION = 1;

  const STATUS = Object.freeze({
    READY: 'ready',
    REJECTED: 'rejected'
  });

  const OUTCOME = Object.freeze({
    CONSIDER_NOW: 'consider-now',
    DELAY: 'delay',
    REJECT: 'reject'
  });

  const REASON = Object.freeze({
    OK: 'OK',
    INVALID_ADVICE_RESULT: 'INVALID_ADVICE_RESULT',
    WRONG_INTENT: 'WRONG_INTENT',
    INVALID_CHARACTER_DECISION: 'INVALID_CHARACTER_DECISION'
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function rejected(reasonCode) {
    return deepFreeze({
      version: VERSION,
      authority: 'character-decision',
      driver: 'local-bot-compatible',
      status: STATUS.REJECTED,
      reasonCode,
      intentKind: null,
      actorId: null,
      outcome: null,
      sourceDisposition: null,
      reinterpretedDirectControl: false,
      canRequestSimulationValidation: false,
      requiresSimulationValidation: false,
      canSelectTarget: false,
      canCreateOpportunity: false,
      canCommitInteraction: false,
      canMoveActor: false,
      canAwardResources: false,
      canValidateAction: false,
      canExecuteAction: false,
      canResolveAction: false,
      canMutateWorld: false,
      authoritativeTargetRef: null,
      authoritativeOpportunityRef: null
    });
  }

  function outcomeFor(disposition, dispositions) {
    if (disposition === dispositions.ACCEPTED || disposition === dispositions.REINTERPRETED) {
      return OUTCOME.CONSIDER_NOW;
    }
    if (disposition === dispositions.DELAYED) return OUTCOME.DELAY;
    if (disposition === dispositions.REJECTED) return OUTCOME.REJECT;
    return null;
  }

  function evaluate(normalizedAdviceResult) {
    const contract = window.Game.AdvisorConversationContract;
    const result = normalizedAdviceResult;

    if (!contract || !result || typeof result !== 'object'
      || result.status !== contract.statuses.READY
      || result.authority !== 'character-advice'
      || result.context?.authority !== 'simulation'
      || !result.context?.actorId
      || !result.record?.character
      || result.record.character.actorId !== result.context.actorId) {
      return rejected(REASON.INVALID_ADVICE_RESULT);
    }

    if (!result.intent || result.intent.kind !== contract.intentKinds.INQUIRE_INNKEEPER_WORK) {
      return rejected(REASON.WRONG_INTENT);
    }

    const outcome = outcomeFor(result.disposition, contract.dispositions);
    if (!outcome) return rejected(REASON.INVALID_CHARACTER_DECISION);

    const canRequestSimulationValidation = outcome === OUTCOME.CONSIDER_NOW;

    return deepFreeze({
      version: VERSION,
      authority: 'character-decision',
      driver: result.driver,
      status: STATUS.READY,
      reasonCode: REASON.OK,
      intentKind: result.intent.kind,
      actorId: result.context.actorId,
      outcome,
      sourceDisposition: result.disposition,
      reinterpretedDirectControl: result.disposition === contract.dispositions.REINTERPRETED,
      canRequestSimulationValidation,
      requiresSimulationValidation: canRequestSimulationValidation,
      canSelectTarget: false,
      canCreateOpportunity: false,
      canCommitInteraction: false,
      canMoveActor: false,
      canAwardResources: false,
      canValidateAction: false,
      canExecuteAction: false,
      canResolveAction: false,
      canMutateWorld: false,
      authoritativeTargetRef: null,
      authoritativeOpportunityRef: null
    });
  }

  window.Game.InnkeeperWorkAutonomy = Object.freeze({
    version: VERSION,
    authority: 'character-decision',
    statuses: STATUS,
    outcomes: OUTCOME,
    reasonCodes: REASON,
    evaluate
  });
})();
