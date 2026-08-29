/* R04 / #271: let Local BOT consume the same read-only Simulation-backed character truth used by compatible drivers. */
(function installLocalBotCharacterContextBridge(global) {
  'use strict';

  const Game = global.Game = global.Game || {};
  const BRIDGE_VERSION = 'r04-local-bot-character-context-v1';
  const MAX_URGENCY_DELTA = 20;
  const INVALID_REASON = 'INVALID_CHARACTER_CONTEXT';

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.keys(value).forEach((key) => deepFreeze(value[key]));
    return value;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function characterInput(authoritativeContextInput, explicitCharacterContext) {
    if (explicitCharacterContext !== undefined && explicitCharacterContext !== null) return explicitCharacterContext;
    const source = authoritativeContextInput && typeof authoritativeContextInput === 'object' ? authoritativeContextInput : {};
    return source.characterContext && typeof source.characterContext === 'object' ? source.characterContext : null;
  }

  function validateCharacterContext(api, candidate, simulationContext) {
    if (!candidate) return deepFreeze({ supplied: false, ok: true, context: null, fingerprint: null });

    const policy = candidate.driverPolicy && typeof candidate.driverPolicy === 'object' ? candidate.driverPolicy : {};
    const biases = candidate.current?.decisionBiases;
    const noAuthority = policy.directActionAuthority === false
      && policy.directMovementAuthority === false
      && policy.directLegalityAuthority === false
      && policy.directResolutionAuthority === false
      && policy.directWorldMutationAuthority === false
      && policy.simulationValidationRequired === true;

    const structurallyValid = candidate.authority === 'simulation'
      && candidate.version === api.version
      && candidate.characterId === simulationContext.actorId
      && candidate.worldIdentity
      && candidate.stable?.baselinePersonality
      && biases && typeof biases === 'object'
      && biases.role === 'bias-only'
      && biases.legalityAuthority === 'simulation-validation-required'
      && noAuthority;

    if (!structurallyValid) {
      return deepFreeze({ supplied: true, ok: false, context: null, fingerprint: null });
    }

    let fingerprint;
    try {
      fingerprint = api.fingerprint(candidate);
    } catch (_error) {
      return deepFreeze({ supplied: true, ok: false, context: null, fingerprint: null });
    }
    return deepFreeze({ supplied: true, ok: true, context: candidate, fingerprint });
  }

  function opportunityBiasDelta(opportunityInput, characterContext) {
    if (!characterContext) return 0;
    const opportunity = opportunityInput && typeof opportunityInput === 'object' ? opportunityInput : {};
    const biases = characterContext.current.decisionBiases || {};
    const riskLevel = clamp(number(opportunity.riskLevel), 0, 100) / 100;
    const socialIntensity = clamp(number(opportunity.socialIntensity), 0, 100) / 100;
    const persistenceDemand = clamp(number(opportunity.persistenceDemand), 0, 100) / 100;

    const riskPreference = clamp((number(biases.riskTolerance, 50) - number(biases.caution, 50)) / 100, -1, 1);
    const socialPreference = clamp((number(biases.socialApproach, 50) - 50) / 50, -1, 1);
    const persistencePreference = clamp((number(biases.persistence, 50) - 50) / 50, -1, 1);

    return clamp(Math.round(
      riskLevel * riskPreference * 16
      + socialIntensity * socialPreference * 10
      + persistenceDemand * persistencePreference * 10
    ), -MAX_URGENCY_DELTA, MAX_URGENCY_DELTA);
  }

  function characterEvidence(validated) {
    if (!validated.supplied || !validated.ok) return null;
    const context = validated.context;
    return deepFreeze({
      status: 'ready',
      authority: 'simulation',
      version: context.version,
      characterId: context.characterId,
      fingerprint: validated.fingerprint,
      decisionBiases: {
        riskTolerance: number(context.current.decisionBiases.riskTolerance, 50),
        caution: number(context.current.decisionBiases.caution, 50),
        socialApproach: number(context.current.decisionBiases.socialApproach, 50),
        persistence: number(context.current.decisionBiases.persistence, 50)
      },
      directActionAuthority: false,
      directMovementAuthority: false,
      directLegalityAuthority: false,
      directResolutionAuthority: false,
      directWorldMutationAuthority: false,
      simulationValidationRequired: true
    });
  }

  function install() {
    const base = Game.LocalBotDriver;
    const contextApi = Game.CharacterDriverContext;
    if (!base || typeof base.select !== 'function' || !contextApi?.compose || !contextApi?.fingerprint) return false;
    if (base.characterContextBridge === true && base.characterContextBridgeVersion === BRIDGE_VERSION) return true;

    function invalidCharacterResult(authoritativeContextInput) {
      const context = base.normalizeContext(authoritativeContextInput);
      return deepFreeze({
        schemaVersion: base.schemaVersion,
        authority: 'local-bot',
        status: 'rejected',
        reasonCode: INVALID_REASON,
        context,
        selected: null,
        candidate: null,
        characterContext: deepFreeze({ status: 'rejected', reasonCode: INVALID_REASON })
      });
    }

    function select(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput, explicitCharacterContext) {
      const simulationContext = base.normalizeContext(authoritativeContextInput);
      const supplied = characterInput(authoritativeContextInput, explicitCharacterContext);
      const validated = validateCharacterContext(contextApi, supplied, simulationContext);
      if (!validated.ok) return invalidCharacterResult(authoritativeContextInput);
      if (!validated.supplied) return base.select(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput);

      const rawOpportunities = Array.isArray(opportunitiesInput) ? opportunitiesInput : [];
      const adjusted = rawOpportunities.map((source) => {
        const normalized = base.normalizeOpportunity(source);
        const delta = opportunityBiasDelta(source, validated.context);
        return { ...source, urgency: clamp(normalized.urgency + delta, 0, 100) };
      });
      const selected = base.select(authoritativeContextInput, adjusted, advisorInfluenceInput);
      const originalSelected = selected?.selected
        ? rawOpportunities.find((entry) => String(entry?.id || '').trim() === selected.selected.id)
        : null;
      const restoredSelected = originalSelected ? base.normalizeOpportunity(originalSelected) : selected?.selected || null;

      return deepFreeze({
        ...selected,
        selected: restoredSelected,
        characterContext: characterEvidence(validated)
      });
    }

    function buildIntent(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput, explicitCharacterContext) {
      const selection = select(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput, explicitCharacterContext);
      if (selection.status !== 'selected') return deepFreeze({ selection, intent: null });
      const driver = Game.ProtagonistDriverIntent;
      const intent = driver?.build ? driver.build(selection.candidate, selection.context) : null;
      return deepFreeze({ selection, intent });
    }

    function canonicalStringify(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput, explicitCharacterContext) {
      return JSON.stringify(select(authoritativeContextInput, opportunitiesInput, advisorInfluenceInput, explicitCharacterContext));
    }

    Game.LocalBotDriver = Object.freeze({
      ...base,
      characterContextBridge: true,
      characterContextBridgeVersion: BRIDGE_VERSION,
      characterContextVersion: contextApi.version,
      invalidCharacterContextReason: INVALID_REASON,
      normalizeCharacterContext(candidate, authoritativeContextInput) {
        return validateCharacterContext(contextApi, candidate, base.normalizeContext(authoritativeContextInput));
      },
      characterOpportunityBiasDelta: opportunityBiasDelta,
      select,
      buildIntent,
      canonicalStringify
    });
    return true;
  }

  if (!install()) {
    if (global.document?.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', install, { once: true });
    }
    global.addEventListener?.('load', install, { once: true });
  }
})(typeof window !== 'undefined' ? window : globalThis);
