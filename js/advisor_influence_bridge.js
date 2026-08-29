/* R04 #248: bind pending free-text Advisor influence to the verified #181 Local BOT decision boundary. */
window.Game = window.Game || {};
(function () {
  const Game = window.Game;
  const base = Game.LocalBotDriver;
  if (!base || typeof base.select !== 'function' || base.advisorChatBridge === true) return;

  function hasExplicitAdvisor(value) {
    return value !== undefined && value !== null;
  }

  function pendingAdvisor(contextInput) {
    const ui = Game.AdvisorChatUI;
    if (!ui || typeof ui.peekPendingInfluenceForDecision !== 'function') return null;
    return ui.peekPendingInfluenceForDecision(contextInput);
  }

  function consumePendingIfDecisionRan(pending, result) {
    if (!pending || result?.status === 'idle') return;
    Game.AdvisorChatUI?.markPendingInfluenceConsumed?.();
  }

  function select(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput) {
    if (hasExplicitAdvisor(advisorInfluenceInput)) {
      return base.select(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput);
    }
    const pending = pendingAdvisor(authoritativeContextInput);
    const result = base.select(authoritativeContextInput, opportunitiesInput, pending);
    consumePendingIfDecisionRan(pending, result);
    return result;
  }

  function buildIntent(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput) {
    const selection = select(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput);
    if (selection.status !== 'selected') return Object.freeze({ selection, intent: null });
    const driver = Game.ProtagonistDriverIntent;
    const intent = driver?.build ? driver.build(selection.candidate, selection.context) : null;
    return Object.freeze({ selection, intent });
  }

  function canonicalStringify(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput) {
    if (hasExplicitAdvisor(advisorInfluenceInput)) {
      return base.canonicalStringify(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput);
    }
    return base.canonicalStringify(authoritativeContextInput, opportunitiesInput);
  }

  Game.LocalBotDriver = Object.freeze({
    ...base,
    advisorChatBridge: true,
    select,
    buildIntent,
    canonicalStringify
  });
})();